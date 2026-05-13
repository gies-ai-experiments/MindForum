import OpenAI from "openai";
import type { Message, PinnedFacts, RoomFile } from "./store";

const MODEL_CHAT = process.env.OPENAI_MODEL || "gpt-5.4";
const MODEL_BRIEF = process.env.OPENAI_MODEL_BRIEF || MODEL_CHAT;
const MAX_FILE_CHARS = 200_000;
const MAX_HISTORY = 30;

function client(): OpenAI {
  // Instantiated per-call so missing env vars fail at request time, not build time.
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function fileBlock(files: RoomFile[]): string {
  if (files.length === 0) return "";
  const parts = files.map(
    (f) => `--- FILE: ${f.name} ---\n${f.extractedText.slice(0, MAX_FILE_CHARS)}`
  );
  return `\n\nShared files selected by the room:\n${parts.join("\n\n")}`;
}

function historyBlock(messages: Message[]): { role: "user" | "assistant"; content: string }[] {
  const recent = messages.slice(-MAX_HISTORY);
  return recent.map((m) => ({
    role: m.authorId === "ai" ? "assistant" : "user",
    content: m.authorId === "ai" ? m.content : `${m.authorName}: ${m.content}`,
  }));
}

function roomGuidanceBlock(systemPrompt: string): string {
  const trimmed = systemPrompt.trim();
  if (!trimmed) return "";
  return `\n\nRoom-specific guidance from the organizer (follow it unless it conflicts with these instructions):\n${trimmed}`;
}

function chatSystemPrompt(files: RoomFile[], systemPrompt: string): string {
  return `You are an AI collaborator in a MindForum room — a shared workspace where a small group brainstorms together in one chat thread. Participants can upload documents that are shared with the group. You only respond when someone addresses you with \`@ai\`; otherwise you stay silent. In the history, each participant's message is prefixed with their name (e.g., "Alice: ..."); your reply is visible to everyone. Keep replies concise. Reference shared files when relevant. Stay grounded in what people have actually said and in the files; don't invent context.${roomGuidanceBlock(systemPrompt)}${fileBlock(files)}`;
}

export async function chatReply(
  messages: Message[],
  files: RoomFile[],
  systemPrompt = ""
): Promise<string> {
  const res = await client().chat.completions.create({
    model: MODEL_CHAT,
    messages: [
      { role: "system", content: chatSystemPrompt(files, systemPrompt) },
      ...historyBlock(messages),
    ],
  });
  return res.choices[0]?.message?.content?.trim() ?? "";
}

export async function* chatReplyStream(
  messages: Message[],
  files: RoomFile[],
  systemPrompt = ""
): AsyncGenerator<string, void, void> {
  const stream = await client().chat.completions.create({
    model: MODEL_CHAT,
    stream: true,
    messages: [
      { role: "system", content: chatSystemPrompt(files, systemPrompt) },
      ...historyBlock(messages),
    ],
  });
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}

export type BriefDecision = {
  question: string;
  closedAt: string;            // ISO 8601
  winnerText: string | null;
  tallies: { option: string; votes: number }[];
  totalVotes: number;
  inconclusive: boolean;
};

export type Brief = {
  themes: string[];
  outline: { section: string; points: string[] }[];
  risks: string[];
  nextSteps: string[];
  suggestedCollaborators: string[];
  decisions: BriefDecision[];
};

export async function generateBrief(
  messages: Message[],
  files: RoomFile[],
  systemPrompt = "",
  closedPolls: BriefDecision[] = [],
): Promise<Brief> {
  const pollBlock = closedPolls.length === 0
    ? ""
    : `\n\nClosed polls (echo verbatim into decisions[]; do not edit text or counts):\n${JSON.stringify(closedPolls)}`;

  const system = `You turn a MindForum conversation, shared files, and any closed polls into a structured project brief. Be specific, not generic. Every item should be grounded in the conversation, the files, or the polls. If a section has no grounding, return an empty array for it rather than inventing content.${roomGuidanceBlock(systemPrompt)}${fileBlock(files)}${pollBlock}`;
  const res = await client().chat.completions.create({
    model: MODEL_BRIEF,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "ProjectBrief",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            themes: { type: "array", items: { type: "string" } },
            outline: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  section: { type: "string" },
                  points: { type: "array", items: { type: "string" } },
                },
                required: ["section", "points"],
              },
            },
            risks: { type: "array", items: { type: "string" } },
            nextSteps: { type: "array", items: { type: "string" } },
            suggestedCollaborators: { type: "array", items: { type: "string" } },
            decisions: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  question: { type: "string" },
                  closedAt: { type: "string" },
                  winnerText: { type: ["string", "null"] },
                  tallies: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        option: { type: "string" },
                        votes: { type: "integer" },
                      },
                      required: ["option", "votes"],
                    },
                  },
                  totalVotes: { type: "integer" },
                  inconclusive: { type: "boolean" },
                },
                required: ["question", "closedAt", "winnerText", "tallies", "totalVotes", "inconclusive"],
              },
            },
          },
          required: ["themes", "outline", "risks", "nextSteps", "suggestedCollaborators", "decisions"],
        },
      },
    },
    messages: [{ role: "system", content: system }, ...historyBlock(messages)],
  });
  const raw = res.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as Brief;
  // Post-validate: overwrite any echo drift with DB-canonical data.
  parsed.decisions = closedPolls;
  return parsed;
}

