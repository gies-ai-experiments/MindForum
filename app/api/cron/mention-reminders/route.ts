import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { skipDeadDueReminders, claimDueMentionReminders } from "@/lib/store";
import { groupRemindersByAuthor } from "@/lib/mention-reminders";
import { sendMentionReminderEmail } from "@/lib/email";

export const runtime = "nodejs";

const BATCH_LIMIT = 500;

function baseUrlFrom(req: NextRequest): string {
  return (
    process.env.NEXTAUTH_URL ??
    `${req.headers.get("x-forwarded-proto") ?? "https"}://${
      req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000"
    }`
  ).replace(/\/$/, "");
}

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const baseUrl = baseUrlFrom(req);
  try {
    const skipped = await skipDeadDueReminders();
    const rows = await claimDueMentionReminders(BATCH_LIMIT);
    const groups = groupRemindersByAuthor(rows);
    const results = await Promise.allSettled(
      groups.map((g) =>
        sendMentionReminderEmail({
          authorName: g.authorName,
          authorEmail: g.authorEmail,
          roomName: g.roomName,
          roomUrl: `${baseUrl}/room/${g.roomId}`,
          mentionedNames: g.mentionedNames,
        }),
      ),
    );
    const emailed = results.filter(
      (r) => r.status === "fulfilled" && r.value.ok,
    ).length;
    return NextResponse.json({ ok: true, skipped, claimed: rows.length, emailed });
  } catch (err) {
    console.error("mention-reminders cron failed:", err);
    Sentry.captureException(err);
    return NextResponse.json({ error: "cron_failed" }, { status: 500 });
  }
}
