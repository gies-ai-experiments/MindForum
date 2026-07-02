import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildInvitationEmail,
  sendInvitationEmail,
  buildMentionReminderEmail,
  buildCoAdminGrantEmail,
  sendCoAdminGrantEmail,
} from "./email.ts";

test("buildInvitationEmail includes room, inviter, invitee, email, and url", () => {
  const { subject, html, plainText } = buildInvitationEmail({
    inviteeName: "Dana Lee",
    inviteeEmail: "dana@illinois.edu",
    roomName: "AI Ethics Exercise",
    inviterName: "Ashleyn Castelino",
    acceptUrl: "https://mindforum.example/dashboard",
  });

  assert.match(subject, /AI Ethics Exercise/);
  for (const body of [html, plainText]) {
    assert.match(body, /Dana Lee/);
    assert.match(body, /Ashleyn Castelino/);
    assert.match(body, /AI Ethics Exercise/);
    assert.match(body, /https:\/\/mindforum\.example\/dashboard/);
  }
  assert.match(html, /dana@illinois\.edu/);
});

test("buildInvitationEmail escapes HTML in user-supplied fields", () => {
  const { html } = buildInvitationEmail({
    inviteeName: "<script>x</script>",
    inviteeEmail: "x@illinois.edu",
    roomName: "Room & <b>Co</b>",
    inviterName: "A",
    acceptUrl: "https://mindforum.example/dashboard",
  });
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Room &amp; &lt;b&gt;Co&lt;\/b&gt;/);
});

test("sendInvitationEmail no-ops when ACS is not configured", async () => {
  const prevConn = process.env.ACS_CONNECTION_STRING;
  const prevSender = process.env.ACS_SENDER_ADDRESS;
  delete process.env.ACS_CONNECTION_STRING;
  delete process.env.ACS_SENDER_ADDRESS;
  try {
    const res = await sendInvitationEmail({
      inviteeName: "Dana Lee",
      inviteeEmail: "dana@illinois.edu",
      roomName: "AI Ethics Exercise",
      inviterName: "Ashleyn Castelino",
      acceptUrl: "https://mindforum.example/dashboard",
    });
    assert.equal(res.ok, false);
    assert.equal(res.error, "not_configured");
  } finally {
    if (prevConn !== undefined) process.env.ACS_CONNECTION_STRING = prevConn;
    if (prevSender !== undefined) process.env.ACS_SENDER_ADDRESS = prevSender;
  }
});

test("buildCoAdminGrantEmail names the room, co-admin, granter, and room link", () => {
  const { subject, html, plainText } = buildCoAdminGrantEmail({
    coAdminName: "Dana Lee",
    coAdminEmail: "dana@illinois.edu",
    roomName: "AI Ethics Exercise",
    granterName: "Ashleyn Castelino",
    roomUrl: "https://mindforum.example/room/ai-ethics",
  });

  assert.match(subject, /AI Ethics Exercise/);
  for (const body of [html, plainText]) {
    assert.match(body, /Dana Lee/);
    assert.match(body, /Ashleyn Castelino/);
    assert.match(body, /AI Ethics Exercise/);
    assert.match(body, /https:\/\/mindforum\.example\/room\/ai-ethics/);
  }
  assert.match(html, /dana@illinois\.edu/);
});

test("buildCoAdminGrantEmail escapes HTML in user-supplied fields", () => {
  const { html } = buildCoAdminGrantEmail({
    coAdminName: "<script>x</script>",
    coAdminEmail: "x@illinois.edu",
    roomName: "Room & <b>Co</b>",
    granterName: "A",
    roomUrl: "https://mindforum.example/room/x",
  });
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Room &amp; &lt;b&gt;Co&lt;\/b&gt;/);
});

test("sendCoAdminGrantEmail no-ops when ACS is not configured", async () => {
  const prevConn = process.env.ACS_CONNECTION_STRING;
  const prevSender = process.env.ACS_SENDER_ADDRESS;
  delete process.env.ACS_CONNECTION_STRING;
  delete process.env.ACS_SENDER_ADDRESS;
  try {
    const res = await sendCoAdminGrantEmail({
      coAdminName: "Dana Lee",
      coAdminEmail: "dana@illinois.edu",
      roomName: "AI Ethics Exercise",
      granterName: "Ashleyn Castelino",
      roomUrl: "https://mindforum.example/room/ai-ethics",
    });
    assert.equal(res.ok, false);
    assert.equal(res.error, "not_configured");
  } finally {
    if (prevConn !== undefined) process.env.ACS_CONNECTION_STRING = prevConn;
    if (prevSender !== undefined) process.env.ACS_SENDER_ADDRESS = prevSender;
  }
});

test("buildMentionReminderEmail names the room, author greeting, people, and link", () => {
  const { subject, html, plainText } = buildMentionReminderEmail({
    authorName: "Ashleyn Castelino",
    authorEmail: "ash@illinois.edu",
    roomName: "AI Ethics Exercise",
    roomUrl: "https://mindforum.example/room/ai-ethics",
    mentionedNames: ["Dana Lee", "Bo Park"],
  });
  assert.match(subject, /AI Ethics Exercise/);
  for (const body of [html, plainText]) {
    assert.match(body, /Ashleyn Castelino/);
    assert.match(body, /Dana Lee and Bo Park/);
    assert.match(body, /AI Ethics Exercise/);
    assert.match(body, /https:\/\/mindforum\.example\/room\/ai-ethics/);
  }
});

test("buildMentionReminderEmail escapes HTML in user-supplied fields", () => {
  const { html } = buildMentionReminderEmail({
    authorName: "<b>A</b>",
    authorEmail: "a@x",
    roomName: "Room & <i>Co</i>",
    roomUrl: "https://mindforum.example/room/x",
    mentionedNames: ["<script>x</script>"],
  });
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>x<\/script>/);
});
