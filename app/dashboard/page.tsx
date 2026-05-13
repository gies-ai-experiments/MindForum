import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCreator } from "@/lib/creator-auth";
import { CREATOR_COOKIE } from "@/lib/creator-cookie";
import { adminListRoomsWithActivity } from "@/lib/store";
import SignInForm from "./SignInForm";
import SignOutButton from "./SignOutButton";
import CreateRoomForm from "./CreateRoomForm";

export const dynamic = "force-dynamic";

type SearchParams = { err?: string; next?: string; archived?: string };

function relTime(d: Date | null): string {
  if (!d) return "—";
  const ms = Date.now() - d.getTime();
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const days = Math.floor(h / 24);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${days}d ago`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const creator = await getCreator();

  if (!creator) {
    // If a stale cookie is still present (token rotated, creator disabled,
    // or row deleted), middleware would let the user back into bookmarked
    // /dashboard/sub-routes. Recycle the cookie via the auth GET handler so
    // the next request lands on the SignInForm clean.
    const ck = await cookies();
    if (ck.get(CREATOR_COOKIE)?.value) {
      const target = sp.next ? `/dashboard/auth?next=${encodeURIComponent(sp.next)}` : "/dashboard/auth";
      redirect(target);
    }
    return <SignInForm error={sp.err} next={sp.next} />;
  }

  // Show active by default; ?archived=all to include archived; ?archived=true for only archived.
  const archivedFilter =
    sp.archived === "true" || sp.archived === "all" ? sp.archived : "false";
  const rows = await adminListRoomsWithActivity({
    column: "last_message_at",
    direction: "DESC",
    ownerId: creator.id,
    archived: archivedFilter,
  });

  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const origin = `${proto}://${host}`;

  return (
    <main
      style={{
        maxWidth: 1100,
        margin: "2rem auto",
        padding: "0 16px",
        fontFamily: "system-ui",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24,
          paddingBottom: 12,
          borderBottom: "1px solid #eee",
        }}
      >
        <div>
          <h1 style={{ margin: 0 }}>Dashboard</h1>
          <div style={{ color: "#666", fontSize: 13, marginTop: 4 }}>
            {creator.email} · {creator.displayName}
            {creator.isSuperAdmin && (
              <span
                style={{
                  marginLeft: 8,
                  background: "#fde68a",
                  color: "#92400e",
                  padding: "1px 6px",
                  borderRadius: 4,
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                SUPER ADMIN
              </span>
            )}
          </div>
        </div>
        <SignOutButton />
      </header>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Create a room</h2>
        <CreateRoomForm />
      </section>

      <section>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
          <h2 style={{ fontSize: 18, margin: 0 }}>Your rooms ({rows.length})</h2>
          <div style={{ fontSize: 13 }}>
            <a
              href="/dashboard"
              style={{
                marginRight: 8,
                fontWeight: archivedFilter === "false" ? 600 : 400,
              }}
            >
              Active
            </a>
            <a
              href="/dashboard?archived=true"
              style={{
                marginRight: 8,
                fontWeight: archivedFilter === "true" ? 600 : 400,
              }}
            >
              Archived
            </a>
            <a
              href="/dashboard?archived=all"
              style={{ fontWeight: archivedFilter === "all" ? 600 : 400 }}
            >
              All
            </a>
          </div>
        </div>

        {rows.length === 0 ? (
          <p style={{ color: "#666" }}>
            No rooms yet. Create one above — pick a slug like{" "}
            <code>my-team-jam</code>.
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                <th style={{ padding: 8 }}>Room</th>
                <th style={{ padding: 8 }}>Status</th>
                <th style={{ padding: 8 }}>Last activity</th>
                <th style={{ padding: 8, textAlign: "right" }}>7d msgs</th>
                <th style={{ padding: 8, textAlign: "right" }}>People</th>
                <th style={{ padding: 8, textAlign: "right" }}>Files</th>
                <th style={{ padding: 8 }}>Link</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const url = `${origin}/room/${r.id}`;
                const isArchived = r.archivedAt !== null;
                return (
                  <tr key={r.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: 8 }}>
                      <a href={`/dashboard/rooms/${r.id}/settings`}>{r.name}</a>
                      <div style={{ fontSize: 11, color: "#888" }}>{r.id}</div>
                    </td>
                    <td style={{ padding: 8 }}>
                      {isArchived ? (
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
                    <td style={{ padding: 8 }}>{relTime(r.lastMessageAt)}</td>
                    <td style={{ padding: 8, textAlign: "right" }}>
                      {r.msgs7d}
                    </td>
                    <td style={{ padding: 8, textAlign: "right" }}>
                      {r.totalParticipants}
                    </td>
                    <td style={{ padding: 8, textAlign: "right" }}>
                      {r.fileCount}
                    </td>
                    <td style={{ padding: 8 }}>
                      <a href={url} target="_blank" rel="noreferrer">
                        Open ↗
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
