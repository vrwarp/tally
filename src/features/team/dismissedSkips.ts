/**
 * Outstanding placements somebody has decided not to act on.
 *
 * When a redemption cannot add the new person to a gathering — the inviter is
 * no longer on it — the server writes the chain into `skipped`, and the Team
 * screen keeps that on the card until it is resolved (P5). Resolving it is
 * normally **Add now**, and that answer needs nothing kept here: the row
 * disappears because `eventAccess` now holds the person, which every phone can
 * see.
 *
 * **Dismiss** is the other answer — "that one is not happening, stop showing
 * me" — and it has nowhere on the invitation to be written. The rules refuse a
 * client every one of the outcome fields, `skipped` included, precisely so
 * that a browser cannot rewrite the server's record of what a redemption did.
 * That is the right rule and this is the cost of it: a dismissal is a note to
 * *this reader on this device*, not a fact about the invitation, and it is
 * kept in `localStorage` and nowhere else. Two consequences worth knowing —
 * another admin still sees the item, and clearing site data brings it back.
 * Both are the honest behaviour for a preference that never left the browser.
 */

/** Namespaced like every other key the app keeps — see `src/kiosk/storage.ts`. */
const KEY = 'tally:team:dismissedSkips';

/**
 * An invitation id and a chain, as one string.
 *
 * Per chain rather than per invitation: a redemption can skip two gatherings,
 * and dismissing the one that will never be fixed must not hide the one
 * somebody is still chasing.
 */
export function skipId(invitationId: string, chain: string): string {
  return `${invitationId}::${chain}`;
}

export function readDismissedSkips(): ReadonlySet<string> {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((entry): entry is string => typeof entry === 'string'));
  } catch {
    // A private window, a full disk, a corrupt value. None of them is a reason
    // to fail to draw the card the entry is about.
    return new Set();
  }
}

export function writeDismissedSkips(ids: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...ids]));
  } catch {
    // The dismissal still holds for this session — the caller keeps it in
    // state — it just will not survive a reload. Silence is right here: a
    // toast about storage, on the screen where somebody is granting access to
    // a roster of minors, is noise about the wrong thing.
  }
}
