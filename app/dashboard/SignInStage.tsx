"use client";

import { useState, type ReactNode } from "react";

export default function SignInStage({ children }: { children: ReactNode }) {
  const [submitting, setSubmitting] = useState(false);

  return (
    <main
      className={submitting ? "signin is-submitting" : "signin"}
      onSubmitCapture={() => setSubmitting(true)}
    >
      {children}
    </main>
  );
}
