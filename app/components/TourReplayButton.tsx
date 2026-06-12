"use client";
import { startTour } from "./FeatureTour";
import { TOUR_KEYS } from "@/lib/tour-steps";

export default function TourReplayButton({
  surface,
  className,
}: {
  surface: "room" | "dashboard";
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label="Take a tour"
      title="Take a tour"
      className={className}
      onClick={() => startTour(TOUR_KEYS[surface])}
    >
      ?
    </button>
  );
}
