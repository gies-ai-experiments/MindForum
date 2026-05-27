import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { adminAddFile, adminUpsertRoom, type RoomFile } from "@/lib/store";
import { parseFile } from "@/lib/parse";
import { query } from "@/lib/db";

export const runtime = "nodejs";

type SeedFile = {
  path: string;
  name?: string;
  selected?: boolean;
};

type SeedBody = {
  id: string;
  name: string;
  systemPrompt?: string;
  files?: SeedFile[];
  /**
   * "metadata" (default): upsert rooms row + replace files. Keeps messages +
   * participants. Use this to refresh canonical content without losing chat.
   * "full": wipe the room entirely (cascades to participants/messages/files),
   * then re-create. Use this for intentional resets.
   */
  replaceMode?: "metadata" | "full";
  /**
   * Override the email used to look up a real participant for file
   * attribution. When omitted, falls back to SEED_UPLOADER_EMAIL env var,
   * then to a hardcoded default. If no participant in the room matches,
   * seeded files use the legacy "seed" marker and render as "Unknown
   * uploader" until a re-seed happens after the admin has joined.
   */
  seedUploader?: { email: string };
};

const MAX_TEXT_CHARS = 200_000;

/**
 * Admin-only room seeder. Idempotent.
 * Auth: requires x-admin-token header matching ADMIN_TOKEN env var.
 */
export async function POST(req: NextRequest) {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) return NextResponse.json({ error: "admin_disabled" }, { status: 503 });
  const supplied = req.headers.get("x-admin-token");
  if (supplied !== adminToken) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: SeedBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  if (!body.id || !body.name) {
    return NextResponse.json({ error: "id_and_name_required" }, { status: 400 });
  }

  const replaceMode: "metadata" | "full" =
    body.replaceMode === "full" ? "full" : "metadata";

  try {
    await adminUpsertRoom({
      id: body.id,
      name: body.name.slice(0, 100),
      systemPrompt: (body.systemPrompt ?? "").slice(0, 4000),
      replaceMode,
    });
  } catch (err) {
    console.error("adminUpsertRoom failed:", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  // Attribute seeded files to a real participant (matched by email) so the
  // Files panel shows a name instead of "Unknown uploader". We deliberately
  // do NOT create a synthetic participant row — that would surface in the
  // Participants sidebar, mention suggestions, and snapshot before any human
  // joined. If no matching participant exists yet, files keep the legacy
  // 'seed' marker; a subsequent re-seed (after the admin joins) will repoint
  // them via replaceMode "metadata".
  const seedEmail =
    body.seedUploader?.email ??
    process.env.SEED_UPLOADER_EMAIL ??
    "vishal@illinois.edu";
  let seedUploaderId = "seed";
  if ((body.files ?? []).length > 0) {
    const existing = await query<{ id: string }>(
      `SELECT id FROM participants
       WHERE room_id = $1 AND lower(email) = lower($2)
       LIMIT 1`,
      [body.id, seedEmail]
    );
    if (existing.rows[0]) seedUploaderId = existing.rows[0].id;
  }

  const loaded: { name: string; path: string; bytes: number }[] = [];
  const failed: { path: string; error: string }[] = [];

  for (const sf of body.files ?? []) {
    try {
      const abs = path.resolve(process.cwd(), sf.path);
      if (!abs.startsWith(process.cwd() + path.sep) && abs !== process.cwd()) {
        failed.push({ path: sf.path, error: "path_escape" });
        continue;
      }
      const buf = fs.readFileSync(abs);
      const fileName = sf.name ?? path.basename(sf.path);
      const parsed = await parseFile(fileName, "", buf);
      const pathHash = crypto
        .createHash("sha1")
        .update(sf.path)
        .digest("base64url")
        .slice(0, 12);
      const rf: RoomFile = {
        id: `seed-${pathHash}`,
        roomId: body.id,
        name: fileName,
        mime: parsed.mime,
        sizeBytes: buf.length,
        uploadedById: seedUploaderId,
        uploadedAt: Date.now(),
        extractedText: parsed.text.slice(0, MAX_TEXT_CHARS),
        selected: sf.selected !== false,
        sourceType: "uploaded",
        sourceUrl: null,
        sourceMeta: null,
      };
      await adminAddFile(rf);
      loaded.push({ name: fileName, path: sf.path, bytes: buf.length });
    } catch (err) {
      failed.push({ path: sf.path, error: (err as Error).message });
    }
  }

  return NextResponse.json({
    ok: true,
    id: body.id,
    name: body.name,
    replaceMode,
    files: loaded,
    failed,
  });
}
