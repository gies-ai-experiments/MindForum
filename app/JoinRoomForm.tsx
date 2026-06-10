"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Join-by-room-ID form. Most participants arrive via a direct room link;
 * this is the recovery path when someone only has the ID.
 */
export default function JoinRoomForm() {
  const router = useRouter();
  const [joinId, setJoinId] = useState("");

  function onJoin(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = joinId.trim();
    if (!trimmed) return;
    // Accept a full room URL pasted in, not just the bare ID.
    const fromUrl = trimmed.match(/\/room\/([a-z0-9-]+)/i);
    router.push(`/room/${fromUrl ? fromUrl[1] : trimmed}`);
  }

  return (
    <form onSubmit={onJoin} className="landing-join-form">
      <input
        value={joinId}
        onChange={(e) => setJoinId(e.target.value)}
        placeholder="Room ID or full room link"
        aria-label="Room ID or full room link"
      />
      <button type="submit" className="landing-btn landing-btn--navy">
        Open
      </button>
    </form>
  );
}
