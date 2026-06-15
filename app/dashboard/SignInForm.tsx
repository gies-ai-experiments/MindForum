import { signInAzure } from "@/lib/nextauth-actions";
import { isAzureConfigured } from "@/lib/auth-config";

export default function SignInForm({
  error,
  next,
}: {
  error?: string;
  next?: string;
}) {
  const errMsg =
    error === "bad_token"
      ? "Invalid token."
      : error === "missing_token"
        ? "Paste your token to continue."
        : error === "session_expired"
          ? "Your session expired. Sign in again."
          : error === "disabled"
            ? "Your account has been disabled. Contact your admin."
            : null;

  const azureEnabled = isAzureConfigured();

  return (
    <main
      style={{
        maxWidth: 420,
        margin: "4rem auto",
        padding: "0 16px",
        fontFamily: "system-ui",
      }}
    >
      <h1 style={{ marginBottom: 4 }}>Creator sign-in</h1>
      <p style={{ color: "#666", marginTop: 0, marginBottom: 16 }}>
        {azureEnabled
          ? "Sign in with your university account, or paste a token."
          : "Paste the token your admin shared with you."}
      </p>
      {errMsg && (
        <p role="alert" style={{ color: "#c00", marginBottom: 12 }}>
          {errMsg}
        </p>
      )}

      {azureEnabled && (
        <form action={signInAzure} style={{ marginBottom: 16 }}>
          {next && <input type="hidden" name="next" value={next} />}
          <button
            type="submit"
            style={{
              width: "100%",
              padding: "10px 20px",
              fontSize: 15,
              background: "#2563eb",
              color: "white",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Sign in with Illinois
          </button>
        </form>
      )}

      {azureEnabled && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 16,
            color: "#9ca3af",
            fontSize: 13,
          }}
        >
          <hr style={{ flex: 1, border: "none", borderTop: "1px solid #e5e7eb" }} />
          or
          <hr style={{ flex: 1, border: "none", borderTop: "1px solid #e5e7eb" }} />
        </div>
      )}

      <form method="POST" action="/dashboard/auth">
        {next && <input type="hidden" name="next" value={next} />}
        <input
          type="password"
          name="token"
          autoComplete="off"
          autoFocus={!azureEnabled}
          required
          placeholder="Paste token here"
          style={{
            width: "100%",
            padding: 10,
            fontSize: 16,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            border: "1px solid #d1d5db",
            borderRadius: 6,
          }}
        />
        <button
          type="submit"
          style={{
            marginTop: 12,
            padding: "10px 20px",
            fontSize: 15,
            background: "#1f2937",
            color: "white",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          Sign in
        </button>
      </form>
    </main>
  );
}
