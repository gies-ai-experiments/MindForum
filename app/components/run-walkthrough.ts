"use client";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import { type TourStep } from "@/lib/tour-steps";

/** Per-step side-effects, keyed by `TourStep.id` (e.g. type "/poll" into the composer). */
export type WalkthroughHooks = Record<string, { onShow?: () => void; onHide?: () => void }>;

export function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Visible = element exists and is laid out (not display:none / in a closed drawer). */
export function isVisible(selector: string): boolean {
  const el = document.querySelector<HTMLElement>(selector);
  return !!el && el.offsetParent !== null;
}

/**
 * Drive a driver.js spotlight walkthrough over `steps`. Shared by the first-run
 * tour (FeatureTour) and the "What's new" walkthrough so both look and behave
 * identically. `onDone` runs once when the walkthrough is destroyed (finished,
 * closed, or skipped) — callers use it to mark progress as seen.
 */
export function runWalkthrough(
  steps: TourStep[],
  opts?: { hooks?: WalkthroughHooks; onDone?: () => void }
): void {
  if (steps.length === 0) return;
  const hooks = opts?.hooks;
  // Track which step side-effects are active so we can always restore on exit.
  const pendingHide = new Set<string>();
  const fireShow = (id?: string) => {
    if (!id) return;
    hooks?.[id]?.onShow?.();
    if (hooks?.[id]?.onHide) pendingHide.add(id);
  };
  const fireHide = (id?: string) => {
    if (!id || !pendingHide.has(id)) return;
    hooks?.[id]?.onHide?.();
    pendingHide.delete(id);
  };
  const d = driver({
    showProgress: true,
    animate: !reducedMotion(),
    popoverClass: "mindforum-tour",
    nextBtnText: "Next",
    prevBtnText: "Back",
    doneBtnText: "Done",
    steps: steps.map((s) => ({
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
      opts?.onDone?.();
    },
  });
  d.drive();
}
