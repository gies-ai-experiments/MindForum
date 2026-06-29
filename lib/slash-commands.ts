// Slash commands offered by the in-room composer popup. Single source of truth:
// the menu, and the `/poll` // `/summarize` intercepts + glow in
// app/room/[id]/page.tsx, all read from here. Adding a command is one entry.

export type SlashCommand = {
  cmd: string; // the literal command, leading slash included (e.g. "/poll")
  desc: string; // one-line description shown in the popup
};

export const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: "/poll", desc: "Start a vote" },
  { cmd: "/summarize", desc: "Summarize the conversation" },
];

/**
 * Commands to offer for the current composer draft.
 *
 * The menu opens only when the draft is a bare leading slash token — a "/" at
 * the very start followed by letters and nothing else ("/", "/p", "/su"). Once
 * the text has a space (args started / ready to send), isn't at the start, or
 * matches no command, this returns [] and the caller closes the menu. Matching
 * the typed prefix is case-insensitive.
 */
export function matchSlashCommands(draft: string): SlashCommand[] {
  const m = draft.match(/^\/([a-z]*)$/i);
  if (!m) return [];
  const prefix = ("/" + m[1]).toLowerCase();
  return SLASH_COMMANDS.filter((c) => c.cmd.startsWith(prefix));
}
