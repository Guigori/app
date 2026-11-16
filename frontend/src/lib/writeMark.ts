/**
 * The app just saved something on the server. Until the change listener reports the new revision, a copy kept on
 * the device cannot contain it, so screens opened from the device ask the server instead (lib/mirror.ts).
 */
let pendingSince: number | null = null;

export function markServerWrite(): void {
  pendingSince = Date.now();
}

/** True while a save has not shown up as a newer revision yet (gives up after 30 s). */
export function writeNotYetSeen(revisionSeenAt: number | null): boolean {
  if (pendingSince === null) return false;
  if ((revisionSeenAt !== null && revisionSeenAt >= pendingSince) || Date.now() - pendingSince > 30_000) {
    pendingSince = null;
    return false;
  }
  return true;
}
