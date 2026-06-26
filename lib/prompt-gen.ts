import { MAX_SYSTEM_PROMPT_CHARS } from "./limits";

/** Minimum plain-English description length worth sending to the model. */
export const MIN_PROMPT_DESCRIPTION_CHARS = 10;

export type PromptGenInput =
  | { ok: true; description: string }
  | { ok: false; error: "description_required" | "description_too_long" };

/**
 * Validate the POST /api/generate-prompt body. Trims the description; rejects
 * anything that isn't a string of at least MIN_PROMPT_DESCRIPTION_CHARS, and
 * anything over the system-prompt char cap (a plain description is normally far
 * shorter, but reusing the cap keeps a single limit across the feature).
 */
export function parsePromptGenInput(body: unknown): PromptGenInput {
  const raw =
    body && typeof body === "object" && "description" in body
      ? (body as { description: unknown }).description
      : undefined;
  if (typeof raw !== "string" || raw.trim().length < MIN_PROMPT_DESCRIPTION_CHARS) {
    return { ok: false, error: "description_required" };
  }
  const description = raw.trim();
  if (description.length > MAX_SYSTEM_PROMPT_CHARS) {
    return { ok: false, error: "description_too_long" };
  }
  return { ok: true, description };
}
