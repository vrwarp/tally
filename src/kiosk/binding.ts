/**
 * Which gathering this kiosk is for.
 *
 * Chosen by a staff member at setup and persisted so a reboot lands back on
 * the same event. Afterwards the kiosk returns to the (staff-gated) chooser on
 * its own.
 *
 * The binding used to die at `endAt`, which is exactly when a nursery's
 * parents arrive: the screen unbound itself at the moment pickup began. It now
 * lasts until the later of the event ending and the check-in window closing —
 * the same "the evening is still being recorded" window the rest of Tally
 * works to, and already the thing `checkInClosesAtMs` is here for.
 *
 * `max` rather than `checkInClosesAt` outright. The editor refuses to save a
 * window that closes before the event ends, but `firestore.rules` only asks
 * that the field be a timestamp, so a seed, a migration or an older client can
 * produce one. Taking the later of the two cannot shorten any binding, which
 * a bare `checkInClosesAt` would.
 *
 * The binding has an upper bound and a lower one, and they are not symmetric.
 * A kiosk may be bound *before* its gathering opens — the chooser offers the
 * week on purpose, and a volunteer setting a tablet up at four for a half-six
 * gathering is the ordinary case — but it may not take check-ins there. That is
 * the one direction Tally has never allowed anywhere: the app's own chooser
 * offers today and a tail of finished gatherings and nothing ahead, because
 * recording a Friday somebody forgot is real work and recording a Friday that
 * has not happened is always a mistake. See `windowHasOpened`.
 */
import type { KioskGround, KioskPalette } from '@/lib/kioskTheme';
import type { LabelTemplate } from '@/lib/labelTemplate';
import { KIOSK_KEYS, readJson, removeKey, writeJson } from './storage';

export interface KioskBinding {
  eventId: string;
  seriesId: string | null;
  /**
   * The chain whose past instances say who comes to this, or null when nothing
   * does. What `kioskIndex/participation` is keyed by.
   *
   * Not `seriesId`, and that is the whole reason it is here: a weekly gathering
   * created in the app has a recurrence root and no series document, so
   * `seriesId` is null for exactly the chains with the most history behind
   * them. Not plain `chainKey` either — a one-off reads the chain a leader
   * pointed it at, and nothing at all when they pointed it at nothing. See
   * `predictionChain` in `src/lib/gatherings.ts`, which this mirrors so the
   * lobby screen and the check-in screen cannot answer "who belongs here"
   * differently about the same evening.
   *
   * Optional for the same reason `requiresCheckOut` is: a binding written before
   * this existed has no such key, and a paired lobby screen must not be logged
   * out by a deploy. Absent or null reads as "no scope", which searches the
   * whole roster — the behaviour the kiosk has always had.
   */
  predictsFrom?: string | null;
  title: string;
  startAtMs: number;
  endAtMs: number;
  /**
   * When this gathering starts taking arrivals — the floor under every
   * check-in this kiosk writes.
   *
   * Optional for the same reason `requiresCheckOut` is: a binding written
   * before this existed has no such key, and a paired lobby screen must not be
   * logged out by a deploy. Absent reads as "already open", which is the
   * behaviour the kiosk has always had and the only safe direction here — the
   * failure of guessing the other way is a lobby full of families the tablet
   * refuses on the strength of a field it never stored. The next rebind picks
   * the real answer up.
   */
  checkInOpensAtMs?: number;
  checkInClosesAtMs: number;
  /**
   * Whether this gathering hands children back — the one behaviour flag the
   * kiosk carries. Optional because a binding written before pickup existed
   * has no such key, and a paired lobby screen must not be logged out by a
   * deploy: it reads as "off" and the next rebind picks the real answer up.
   */
  requiresCheckOut?: boolean;
  /**
   * What to print at check-in, or null/absent for nothing.
   *
   * Optional for the same reason `requiresCheckOut` is: a binding written before
   * labels existed has no such key, and a paired lobby screen must not be logged
   * out by a deploy. Absent reads as "prints nothing", and the next rebind picks
   * up the real answer — which is the safe direction, since the failure is a
   * missing sticker rather than a wrong one.
   */
  labelTemplate?: LabelTemplate | null;
  /**
   * Whether the registration wizard asks about allergies.
   *
   * Optional for the same reason `requiresCheckOut` is: a binding written
   * before the flag existed has no such key, and a paired lobby screen must
   * not be logged out by a deploy. Absent reads as "don't ask", which is the
   * safe direction twice over — the failure is a question missing for one
   * evening, not a family's medical note typed into a backend that refuses
   * it. The next rebind picks up the real answer.
   */
  allergiesSupported?: boolean;
  /**
   * The look this gathering lends the screen, already worked out.
   *
   * Optional for the same reason `requiresCheckOut` is: a binding written
   * before themes existed has no such key, and a paired lobby screen must not
   * be logged out by a deploy. Absent reads as the kiosk that shipped, and the
   * next rebind picks up whatever the gathering actually says.
   *
   * Finished hex rather than the hue names stored on the event, because the
   * kiosk does no colour work — the server resolved this while building the
   * chooser row, the way it already resolves which occurrences exist. Both keys
   * are absent together on a gathering nobody themed, and `kioskPalette` alone
   * is absent on one that moved its ground and left the hues alone.
   *
   * A theme edited mid-evening does not reach a bound kiosk until it rebinds,
   * which is how every other field here already behaves — and better than a
   * lobby screen repainting under a family's hands because somebody is editing
   * an event in another room.
   */
  kioskGround?: KioskGround | null;
  kioskPalette?: KioskPalette | null;
  /**
   * The gathering's icon, as SVG path data on Material's `0 -960 960 960`
   * viewBox — or absent for a gathering nobody gave one, which is most of them.
   *
   * Optional for the same reason `requiresCheckOut` is: a binding written
   * before the kiosk drew icons has no such key, and a paired lobby screen must
   * not be logged out by a deploy. Absent reads as "no icon", which is exactly
   * what the kiosk looked like before this existed, and the next rebind picks
   * up whatever the gathering actually wears.
   *
   * Path data rather than the Material name the event stores, for the reason
   * `kioskPalette` is finished hex rather than four hue names: the catalogue is
   * sixty kilobytes and the kiosk needs one glyph out of it. The server looks it
   * up while building the chooser row. See `src/kiosk/icon.ts`.
   */
  iconPath?: string | null;
  boundAtMs: number;
}

