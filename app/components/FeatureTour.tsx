"use client";
import { useEffect, useRef } from "react";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import {
  type TourStep,
  selectVisibleSteps,
  tourSeen,
  markTourSeen,
} from "@/lib/tour-steps";

/** Per-step side-effects, keyed by `TourStep.id` (e.g. type "/poll" into the composer). */
export type TourHooks = Record<string, { onShow?: () => void; onHide?: () => void }>;

const REPLAY_EVENT = "mindforum:start-tour";

/** Start (or replay) a tour from anywhere on the page. */
export function startTour(storageKey: string) {
  window.dispatchEvent(new CustomEvent(REPLAY_EVENT, { detail: { storageKey } }));
}

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Visible = element exists and is laid out (not display:none / in a closed drawer). */
function isVisible(selector: string): boolean {
  const el = document.querySelector<HTMLElement>(selector);
  return !!el && el.offsetParent !== null;
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
      // Track which step side-effects are active so we can always restore on exit.
      const pendingHide = new Set<string>();
      const fireShow = (id?: string) => {
        if (!id) return;
        hooksRef.current?.[id]?.onShow?.();
        if (hooksRef.current?.[id]?.onHide) pendingHide.add(id);
      };
      const fireHide = (id?: string) => {
        if (!id || !pendingHide.has(id)) return;
        hooksRef.current?.[id]?.onHide?.();
        pendingHide.delete(id);
      };
      const d = driver({
        showProgress: true,
        animate: !reducedMotion(),
        popoverClass: "mindforum-tour",
        nextBtnText: "Next",
        prevBtnText: "Back",
        doneBtnText: "Done",
        steps: visible.map((s) => ({
          element: s.selector,
          popover: {
            title: s.title,
            description: s.body,
            side: s.side,
            align: s.align,
          },
          onHighlighted: () => fireShow(s.id),
          onDeselected: () => fireHide(s.id),
        })),
        onDestroyed: () => {
          // Restore any step whose onDeselected didn't fire (e.g. closed via X/Done).
          for (const id of Array.from(pendingHide)) fireHide(id);
          markTourSeen(storageKey, window.localStorage);
        },
      });
      d.drive();
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
