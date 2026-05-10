import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { getActor, httpErrorResponse, provisionCreator, requireJsonContent } from "@/lib/creator-auth";
import { listCreators } from "@/lib/store";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_DISPLAY_NAME = 80;

/** GET: list allowlisted creators (excluding the synthetic super-admin row). */
export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const rows = await listCreators();
  return NextResponse.json({
    creators: rows.map((r) => ({
      id: r.id,
      email: r.email,
      displayName: r.displayName,
      isSuperAdmin: r.isSuperAdmin,
      disabledAt: r.disabledAt,
      tokenLastFour: r.tokenLastFour,
      tokenRotatedAt: r.tokenRotatedAt,
      createdAt: r.createdAt,
      roomCount: r.roomCount,
      lastActivityAt: r.lastActivityAt ? r.lastActivityAt.getTime() : null,
    })),
  });
}

/**
 * POST: create a new allowlisted creator. Returns the plaintext token in the
 * response body — the operator must surface this exactly once and warn the
 * user that it cannot be re-displayed.
 */
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    requireJsonContent(req);
    const body = await req.json().catch(() => ({}));
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const displayName =
      typeof body.displayName === "string"
        ? body.displayName.trim().slice(0, MAX_DISPLAY_NAME)
        : "";
    if (!email || !EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "invalid_email" }, { status: 400 });
    }
    if (!displayName) {
      return NextResponse.json({ error: "missing_display_name" }, { status: 400 });
    }

    const actor = await getActor();
    const result = await provisionCreator({
      email,
      displayName,
      createdBy: actor?.id ?? null,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }
    if (actor) {
      await logAudit({
        actor,
        action: "allowlist.create",
        metadata: {
          creatorEmail: result.creator.email,
          creatorDisplayName: result.creator.displayName,
        },
      });
    }
    return NextResponse.json({
      creator: {
        id: result.creator.id,
        email: result.creator.email,
        displayName: result.creator.displayName,
        tokenLastFour: result.creator.tokenLastFour,
        createdAt: result.creator.createdAt,
      },
      // One-time reveal. The client is expected to discard this from memory
      // once the operator has copied it.
      plaintextToken: result.plaintextToken,
    });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
