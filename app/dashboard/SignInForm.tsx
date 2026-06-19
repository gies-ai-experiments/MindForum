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
      ? "That token didn't work. Check it and try again."
      : error === "missing_token"
        ? "Paste your token to continue."
        : error === "session_expired"
          ? "Your session expired. Sign in again."
          : error === "disabled"
            ? "This account is disabled. Contact your admin."
            : null;

  const azureEnabled = isAzureConfigured();

  return (
    <main className="signin">
      <section className="signin-auth">
        <div className="signin-auth__inner">
          <div className="signin-brand">
            <span className="signin-brand__mark">M</span>
            <span className="signin-brand__word">MindForum</span>
          </div>
          <p className="signin-tagline">
            Sign in to your brainstorming rooms.
          </p>

          {errMsg && (
            <p role="alert" className="signin-error">
              {errMsg}
            </p>
          )}

          {azureEnabled && (
            <form action={signInAzure} className="signin-ssoform">
              {next && <input type="hidden" name="next" value={next} />}
              <button type="submit" className="signin-cta">
                Sign in with Illinois
              </button>
            </form>
          )}

          {azureEnabled && (
            <div className="signin-or">
              <span>or use a token</span>
            </div>
          )}

          <form
            method="POST"
            action="/dashboard/auth"
            className="signin-tokenform"
          >
            {next && <input type="hidden" name="next" value={next} />}
            <input
              type="password"
              name="token"
              autoComplete="off"
              autoFocus={!azureEnabled}
              required
              placeholder="Paste your access token"
              className="signin-token"
            />
            <button type="submit" className="signin-tokenbtn">
              Sign in
            </button>
          </form>
        </div>

        <p className="signin-foot">MindForum · University of Illinois</p>
      </section>

      <aside className="signin-visual" aria-hidden="true">
        <div className="signin-stage">
          <span className="signin-shard signin-shard--1" />
          <span className="signin-shard signin-shard--2" />
          <span className="signin-shard signin-shard--3" />
          <span className="signin-shard signin-shard--4" />
          <span className="signin-shard signin-shard--5" />
          <span className="signin-shard signin-shard--6" />
          <span className="signin-shard signin-shard--7" />
        </div>
      </aside>
    </main>
  );
}
