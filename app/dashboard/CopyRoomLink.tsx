"use client";

import { useState } from "react";

export default function CopyRoomLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(e: React.MouseEvent) {
    e.preventDefault();
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <a
      href={url}
      onClick={handleCopy}
      target="_blank"
      rel="noreferrer"
      style={{ cursor: "pointer" }}
    >
      {copied ? "Link copied ✓" : "Open ↗"}
    </a>
  );
}
