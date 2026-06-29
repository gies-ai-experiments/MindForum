import Link from "next/link";
import AdminCreateCard from "./AdminCreateCard";
import FeatureShowcase from "./FeatureShowcase";
import MindForumLogo from "./components/MindForumLogo";

export const metadata = {
  title: "MindForum — brainstorm together, with an AI that waits its turn",
};

const TRUSTED: { name: string; href?: string }[] = [
  { name: "Gies College of Business", href: "https://giesbusiness.illinois.edu" },
  { name: "Disruption Lab", href: "https://giesgroups.illinois.edu/disruptionlab" },
  { name: "MSBAi" },
  { name: "AI Experiments" },
  { name: "Faculty cohorts" },
];

/**
 * One copy of the trusted-by logos. Rendered twice inside the marquee track so
 * the right-to-left scroll loops seamlessly; the duplicate is `hidden` (aria +
 * untabbable) so assistive tech and keyboard users only meet each link once.
 */
function TrustedRow({ hidden = false }: { hidden?: boolean }) {
  return (
    <div className="landing-trusted__group" aria-hidden={hidden || undefined}>
      {TRUSTED.map(({ name, href }) =>
        href ? (
          <a
            key={name}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            tabIndex={hidden ? -1 : undefined}
            className="landing-trusted__logo landing-trusted__logo--link"
          >
            {name}
          </a>
        ) : (
          <span key={name} className="landing-trusted__logo">
            {name}
          </span>
        )
      )}
    </div>
  );
}

export default function LandingPage() {
  return (
    <main className="landing">
      <header className="landing-nav">
        <MindForumLogo className="landing-wordmark" />
        <nav className="landing-nav__links">
          <a href="#features">Features</a>
          <a href="#how-it-works">How it works</a>
        </nav>
        <div className="landing-nav__actions">
          <Link href="/dashboard" className="landing-btn landing-btn--orange">
            Sign in
          </Link>
        </div>
      </header>

      <section className="landing-hero">
        <div className="landing-hero__grid" aria-hidden="true">
          <span className="landing-hero__grid-plane landing-hero__grid-plane--floor" />
          <span className="landing-hero__grid-plane landing-hero__grid-plane--ceil" />
          <span className="landing-hero__grid-dots" />
        </div>
        <h1>
          <span className="landing-hero__line">Brainstorm together,</span>
          <span className="landing-hero__line landing-hero__line--accent">
            with an AI that waits its turn.
          </span>
        </h1>
        <p className="landing-hero__sub">
          MindForum is a shared room where a small group — and one well-briefed AI —
          think through a problem together. The AI reads the room, knows your documents,
          and speaks only when you mention <code>@ai</code>.
        </p>
        <div className="landing-hero__cta">
          <Link href="/dashboard" className="landing-btn landing-btn--orange landing-btn--lg">
            Sign in to create rooms
          </Link>
        </div>

        <div className="landing-trusted">
          <p>Supported by</p>
          <div className="landing-trusted__marquee">
            <div className="landing-trusted__track">
              <TrustedRow />
              <TrustedRow hidden />
            </div>
          </div>
        </div>
      </section>

      <section className="landing-demo" aria-label="Product demo video">
        <div className="landing-demo__frame">
          <div className="landing-show__windowbar">
            <span className="landing-show__windowdots">▪▪▪</span>
            <span className="landing-show__windowtitle">MINDFORUM IN 20 SECONDS</span>
            <span className="landing-show__windowstatus">● live demo</span>
          </div>
          {/* Raw HTML so autoplay/muted land in the SSR markup — React omits the
              muted attribute, which breaks autoplay policies before hydration. */}
          <div
            dangerouslySetInnerHTML={{
              __html:
                '<video class="landing-demo__video" src="/demo.mp4" poster="/demo-poster.jpg" autoplay muted loop playsinline aria-label="Demo: joining a MindForum room, sending a message, and getting a streamed @ai reply"></video>',
            }}
          />
        </div>
      </section>

      <FeatureShowcase />

      <div className="landing-light">
      <section id="how-it-works" className="landing-section landing-how">
        <div className="landing-how__head">
          <span className="landing-how__kicker">
            <span className="landing-how__kickerdot" aria-hidden="true" />
            HOW IT WORKS
          </span>
          <h2>From blank page to project brief in one session.</h2>
        </div>
        <div className="landing-steps">
          <article className="landing-step-card">
            <svg className="landing-step__icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="4" y="4" width="16" height="16" rx="3" />
              <path d="M12 9v6M9 12h6" />
            </svg>
            <span className="landing-step__label">STEP 01</span>
            <h3>Create a room</h3>
            <p>Sign in, name the room, and write a short brief for the AI.</p>
            <Link href="/dashboard" className="landing-btn landing-btn--navy landing-btn--pill">
              Sign in to start
            </Link>
          </article>
          <article className="landing-step-card">
            <svg className="landing-step__icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            <span className="landing-step__label">STEP 02</span>
            <h3>Share the link</h3>
            <p>Colleagues join in one click with just their name — no accounts.</p>
          </article>
          <article className="landing-step-card">
            <svg className="landing-step__icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" />
              <path d="M8.5 12h.01M12 12h.01M15.5 12h.01" strokeWidth="2.4" />
            </svg>
            <span className="landing-step__label">STEP 03</span>
            <h3>Think out loud</h3>
            <p>Brainstorm naturally. Pull the AI in with @ai; export a brief when done.</p>
            <a href="#features" className="landing-btn landing-btn--navy landing-btn--pill">
              See the features
            </a>
          </article>
        </div>
      </section>

      <AdminCreateCard />

      <footer className="landing-footer">
        <span>
          Built at{" "}
          <a
            href="https://giesbusiness.illinois.edu"
            target="_blank"
            rel="noopener noreferrer"
          >
            Gies College of Business
          </a>
          , University of Illinois Urbana-Champaign.
          <br />
          Supported by{" "}
          <a
            href="https://giesgroups.illinois.edu/disruptionlab"
            target="_blank"
            rel="noopener noreferrer"
          >
            Disruption Lab
          </a>
          .
        </span>
        <span>
          <a
            href="https://github.com/gies-ai-experiments/MindForum"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open source (MIT)
          </a>
          {" · "}
          <Link href="/dashboard">Creator sign-in</Link>
        </span>
      </footer>
      </div>
    </main>
  );
}
