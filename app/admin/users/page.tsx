import { adminToken, isAdmin } from "@/lib/admin-auth";
import { listCreators } from "@/lib/store";
import UsersTable from "./UsersTable";

export const dynamic = "force-dynamic";

type SearchParams = { err?: string };

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  if (!adminToken()) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>Admin disabled</h1>
        <p>Set ADMIN_TOKEN to enable.</p>
      </main>
    );
  }
  const sp = await searchParams;
  if (!(await isAdmin())) {
    // Reuse /admin/rooms's TokenForm shape but post to /admin/users/auth so
    // we land back here on success.
    return (
      <main style={{ maxWidth: 360, margin: "4rem auto", fontFamily: "system-ui" }}>
        <h1>Admin access</h1>
        <p style={{ color: "#666" }}>Paste the admin token to manage creators.</p>
        {sp.err === "bad_token" && (
          <p role="alert" style={{ color: "#c00" }}>Invalid token.</p>
        )}
        <form method="POST" action="/admin/users/auth">
          <input
            type="password"
            name="token"
            autoComplete="off"
            autoFocus
            required
            style={{ width: "100%", padding: 8, fontSize: 16 }}
          />
          <button type="submit" style={{ marginTop: 8, padding: "8px 16px" }}>
            Continue
          </button>
        </form>
      </main>
    );
  }

  const rows = await listCreators();

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
          alignItems: "baseline",
          marginBottom: 16,
        }}
      >
        <div>
          <h1 style={{ margin: 0 }}>Allowlisted creators ({rows.length})</h1>
          <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
            <a href="/admin/rooms">← Rooms</a>
          </div>
        </div>
      </header>
      <UsersTable
        initialRows={rows.map((r) => ({
          id: r.id,
          email: r.email,
          displayName: r.displayName,
          disabledAt: r.disabledAt,
          tokenLastFour: r.tokenLastFour,
          tokenRotatedAt: r.tokenRotatedAt,
          createdAt: r.createdAt,
          roomCount: r.roomCount,
          lastActivityAt: r.lastActivityAt ? r.lastActivityAt.getTime() : null,
        }))}
      />
    </main>
  );
}
