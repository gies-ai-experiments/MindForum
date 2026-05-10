import { headers } from "next/headers";
import { adminToken, isAdmin } from "@/lib/admin-auth";
import { adminListRoomsWithActivity } from "@/lib/store";
import { resolveSort, type SortKey } from "@/lib/admin-sort";
import TokenForm from "./TokenForm";
import CopyLinkButton from "./CopyLinkButton";

export const dynamic = "force-dynamic";

type SearchParams = {
  sort?: string;
  dir?: string;
  q?: string;
  err?: string;
  archived?: string;
};

type ArchivedFilter = "true" | "false" | "all";

function resolveArchivedFilter(raw: string | undefined): ArchivedFilter {
  if (raw === "true" || raw === "all") return raw;
  return "false";
}

function relTime(d: Date | null): { label: string; dot: "green" | "yellow" | "gray" } {
  if (!d) return { label: "—", dot: "gray" };
  const ms = Date.now() - d.getTime();
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const days = Math.floor(h / 24);
  let label: string;
  if (m < 1) label = "just now";
  else if (m < 60) label = `${m}m ago`;
  else if (h < 24) label = `${h}h ago`;
  else label = `${days}d ago`;
  const dot = h < 1 ? "green" : h < 24 ? "yellow" : "gray";
  return { label, dot };
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function sortLink(
  current: { column: SortKey; direction: "ASC" | "DESC" },
  key: SortKey,
  q: string,
  label: string
) {
  const flip = current.column === key && current.direction === "DESC" ? "asc" : "desc";
  const params = new URLSearchParams();
  params.set("sort", key);
  params.set("dir", flip);
  if (q) params.set("q", q);
  const arrow = current.column === key ? (current.direction === "DESC" ? " ↓" : " ↑") : "";
  return <a href={`/admin/rooms?${params.toString()}`}>{label}{arrow}</a>;
}

export default async function AdminRoomsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  if (!adminToken()) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Admin disabled</h1>
        <p>Set ADMIN_TOKEN to enable.</p>
      </main>
    );
  }
  const sp = await searchParams;
  if (!(await isAdmin())) {
    return <TokenForm error={sp.err} />;
  }
  const sort = resolveSort(sp.sort, sp.dir);
  const q = (sp.q ?? "").trim();
  const archived = resolveArchivedFilter(sp.archived);
  const rows = await adminListRoomsWithActivity({ ...sort, q, archived });

  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3000";
  const origin = `${proto}://${host}`;

  return (
    <main style={{ maxWidth: 1100, margin: "2rem auto", padding: "0 16px", fontFamily: "system-ui" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1>Rooms ({rows.length})</h1>
        <div style={{ fontSize: 13 }}>
          <a href="/admin/users">Manage creators →</a>
        </div>
      </header>
      <form method="GET" action="/admin/rooms" style={{ marginBottom: 12 }}>
        <input type="hidden" name="sort" value={sort.column} />
        <input type="hidden" name="dir" value={sort.direction.toLowerCase()} />
        <input type="hidden" name="archived" value={archived} />
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="filter by name…"
          style={{ padding: 6, width: 260 }}
        />
        <button type="submit" style={{ marginLeft: 6 }}>Filter</button>
        {q && (
          <a
            href={`/admin/rooms${archived !== "false" ? `?archived=${archived}` : ""}`}
            style={{ marginLeft: 8 }}
          >
            clear
          </a>
        )}
        <span style={{ marginLeft: 16, fontSize: 13 }}>
          {(["false", "true", "all"] as const).map((v) => {
            const params = new URLSearchParams();
            params.set("sort", sort.column);
            params.set("dir", sort.direction.toLowerCase());
            if (q) params.set("q", q);
            if (v !== "false") params.set("archived", v);
            const label = v === "false" ? "Active" : v === "true" ? "Archived" : "All";
            return (
              <a
                key={v}
                href={`/admin/rooms?${params.toString()}`}
                style={{
                  marginRight: 8,
                  fontWeight: archived === v ? 600 : 400,
                }}
              >
                {label}
              </a>
            );
          })}
        </span>
      </form>
      {rows.length === 0 ? (
        <p>No rooms match. Seed one with <code>scripts/seed-msba-rooms.py</code>.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              <th style={{ padding: 8 }}>{sortLink(sort, "name", q, "Room")}</th>
              <th style={{ padding: 8 }}>Owner</th>
              <th style={{ padding: 8 }}>Status</th>
              <th style={{ padding: 8 }}>{sortLink(sort, "last_message_at", q, "Last activity")}</th>
              <th style={{ padding: 8, textAlign: "right" }}>{sortLink(sort, "msgs_24h", q, "24h")}</th>
              <th style={{ padding: 8, textAlign: "right" }}>{sortLink(sort, "msgs_7d", q, "7d / users")}</th>
              <th style={{ padding: 8, textAlign: "right" }}>{sortLink(sort, "file_count", q, "Files")}</th>
              <th style={{ padding: 8 }}>{sortLink(sort, "created_at", q, "Created")}</th>
              <th style={{ padding: 8 }}>Link</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const t = relTime(r.lastMessageAt);
              const dotColor = t.dot === "green" ? "#1a7f37" : t.dot === "yellow" ? "#bf8700" : "#999";
              const url = `${origin}/room/${r.id}`;
              return (
                <tr key={r.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: 8 }}>
                    <a href={`/room/${r.id}`} target="_blank" rel="noreferrer">{r.name}</a>
                    <div style={{ fontSize: 11, color: "#888" }}>{r.id}</div>
                  </td>
                  <td style={{ padding: 8, fontSize: 13 }}>
                    {r.ownerId === "cr_super_admin" ? (
                      <span style={{ color: "#888" }}>—</span>
                    ) : (
                      <a href={`/admin/users#${r.ownerId}`}>
                        {r.ownerDisplayName ?? r.ownerId}
                      </a>
                    )}
                  </td>
                  <td style={{ padding: 8 }}>
                    {r.archivedAt !== null ? (
                      <span
                        style={{
                          background: "#fee2e2",
                          color: "#991b1b",
                          padding: "1px 6px",
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        ARCHIVED
                      </span>
                    ) : (
                      <span
                        style={{
                          background: "#dcfce7",
                          color: "#166534",
                          padding: "1px 6px",
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        ACTIVE
                      </span>
                    )}
                  </td>
                  <td style={{ padding: 8 }}>
                    <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: dotColor, marginRight: 6 }} />
                    {t.label}
                  </td>
                  <td style={{ padding: 8, textAlign: "right" }}>{r.msgs24h}</td>
                  <td style={{ padding: 8, textAlign: "right" }}>{r.msgs7d} / {r.participants7d}</td>
                  <td style={{ padding: 8, textAlign: "right" }}>{r.fileCount}</td>
                  <td style={{ padding: 8 }}>{ymd(r.createdAt)}</td>
                  <td style={{ padding: 8 }}><CopyLinkButton url={url} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
