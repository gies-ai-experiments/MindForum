import Link from "next/link";
import JoinRoomForm from "./JoinRoomForm";
import AdminCreateCard from "./AdminCreateCard";

export const metadata = {
  title: "MindForum — brainstorm together, with an AI that waits its turn",
};

const FEATURES = [
  {
    title: "An AI that waits its turn",
    body: "The AI is silent by default. Mention @ai when you want a synthesis, a counterpoint, or a fresh angle — the rest of the time the conversation belongs to the group.",
  },
  {
    title: "Shared files as context",
    body: "Upload PDFs, Word docs, or notes to the room. Check the ones that matter and the AI reads them before it answers, so its suggestions are grounded in your material.",
  },
  {
    title: "One-click project brief",
    body: "When the session winds down, turn the whole thread into a structured brief — themes, outline, risks, next steps — and download it as Markdown.",
  },
  {
    title: "Polls & decisions",
    body: "Type /poll to put a question to the group. The AI drafts options from the discussion, tallies stay hidden until the poll closes, and outcomes land in the brief.",
  },
  {
    title: "Live, lightweight presence",
    body: "Messages stream in real time. @-mention a colleague to flag something for them. No installs, no accounts for participants — the link is the invitation.",
  },
  {
    title: "A facilitator you design",
    body: "Each room carries its own AI guidance. Tell it to probe before proposing, to play devil's advocate, or to keep a grant reviewer's eye — every room gets its own personality.",
  },
];

const STEPS = [
  {
    title: "Create a room",
    body: "Sign in, name the room, and write a short brief for the AI: what the group is working on and how it should behave.",
  },
  {
    title: "Share the link",
    body: "Colleagues join in one click with just their name — no accounts, no setup. Comfortable for groups of two to six.",
  },
  {
    title: "Think out loud",
    body: "Brainstorm as you would in a hallway conversation. Pull the AI in with @ai when it's useful; export a brief when you're done.",
  },
];

export default function LandingPage() {
  return (
    <main className="landing">
      <header className="landing-nav">
        <span className="landing-wordmark">MindForum</span>
        <nav>
          <Link href="/dashboard" className="landing-btn landing-btn--ghost">
            Sign in
          </Link>
        </nav>
      </header>

      <section className="landing-hero">
        <div className="landing-hero__copy">
          <h1>
            Brainstorm together, with an AI that <em>waits its turn</em>.
          </h1>
          <p>
            MindForum is a shared room where a small group — and one
            well-briefed AI — think through a problem together. The AI reads
            the room, knows your documents, and speaks only when you mention{" "}
            <code>@ai</code>.
          </p>
          <div className="landing-hero__cta">
            <Link href="/dashboard" className="landing-btn landing-btn--orange">
              Sign in to create rooms
            </Link>
            <a href="#join" className="landing-btn landing-btn--ghost">
              Have a room link? Join →
            </a>
          </div>
        </div>

        <div className="landing-chat-mock" aria-hidden="true">
          <div className="landing-chat-mock__title">Fall 2026 Grant Brainstorm</div>
          <div className="landing-bubble">
            <span className="landing-bubble__name">Priya</span>
            What if we framed the pilot around student outcomes instead of the
            tooling?
          </div>
          <div className="landing-bubble">
            <span className="landing-bubble__name">Marcus</span>
            Stronger for this RFP. <strong>@ai</strong> — does the draft
            proposal we uploaded support that framing?
          </div>
          <div className="landing-bubble landing-bubble--ai">
            <span className="landing-bubble__name">AI</span>
            Mostly, yes — sections 2 and 4 already lead with outcomes. The gap
            is evaluation: the draft names no baseline measure. Want three
            options the group could react to?
          </div>
        </div>
      </section>

      <section className="landing-section">
        <h2>How it works</h2>
        <ol className="landing-steps">
          {STEPS.map((s, i) => (
            <li key={s.title} className="landing-card">
              <span className="landing-step__num">{i + 1}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-section">
        <h2>What's in the room</h2>
        <div className="landing-features">
          {FEATURES.map((f) => (
            <div key={f.title} className="landing-card">
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="join" className="landing-section landing-join">
        <div className="landing-card">
          <h2>Join a room</h2>
          <p>
            Invited by a colleague? Their link takes you straight in — or paste
            the room ID here.
          </p>
          <JoinRoomForm />
        </div>
      </section>

      <AdminCreateCard />

      <footer className="landing-footer">
        <span>
          Built at Gies College of Business, University of Illinois
          Urbana-Champaign.
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
    </main>
  );
}
