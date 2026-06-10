"use client";
import { useEffect, useState } from "react";

/**
 * Numbered feature showcase: sticky nav on the left, mosaic media panels with
 * floating UI mockups in the middle, text column on the right. The nav tracks
 * the panel nearest the viewport center via IntersectionObserver.
 */

type Feature = {
  id: string;
  num: string;
  navLabel: string;
  title: string;
  body: string;
  bullets: string[];
  windowTitle: string;
  windowStatus: string;
  visual: "chat" | "files" | "poll" | "facilitator";
};

const FEATURES: Feature[] = [
  {
    id: "feat-ai",
    num: "01",
    navLabel: "AI THAT WAITS",
    title: "An AI that waits its turn",
    body: "Silent by default. The conversation belongs to the group — mention @ai when you want a synthesis, a counterpoint, or a fresh angle.",
    bullets: [
      "Replies stream in live, token by token",
      "Reads the whole room, not just the last message",
      "@-mention colleagues — no installs, the link is the invitation",
    ],
    windowTitle: "ROOM CHAT",
    windowStatus: "● live",
    visual: "chat",
  },
  {
    id: "feat-files",
    num: "02",
    navLabel: "GROUNDED IN FILES",
    title: "Grounded in your documents",
    body: "Upload PDFs, Word docs, or notes. Check the ones that matter and the AI reads them before it answers — suggestions stay anchored to your material.",
    bullets: [
      "Per-file toggles control exactly what the AI sees",
      "Replies cite which documents they drew from",
      "One-click project brief: themes, outline, risks, next steps",
    ],
    windowTitle: "ROOM FILES",
    windowStatus: "6 attached",
    visual: "files",
  },
  {
    id: "feat-polls",
    num: "03",
    navLabel: "POLLS & DECISIONS",
    title: "Decisions, not just discussion",
    body: "Type /poll to put a question to the group. The AI drafts options from the discussion; tallies stay hidden until the poll closes.",
    bullets: [
      "Options drafted from the conversation, not from scratch",
      "Hidden tallies keep early votes from anchoring the room",
      "Outcomes land in the project brief automatically",
    ],
    windowTitle: "/POLL",
    windowStatus: "3 votes in",
    visual: "poll",
  },
  {
    id: "feat-facilitator",
    num: "04",
    navLabel: "FACILITATOR BY DESIGN",
    title: "A facilitator you design",
    body: "Each room carries its own AI guidance — probe before proposing, play devil's advocate, or keep a grant reviewer's eye.",
    bullets: [
      "Per-room system prompt shapes every reply",
      "Personas: probing coach, devil's advocate, reviewer",
      "Update guidance mid-session as the work evolves",
    ],
    windowTitle: "ROOM GUIDANCE",
    windowStatus: "saved",
    visual: "facilitator",
  },
];

function Visual({ type }: { type: Feature["visual"] }) {
  switch (type) {
    case "chat":
      return (
        <div className="landing-feat-chat">
          <div className="landing-feat-chat__bubble">
            <span>Priya</span>
            What if we framed the pilot around student outcomes?
          </div>
          <div className="landing-feat-chat__bubble">
            <span>Marcus</span>
            <strong>@ai</strong> — does the draft support that framing?
          </div>
          <div className="landing-feat-chat__bubble landing-feat-chat__bubble--ai">
            <span>AI</span>
            Sections 2 and 4 lead with outcomes. The gap is evaluation.
          </div>
        </div>
      );
    case "files":
      return (
        <div>
          <div className="landing-feat-files">
            {["PDF", "DOC", "MD"].map((label, i) => (
              <div key={i} className="landing-feat-file">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <div className="landing-feat-brief">
            {["Themes", "Outline", "Risks", "Next steps"].map((item) => (
              <div key={item} className="landing-feat-brief__row">
                <span className="landing-feat-brief__dot" />
                <span>{item}</span>
                <span className="landing-feat-brief__bar" />
              </div>
            ))}
          </div>
        </div>
      );
    case "poll":
      return (
        <div className="landing-feat-poll">
          {["Outcomes-first framing", "Tooling-first framing", "Hybrid approach"].map((opt, i) => (
            <div key={opt} className={`landing-feat-poll__opt${i === 0 ? " landing-feat-poll__opt--sel" : ""}`}>
              <span className="landing-feat-poll__radio" />
              <span>{opt}</span>
            </div>
          ))}
        </div>
      );
    case "facilitator":
      return (
        <div className="landing-feat-fac">
          {[
            { label: "Probe first", w: "72%" },
            { label: "Devil's advocate", w: "48%" },
            { label: "Grant reviewer", w: "86%" },
          ].map((s) => (
            <div key={s.label} className="landing-feat-fac__row">
              <span>{s.label}</span>
              <div className="landing-feat-fac__track">
                <div className="landing-feat-fac__fill" style={{ width: s.w }} />
              </div>
            </div>
          ))}
        </div>
      );
  }
}

export default function FeatureShowcase() {
  const [active, setActive] = useState(FEATURES[0].id);

  useEffect(() => {
    const panels = document.querySelectorAll(".landing-show__panel");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      // A horizontal band around the viewport center decides the active panel.
      { rootMargin: "-40% 0px -50% 0px" }
    );
    panels.forEach((p) => observer.observe(p));
    return () => observer.disconnect();
  }, []);

  return (
    <section id="features" className="landing-show">
      <div className="landing-show__head">
        <span className="landing-show__kicker">■ WHY MINDFORUM</span>
        <h2>
          Everything a brainstorm needs.
          <br />
          Nothing that talks over it.
        </h2>
      </div>

      <div className="landing-show__grid">
        <nav className="landing-show__nav" aria-label="Features">
          {FEATURES.map((f) => (
            <a
              key={f.id}
              href={`#${f.id}`}
              className={`landing-show__navitem${active === f.id ? " landing-show__navitem--active" : ""}`}
            >
              <span className="landing-show__navnum">{f.num}</span>
              {f.navLabel}
            </a>
          ))}
        </nav>

        <div className="landing-show__panels">
          {FEATURES.map((f, i) => (
            <article key={f.id} id={f.id} className="landing-show__panel">
              <div className={`landing-show__media landing-show__media--m${(i % 4) + 1}`} aria-hidden="true">
                <div className="landing-show__window">
                  <div className="landing-show__windowbar">
                    <span className="landing-show__windowdots">▪▪▪</span>
                    <span className="landing-show__windowtitle">{f.windowTitle}</span>
                    <span className="landing-show__windowstatus">{f.windowStatus}</span>
                  </div>
                  <div className="landing-show__windowbody">
                    <Visual type={f.visual} />
                  </div>
                </div>
              </div>
              <div className="landing-show__text">
                <span className="landing-show__chip">{f.num}</span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
                <ul className="landing-show__bullets">
                  {f.bullets.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
