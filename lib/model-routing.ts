export const LONG_CONTEXT_MESSAGE_COUNT = 30;

type ModelTier = "fast" | "default" | "strong";

export type ModelRoutingTask =
  | "document-summary"
  | "url-extract"
  | "poll-draft"
  | "chat-reply"
  | "brief"
  | "rolling-summary"
  | "summary";

export type ChatRoutingInput = {
  messageCount: number;
  selectedFileCount?: number;
  recapBlock?: string;
};

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function modelForTier(tier: ModelTier): string {
  const legacyDefault = env("OPENAI_MODEL") ?? "gpt-5.4";
  if (tier === "fast") {
    return env("OPENAI_MODEL_FAST") ?? env("OPENAI_MODEL_BRIEF") ?? legacyDefault;
  }
  if (tier === "strong") {
    return env("OPENAI_MODEL_STRONG") ?? legacyDefault;
  }
  return env("OPENAI_MODEL_DEFAULT") ?? legacyDefault;
}

export function isLongContext(input: ChatRoutingInput): boolean {
  return (
    input.messageCount > LONG_CONTEXT_MESSAGE_COUNT ||
    (input.selectedFileCount ?? 0) > 0 ||
    Boolean(input.recapBlock?.trim())
  );
}

export function modelForTask(
  task: ModelRoutingTask,
  input?: ChatRoutingInput
): string {
  switch (task) {
    case "document-summary":
    case "url-extract":
      return modelForTier("fast");
    case "poll-draft":
      return input && isLongContext(input) ? modelForTier("strong") : modelForTier("fast");
    case "summary":
      return input && isLongContext(input) ? modelForTier("strong") : modelForTier("default");
    case "chat-reply":
      return input && isLongContext(input) ? modelForTier("strong") : modelForTier("default");
    case "brief":
    case "rolling-summary":
      return modelForTier("strong");
  }
}
