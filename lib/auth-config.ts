// NextAuth.js v5 configuration for Azure AD / Entra ID creator sign-in.
// When Azure AD env vars are absent, the provider is not configured and
// the dashboard falls back to the existing token-paste flow.
//
// IMPORTANT: Next.js builds may inline process.env at compile time differently
// for route handlers vs server components. We always initialize NextAuth with
// a valid config, and conditionally include the Entra ID provider at runtime.

import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import * as crypto from "crypto";
import { query } from "./db";

function generateToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext).digest("hex");
}

function getProviders() {
  const clientId = process.env.AZURE_AD_CLIENT_ID;
  if (!clientId) return [];

  const tenantId = process.env.AZURE_AD_TENANT_ID || "common";
  return [
    MicrosoftEntraID({
      clientId,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET,
      issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      authorization: {
        params: {
          scope: "openid profile email",
        },
      },
    }),
  ];
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: getProviders(),
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
  // App Service sits behind a trusted reverse proxy on a known custom host.
  // Without this, Auth.js v5 rejects /api/auth/* with `UntrustedHost` in
  // production unless AUTH_URL / AUTH_TRUST_HOST is also set — so the Illinois
  // sign-in button would render but the OAuth flow would 500 before starting.
  trustHost: true,
  callbacks: {
    async signIn({ profile }) {
      // Entra v2 tokens don't always include the optional `email` claim; fall
      // back to the UPN / preferred_username (which is the user's @illinois.edu
      // address for our tenant). The allowlist matches on this value, so the
      // session lookup must resolve to the same string — see the session
      // callback below, which stamps it onto session.user.email.
      const p = profile as Record<string, unknown> | undefined;
      const rawEmail =
        (p?.email as string | undefined) ||
        (p?.preferred_username as string | undefined) ||
        (p?.upn as string | undefined);
      if (!rawEmail) return false;

      const email = rawEmail.toLowerCase();
      const displayName = (p?.name as string) || email;

      const { rows } = await query<{
        id: string;
        disabled_at: Date | null;
      }>(
        `SELECT id, disabled_at
           FROM allowlisted_creators
          WHERE lower(email) = $1
          LIMIT 1`,
        [email]
      );

      const existing = rows[0];

      if (existing) {
        if (existing.disabled_at) {
          return `/dashboard?err=disabled`;
        }

        // Do NOT rotate the creator's token here. Entra sessions authenticate
        // by email lookup (getCreator → findByEmail), not by the token, so
        // rotating would silently invalidate the user's pasted-token fallback
        // (and any active token-cookie session) for no benefit — the new
        // plaintext is never surfaced to anyone.
        (profile as Record<string, unknown>).__creatorId = existing.id;
        (profile as Record<string, unknown>).__creatorEmail = email;
        return true;
      }

      const plaintext = generateToken();
      const hash = hashToken(plaintext);
      const lastFour = plaintext.slice(-4);
      const id = `cr_${crypto.randomUUID().slice(0, 8)}`;

      await query(
        `INSERT INTO allowlisted_creators
           (id, email, display_name, token_hash, token_last_four,
            token_rotated_at, created_at, created_by)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), NULL)`,
        [id, email, displayName, hash, lastFour]
      );

      (profile as Record<string, unknown>).__creatorId = id;
      (profile as Record<string, unknown>).__creatorEmail = email;
      return true;
    },

    async jwt({ token, profile }) {
      const p = profile as Record<string, unknown> | undefined;
      if (p?.__creatorId) {
        token.creatorId = p.__creatorId as string;
        token.creatorEmail = p.__creatorEmail as string;
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user && token.creatorId) {
        const u = session.user as unknown as Record<string, unknown>;
        u.creatorId = token.creatorId;
        u.creatorEmail = token.creatorEmail;
        // getCreator() resolves the Entra session via session.user.email; when
        // the tenant omitted the email claim, populate it with the resolved
        // UPN so the lookup matches the allowlist row we signed in against.
        if (!u.email && token.creatorEmail) u.email = token.creatorEmail;
      }
      return session;
    },
  },
  pages: {
    signIn: "/dashboard",
    error: "/dashboard",
  },
  session: {
    strategy: "jwt",
  },
});

export function isAzureConfigured(): boolean {
  return !!process.env.AZURE_AD_CLIENT_ID;
}
