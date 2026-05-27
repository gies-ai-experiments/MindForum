import { nanoid } from "nanoid";
import { logAudit } from "./audit";
import { query } from "./db";
import { broadcast } from "./sse";
import { addFile, type Participant, type RoomFile } from "./store";
import { publicRoomFile, type SourceMeta, type SourceType } from "./context-sources";

export type AttachRoomFileInput = {
  roomId: string;
  participant: Participant;
  name: string;
  mime: string;
  sizeBytes: number;
  extractedText: string;
  sourceType: SourceType;
  sourceUrl: string | null;
  sourceMeta: SourceMeta;
};

export async function attachRoomFile(input: AttachRoomFileInput) {
  const file: RoomFile = {
    id: nanoid(10),
    roomId: input.roomId,
    name: input.name,
    mime: input.mime,
    sizeBytes: input.sizeBytes,
    uploadedById: input.participant.id,
    uploadedAt: Date.now(),
    extractedText: input.extractedText,
    selected: true,
    sourceType: input.sourceType,
    sourceUrl: input.sourceUrl,
    sourceMeta: input.sourceMeta,
  };

  await addFile(file);

  await logAudit({
    actor: { id: input.participant.id, email: input.participant.email },
    action: "file.upload",
    roomId: input.roomId,
    metadata: {
      fileId: file.id,
      fileName: file.name,
      sizeBytes: file.sizeBytes,
      mime: file.mime,
      sourceType: file.sourceType,
      sourceUrl: file.sourceUrl,
      sourceMeta: file.sourceMeta,
    },
  });

  const publicFile = publicRoomFile(file);
  broadcast(input.roomId, "file_added", publicFile);
  broadcast(input.roomId, "file_selection_changed", {
    selectedFileIds: await selectedIds(input.roomId),
  });

  return publicFile;
}

async function selectedIds(roomId: string): Promise<string[]> {
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM room_files WHERE room_id = $1 AND selected = TRUE ORDER BY uploaded_at ASC`,
    [roomId]
  );
  return rows.map((r) => r.id);
}
