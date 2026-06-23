import { notFound } from "next/navigation";
import { getActor } from "@/lib/creator-auth";
import { getRoom, isCoAdmin, coAdminEmails, getCreatorById } from "@/lib/store";
import { listAuditForRoom } from "@/lib/audit";
import GeneralEditor from "./GeneralEditor";
import ArchiveControl from "./ArchiveControl";
import MentionReminderToggle from "./MentionReminderToggle";
import FilesPanel from "./FilesPanel";
import ParticipantsPanel from "./ParticipantsPanel";
import InvitationsPanel from "./InvitationsPanel";
import ActivityFeed from "./ActivityFeed";

export const dynamic = "force-dynamic";

export default async function RoomSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await getActor();
  // Middleware ensures cookie presence on /dashboard/* sub-routes; getActor
  // returning null here means a stale / rotated cookie that the middleware
  // didn't catch (it only checks presence, not validity).
  if (!actor) notFound();

  const room = await getRoom(id);
  if (!room) notFound();

  // Cross-actor access leaks 404 (not 403) to keep room existence private —
  // matches the API ownership guard. Co-admins may manage the room too.
  const manager =
    actor.isSuperAdmin || room.ownerId === actor.id || (await isCoAdmin(id, actor.id));
  if (!manager) notFound();

  const audit = await listAuditForRoom(id, 50);
  const archived = room.archivedAt !== null;
  const coAdmins = await coAdminEmails(id);
  const ownerCreator = await getCreatorById(room.ownerId);
  const ownerEmail = (ownerCreator?.email ?? "").toLowerCase();
  const canManageCoAdmins = actor.isSuperAdmin || room.ownerId === actor.id;

  return (
    <main
      style={{
        maxWidth: 960,
        margin: "2rem auto",
        padding: "0 16px",
        fontFamily: "system-ui",
      }}
    >
      <header style={{ marginBottom: 24, paddingBottom: 12, borderBottom: "1px solid #eee" }}>
        <div style={{ fontSize: 13, color: "#888", marginBottom: 4 }}>
          <a href="/dashboard">← Dashboard</a>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0 }}>{room.name}</h1>
          {archived && (
            <span
              style={{
                background: "#fee2e2",
                color: "#991b1b",
                padding: "2px 8px",
                borderRadius: 4,
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              ARCHIVED
            </span>
          )}
        </div>
        <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
          <code>{room.id}</code> ·{" "}
          <a href={`/room/${room.id}`} target="_blank" rel="noreferrer">
            Open room ↗
          </a>
        </div>
      </header>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, marginBottom: 8 }}>General</h2>
        <GeneralEditor
          roomId={room.id}
          initialName={room.name}
          initialSystemPrompt={room.systemPrompt}
          archived={archived}
        />
        <div style={{ marginTop: 16 }}>
          <ArchiveControl roomId={room.id} archived={archived} />
        </div>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, marginBottom: 8 }}>
          Files ({room.files.length})
        </h2>
        <FilesPanel
          roomId={room.id}
          files={room.files.map((f) => ({
            id: f.id,
            name: f.name,
            mime: f.mime,
            sizeBytes: f.sizeBytes,
            uploadedAt: f.uploadedAt,
            selected: f.selected,
            sourceType: f.sourceType,
            sourceUrl: f.sourceUrl,
            sourceMeta: f.sourceMeta,
          }))}
          archived={archived}
        />
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, marginBottom: 8 }}>
          Participants ({room.participants.length})
        </h2>
        <ParticipantsPanel
          roomId={room.id}
          participants={room.participants}
          archived={archived}
          coAdminEmails={coAdmins}
          ownerEmail={ownerEmail}
          canManageCoAdmins={canManageCoAdmins}
        />
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, marginBottom: 8 }}>Mention reminders</h2>
        <MentionReminderToggle
          roomId={room.id}
          initialEnabled={room.mentionRemindersEnabled}
          archived={archived}
        />
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, marginBottom: 8 }}>Invitations</h2>
        <InvitationsPanel roomId={room.id} archived={archived} />
      </section>

      <section>
        <h2 style={{ fontSize: 16, marginBottom: 8 }}>Activity (last 50)</h2>
        <ActivityFeed entries={audit} />
      </section>
    </main>
  );
}
