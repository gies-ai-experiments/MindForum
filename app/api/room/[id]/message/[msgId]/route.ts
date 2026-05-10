import { NextRequest, NextResponse } from "next/server";
import { editMessage, getMessageRoomId, getParticipant } from "@/lib/store";
import { broadcast } from "@/lib/sse";
import { checkRate, clientIp, rateLimited } from "@/lib/ratelimit";
import { assertActiveRoom, httpErrorResponse } from "@/lib/creator-auth";

export const runtime = "nodejs";

const MAX_CONTENT = 4000;

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; msgId: string }> }
) {
  const rate = checkRate("edit", clientIp(req), 30, 60 * 1000);
  if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);

  const { id, msgId } = await ctx.params;
  try {
    await assertActiveRoom(id);
  } catch (err) {
    return httpErrorResponse(err);
  }

  const pid = req.cookies.get(`mindforum_pid_${id}`)?.value;
  const participant = pid ? await getParticipant(id, pid) : null;
  if (!participant) return NextResponse.json({ error: "not_joined" }, { status: 401 });

  // Cross-room safety check matches the react route's pattern.
  const ownerRoom = await getMessageRoomId(msgId);
  if (ownerRoom !== id) {
    return NextResponse.json({ error: "message_not_found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) return NextResponse.json({ error: "empty" }, { status: 400 });

  const updated = await editMessage(msgId, participant.id, content.slice(0, MAX_CONTENT));
  // Existence / cross-room mismatches are handled above with a 404. A null
  // result here is treated as a failed edit authorization and returns 403.
  if (!updated) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // Reuse the existing message_updated event the AI stream already uses, with
  // an extra editedAt field so clients can render "(edited)".
  broadcast(id, "message_updated", {
    id: msgId,
    content: updated.content,
    editedAt: updated.editedAt,
  });

  return NextResponse.json({ ok: true, content: updated.content, editedAt: updated.editedAt });
}
