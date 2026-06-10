import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "MindForum",
  description:
    "Shared AI brainstorming rooms for small groups. Invite colleagues with a link, upload documents as context, and pull the AI into the conversation only when you mention @ai.",
  openGraph: {
    title: "MindForum",
    description:
      "Shared AI brainstorming rooms for small groups. The AI reads the room, knows your documents, and speaks only when mentioned.",
    siteName: "MindForum",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
