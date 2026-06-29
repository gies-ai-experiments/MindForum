// Room slug helpers, shared by the client (deriving a slug from a typed room
// name) and the server (validating it). The rule mirrors the slug check in
// POST /api/room: lowercase letters, digits, and hyphens, 3–40 chars.

export const ROOM_SLUG_RE = /^[a-z0-9-]{3,40}$/;

/**
 * Turn a free-text room name into a candidate slug: lowercase, ASCII alnum runs
 * joined by single hyphens, trimmed, capped at 40 chars with no trailing hyphen.
 * May return "" (e.g. all punctuation) or a too-short string — callers validate
 * with isValidRoomSlug before use, and the UI lets the user edit it.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // any run of non-alphanumerics → one hyphen
    .replace(/^-+/, "") // strip leading hyphens
    .slice(0, 40) // cap length
    .replace(/-+$/, ""); // strip trailing hyphen(s), incl. one created by the cap
}

export function isValidRoomSlug(slug: string): boolean {
  return ROOM_SLUG_RE.test(slug);
}
