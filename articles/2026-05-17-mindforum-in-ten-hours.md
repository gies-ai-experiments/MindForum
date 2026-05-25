# Ten Hours from Email to Faculty Tool: What the Shape of Software Looks Like When Building Becomes Cheap

*Published 17 May 2026*

On the morning of April 20, my colleague [William Ocasio](https://giesbusiness.illinois.edu/profile/william-ocasio) emailed me a transcript of a long conversation he had had with [Claude](https://www.anthropic.com/claude) about the ethics of AI in warfare. He had found it unexpectedly good and thought it could seed an exercise for our first-year business sequence. I wondered if we could brainstorm on it with four or five other faculty who would be stakeholders, ideally asynchronously, ideally soon.

Under ten hours later, **MindForum** was live on my VPS, preloaded with his transcript and a draft of a student-facing AI prompt, with a facilitator AI waiting in the chat. I had already sent the first `@ai help me get started`, found the reply thin, tuned the system prompt, and spun the room back up.

No part of this story is about AI writing code faster than humans. It is about what happens to the shape of software when building becomes cheap enough that you can make a tool that fits **one specific group's one specific problem**.

## The collaboration chain

The speed did not come from one person moving fast. It came from three actors each doing the part they were best at, and handing off cleanly.

**Ashleyn Castelino** — an MSBA student at Gies — wrote the spec. After a few Teams messages that morning, he came back with two careful design documents: a data model and a task-by-task implementation plan. Rooms in memory, server-sent events for live updates, PDF/DOCX parsing, a "Generate project brief" button using structured JSON output. Not a wishlist — runnable instructions. He used his own agent and skills system to produce it. I trusted that system, hardened by many prototypes, would deliver a good spec.

**I modified and executed** from his spec. Cloned his repo, worked through the 18-task plan with [Claude Opus 4.7](https://www.anthropic.com/claude) over a few hours, adapted a few things (moved the model to gpt-5.4, instantiated the OpenAI client per-request to avoid Vercel-style build-phase failures), kept most of Ash's architecture intact. Pushed to GitHub. Deployed to the VPS.

**The model wrote most of the code.** Not in a flourish, not as one monolithic prompt. In small steps that matched the plan. Each step was readable, runnable, testable. When something broke — and things broke — the loop closed quickly because the unit was small and the spec was already explicit.

By evening the room was up. By the next morning I was iterating the facilitator prompt with my own first-pass usage. The faculty who would actually use it had not even logged in yet.

## What I expected to learn vs. what I learned

Going in, I expected the lesson to be about velocity. Models are fast now; we know this. The interesting result was somewhere else.

The lesson was about **shape**. Five years ago, a tool sized to "four or five faculty discussing one transcript asynchronously" was not buildable. Not by me, not by my IT team, not by a vendor. There was no price point that made sense. Every option — Slack channel, Teams thread, Google Doc, a hand-curated email chain — was a tool sized for a different problem, being asked to do this one badly.

MindForum is not a clever product. It is a 19-task application that does exactly one job: hold a transcript and a facilitator prompt and a small group of stakeholders in the same room for a few days, so the deliberation can happen at the speed of the participants and not at the speed of a meeting calendar.

When building drops in cost by an order of magnitude, the entire category of "tools too small to be worth making" becomes buildable. That is the shape change. It looks like speed from the outside; from the inside it looks like *fit*.

This is the second time this month I have watched a small, specific tool come together fast. The first was a [faculty-deliberation platform shipped between talks at a college retreat](https://chatwithgpt.substack.com/p/build-to-learn-learn-to-build-when) in mid-April — a different problem, the same loop, with a less elegant handoff because I was wearing every hat in the chain. MindForum is the next iteration: shorter, cleaner, and — importantly — only possible because someone else (Ash) was now in the chain doing the part I am not best at.

This is roughly the argument Ink & Switch has been making for years under the banner of [**malleable software**](https://www.inkandswitch.com/malleable-software/) — that the right unit of software is the one a user can bend to their workflow, not a prepackaged product they bend themselves around. The version we just lived through is the same argument with one new ingredient: the bending is now cheap enough that you do it before the meeting, not after the procurement cycle. MindForum is malleable software made not by a researcher arguing for the category but by a faculty member who needed a thing on Tuesday.

## Why the chain matters more than the model

The single most undervalued part of this story is that no one in the chain was doing everyone's job.

Ashleyn writes specs better than I do. He has been building agentic prototypes for months and has a working theory of how to structure them. His spec was not just clearer than what I would have written — it included decisions I would not have made (PDF/DOCX parsing as a first-class feature, structured JSON for the project brief, server-sent events rather than polling). Those decisions came from a builder who has seen what breaks at the seams.

I am not a better coder than Claude Opus 4.7 — not even close. I am a better evaluator. I have shipped enough small applications now to know which parts of a generated implementation will betray you in three days and which will hold. My contribution was reading the diffs the model produced, swapping the model where the architecture decision was load-bearing (gpt-5.4 for one specific reasoning task), and adapting the OpenAI client instantiation to a deployment pattern that Vercel rewards. None of that is novel work. All of it is necessary work.

The model did not have taste about MindForum. It did not know that the facilitator AI's first reply being thin meant the system prompt was wrong, not the model. It also did not have a stake in the outcome — it would not be the one returning to Willie on April 21 to say "the room is live, here is the link."

The three roles together produced what none of them produces alone. This is not new; it is the [compound engineering loop](https://chatwithgpt.substack.com/p/compound-engineering-use-it-before) other Hybrid Builder pieces have been chasing. What is new is how cheap the assembly has become.

## The loop, in five steps

I have been writing about this as #BuildToLearn and #LearnToBuild on LinkedIn for the last year. The MindForum story is what the loop looks like when faculty are part of it:

1. **A specific need surfaces.** Not "a discussion platform." A specific transcript, a specific group, a specific deliberation, a specific deadline.
2. **A builder writes a spec for the specific need.** Not a wishlist. Runnable instructions that someone else could execute.
3. **A model executes the spec.** Most of the code is generated. The human picks the model and adapts the parts where deployment context matters.
4. **A human evaluates the result.** Reads the diffs, tunes prompts, swaps models where taste is load-bearing, fixes the small things the model could not have known.
5. **The tool lives long enough to be useful for the specific need, and probably not much longer.** It is a working artifact, not a product.

The fifth point is the one I keep returning to. MindForum exists because four or five faculty needed to discuss one transcript. It does not need to scale. It does not need a paying customer. It does not need a roadmap. It needs to work this week.

When the cost of building drops enough, software stops being a thing you commission and starts being a thing you make for yourself. The same way you make a slide deck. The same way you make a one-page memo. You do not call IT to make you a memo.

## What this means for faculty

If you are a faculty member reading this and thinking "I do not write code," the relevant skill is not coding. It is **specifying** — knowing the difference between a wishlist and a spec, between "I want a discussion platform" and "I need to hold a transcript and a facilitator prompt and four to five people for three days."

The skill is **evaluating** — reading the output and knowing which parts to trust and which parts to push back on. That is the skill faculty already have; we have been doing it to student work for our entire careers.

And the skill is **the chain** — knowing who to hand off to and who to take a handoff from. Ashleyn did not need me to write his spec. I did not need him to deploy. Neither of us needed the model to have taste. We needed each other to be good at our own thing and to hand off cleanly.

## What this does not mean

It does not mean every faculty member should be shipping software. Most should not. Most of the time, a Google Doc is the right answer.

It does mean that the menu has grown. The thing that used to be "too small to build" is now "a Friday afternoon." That changes which problems you let yourself try to solve.

It also does not mean the model is the bottleneck. The bottleneck is still the human who knows what is worth building, and the human who can read a diff with judgement, and — increasingly — the student who can write a spec a faculty member can execute against.

## What I am watching for next

The MindForum incident was a faculty colleague (Willie) emailing me (a faculty colleague) with a specific need that triggered a build by a student (Ash) and a model (Opus 4.7), executed by a faculty member (me again, wearing a different hat) and delivered to the faculty who would use it. That chain ran in under ten hours.

I am watching for the version of this chain that has **no faculty member in the middle**. Where a student writes a spec for another student. Where two students hand off a build to each other through a shared agent. Where the artifact never has to pass through me to reach the people who need it. That chain is shorter, faster, and — most importantly — does not have my calendar as the rate limit.

When that version of the loop runs in our program, the shape of software for higher education will have changed again.

---

*Vishal Sachdev is the academic director of the on-campus MS in Business Analytics program at Gies College of Business, University of Illinois Urbana-Champaign. He writes [The Hybrid Builder](https://chatwithgpt.substack.com/) on AI-augmented teaching and building.*

*The April 20 MindForum incident was first mentioned in a [LinkedIn post on 25 April 2026](https://www.linkedin.com/feed/update/urn:li:ugcPost:7453774563659653120).*
