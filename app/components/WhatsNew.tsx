"use client";
import { useEffect, useState } from "react";
import { runWalkthrough, isVisible } from "./run-walkthrough";
import { selectVisibleSteps, tourSeen, TOUR_KEYS } from "@/lib/tour-steps";
import {
  WHATS_NEW_ROOM,
  WHATS_NEW_DASH,
  WHATS_NEW_KEYS,
  unseenWhatsNew,
  markWhatsNewSeen,
  type WhatsNewStep,
} from "@/lib/whats-new";

const STEPS: Record<"room" | "dashboard", WhatsNewStep[]> = {
  room: WHATS_NEW_ROOM,
  dashboard: WHATS_NEW_DASH,
};

/**
 * "What's new" button + spotlight walkthrough of features shipped since the
 * user's last visit. Reuses the tour's driver.js runner (runWalkthrough), so it
 * looks and behaves exactly like the first-run tour — it just plays the unseen
 * subset. Place beside the TourReplayButton on each surface.
 */
export default function WhatsNew({
  surface,
  className,
}: {
  surface: "room" | "dashboard";
  className?: string;
}) {
  const steps = STEPS[surface];
  const key = WHATS_NEW_KEYS[surface];
  const [count, setCount] = useState(0);

  // Play `subset`, marking everything seen + clearing the badge when done.
  function play(subset: WhatsNewStep[]) {
    const store = window.localStorage;
    const visible = selectVisibleSteps(subset, isVisible);
    const finish = () => {
      markWhatsNewSeen(steps, store, key);
      setCount(0);
    };
    if (visible.length === 0) {
      finish();
      return;
    }
    runWalkthrough(visible, { onDone: finish });
  }

  useEffect(() => {
    const store = window.localStorage;
    const marker = store.getItem(key);
    // Brand-new user: treat as caught up (they get the full first-run tour),
    // don't replay the whole history at them.
    if (marker === null) {
      markWhatsNewSeen(steps, store, key);
      setCount(0);
      return;
    }
    const unseen = unseenWhatsNew(steps, store, key);
    setCount(unseen.length);
    // Auto-play the new steps once — but only if the first-run tour for this
    // surface is already done, so the two walkthroughs never overlap.
    if (unseen.length > 0 && tourSeen(TOUR_KEYS[surface], store)) {
      const t = setTimeout(() => play(unseen), 700);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surface]);

  return (
    <button
      type="button"
      className={className}
      title="What's new"
      aria-label={count > 0 ? `What's new — ${count} new` : "What's new"}
      onClick={() => play(steps)}
      style={{ position: "relative" }}
    >
      <span aria-hidden="true">✦</span>
      <span className="whatsnew-btn__label">What's new</span>
      {count > 0 && <span className="whatsnew-btn__badge">{count}</span>}
    </button>
  );
}
