// Minimal in-memory IP rate limiter. Survives HMR via globalThis stash.
// Buckets are sliding 1-minute windows; each endpoint picks its own limit.
// Not distributed (one process), which matches the rest of the app's scope.
//
// Known buckets:
//   create-room       5  / 10min
//   join              10 /  1min
//   message           60 /  1min
//   attach            10 / 10min (upload + GitHub context + URL context)
//   brief             3  /  5min
//   poll-draft        5  /  5min
//   poll-create       5  / 10min
//   poll-vote         30 /  1min
//   poll-close        10 /  1min

type Hit = { ts: number; n: number };

const g = globalThis as unknown as {
  __mindforumRate?: Map<string, Hit>;
};
const store: Map<string, Hit> = g.__mindforumRate ?? new Map();
g.__mindforumRate = store;

export type RateResult = { allowed: boolean; retryAfterSeconds: number };

/**
 * Check and atomically increment a rate-limit bucket for the given key.
 * `bucket` namespaces the limiter (e.g. "create-room", "message").
 * `key` is typically the client IP.
 * `limit` is the max hits allowed within `windowMs`.
 */
export function checkRate(
  bucket: string,
  key: string,
  limit: number,
  windowMs: number
): RateResult {
  const now = Date.now();
  const k = `${bucket}:${key}`;
  const hit = store.get(k);

  if (!hit || now - hit.ts > windowMs) {
    store.set(k, { ts: now, n: 1 });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (hit.n >= limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((hit.ts + windowMs - now) / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  hit.n += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Extract the client IP from request headers. Behind nginx with
 * proxy_set_header X-Forwarded-For / X-Real-IP.
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const xreal = req.headers.get("x-real-ip");
  if (xreal) return xreal.trim();
  return "unknown";
}

/** Build a 429 response with Retry-After header. */
export function rateLimited(retryAfterSeconds: number): Response {
  return new Response(
    JSON.stringify({ error: "rate_limited", retryAfterSeconds }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(retryAfterSeconds),
      },
    }
  );
}
