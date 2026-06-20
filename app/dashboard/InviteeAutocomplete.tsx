"use client";

import { useRef, useState } from "react";

type CreatorSuggestion = { id: string; email: string; displayName: string };

export default function InviteeAutocomplete({
  email,
  onEmailChange,
  onPick,
  disabled,
  placeholder = "Email or name",
}: {
  email: string;
  onEmailChange: (value: string) => void;
  onPick: (s: { email: string; displayName: string }) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [suggestions, setSuggestions] = useState<CreatorSuggestion[]>([]);
  const [show, setShow] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleChange(value: string) {
    onEmailChange(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 1) {
      setSuggestions([]);
      setShow(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/dashboard/creators/lookup?q=${encodeURIComponent(value.trim())}`
        );
        if (res.ok) {
          const data = await res.json();
          setSuggestions(data);
          setShow(data.length > 0);
        }
      } catch {
        /* ignore */
      }
    }, 300);
  }

  function pick(s: CreatorSuggestion) {
    onPick({ email: s.email, displayName: s.displayName });
    setSuggestions([]);
    setShow(false);
  }

  return (
    <div style={{ flex: "1 1 200px", position: "relative" }}>
      <input
        type="email"
        placeholder={placeholder}
        value={email}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => suggestions.length > 0 && setShow(true)}
        onBlur={() => setTimeout(() => setShow(false), 200)}
        disabled={disabled}
        autoComplete="off"
        style={{
          width: "100%",
          padding: "6px 10px",
          fontSize: 14,
          border: "1px solid #d1d5db",
          borderRadius: 6,
          boxSizing: "border-box",
        }}
      />
      {show && suggestions.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            background: "white",
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
            zIndex: 10,
            maxHeight: 200,
            overflowY: "auto",
          }}
        >
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              onMouseDown={() => pick(s)}
              style={{
                display: "block",
                width: "100%",
                padding: "8px 10px",
                border: "none",
                background: "transparent",
                textAlign: "left",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              <span style={{ fontWeight: 600 }}>{s.displayName}</span>
              <span style={{ color: "#888", marginLeft: 8 }}>{s.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
