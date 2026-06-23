// Pure helpers for the no-reply mention reminder feature: timing constant,
// row/group shapes shared by the store and the cron route, and the
// presentation helpers used to compose the reminder email.

export const MENTION_REMINDER_DELAY_MS = 60 * 60 * 1000; // 1 hour

/** A due reminder claimed by the cron, joined with its room name. */
export type DueReminderRow = {
  id: string;
  roomId: string;
  roomName: string;
  authorId: string;
  authorName: string;
  authorEmail: string;
  mentionedName: string;
};

/** One digest email's worth of reminders for a single author in a single room. */
export type ReminderGroup = {
  roomId: string;
  roomName: string;
  authorId: string;
  authorName: string;
  authorEmail: string;
  mentionedNames: string[];
};

export function groupRemindersByAuthor(rows: DueReminderRow[]): ReminderGroup[] {
  const groups = new Map<string, ReminderGroup>();
  for (const r of rows) {
    const key = `${r.roomId} ${r.authorId}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        roomId: r.roomId,
        roomName: r.roomName,
        authorId: r.authorId,
        authorName: r.authorName,
        authorEmail: r.authorEmail,
        mentionedNames: [],
      };
      groups.set(key, g);
    }
    if (!g.mentionedNames.includes(r.mentionedName)) {
      g.mentionedNames.push(r.mentionedName);
    }
  }
  return [...groups.values()];
}

/** "A" | "A and B" | "A, B and C" | "A, B, C and N others". */
export function formatNameList(names: string[]): string {
  const n = names.length;
  if (n === 0) return "";
  if (n === 1) return names[0];
  if (n === 2) return `${names[0]} and ${names[1]}`;
  if (n === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  const others = n - 3;
  return `${names[0]}, ${names[1]}, ${names[2]} and ${others} other${others === 1 ? "" : "s"}`;
}
