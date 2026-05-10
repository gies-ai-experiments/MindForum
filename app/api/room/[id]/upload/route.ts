import { NextRequest, NextResponse } from "next/server";
import { addFile, getParticipant, type RoomFile } from "@/lib/store";
import { broadcast } from "@/lib/sse";
import { parseFile } from "@/lib/parse";
import { checkRate, clientIp, rateLimited } from "@/lib/ratelimit";
import { assertActiveRoom, httpErrorResponse } from "@/lib/creator-auth";
import { logAudit } from "@/lib/audit";
import { nanoid } from "nanoid";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARS = 200_000;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rate = checkRate("upload", clientIp(req), 10, 10 * 60 * 1000);
  if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);

  const { id } = await ctx.params;
  try {
    await assertActiveRoom(id);
  } catch (err) {
    return httpErrorResponse(err);
  }

  const pid = req.cookies.get(`mindforum_pid_${id}`)?.value;
  const participant = pid ? await getParticipant(id, pid) : null;
  if (!participant) return NextResponse.json({ error: "not_joined" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no_file" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });

  const buf = Buffer.from(await file.arrayBuffer());
  let parsed;
  try {
    parsed = await parseFile(file.name, file.type, buf);
  } catch (err) {
    return NextResponse.json(
      { error: "parse_failed", message: (err as Error).message },
      { status: 415 }
    );
  }

  const rf: RoomFile = {
    id: nanoid(10),
    roomId: id,
    name: file.name,
    mime: parsed.mime,
    sizeBytes: file.size,
    uploadedById: participant.id,
    uploadedAt: Date.now(),
    extractedText: parsed.text.slice(0, MAX_TEXT_CHARS),
    selected: true,
  };

  try {
    await addFile(rf);
  } catch (err) {
    console.error("addFile failed:", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  const { extractedText: _drop, selected: _sel, ...publicFile } = rf;
  // Participant-scoped audit row. Actor namespace is participant id, not
  // creator id — listings can disambiguate via the action column.
  await logAudit({
    actor: { id: participant.id, email: participant.email },
    action: "file.upload",
    roomId: id,
    metadata: {
      fileId: rf.id,
      fileName: rf.name,
      sizeBytes: rf.sizeBytes,
      mime: rf.mime,
    },
  });
  broadcast(id, "file_added", publicFile);
  // Fresh selection list = everything currently selected. Cheap to rebuild on the fly.
  broadcast(id, "file_selection_changed", {
    selectedFileIds: await selectedIds(id),
  });

  return NextResponse.json({ ok: true, file: publicFile });
}

async function selectedIds(roomId: string): Promise<string[]> {
  const { query } = await import("@/lib/db");
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM room_files WHERE room_id = $1 AND selected = TRUE ORDER BY uploaded_at ASC`,
    [roomId]
  );
  return rows.map((r) => r.id);
}
