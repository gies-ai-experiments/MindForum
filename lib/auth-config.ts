// NextAuth.js v5 configuration for Azure AD / Entra ID creator sign-in.
// When Azure AD env vars are absent, the provider is not configured and
// the dashboard falls back to the existing token-paste flow.
//
// Cookie bridging strategy: NextAuth callbacks cannot set response cookies,
// so we store creator identity in the JWT token via the jwt callback.
// lib/creator-auth.ts getCreator() checks the NextAuth session when the
// mindforum_creator_session cookie is absent.

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

const azureConfigured = !!process.env.AZURE_AD_CLIENT_ID;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _handlers: any, _signIn: any, _signOut: any, _auth: any;

if (azureConfigured) {
  const tenantId = process.env.AZURE_AD_TENANT_ID || "common";
  const config = NextAuth({
    providers: [
      MicrosoftEntraID({
        clientId: process.env.AZURE_AD_CLIENT_ID!,
        clientSecret: process.env.AZURE_AD_CLIENT_SECRET,
        issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
        authorization: {
          params: {
            scope: "openid profile email",
          },
        },
      }),
    ],
    callbacks: {
      async signIn({ profile }) {
        if (!profile?.email) return false;

        const email = (profile.email as string).toLowerCase();
        const displayName =
          (profile as Record<string, unknown>).name as string || email;

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

          const plaintext = generateToken();
          const hash = hashToken(plaintext);
          const lastFour = plaintext.slice(-4);
          await query(
            `UPDATE allowlisted_creators
                SET token_hash = $1, token_last_four = $2, token_rotated_at = NOW()
              WHERE id = $3`,
            [hash, lastFour, existing.id]
          );

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
  _handlers = config.handlers;
  _signIn = config.signIn;
  _signOut = config.signOut;
  _auth = config.auth;
}

function noop() {
  throw new Error("Entra ID auth is not configured. Set AZURE_AD_CLIENT_ID to enable.");
}

export const handlers = _handlers || { GET: noop, POST: noop };
export const signIn = _signIn || noop;
export const signOut = _signOut || noop;
export const auth = _auth || (() => Promise.resolve(null));
export const isAzureConfigured = azureConfigured;