export type PollDraft = {
  question: string;
  options: string[];   // 0..5; empty array signals "no convergeable question"
};

const POLL_DRAFT_SYSTEM = `You help a MindForum room run a quick vote. Read the recent conversation and propose ONE decision-point that participants are implicitly debating. Output a single question and 2 to 5 mutually exclusive options grounded in what participants actually said. Do NOT invent options the group didn't discuss. If the conversation has no convergeable decision yet, return options: [].`;

export async function draftPollFromHistory(
  recentMessages: Message[],
): Promise<PollDraft> {
  const res = await client().chat.completions.create({
    model: MODEL_BRIEF,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "PollDraft",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            question: { type: "string" },
            options: {
              type: "array",
              minItems: 0,
              maxItems: 5,
              items: { type: "string" },
            },
          },
          required: ["question", "options"],
        },
      },
    },
    messages: [
      { role: "system", content: POLL_DRAFT_SYSTEM },
      ...historyBlock(recentMessages),
    ],
  });
  const raw = res.choices[0]?.message?.content ?? `{"question":"","options":[]}`;
  try {
    return JSON.parse(raw) as PollDraft;
  } catch {
    return { question: "", options: [] };
  }
}

const ROLLING_SUMMARY_RECENCY = 15;

function formatMsgsForPrompt(msgs: Message[]): string {
  if (msgs.length === 0) return "(none)";
  return msgs
    .map((m) => {
      const who = m.authorId === "ai" ? "AI" : m.authorName;
      return `${who}: ${m.content.replace(/\s+/g, " ").trim()}`;
    })
    .join("\n");
}

export type RollingSummaryUpdate = {
  bullets: string[];
  pinnedFacts: PinnedFacts;
};

/**
 * Fold a delta of new messages into the prior rolling summary and pinned facts.
 *
 * - `priorBullets` / `priorPinnedFacts` may be empty for the cold-start call.
 * - `recentMessages` is a verbatim recency window (last K chat messages) so the
 *   model sees current phrasing — counters drift from summarizing-a-summary.
 * - `deltaMessages` are the chat messages strictly after the last
 *   `summary_up_to_msg_id` (i.e. what's new since we last summarized).
 *
 * File contents are intentionally NOT included — pinned_facts.files preserves
 * names so cost stays O(delta + recency window) regardless of file size.
 */
export async function updateRollingSummary(args: {
  priorBullets: string[];
  priorPinnedFacts: PinnedFacts;
  recentMessages: Message[];
  deltaMessages: Message[];
  fileNames: string[];
  systemPrompt: string;
}): Promise<RollingSummaryUpdate> {
  const fileList =
    args.fileNames.length > 0
      ? `\n\nFiles shared in this room (names only — not contents):\n${args.fileNames.map((n) => `- ${n}`).join("\n")}`
      : "";

  const system = `You maintain a rolling catch-up summary for a MindForum brainstorming room. A late joiner reads this summary to get oriented.

Goals, in order:
1. Keep the summary tight and concrete (5-8 bullets, one short sentence each).
2. Maintain a "pinned facts" list: people who participated, decisions reached, and files referenced. Pinned items must NOT be paraphrased away in future rounds — preserve them across updates.
3. Fold new (delta) messages into the prior summary. Drop bullets that are now stale; merge near-duplicates; promote anything important to a pinned fact.
4. Never invent participants, decisions, or files. If something was just opinion or a question, do not call it a decision.
5. If the prior summary or pinned facts contradict what later messages say, prefer the latest messages.${roomGuidanceBlock(args.systemPrompt)}${fileList}`;

  const user = `## Prior summary bullets
${args.priorBullets.length ? args.priorBullets.map((b) => `- ${b}`).join("\n") : "(none — this is the first summary)"}

## Prior pinned facts
- names: ${args.priorPinnedFacts.names.join(", ") || "(none)"}
- decisions: ${args.priorPinnedFacts.decisions.join("; ") || "(none)"}
- files: ${args.priorPinnedFacts.files.join(", ") || "(none)"}

## Recency window (last ${args.recentMessages.length} messages, verbatim)
${formatMsgsForPrompt(args.recentMessages)}

## Delta — new messages since last summary (${args.deltaMessages.length} messages)
${formatMsgsForPrompt(args.deltaMessages)}

Produce the updated rolling summary as JSON.`;

  const res = await client().chat.completions.create({
    model: MODEL_CHAT,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "RollingSummary",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            bullets: { type: "array", items: { type: "string" } },
            pinnedFacts: {
              type: "object",
              additionalProperties: false,
              properties: {
                names: { type: "array", items: { type: "string" } },
                decisions: { type: "array", items: { type: "string" } },
                files: { type: "array", items: { type: "string" } },
              },
              required: ["names", "decisions", "files"],
            },
          },
          required: ["bullets", "pinnedFacts"],
        },
      },
    },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const raw = res.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as RollingSummaryUpdate;
  return {
    bullets: parsed.bullets ?? [],
    pinnedFacts: {
      names: parsed.pinnedFacts?.names ?? [],
      decisions: parsed.pinnedFacts?.decisions ?? [],
      files: parsed.pinnedFacts?.files ?? [],
    },
  };
}

export const ROLLING_SUMMARY_RECENCY_WINDOW = ROLLING_SUMMARY_RECENCY;
