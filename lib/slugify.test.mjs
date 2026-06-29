import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify, isValidRoomSlug, ROOM_SLUG_RE } from "./slugify.ts";

test("slugifies a normal name", () => {
  assert.equal(slugify("Q3 Onboarding Revamp"), "q3-onboarding-revamp");
});

test("trims, lowercases, and collapses punctuation/space runs to single hyphens", () => {
  assert.equal(slugify("  Hello, World!  "), "hello-world");
  assert.equal(slugify("multiple   spaces & symbols!!"), "multiple-spaces-symbols");
});

test("leaves an already-valid-ish slug intact (lowercased)", () => {
  assert.equal(slugify("Already-Good-Slug"), "already-good-slug");
});

test("caps at 40 chars and never leaves a trailing hyphen", () => {
  const long = slugify("a".repeat(50));
  assert.equal(long.length, 40);
  assert.equal(long, "a".repeat(40));
  // A name whose 40th char would be a hyphen must not end in one.
  const withSpaces = slugify(Array(20).fill("ab").join(" ")); // "ab ab ab ..."
  assert.ok(withSpaces.length <= 40);
  assert.ok(!withSpaces.endsWith("-"), `should not end with hyphen: ${withSpaces}`);
});

test("non-ascii drops to ascii alnum", () => {
  assert.equal(slugify("café münchen"), "caf-m-nchen");
});

test("empty / all-punctuation name yields empty string", () => {
  assert.equal(slugify("   "), "");
  assert.equal(slugify("!!!"), "");
});

test("isValidRoomSlug enforces 3-40 [a-z0-9-]", () => {
  assert.equal(isValidRoomSlug("ab"), false); // too short
  assert.equal(isValidRoomSlug("abc"), true);
  assert.equal(isValidRoomSlug("a-b-c-1"), true);
  assert.equal(isValidRoomSlug("Abc"), false); // uppercase
  assert.equal(isValidRoomSlug("a_b"), false); // underscore
  assert.equal(isValidRoomSlug("a".repeat(40)), true);
  assert.equal(isValidRoomSlug("a".repeat(41)), false); // too long
  assert.equal(isValidRoomSlug(""), false);
});

test("slugify output of a reasonable name is a valid room slug", () => {
  assert.ok(isValidRoomSlug(slugify("Q3 Onboarding Revamp")));
  assert.ok(ROOM_SLUG_RE instanceof RegExp);
});
