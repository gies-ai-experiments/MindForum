import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCreator } from "@/lib/creator-auth";
import { CREATOR_COOKIE } from "@/lib/creator-cookie";
import { adminListRoomsWithActivity, listPendingInvitationsByEmail } from "@/lib/store";
import SignInForm from "./SignInForm";
import SignOutButton from "./SignOutButton";
import CreateRoomForm from "./CreateRoomForm";
import ResizableDash from "./ResizableDash";
import PendingInvitations from "./PendingInvitations";
import ApiKeysPanel from "./ApiKeysPanel";
import FeatureTour from "@/app/components/FeatureTour";
import TourReplayButton from "@/app/components/TourReplayButton";
import { DASHBOARD_TOUR_STEPS, TOUR_KEYS } from "@/lib/tour-steps";

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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Inline stroke icons (match the landing visual language)
const Icon = {
  grid: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  list: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
      <circle cx="3.5" cy="6" r="1" /><circle cx="3.5" cy="12" r="1" /><circle cx="3.5" cy="18" r="1" />
    </svg>
  ),
  plus: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="3" /><path d="M12 9v6M9 12h6" />
    </svg>
  ),
  shield: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l7 3v6c0 4-3 7-7 8-4-1-7-4-7-8V6z" /><path d="M9 12l2 2 4-4" />
    </svg>
  ),
  rooms: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" />
    </svg>
  ),
  people: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  files: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
    </svg>
  ),
  mail: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  ),
  key: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2l-2 2m-7.5 7.5a5 5 0 1 0-7 7 5 5 0 0 0 7-7zm0 0L21 4m-4 4l3 3" />
    </svg>
  ),
};

