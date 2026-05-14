import { query } from "./db";

/** Returns true if the room's `closed_at IS NOT NULL`. Write routes call this
 *  early and reject with 410 Gone to keep history readable but stop new writes. */
export async function roomIsClosed(roomId: string): Promise<boolean> {
  const { rows } = await query<{ closed_at: Date | null }>(
    `SELECT closed_at FROM rooms WHERE id = $1`,
    [roomId],
  );
  return rows[0]?.closed_at != null;
}
