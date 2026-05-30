import { NextRequest, NextResponse } from "next/server";
import {
  appendMessage,
  closeExpiredPolls,
  getChatMessagesAfter,
  getRecentChatMessages,
  getRecentMessages,
  getRoomCatchupContext,
  getRoomSummary,
  getSelectedFiles,
  setFileSummary,
  updateMessageContent,
  updateMessageGrounding,
  type Message,
} from "@/lib/store";
import { broadcast } from "@/lib/sse";
import { chatReplyStream, summarizeDocument } from "@/lib/openai";
import { needsSummary } from "@/lib/doc-context";
import { decideContextMode, renderRecapBlock, GATE, RECENT_WINDOW } from "@/lib/chat-context";
import { refreshSummaryForReply } from "@/lib/recap";
import { checkRate, clientIp, rateLimited } from "@/lib/ratelimit";
import { assertActiveRoom, httpErrorResponse } from "@/lib/creator-auth";
import { requireRoomParticipant } from "@/lib/auth-helpers";
import { roomIsClosed } from "@/lib/room-state";
import { nanoid } from "nanoid";

export const runtime = "nodejs";

const STREAM_FLUSH_MS = 1000;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rate = checkRate("message", clientIp(req), 60, 60 * 1000);
  if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);

  const { id } = await ctx.params;
  try {
    await assertActiveRoom(id);
  } catch (err) {
    return httpErrorResponse(err);
  }
  if (await roomIsClosed(id)) {
    return NextResponse.json({ error: "room_closed" }, { status: 410 });
  }

  const auth = await requireRoomParticipant(req, id);
  if (!auth.ok) return auth.response;
  const participant = auth.participant;

  // Shadow-mute: muted participants get a fake-success response so their own
  // UI shows the message (optimistic), but the row never enters the DB and
  // nobody else is broadcast to. We DO log the attempt server-side so the
  // facilitator has a record of what the muted user tried to say — not
  // persisted to the DB (would defeat the shadow-mute design), just stderr.
  if (participant.mutedAt != null) {
    const mutedBody = await req.json().catch(() => ({}));
    const attempted =
      typeof mutedBody.content === "string" ? mutedBody.content.trim().slice(0, 4000) : "";
    console.info({
      adminAction: "shadow_mute_suppress",
      roomId: id,
      pid: participant.id,
      name: participant.name,
      contentLength: attempted.length,
      contentPreview: attempted.slice(0, 200),
      at: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true, id: nanoid(10) });
  }

  // Lazy-close any expired polls so a post-expiry message also acts as a
  // close trigger for clients with stale tabs.
  const newlyClosed = await closeExpiredPolls(id);
  for (const c of newlyClosed) broadcast(id, "poll_closed", c);

  const body = await req.json().catch(() => ({}));
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) return NextResponse.json({ error: "empty" }, { status: 400 });

  const msg: Message = {
    id: nanoid(10),
    roomId: id,
    authorId: participant.id,
    authorName: participant.name,
    content: content.slice(0, 4000),
    createdAt: Date.now(),
    kind: "chat",
  };

  try {
    await appendMessage(msg);
  } catch (err) {
    console.error("appendMessage failed:", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  // Durable — safe to broadcast.
  broadcast(id, "message_added", msg);

  // Fetch the systemPrompt once here rather than pulling a full Room object.
  // If the row disappears between the roomExists check and now, the async AI
  // work will fail and report an error on the chat; no crash.
  if (/^@ai\b/i.test(content)) {
    const aiMsg: Message = {
      id: nanoid(10),
      roomId: id,
      authorId: "ai",
      authorName: "AI",
      content: "",
      createdAt: Date.now(),
      kind: "chat",
    };

    try {
      await appendMessage(aiMsg);
    } catch (err) {
      console.error("append empty ai stub failed:", err);
      return NextResponse.json({ ok: true, id: msg.id });
    }
    broadcast(id, "message_added", aiMsg);

    void (async () => {
      let lastFlush = Date.now();
      let dirty = false;
      const grounded = new Set<string>(); // file names the AI read in full
      try {
        const [ctx, selectedFiles] = await Promise.all([
          getRoomCatchupContext(id),
          getSelectedFiles(id),
        ]);
        const systemPrompt = ctx?.systemPrompt ?? "";

        // Lazy backfill: pre-existing / previously-failed files have summary=null.
        await Promise.all(
          selectedFiles.filter(needsSummary).map(async (f) => {
            try {
              const s = await summarizeDocument(f.name, f.extractedText);
              if (s) {
                await setFileSummary(id, f.id, s);
                f.summary = s;
              }
            } catch (err) {
              console.error("lazy summarize failed (using truncated full text):", err);
            }
          })
        );

        // Decide the conversation-context mode by room length. The stub AI msg is
        // already in the table (kind:"chat", empty) — exclude it from the delta,
        // the verbatim window, and the fold everywhere below.
        const chatCount = Math.max(0, (ctx?.chatCount ?? 0) - 1);
        if (chatCount <= GATE) {
          const all = await getRecentMessages(id, GATE + 1);
          windowMessages = all.filter((m) => m.id !== aiMsg.id);
        } else {
          try {
            const stored = await getRoomSummary(id);
            const deltaRaw = await getChatMessagesAfter(id, stored?.upToMsgId ?? null);
            const delta = deltaRaw.filter((m) => m.id !== aiMsg.id);
            const mode = decideContextMode({ chatCount, deltaSize: delta.length });

            if (mode === "recap-nofold") {
              windowMessages = delta; // ≤WINDOW new msgs; recap covers the rest
              recapBlock = renderRecapBlock(
                stored?.bullets ?? [],
                stored?.pinnedFacts ?? { names: [], decisions: [], files: [] }
              );
            } else {
              const fresh = await refreshSummaryForReply({
                roomId: id,
                systemPrompt,
                selectedFileNames: ctx?.selectedFileNames ?? [],
                excludeMsgId: aiMsg.id,
              });
              const recentRaw = await getRecentChatMessages(id, RECENT_WINDOW + 1);
              windowMessages = recentRaw
                .filter((m) => m.id !== aiMsg.id)
                .slice(-RECENT_WINDOW);
              recapBlock = renderRecapBlock(fresh.bullets, fresh.pinnedFacts);
            }
          } catch (err) {
            // Recap failed → degrade to today's raw path. Never block a reply.
            console.error("recap context failed (falling back to raw):", err);
            const all = await getRecentMessages(id, GATE);
            windowMessages = all.filter((m) => m.id !== aiMsg.id);
            recapBlock = "";
          }
        }

        for await (const delta of chatReplyStream(windowMessages, selectedFiles, systemPrompt, {
          recapBlock,
          onReadDocument: (name) => grounded.add(name),
        })) {
          aiMsg.content += delta;
          dirty = true;
          broadcast(id, "message_token", { id: aiMsg.id, delta });

          if (Date.now() - lastFlush >= STREAM_FLUSH_MS) {
            try {
              await updateMessageContent(aiMsg.id, aiMsg.content);
              dirty = false;
              lastFlush = Date.now();
            } catch (err) {
              // Non-fatal — retry on next tick.
              console.error("mid-stream flush failed:", err);
            }
          }
        }

        if (!aiMsg.content) {
          aiMsg.content = "(no reply)";
          dirty = true;
        }
      } catch (err) {
        console.error("chatReplyStream failed:", err);
        aiMsg.content =
          (aiMsg.content || "") +
          (aiMsg.content
            ? "\n\n⚠️ (response cut off — try again)"
            : "⚠️ I couldn't generate a response. Try again.");
        dirty = true;
        broadcast(id, "message_updated", { id: aiMsg.id, content: aiMsg.content });
      } finally {
        if (dirty) {
          try {
            await updateMessageContent(aiMsg.id, aiMsg.content);
          } catch (err) {
            console.error("final flush failed:", err);
          }
        }
        // Persist + broadcast which files the AI read in full (grounding caption).
        // Runs in finally so even a cut-off reply records what it opened.
        if (grounded.size > 0) {
          const files = [...grounded];
          try {
            await updateMessageGrounding(aiMsg.id, files);
          } catch (err) {
            console.error("persist grounding failed:", err);
          }
          broadcast(id, "message_grounding", { id: aiMsg.id, files });
        }
      }
    })();
  }

  return NextResponse.json({ ok: true, id: msg.id });
}