function isBinding(value: unknown): value is KioskBinding {
  const b = value as KioskBinding | null;
  return (
    !!b &&
    typeof b.eventId === 'string' &&
    b.eventId.length > 0 &&
    typeof b.title === 'string' &&
    typeof b.startAtMs === 'number' &&
    typeof b.endAtMs === 'number' &&
    typeof b.checkInClosesAtMs === 'number'
  );
}

export function readBinding(): KioskBinding | null {
  const stored = readJson<KioskBinding>(KIOSK_KEYS.binding);
  return isBinding(stored) ? stored : null;
}

export function writeBinding(binding: KioskBinding): void {
  writeJson(KIOSK_KEYS.binding, binding);
}

export function clearBinding(): void {
  removeKey(KIOSK_KEYS.binding);
}

/** How long a kiosk stays on one gathering. See the note above. */
export function bindingEndsAt(binding: KioskBinding): number {
  return Math.max(binding.endAtMs, binding.checkInClosesAtMs);
}

export function bindingIsLive(binding: KioskBinding, nowMs: number): boolean {
  return nowMs < bindingEndsAt(binding);
}

/** Whether to show the quiet "check-in window has closed" line. */
export function windowHasClosed(binding: KioskBinding, nowMs: number): boolean {
  return nowMs > binding.checkInClosesAtMs;
}

/**
 * Whether this gathering has started taking arrivals yet.
 *
 * The counterpart `windowHasClosed` never had, and the asymmetry between them
 * is the point. A closed window is advisory — the kiosk says so and keeps
 * working, because a family collected at 21:10 from a gathering whose doors
 * shut at 20:00 still walked out of the building. A window that has not opened
 * is a refusal: nobody can have arrived at an evening that has not happened,
 * and a kiosk bound to next Wednesday by a thumb one row off would otherwise
 * take a whole night's register against the wrong date, silently, while the
 * screen showed nothing but a pair of clock times.
 *
 * True when the field is absent — see the field's own note.
 */
export function windowHasOpened(binding: KioskBinding, nowMs: number): boolean {
  return binding.checkInOpensAtMs === undefined || nowMs >= binding.checkInOpensAtMs;
}

/**
 * "6:30 – 8:00 PM" — when this gathering runs.
 *
 * `Intl` rather than the `date-fns` helper the rest of the app formats times
 * with, and that is a deliberate cost: `src/lib/time.ts` would pull the whole
 * library into a bundle with a hard gzipped budget (see
 * `scripts/check-kiosk-budget.mjs`) for one line of text. The browser already
 * has this.
 *
 * The meridiem is written once when both ends share it, because "6:30 PM –
 * 8:00 PM" is the same fact said twice and this line sits under a title it
 * must not compete with.
 */
/**
 * Built once, not per call.
 *
 * `toLocaleTimeString` resolves its options into a formatter every time, and
 * this line is drawn by the search screen's header — so it was being rebuilt
 * twice on every render, which on a screen that re-renders per keystroke put it
 * among the kiosk's ten most expensive functions for a string that changes only
 * when the binding does. See docs/kiosk-performance.md.
 */
const CLOCK = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' });

function clock(ms: number): string {
  return CLOCK.format(new Date(ms));
}

export function eventWindow(binding: KioskBinding): string {
  const start = clock(binding.startAtMs);
  const end = clock(binding.endAtMs);
  const meridiem = /\s?([AP]M)$/i.exec(start);
  const shared = meridiem && end.toUpperCase().endsWith(meridiem[1]!.toUpperCase());
  return `${shared ? start.slice(0, meridiem.index) : start} – ${end}`;
}

/**
 * "6:30 PM", or "Wednesday, Aug 19 at 6:30 PM" when that is not today.
 *
 * The day is carried on purpose, and it is the more important half. A kiosk
 * bound one row off shows the wrong gathering's clock times and looks entirely
 * ordinary; a bare "opens at 6:30 PM" would read to a volunteer as "come back
 * after supper" rather than as "this tablet is set to next week". The date is
 * the fact that makes a misbinding obvious to the one person who can fix it.
 */
export function opensAtLabel(binding: KioskBinding, nowMs: number): string {
  const opensAtMs = binding.checkInOpensAtMs ?? binding.startAtMs;
  const opens = new Date(opensAtMs);
  const at = clock(opensAtMs);
  if (opens.toDateString() === new Date(nowMs).toDateString()) return at;
  const day = opens.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
  return `${day} at ${at}`;
}
