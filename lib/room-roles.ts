// Pure room-management authorization decision. No DB — callers supply the
// co-admin id list. Mirrors checkRoomOwner's rule, plus co-admins.
export function isManager(
  actor: { id: string; isSuperAdmin: boolean },
  ownerId: string,
  coAdminIds: string[],
): boolean {
  if (actor.isSuperAdmin) return true;
  if (actor.id === ownerId) return true;
  return coAdminIds.includes(actor.id);
}
