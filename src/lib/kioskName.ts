/**
 * What the church calls a lobby kiosk — *Lobby*, *Nursery door* — tidied the
 * same way wherever a name is given or read.
 *
 * Its own module rather than a part of `kioskDevice.ts`, which the kiosk's
 * first paint loads: nothing on the tablet says its own name, and a helper the
 * main app shares with it would be carried there for nothing.
 *
 * Shared with the functions (`scripts/sync-functions-shared.mjs`) so the name
 * the pairing stores, the name the core team saves and the name the presence
 * copy carries are tidied by one rule.
 */

/**
 * The longest name a kiosk may carry, in UTF-16 units — so a name within it is
 * within any count of characters the rules make (`firestore.rules`).
 *
 * Short on purpose: a name lands inside sentences on the event page and the
 * counselors' register — *Lobby hasn't been heard from since 9:41* — and on a
 * phone's one line.
 */
export const KIOSK_NAME_MAX = 40;

/**
 * A kiosk's name as typed, tidied: *Lobby*, *Nursery door*. Null for anything
 * that says nothing, which every screen reads as "no name" and falls back to
 * the device id.
 *
 * Whoever pairs a kiosk may name it, and the core team may rename it later;
 * both paths tidy through here so a name cannot mean two things. Cut at a
 * whole character, never inside one.
 */
export function kioskName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const tidy = value.replace(/\s+/g, ' ').trim();
  let name = '';
  for (const character of tidy) {
    if (name.length + character.length > KIOSK_NAME_MAX) break;
    name += character;
  }
  // A cut that lands just after a space would leave it hanging.
  name = name.trimEnd();
  return name.length > 0 ? name : null;
}