/** Normalize an array of counts into bar heights (4–100%). */
function MiniSpark({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <div className="dash-spark" aria-hidden="true">
      {values.map((v, i) => (
        <span
          key={i}
          className={`dash-spark__bar${i === 0 ? " dash-spark__bar--lead" : ""}`}
          style={{ height: `${Math.max(8, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const creator = await getCreator();

  if (!creator) {
    // Stale cookie (token rotated, creator disabled, or row deleted): recycle
    // it via the auth GET handler so the next request lands clean on sign-in.
    const ck = await cookies();
    if (ck.get(CREATOR_COOKIE)?.value) {
      const target = sp.next ? `/dashboard/auth?next=${encodeURIComponent(sp.next)}` : "/dashboard/auth";
      redirect(target);
    }
    return <SignInForm error={sp.err} next={sp.next} />;
  }

  const archivedFilter =
    sp.archived === "true" || sp.archived === "all" ? sp.archived : "false";

  // Fetch everything once; derive global stats + ranking, then filter the table.
  const allRows = await adminListRoomsWithActivity({
    column: "last_message_at",
    direction: "DESC",
    ownerId: creator.id,
    inviteeEmail: creator.email,
    archived: "all",
  });

  const pendingCount = creator
    ? (await listPendingInvitationsByEmail(creator.email)).length
    : 0;

  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const origin = `${proto}://${host}`;

  const activeRows = allRows.filter((r) => r.archivedAt === null);
  const archivedCount = allRows.length - activeRows.length;
  const totalPeople = allRows.reduce((s, r) => s + r.totalParticipants, 0);
  const totalMsgs7d = allRows.reduce((s, r) => s + r.msgs7d, 0);
  const totalFiles = allRows.reduce((s, r) => s + r.fileCount, 0);

  const displayRows = allRows.filter((r) =>
    archivedFilter === "all"
      ? true
      : archivedFilter === "true"
      ? r.archivedAt !== null
      : r.archivedAt === null
  );

  // Ranking + mini-sparks from real per-metric ordering (active rooms).
  const ranking = [...activeRows]
    .sort(
      (a, b) =>
        b.msgs7d - a.msgs7d ||
        b.totalParticipants - a.totalParticipants ||
        (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0)
    )
    .slice(0, 7);
  const rankMax = Math.max(1, ...ranking.map((r) => r.msgs7d));
  const topBy = (key: "msgs7d" | "totalParticipants" | "fileCount") =>
    [...allRows].sort((a, b) => b[key] - a[key]).slice(0, 7).map((r) => r[key]);

  return (
    <ResizableDash sidebar={
      <aside className="dash-sidebar">
        <div className="dash-brand">
          <span className="dash-brand__mark">M</span>
          MindForum
        </div>

        <nav className="dash-nav" aria-label="Dashboard">
          <span className="dash-navlabel">WORKSPACE</span>
          <a className="dash-navitem dash-navitem--active" href="#overview">
            {Icon.grid}<span className="dash-navtext">Overview</span>
          </a>
          <a className="dash-navitem" href="#rooms">
            {Icon.list}<span className="dash-navtext">Your rooms</span>
          </a>
          {pendingCount > 0 && (
            <a className="dash-navitem" href="#invitations">
              {Icon.mail}<span className="dash-navtext">Invitations</span>
              <span className="dash-invite-badge">{pendingCount}</span>
            </a>
          )}
          <a className="dash-navitem" href="#create">
            {Icon.plus}<span className="dash-navtext">Create room</span>
          </a>
          <a className="dash-navitem" href="#api-keys">
            {Icon.key}<span className="dash-navtext">API keys</span>
          </a>
          {creator.isSuperAdmin && (
            <>
              <span className="dash-navlabel">ADMIN</span>
              <Link className="dash-navitem" href="/admin/rooms">
                {Icon.rooms}<span className="dash-navtext">All rooms</span>
              </Link>
              <Link className="dash-navitem" href="/admin/users">
                {Icon.shield}<span className="dash-navtext">Creators</span>
              </Link>
            </>
          )}
        </nav>

        <div className="dash-sidebar__foot">
          <div className="dash-user">
            <span className="dash-user__avatar">{initials(creator.displayName)}</span>
            <span className="dash-user__meta">
              <span className="dash-user__name">{creator.displayName}</span>
              <span className="dash-user__email">{creator.email}</span>
            </span>
          </div>
          <SignOutButton className="dash-signout" />
        </div>
      </aside>
    }>
      <div className="dash-main">
        <header className="dash-topbar">
          <div className="dash-topbar__title">
            Overview
            {creator.isSuperAdmin && <span className="dash-badge-admin">SUPER ADMIN</span>}
          </div>
          <div className="dash-topbar__right">
            <span className="dash-topbar__hello">Welcome back, {creator.displayName.split(/\s+/)[0]}</span>
            <TourReplayButton surface="dashboard" className="dash-tour-btn" />
            <span className="dash-topbar__avatar">{initials(creator.displayName)}</span>
          </div>
        </header>

        <FeatureTour steps={DASHBOARD_TOUR_STEPS} storageKey={TOUR_KEYS.dashboard} autoStart />


        <div className="dash-content">
          {/* ---- Stat cards ---- */}
          <section className="dash-cards" id="overview" data-tour="stats">
            <article className="dash-card">
              <div className="dash-card__top">
                <span className="dash-card__label">Rooms</span>
                <span className="dash-card__icon">{Icon.rooms}</span>
              </div>
              <div className="dash-card__value">{allRows.length}</div>
              <div className="dash-segbar" aria-hidden="true">
                <span
                  className="dash-segbar__fill"
                  style={{ width: `${allRows.length ? (activeRows.length / allRows.length) * 100 : 0}%` }}
                />
                <span
                  className="dash-segbar__fill--muted"
                  style={{ width: `${allRows.length ? (archivedCount / allRows.length) * 100 : 0}%` }}
                />
              </div>
              <div className="dash-card__sub">
                <strong>{activeRows.length}</strong> active · {archivedCount} archived
              </div>
            </article>

            <article className="dash-card">
              <div className="dash-card__top">
                <span className="dash-card__label">Participants</span>
                <span className="dash-card__icon dash-card__icon--navy">{Icon.people}</span>
              </div>
              <div className="dash-card__value">{totalPeople.toLocaleString()}</div>
              <MiniSpark values={topBy("totalParticipants")} />
              <div className="dash-card__sub">across {allRows.length} room{allRows.length === 1 ? "" : "s"}</div>
            </article>

            <article className="dash-card">
              <div className="dash-card__top">
                <span className="dash-card__label">Messages</span>
                <span className="dash-card__icon">{Icon.grid}</span>
              </div>
              <div className="dash-card__value">{totalMsgs7d.toLocaleString()}</div>
              <MiniSpark values={topBy("msgs7d")} />
              <div className="dash-card__sub">last 7 days</div>
            </article>

            <article className="dash-card">
              <div className="dash-card__top">
                <span className="dash-card__label">Files</span>
                <span className="dash-card__icon dash-card__icon--navy">{Icon.files}</span>
              </div>
              <div className="dash-card__value">{totalFiles.toLocaleString()}</div>
              <MiniSpark values={topBy("fileCount")} />
              <div className="dash-card__sub">shared as AI context</div>
            </article>
          </section>

          {/* ---- Rooms table + ranking ---- */}
          <section className="dash-row">
            <div className="dash-panel" id="rooms" data-tour="rooms">
              <div className="dash-panel__head">
                <div>
                  <span className="dash-panel__title">Your rooms</span>
                  <div className="dash-tabs" style={{ marginTop: 10 }}>
                    <a className={`dash-tab${archivedFilter === "false" ? " dash-tab--active" : ""}`} href="/dashboard#rooms">Active</a>
                    <a className={`dash-tab${archivedFilter === "true" ? " dash-tab--active" : ""}`} href="/dashboard?archived=true#rooms">Archived</a>
                    <a className={`dash-tab${archivedFilter === "all" ? " dash-tab--active" : ""}`} href="/dashboard?archived=all#rooms">All</a>
                  </div>
                </div>
                <a className="dash-newbtn" href="#create">＋ New room</a>
              </div>

              {displayRows.length === 0 ? (
                <div className="dash-empty">
                  {archivedFilter === "true"
                    ? "No archived rooms."
                    : (<>No rooms yet. Create one below — pick a slug like <code>my-team-jam</code>.</>)}
                </div>
              ) : (
                <div className="dash-panel__body" style={{ padding: 0 }}>
                  <table className="dash-table">
                    <thead>
                      <tr>
                        <th>Room</th>
                        <th>Status</th>
                        <th>Last activity</th>
                        <th className="num">7d msgs</th>
                        <th className="num">People</th>
                        <th className="num">Files</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayRows.map((r) => {
                        const url = `${origin}/room/${r.id}`;
                        const isArchived = r.archivedAt !== null;
                        return (
                          <tr key={r.id}>
                            <td>
                              <a className="dash-roomname" href={url}>{r.name}</a>
                              <div className="dash-roomid">{r.id}</div>
                            </td>
                            <td>
                              {r.relationship === "invited" ? (
                                <span className="dash-pill dash-pill--invited">INVITED</span>
                              ) : r.relationship === "co-admin" ? (
                                <span
                                  className="dash-pill"
                                  style={{ background: "#DCFCE7", color: "#166534" }}
                                >
                                  CO-ADMIN
                                </span>
                              ) : isArchived ? (
                                <span className="dash-pill dash-pill--archived">ARCHIVED</span>
                              ) : (
                                <span className="dash-pill dash-pill--active">ACTIVE</span>
                              )}
                            </td>
                            <td style={{ color: "var(--muted)", fontSize: 13 }}>{relTime(r.lastMessageAt)}</td>
                            <td className="num">{r.msgs7d}</td>
                            <td className="num">{r.totalParticipants}</td>
                            <td className="num">{r.fileCount}</td>
                            <td>
                              {r.relationship !== "invited" && (
                                <a
                                  className="dash-open"
                                  href={`/dashboard/rooms/${r.id}/settings`}
                                  style={{ marginRight: 14 }}
                                >
                                  Settings
                                </a>
                              )}
                              <a className="dash-open" href={url} target="_blank" rel="noreferrer">Open ↗</a>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="dash-panel" data-tour="ranking">
              <div className="dash-panel__head">
                <span className="dash-panel__title">Most active<span>last 7 days</span></span>
              </div>
              <div className="dash-panel__body">
                {ranking.length === 0 ? (
                  <div className="dash-rank__empty">No active rooms yet.</div>
                ) : (
                  <ol className="dash-rank">
                    {ranking.map((r, i) => (
                      <li key={r.id} className={`dash-rank__row${i < 3 ? " dash-rank__row--top" : ""}`}>
                        <span className="dash-rank__badge">{i + 1}</span>
                        <span className="dash-rank__main">
                          <a className="dash-rank__name" href={`/room/${r.id}`}>{r.name}</a>
                          <span className="dash-rank__track">
                            <span className="dash-rank__fill" style={{ width: `${Math.max(4, (r.msgs7d / rankMax) * 100)}%` }} />
                          </span>
                        </span>
                        <span className="dash-rank__val">{r.msgs7d}<span>msgs</span></span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </section>

          {pendingCount > 0 && <PendingInvitations />}

          {/* ---- Create room ---- */}
          <section className="dash-panel dash-create-card" id="create" data-tour="create">
            <div className="dash-panel__head">
              <span className="dash-panel__title">Create a room<span>name it, brief the AI, attach context</span></span>
            </div>
            <div className="dash-panel__body">
              <CreateRoomForm />
            </div>
          </section>

          {/* ---- API keys ---- */}
          <section className="dash-panel" id="api-keys">
            <div className="dash-panel__body">
              <ApiKeysPanel />
            </div>
          </section>
        </div>
      </div>
    </ResizableDash>
  );
}
