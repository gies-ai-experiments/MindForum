"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

const STORAGE_KEY = "mindforum_dash_sidebar_w";
const DEFAULT_W = 248; // matches .dash grid first column in globals.css
const MIN_W = 200;
const MAX_W = 460;
const WIDE_MIN = 900; // matches the .dash @media (max-width: 900px) breakpoint

function clamp(px: number): number {
  return Math.max(MIN_W, Math.min(MAX_W, px));
}

export default function ResizableDash({
  sidebar,
  children,
}: {
  sidebar: ReactNode;
  children: ReactNode;
}) {
  const [width, setWidth] = useState<number>(DEFAULT_W);
  const [wide, setWide] = useState(false);
  const widthRef = useRef<number>(DEFAULT_W);
  const draggingRef = useRef(false);

  // Restore persisted width and track whether we're on a wide (resizable) viewport.
  useEffect(() => {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    if (saved && !Number.isNaN(saved)) {
      const w = clamp(saved);
      widthRef.current = w;
      setWidth(w);
    }
    const mq = window.matchMedia(`(min-width: ${WIDE_MIN}px)`);
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  function setW(px: number) {
    const w = clamp(px);
    widthRef.current = w;
    setWidth(w);
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!wide) return;
    e.preventDefault();
    draggingRef.current = true;

    const onMove = (ev: PointerEvent) => {
      if (!draggingRef.current) return;
      setW(ev.clientX);
    };
    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      localStorage.setItem(STORAGE_KEY, String(widthRef.current));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div
      className="dash"
      style={wide ? { gridTemplateColumns: `${width}px 1fr` } : undefined}
    >
      {sidebar}
      {wide && (
        <div
          className="dash-resizer"
          style={{ left: width }}
          onPointerDown={onPointerDown}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
        />
      )}
      {children}
    </div>
  );
}
