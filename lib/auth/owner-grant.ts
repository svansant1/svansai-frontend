/** Shared wire types only; no credentials or server dependencies in this module. */
export const OWNER_IDLE_MS = 30 * 60 * 1000;
export type OwnerGrant = { id: string; userId: string; lastActivityAt: string; idleLocksAt: string; revision: number };
export type OwnerStatus = { owner: boolean; unlocked: boolean; featureEnabled: boolean; idleLocksAt: string | null; serverTime: string };
export function grantIsCurrent(grant: OwnerGrant | null, now = Date.now()): boolean {
  return Boolean(grant && Number.isFinite(Date.parse(grant.idleLocksAt)) && now < Date.parse(grant.idleLocksAt));
}
