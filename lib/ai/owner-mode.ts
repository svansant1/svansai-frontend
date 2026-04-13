export function isOwnerUnlocked(session: any): boolean {
    return session?.owner === true;
}

export function unlockOwner(session: any) {
    session.owner = true;
}

export function lockOwner(session: any) {
    session.owner = false;
}