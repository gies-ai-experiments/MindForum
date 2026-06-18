import { EmailClient } from "@azure/communication-email";

export type InvitationEmailParams = {
  inviteeName: string;
  inviteeEmail: string;
  roomName: string;
  inviterName: string;
  acceptUrl: string;
};

export type BuiltEmail = {
  subject: string;
  html: string;
  plainText: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildInvitationEmail(params: InvitationEmailParams): BuiltEmail {
  const { inviteeName, inviteeEmail, roomName, inviterName, acceptUrl } = params;

  const subject = `You're invited to ${roomName} on MindForum`;

  const invitee = escapeHtml(inviteeName);
  const email = escapeHtml(inviteeEmail);
  const room = escapeHtml(roomName);
  const inviter = escapeHtml(inviterName);
  const url = escapeHtml(acceptUrl);

  // Table-based, inline-styled layout for broad email-client compatibility
  // (Outlook/Gmail strip <style> and flex). Brand palette: orange #E84A27,
  // navy #13294B, matching app/globals.css.
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body style="margin:0;padding:0;background:#F5F5F5;font-family:'Source Sans 3',-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F5F5;padding:24px 12px">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden">
            <tr>
              <td style="background:#E84A27;background:linear-gradient(90deg,#E84A27,#ff7a3d);padding:20px 28px">
                <span style="font-family:Montserrat,Segoe UI,Arial,sans-serif;font-weight:700;font-size:20px;color:#FFFFFF;letter-spacing:.2px">MindForum</span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px">
                <h1 style="margin:0 0 14px;font-family:Montserrat,Segoe UI,Arial,sans-serif;font-size:20px;line-height:1.3;color:#13294B">You're invited to ${room}</h1>
                <p style="margin:0 0 14px;font-size:16px;line-height:1.55">Hi ${invitee},</p>
                <p style="margin:0 0 24px;font-size:16px;line-height:1.55"><strong style="color:#13294B">${inviter}</strong> invited you to join the room <strong style="color:#13294B">${room}</strong> on MindForum &mdash; a shared space to brainstorm with your group and an AI collaborator.</p>
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="border-radius:8px;background:#E84A27">
                      <a href="${url}" style="display:inline-block;padding:13px 26px;font-family:'Source Sans 3',Segoe UI,Arial,sans-serif;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:8px">Sign in to MindForum &rarr;</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 0;font-size:14px;line-height:1.55;color:#6B7280">Sign in with this email address (<strong style="color:#111827">${email}</strong>) using your Illinois login, and your invitation to ${room} will be waiting on your dashboard.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px;border-top:1px solid #E5E7EB;background:#FAFAFA">
                <p style="margin:0;font-size:12px;line-height:1.5;color:#6B7280">You received this because ${inviter} invited you to a MindForum room. If you weren't expecting it, you can safely ignore this email.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const plainText = `Hi ${inviteeName},

${inviterName} invited you to join the room "${roomName}" on MindForum.

Sign in to MindForum to accept: ${acceptUrl}

Sign in with this email address (${inviteeEmail}) using your Illinois login and your invitation to "${roomName}" will be waiting on your dashboard.`;

  return { subject, html, plainText };
}

let cachedClient: EmailClient | null = null;

function getClient(): EmailClient | null {
  const conn = process.env.ACS_CONNECTION_STRING;
  if (!conn) return null;
  if (!cachedClient) cachedClient = new EmailClient(conn);
  return cachedClient;
}

export async function sendInvitationEmail(
  params: InvitationEmailParams
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const senderAddress = process.env.ACS_SENDER_ADDRESS;
  const client = getClient();

  if (!client || !senderAddress) {
    console.debug("[email] ACS not configured; skipping invitation email");
    return { ok: false, error: "not_configured" };
  }

  try {
    const { subject, html, plainText } = buildInvitationEmail(params);
    await client.beginSend({
      senderAddress,
      content: { subject, html, plainText },
      recipients: {
        to: [{ address: params.inviteeEmail, displayName: params.inviteeName }],
      },
    });
    // beginSend resolving means ACS accepted the message for delivery; we do not
    // block the request on full delivery polling.
    return { ok: true };
  } catch (err) {
    console.error("[email] failed to send invitation email", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "send_failed",
    };
  }
}
