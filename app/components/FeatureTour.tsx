"use client";
import { useEffect, useRef } from "react";
import {
  type TourStep,
  selectVisibleSteps,
  tourSeen,
  markTourSeen,
} from "@/lib/tour-steps";
import {
  runWalkthrough,
  isVisible,
  type WalkthroughHooks,
} from "./run-walkthrough";

/** Per-step side-effects, keyed by `TourStep.id` (e.g. type "/poll" into the composer). */
export type TourHooks = WalkthroughHooks;

const REPLAY_EVENT = "mindforum:start-tour";

/** Start (or replay) a tour from anywhere on the page. */
export function startTour(storageKey: string) {
  window.dispatchEvent(new CustomEvent(REPLAY_EVENT, { detail: { storageKey } }));
}

export default function FeatureTour({
  steps,
  storageKey,
  autoStart = false,
  startWhen = true,
  hooks,
}: {
  steps: TourStep[];
  storageKey: string;
  autoStart?: boolean;
  startWhen?: boolean;
  hooks?: TourHooks;
}) {
  // Held in a ref so changing host callbacks doesn't re-run the effect/auto-start.
  const hooksRef = useRef<TourHooks | undefined>(hooks);
  hooksRef.current = hooks;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    function run(force: boolean) {
      if (!force && tourSeen(storageKey, window.localStorage)) return;
      const visible = selectVisibleSteps(steps, isVisible);
      if (visible.length === 0) return;
      runWalkthrough(visible, {
        hooks: hooksRef.current,
        onDone: () => markTourSeen(storageKey, window.localStorage),
      });
    }

    if (autoStart && startWhen && !tourSeen(storageKey, window.localStorage)) {
      // Delay so target elements have mounted & painted before highlighting.
      timer = setTimeout(() => run(false), 450);
    }

    function onReplay(e: Event) {
      if ((e as CustomEvent).detail?.storageKey === storageKey) run(true);
    }
    window.addEventListener(REPLAY_EVENT, onReplay);

    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener(REPLAY_EVENT, onReplay);
    };
  }, [steps, storageKey, autoStart, startWhen]);

  return null;
}
