import type { AuditEntry } from "@/lib/audit";

function describe(e: AuditEntry): string {
  const m = e.metadata ?? {};
  switch (e.action) {
    case "room.create":
      return `created the room (slug: ${(m as { slug?: string }).slug ?? "?"})`;
    case "room.update": {
      const md = m as {
        name?: { from: string; to: string };
        systemPromptLen?: { from: number; to: number };
      };
      const parts: string[] = [];
      if (md.name) parts.push(`renamed "${md.name.from}" → "${md.name.to}"`);
      if (md.systemPromptLen) {
        parts.push(
          `system prompt: ${md.systemPromptLen.from.toLocaleString()} → ${md.systemPromptLen.to.toLocaleString()} chars`
        );
      }
      return parts.length ? parts.join(", ") : "updated the room";
    }
    case "room.archive":
      return "archived the room";
    case "room.restore":
      return "restored the room";
    case "room.transfer": {
      const md = m as { fromOwnerId?: string; toOwnerId?: string };
      return `transferred ownership: ${md.fromOwnerId} → ${md.toOwnerId}`;
    }
    case "room.hard_delete":
      return "hard-deleted the room";
    case "participant.kick": {
      const md = m as { participantName?: string; participantEmail?: string };
      return `removed ${md.participantName ?? md.participantEmail ?? "a participant"}`;
    }
    case "file.upload": {
      const md = m as { fileName?: string; sizeBytes?: number };
      return `uploaded "${md.fileName ?? "?"}"${
        md.sizeBytes ? ` (${(md.sizeBytes / 1024).toFixed(0)} KB)` : ""
      }`;
    }
    case "file.delete": {
      const md = m as { fileName?: string };
      return `deleted "${md.fileName ?? "?"}"`;
    }
    case "file.toggle_selected": {
      const md = m as { fileName?: string; fileId?: string; selected?: boolean };
      const ref = md.fileName ?? md.fileId ?? "?";
      return md.selected
        ? `included "${ref}" in AI context`
        : `removed "${ref}" from AI context`;
    }
    default:
      return e.action;
  }
}

function fmtTime(at: number): string {
  const d = new Date(at);
  return d.toISOString().replace("T", " ").slice(0, 16) + "Z";
}

export default function ActivityFeed({
  entries,
}: {
  entries: AuditEntry[];
}) {
  if (entries.length === 0) {
    return (
      <p style={{ color: "#666", fontSize: 13 }}>
        No audit entries yet for this room.
      </p>
    );
  }
  return (
    <ol
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        borderTop: "1px solid #eee",
      }}
    >
      {entries.map((e) => (
        <li
          key={e.id}
          style={{
            padding: "8px 0",
            borderBottom: "1px solid #f5f5f5",
            fontSize: 13,
          }}
        >
          <span style={{ color: "#888", fontFamily: "ui-monospace, Menlo, monospace" }}>
            {fmtTime(e.at)}
          </span>{" "}
          <span style={{ color: "#374151" }}>{e.actorEmail}</span>{" "}
          <span style={{ color: "#111" }}>{describe(e)}</span>
        </li>
      ))}
    </ol>
  );
}
