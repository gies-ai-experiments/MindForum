import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractReadableHtml,
  ingestUrl,
  isBlockedIp,
  normalizeHttpUrl,
  validateResolvedAddresses,
} from "./url.ts";

test("normalizeHttpUrl accepts http and https only", () => {
  assert.equal(normalizeHttpUrl("https://example.com/a").href, "https://example.com/a");
  assert.equal(normalizeHttpUrl("http://example.com/a").href, "http://example.com/a");
  assert.throws(() => normalizeHttpUrl("file:///etc/passwd"), /invalid_url/);
  assert.throws(() => normalizeHttpUrl("ftp://example.com"), /invalid_url/);
  assert.throws(() => normalizeHttpUrl("https://user:pass@example.com"), /invalid_url/);
});

test("isBlockedIp rejects loopback private link-local metadata and local ipv6", () => {
  for (const ip of [
    "0.0.0.0",
    "10.0.0.1",
    "127.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "224.0.0.1",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "fd00::1",
    "fe80::1",
    "ff00::1",
    "[::1]",
  ]) {
    assert.equal(isBlockedIp(ip), true, ip);
  }

  assert.equal(isBlockedIp("93.184.216.34"), false);
  assert.equal(isBlockedIp("2606:2800:220:1:248:1893:25c8:1946"), false);
});

test("validateResolvedAddresses rejects hostnames with any blocked IP", () => {
  assert.throws(() => validateResolvedAddresses([{ address: "127.0.0.1" }]), /invalid_url/);
  assert.throws(
    () => validateResolvedAddresses([{ address: "93.184.216.34" }, { address: "127.0.0.1" }]),
    /invalid_url/,
  );
  assert.doesNotThrow(() => validateResolvedAddresses([{ address: "93.184.216.34" }]));
});

test("extractReadableHtml returns article text when available", () => {
  const html =
    "<html><head><title>T</title></head><body><article><h1>Title</h1><p>Useful paragraph.</p></article></body></html>";
  const text = extractReadableHtml(html, "https://example.com");
  assert.match(text, /Title/);
  assert.match(text, /Useful paragraph/);
});

test("ingestUrl extracts readable HTML through injected fetch resolver and model", async () => {
  const fetchImpl = routeFetch({
    "https://example.com/a": htmlResponse(`
      <html><body><article>
        <h1>Useful page</h1>
        <p>${"Detailed public article text. ".repeat(8)}</p>
      </article></body></html>
    `),
  });

  const result = await ingestUrl({
    url: "https://example.com/a",
    instruction: "Summarize the article",
    fetchImpl,
    resolveImpl: publicResolver,
    extractWithModel: async ({ instruction, text, sourceUrl }) => {
      assert.equal(instruction, "Summarize the article");
      assert.match(text, /Useful page/);
      assert.equal(sourceUrl, "https://example.com/a");
      return { text: "Extracted public article summary.", webSearchCallCount: 2 };
    },
  });

  assert.equal(result.name, "URL: example.com");
  assert.equal(result.mime, "text/markdown");
  assert.equal(result.sourceUrl, "https://example.com/a");
  assert.equal(result.extractedText, "Extracted public article summary.");
  assert.equal(result.sourceMeta.instruction, "Summarize the article");
  assert.match(result.sourceMeta.contentType, /text\/html/);
  assert.equal(result.sourceMeta.extractedLength, result.extractedText.length);
  assert.equal(result.sourceMeta.webSearchCallCount, 2);
  assert.equal(fetchImpl.calls.length, 1);
});

test("ingestUrl follows safe redirects and validates the redirected host", async () => {
  const fetchImpl = routeFetch({
    "https://example.com/start": new Response(null, {
      status: 302,
      headers: { location: "https://docs.example.com/final" },
    }),
    "https://docs.example.com/final": textResponse("Final redirected article. ".repeat(8)),
  });

  const result = await ingestUrl({
    url: "https://example.com/start",
    instruction: "Extract notes",
    fetchImpl,
    resolveImpl: publicResolver,
    extractWithModel: async ({ text }) => ({ text, webSearchCallCount: 0 }),
  });

  assert.equal(result.sourceUrl, "https://docs.example.com/final");
  assert.deepEqual(fetchImpl.calls, ["https://example.com/start", "https://docs.example.com/final"]);
});

