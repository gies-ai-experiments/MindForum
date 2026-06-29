import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRoomParticipant } from "@/lib/auth-helpers";
import { assertActiveRoom, httpErrorResponse } from "@/lib/creator-auth";

export const runtime = "nodejs";

type TargetRow = {
  id: string;
  name: string;
};

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await assertActiveRoom(id);
  } catch (err) {
    return httpErrorResponse(err);
  }

  const auth = await requireRoomParticipant(req, id);
  if (!auth.ok) return auth.response;

  const { rows } = await query<TargetRow>(
    `SELECT DISTINCT r.id, r.name
       FROM rooms r
       JOIN participants p ON p.room_id = r.id
      WHERE lower(p.email) = lower($1)
        AND p.removed_at IS NULL
        AND r.archived_at IS NULL
        AND r.closed_at IS NULL
      ORDER BY r.name ASC, r.id ASC`,
    [auth.participant.email]
  );

  return NextResponse.json({ targets: rows });
}
