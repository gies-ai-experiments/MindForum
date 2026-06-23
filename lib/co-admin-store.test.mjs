// POSTGRES_URL=postgres://localhost/mindforum_test node --import tsx --test lib/co-admin-store.test.mjs
import { test, before } from "node:test";
import assert from "node:assert/strict";
import {
  createRoom, createCreator,
  grantCoAdmin, revokeCoAdmin, isCoAdmin, listCoAdmins, coAdminEmails, getCreatorByEmail,
  adminListRoomsWithActivity,
} from "./store.ts";
import { nanoid } from "nanoid";

let ROOM, c1;
before(async () => {
  const room = await createRoom("ca-" + nanoid(6), "admin", "");
  ROOM = room.id;
  const r = await createCreator({
    email: `ca-${nanoid(5)}@x.edu`, displayName: "Cara",
    tokenHash: nanoid(20), tokenLastFour: "abcd", createdBy: "admin",
  });
  c1 = r.creator.id;
});

test("grant → isCoAdmin/list/emails reflect it → revoke clears", async () => {
  assert.equal(await isCoAdmin(ROOM, c1), false);
  await grantCoAdmin(ROOM, c1, "admin");
  assert.equal(await isCoAdmin(ROOM, c1), true);
  const list = await listCoAdmins(ROOM);
  assert.equal(list.some((x) => x.creatorId === c1), true);
  const emails = await coAdminEmails(ROOM);
  assert.equal(emails.length >= 1, true);
  assert.equal(emails[0], emails[0].toLowerCase());
  await grantCoAdmin(ROOM, c1, "admin"); // idempotent
  await revokeCoAdmin(ROOM, c1);
  assert.equal(await isCoAdmin(ROOM, c1), false);
});

test("getCreatorByEmail finds case-insensitively", async () => {
  const r = await createCreator({
    email: `Mixed-${nanoid(5)}@X.edu`, displayName: "Mx",
    tokenHash: nanoid(20), tokenLastFour: "wxyz", createdBy: "admin",
  });
  const found = await getCreatorByEmail(r.creator.email.toUpperCase());
  assert.equal(found?.id, r.creator.id);
  assert.equal(await getCreatorByEmail("nobody-" + nanoid(6) + "@x.edu"), null);
});

test("co-admin room appears in the creator's dashboard list as co-admin", async () => {
  const room = await createRoom("calist-" + nanoid(6), "admin", "");
  const cr = await createCreator({
    email: `cadmin-${nanoid(5)}@x.edu`, displayName: "CoCo",
    tokenHash: nanoid(20), tokenLastFour: "qrst", createdBy: "admin",
  });
  await grantCoAdmin(room.id, cr.creator.id, "admin");
  const rows = await adminListRoomsWithActivity({
    column: "last_message_at", direction: "DESC",
    ownerId: cr.creator.id, inviteeEmail: cr.creator.email, archived: "all",
  });
  const mine = rows.find((r) => r.id === room.id);
  assert.equal(mine?.relationship, "co-admin");
});
