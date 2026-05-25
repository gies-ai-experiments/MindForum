// Append-only audit log helper.
//
// One row per action. Intentionally no UPDATE or DELETE paths — the audit log
// is the immutable record of who did what to which room. For room.hard_delete
// the metadata snapshot must be captured BEFORE the cascade, so this helper
// is only ever an INSERT.

import { query } from "./db";

/**
 * Anything we can attribute to. In practice this is a Creator (id like
 * `cr_xxx`) for super-admin / creator actions, or a Participant (id is a
 * room-scoped nanoid) for participant-scoped actions like file.upload and
 * file.toggle_selected. Audit listings filter by id, so the namespace mix
 * is fine — the action column disambiguates context.
 */
export type AuditActor = { id: string; email: string };

export type AuditAction =
  | "allowlist.create"
  | "allowlist.update"
  | "allowlist.disable"
  | "allowlist.enable"
  | "allowlist.rotate_token"
  | "allowlist.delete"
  | "room.create"
  | "room.update"
  | "room.archive"
  | "room.restore"
  | "room.hard_delete"
  | "room.transfer"
  | "participant.kick"
  | "participant.mute"
  | "participant.remove"
  | "file.upload"
  | "file.delete"
  | "file.toggle_selected";

/**
 * Append a row to audit_log. Never throws on the caller's behalf — failures
 * are logged but don't block the action that prompted them. The audit log is
 * a record, not a gate.
 */
export async function logAudit(args: {
  actor: AuditActor;
  action: AuditAction;
  roomId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_log (actor_id, actor_email, action, room_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        args.actor.id,
        args.actor.email,
        args.action,
        args.roomId ?? null,
        args.metadata ? JSON.stringify(args.metadata) : null,
      ]
    );
  } catch (err) {
    console.error("audit log write failed:", { action: args.action, roomId: args.roomId, err });
  }
}

export type AuditEntry = {
  id: number;
  at: number;
  actorId: string;
  actorEmail: string;
  action: AuditAction;
  roomId: string | null;
  metadata: Record<string, unknown> | null;
};

type AuditRow = {
  id: string;
  at: Date;
  actor_id: string;
  actor_email: string;
  action: string;
  room_id: string | null;
  metadata: Record<string, unknown> | null;
};

function toEntry(r: AuditRow): AuditEntry {
  return {
    id: Number(r.id),
    at: r.at.getTime(),
    actorId: r.actor_id,
    actorEmail: r.actor_email,
    action: r.action as AuditAction,
    roomId: r.room_id,
    metadata: r.metadata,
  };
}

/** Most recent N entries for a single room (newest first). */
export async function listAuditForRoom(roomId: string, limit = 50): Promise<AuditEntry[]> {
  const { rows } = await query<AuditRow>(
    `SELECT id, at, actor_id, actor_email, action, room_id, metadata
       FROM audit_log
      WHERE room_id = $1
      ORDER BY at DESC
      LIMIT $2`,
    [roomId, limit]
  );
  return rows.map(toEntry);
}

/** Most recent N entries by a single actor (newest first). */
export async function listAuditForActor(actorId: string, limit = 50): Promise<AuditEntry[]> {
  const { rows } = await query<AuditRow>(
    `SELECT id, at, actor_id, actor_email, action, room_id, metadata
       FROM audit_log
      WHERE actor_id = $1
      ORDER BY at DESC
      LIMIT $2`,
    [actorId, limit]
  );
  return rows.map(toEntry);
}
