"use server";

import { signIn, signOut } from "./auth-config";

export async function signInAzure() {
  await signIn("microsoft-entra-id", { redirectTo: "/dashboard" });
}

export async function signOutCreator() {
  await signOut({ redirectTo: "/dashboard" });
}
