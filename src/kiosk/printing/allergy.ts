/**
 * The one piece of medical information a kiosk ever touches.
 *
 * `{{allergy}}` is the only label token whose value is not on the roster row, and
 * that is not an accident of plumbing — it is the shape of the promise. The
 * roster the kiosk caches carries *that* a child has an allergy and never what
 * it is, so four hundred children's notes are not sitting in a lobby's
 * localStorage on the chance that four of them get checked in. The note itself
 * is fetched for one child, at the moment that child's parent is standing at the
 * screen, and is gone again shortly after the sticker is drawn.
 *
 * Its own module rather than a section of `index.ts` for exactly that reason:
 * the rules this file follows are the ones somebody will want to audit, and they
 * should be readable without the rasteriser and the USB transport around them.
 * It is also the only part of printing that can be tested in a plain unit test —
 * everything else in `index.ts` reaches a `?worker` import or `navigator.usb`.
 *
 * Four rules, and each of them is load-bearing:
 *
 *   1. **Nothing happens unless a leader asked.** No `{{allergy}}` on this
 *      gathering's template, no lookup, no note anywhere.
 *   2. **Nothing happens for a child with nothing on file.** The flag answers
 *      that without a request, which is most children, most of the time.
 *   3. **Nothing is written down.** In memory, bounded, never localStorage.
 *   4. **A failure says so.** A flagged child whose note could not be read gets
 *      `Allergy` on the sticker, never a blank — see `ALLERGY_UNREAD`.
 */
import { tokensIn, type LabelTemplate } from '@/lib/labelTemplate';
import type { KioskStudent } from '../search';

/**
 * Where a note comes from.
 *
 * Injected rather than imported. `services.ts` is the only module under
 * `src/kiosk/` allowed to touch Firebase — importing it here would pull the SDK
 * into the printing chunk and undo the split `check-kiosk-budget.mjs` defends.
 * `KioskApp` hands the function over once both chunks have landed.
 *
 * Resolving to `null` means "nobody has a note on file". A *failed* read must
 * reject rather than resolve null, because those two get different stickers.
 */
export type AllergySource = (studentId: string) => Promise<string | null>;

let source: AllergySource | null = null;

export function setAllergySource(next: AllergySource | null): void {
  source = next;
}

/**
 * What prints for a child the roster flagged but whose note could not be read —
 * offline, a backend having a minute, or an answer that did not arrive before
 * the sticker had to.
 *
 * The same degradation `hooks/useAllergyNotes.ts` documents for the on-screen
 * badge, and for the same reason: the true and important half is *check this
 * child*, and a label that said nothing would be read as a child with nothing to
 * check. One word a volunteer can act on beats a blank they cannot.
 */
export const ALLERGY_UNREAD = 'Allergy';

/**
 * How long a label waits for a note before printing the fallback.
 *
 * Generous by kiosk standards, and almost never spent: the lookup starts when
 * the confirm screen opens, so most of it elapses while a thumb is still on its
 * way to the button. It is here for the other case — a hallway connection that
 * will not answer must not hold the print queue open behind it, because every
 * label queued behind this one is also somebody's child at a door.
 */
export const ALLERGY_WAIT_MS = 4_000;

/**
 * Notes in flight or in hand, by student id.
 *
 * Bounded to the same handful as the warm rasters next door and evicted
 * oldest-first. The bound is not a token gesture, but nor is it the thing doing
 * the work: by the time an entry is read, the same text is already sitting in
 * the warm raster beside it as pixels. What matters is that this is a `Map` in a
 * module and not a key in `localStorage` — it does not survive the nightly
 * reload, and it never touches a disk.
 */
const held = new Map<string, Promise<string>>();
const MAX_HELD = 8;

/** Whether this template would print an allergy at all. */
export function usesAllergyToken(template: LabelTemplate): boolean {
  return template.lines.some((line) => tokensIn(line.text).includes('allergy'));
}

/**
 * Start finding out, if this label will print it and this child might have one.
 *
 * Idempotent, because both `warmLabel` and `printLabel` call it and the ordinary
 * path is both — the first when the confirm screen opens, the second when a
 * thumb lands a second or two later.
 */
export function startAllergyLookup(student: KioskStudent, template: LabelTemplate): void {
  if (!usesAllergyToken(template)) return;
  if (held.has(student.id)) return;

  if (held.size >= MAX_HELD) {
    // Oldest first. Map iteration is insertion-ordered, which is the order
    // wanted and is why this is not a sort — as in `queue.ts`.
    const oldest = held.keys().next();
    if (!oldest.done) held.delete(oldest.value);
  }

  // No flag, no request. The empty string resolves the token to nothing, which
  // makes `resolveLines` drop the line — so a child with no allergy gets a tidy
  // label rather than one with a hole where a warning would go.
  if (!student.hasAllergies) {
    held.set(student.id, Promise.resolve(''));
    return;
  }

  held.set(
    student.id,
    source
      ? source(student.id).then(
          (note) => note?.trim() || ALLERGY_UNREAD,
          // Swallowed rather than surfaced. A parent is never told anything
          // about a label, and a volunteer reading `Allergy` on a sticker has
          // already been told the half that matters.
          () => ALLERGY_UNREAD,
        )
      : // Flagged, but nothing to ask. A kiosk mid-boot, or one whose services
        // chunk has not landed — either way the child has an allergy and the
        // sticker must not imply otherwise.
        Promise.resolve(ALLERGY_UNREAD),
  );
}

/**
 * The value `{{allergy}}` resolves to, or `undefined` when this job never asked
 * — a template without the token, or the setup screen's test label.
 *
 * Awaited inside the rasterise step, which is the only part of the print chain
 * already allowed to take its time: `warmLabel` and `printLabel` return
 * immediately and cannot throw, because `onConfirm` has already painted a green
 * tick for a parent who is not waiting on a printer.
 */
export async function allergyFor(studentId: string): Promise<string | undefined> {
  const pending = held.get(studentId);
  if (!pending) return undefined;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve(ALLERGY_UNREAD), ALLERGY_WAIT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** A parent backed out of the confirm screen; this child's note is not wanted. */
export function forgetAllergy(studentId: string): void {
  held.delete(studentId);
}

/**
 * Drop the lot.
 *
 * For unbinding — a kiosk that has left a gathering has no business still
 * holding notes about the children who were at it — and for tests.
 */
export function forgetAllergies(): void {
  held.clear();
}
