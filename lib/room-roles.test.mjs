import { test } from "node:test";
import assert from "node:assert/strict";
import { isManager } from "./room-roles.ts";

const owner = { id: "o1", isSuperAdmin: false };
const sa = { id: "x", isSuperAdmin: true };
const co = { id: "c1", isSuperAdmin: false };
const stranger = { id: "s1", isSuperAdmin: false };

test("owner, super-admin, and co-admin manage; stranger does not", () => {
  assert.equal(isManager(owner, "o1", []), true);
  assert.equal(isManager(sa, "o1", []), true);
  assert.equal(isManager(co, "o1", ["c1"]), true);
  assert.equal(isManager(stranger, "o1", ["c1"]), false);
});