test("ingestUrl rejects redirects to blocked addresses before fetching them", async () => {
  const fetchImpl = routeFetch({
    "https://example.com/start": new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/private" },
    }),
  });

  await assert.rejects(
    () =>
      ingestUrl({
        url: "https://example.com/start",
        instruction: "Extract notes",
        fetchImpl,
        resolveImpl: publicResolver,
        extractWithModel: async ({ text }) => ({ text, webSearchCallCount: 0 }),
      }),
    /invalid_url/,
  );

  assert.deepEqual(fetchImpl.calls, ["https://example.com/start"]);
});

test("ingestUrl rejects direct bracketed IPv6 loopback as invalid url", async () => {
  await assert.rejects(
    () =>
      ingestUrl({
        url: "http://[::1]/private",
        instruction: "Extract notes",
        fetchImpl: routeFetch({}),
        resolveImpl: publicResolver,
        extractWithModel: async ({ text }) => ({ text, webSearchCallCount: 0 }),
      }),
    /invalid_url/,
  );
});

test("ingestUrl passes a pinned dispatcher to fetch after resolving the host", async () => {
  const fetchImpl = async (_url, init) => {
    assert.ok(init.dispatcher);
    return textResponse("Pinned resolver article. ".repeat(8));
  };

  const result = await ingestUrl({
    url: "https://example.com/pinned",
    instruction: "Extract notes",
    fetchImpl,
    resolveImpl: async () => [{ address: "93.184.216.34", family: 4 }],
    extractWithModel: async ({ text }) => ({ text, webSearchCallCount: 0 }),
  });

  assert.equal(result.sourceUrl, "https://example.com/pinned");
});

test("ingestUrl exposes a stable timeout error", async () => {
  const timeout = new Error("aborted");
  timeout.name = "AbortError";
  await assert.rejects(
    () =>
      ingestUrl({
        url: "https://example.com/slow",
        instruction: "Extract notes",
        fetchImpl: async () => {
          throw timeout;
        },
        resolveImpl: publicResolver,
        extractWithModel: async ({ text }) => ({ text, webSearchCallCount: 0 }),
      }),
    /url_fetch_timeout/,
  );
});

test("ingestUrl rejects oversized responses from content-length", async () => {
  await assert.rejects(
    () =>
      ingestUrl({
        url: "https://example.com/large",
        instruction: "Extract notes",
        fetchImpl: routeFetch({
          "https://example.com/large": new Response("not read", {
            headers: {
              "content-type": "text/plain",
              "content-length": String(5 * 1024 * 1024 + 1),
            },
          }),
        }),
        resolveImpl: publicResolver,
        extractWithModel: async ({ text }) => ({ text, webSearchCallCount: 0 }),
      }),
    /too_large/,
  );
});

test("ingestUrl extracts plain text without real network or OpenAI", async () => {
  const source = "Plain text source material. ".repeat(8);
  const result = await ingestUrl({
    url: "https://example.com/source.txt",
    instruction: "Keep the important text",
    fetchImpl: routeFetch({ "https://example.com/source.txt": textResponse(source) }),
    resolveImpl: publicResolver,
    extractWithModel: async ({ text }) => ({ text: text.slice(0, 120), webSearchCallCount: 0 }),
  });

  assert.equal(result.extractedText, source.slice(0, 120));
  assert.equal(result.sourceMeta.contentType, "text/plain");
});

test("ingestUrl rejects unsupported content types", async () => {
  await assert.rejects(
    () =>
      ingestUrl({
        url: "https://example.com/image.png",
        instruction: "Extract text",
        fetchImpl: routeFetch({
          "https://example.com/image.png": new Response(Buffer.from([1, 2, 3]), {
            headers: { "content-type": "image/png" },
          }),
        }),
        resolveImpl: publicResolver,
        extractWithModel: async ({ text }) => ({ text, webSearchCallCount: 0 }),
      }),
    /unsupported_content_type/,
  );
});

function htmlResponse(body) {
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
}

function textResponse(body) {
  return new Response(body, { headers: { "content-type": "text/plain" } });
}

function routeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    const href = url instanceof URL ? url.href : String(url);
    calls.push(href);
    const response = routes[href];
    if (!response) throw new Error(`unexpected_fetch:${href}`);
    return response.clone();
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

async function publicResolver(hostname) {
  if (hostname === "127.0.0.1") return [{ address: "127.0.0.1" }];
  return [{ address: "93.184.216.34" }];
}
