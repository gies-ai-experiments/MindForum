import { NextRequest } from "next/server";
import {
  closeExpiredPolls,
  coAdminEmails,
  getClosedPollsForRoom,
  getOpenPollsForRoom,
  getReactionsForRoom,
  getRoom,
  setParticipantLastSeen,
  snapshot,
} from "@/lib/store";
import { broadcast, subscribe, unsubscribe } from "@/lib/sse";
import { markOnline, markOffline, onlineParticipantIds } from "@/lib/presence";
import { assertActiveOrOwnerOnArchive, HttpError } from "@/lib/creator-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // Soft-delete contract: archived rooms still stream the init snapshot for
  // owner / super-admin (they may want to review history before restoring),
  // and the snapshot's `archived: true` flag tells the client to render the
  // read-only frame. Non-owner participants get 410. There are no live
  // events to suppress because all write paths are blocked on archived rooms.
  try {
    await assertActiveOrOwnerOnArchive(id);
  } catch (err) {
    if (err instanceof HttpError) {
      return new Response(err.code, { status: err.status });
    }
    console.error("stream gate failed:", err);
    return new Response("internal", { status: 500 });
  }

  // Lazy-close any expired polls before snapshotting, so the snapshot reflects
  // current state. Newly-closed polls also fan out to other subscribers.
  const newlyClosed = await closeExpiredPolls(id);
  for (const c of newlyClosed) broadcast(id, "poll_closed", c);

  const cookieName = `mindforum_pid_${id}`;
  const participantId = req.cookies.get(cookieName)?.value ?? null;

  const [room, reactions, openPolls, recentClosedPolls, coAdmins] = await Promise.all([
    getRoom(id),
    getReactionsForRoom(id),
    getOpenPollsForRoom(id, participantId ?? ""),
    getClosedPollsForRoom(id, 10),
    coAdminEmails(id),
  ]);
  if (!room) return new Response("Not found", { status: 404 });

  // Register presence BEFORE building the snapshot so the connecting client
  // sees itself as online. `onlineTransition` is true only on the 0→1 edge,
  // i.e. this participant had no other tab open.
  const onlineTransition = participantId ? markOnline(id, participantId) : false;

  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();

  writer.write(
    encoder.encode(
      `event: snapshot\ndata: ${JSON.stringify(
        snapshot(room, reactions, openPolls, recentClosedPolls, coAdmins, onlineParticipantIds(id)),
      )}\n\n`,
    ),
  );

  subscribe(id, writer);

  // Tell the other subscribers this participant just came online.
  if (onlineTransition && participantId) {
    broadcast(id, "presence", { participantId, online: true });
  }

  // Single idempotent teardown. Reached from both the request-abort signal
  // (clean tab close) and a failed heartbeat write (silently-dropped socket —
  // laptop lid, network loss — where `abort` never fires). Routing the
  // heartbeat failure here means a dead connection flips to yellow within ~15s
  // instead of lingering green.
  let hb: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const onClose = () => {
    if (closed) return;
    closed = true;
    if (hb) clearInterval(hb);
    unsubscribe(id, writer);
    writer.close().catch(() => {});
    if (participantId && markOffline(id, participantId)) {
      const at = Date.now();
      setParticipantLastSeen(id, participantId, at).catch((err) => {
        console.error("setParticipantLastSeen failed:", err);
      });
      broadcast(id, "presence", { participantId, online: false, lastSeenAt: at });
    }
  };

  hb = setInterval(() => {
    writer.write(encoder.encode(`: hb\n\n`)).catch(() => onClose());
  }, 15000);

  req.signal?.addEventListener("abort", onClose);

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
