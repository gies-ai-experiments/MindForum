import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInvitationEmail, sendInvitationEmail } from "./email.ts";

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
