/**
 * "Is this you?" — one big name, one big button.
 *
 * The check-in itself is a single tap, not a hold: speed of confirmation is
 * the kiosk's whole point, and the worst a mis-tap can do is mark somebody
 * present who then walks in anyway. Undo lives with the staff in the main app,
 * deliberately not here.
 *
 * A pickup holds for three seconds instead, and that is not ceremony. Marking
 * a child collected is a claim that somebody took them out of the building,
 * made on an unattended screen in a lobby — and unlike a stray check-in it is
 * not self-correcting when the child walks in anyway. Undoing one needs a
 * volunteer and the main app, so the gesture is worth a deliberate second.
 *
 * ## The rest of the family
 *
 * When the kiosk can see brothers and sisters who need the same thing (see
 * family.ts for how much of a guess that is), they are listed here, ticked, and
 * the one button does all of them. Ticked rather than waiting to be chosen:
 * a family arrives together, and the parent who tapped the first name is
 * already reaching for the button — an unticked list would be a second thing to
 * do rather than a saved trip through the whole flow.
 *
 * What keeps that honest is that every name is on the glass, above the finger
 * that is about to press, and each one unticks with a tap. The kiosk's guess at
 * a family can be wrong; a parent looking at a stranger's child in their own
 * list cannot miss it.
 */
import { useState } from 'react';
import { gradeDescription, haptic } from '@/lib/utils';
import { HoldButton } from '../components/HoldButton';
import { useTapGuard } from '../components/tapGuard';
import type { KioskIntent } from '../KioskApp';
import type { KioskStudent } from '../search';

export function ConfirmScreen({
  student,
  intent,
  family,
  onConfirm,
  onBack,
}: {
  student: KioskStudent;
  intent: KioskIntent;
  /**
   * Others this tap could cover — already filtered to the ones a confirm would
   * do the very same thing to. A check-in screen never offers a collection.
   */
  family: readonly KioskStudent[];
  /** Everyone the parent is confirming, the tapped student first. */
  onConfirm: (chosen: KioskStudent[]) => void;
  onBack: () => void;
}) {
  // Empty means everybody: a family arrives together. See the note above.
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(() => new Set());

  const memberTap = useTapGuard((id: string) => {
    setSkipped((held) => {
      const next = new Set(held);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  });

  const chosen = [student, ...family.filter((member) => !skipped.has(member.id))];
  const others = chosen.length - 1;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 p-8 text-center">
      <div className="shrink-0">
        <div className="text-5xl font-bold text-ink-50">
          {student.firstName} {student.lastName}
        </div>
        {student.grade !== null && (
          <div className="pt-3 text-2xl text-ink-400">{gradeDescription(student.grade)}</div>
        )}
      </div>

      {family.length > 0 && (
        /*
         * Scrollable, and the rows commit on lift for the same reason the search
         * results do — a list that can scroll must not act on the first touch of
         * a drag. `min-h-0` is what lets it shrink instead of pushing the button
         * off a short screen; the name above, the question, and the buttons below
         * hold their size.
         */
        <div className="flex min-h-0 w-full max-w-md flex-col">
          <div className="shrink-0 pb-3 text-lg text-ink-400">
            {intent === 'check-out' ? 'Collecting anyone else?' : 'Checking in anyone else?'}
          </div>
          <div
            className="flex min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain scroll-touch"
            style={{ touchAction: 'pan-y' }}
          >
            {family.map((member) => {
              const taking = !skipped.has(member.id);
              return (
                <button
                  key={member.id}
                  type="button"
                  tabIndex={-1}
                  aria-pressed={taking}
                  {...memberTap(member.id)}
                  className={`flex h-16 shrink-0 items-center justify-between rounded-xl px-5 text-left ${
                    taking ? 'bg-ink-800' : 'bg-ink-900 opacity-60'
                  }`}
                >
                  <span className="truncate text-xl font-semibold text-ink-100">
                    {member.firstName} {member.lastName}
                  </span>
                  <span
                    className={`ml-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xl ${
                      taking
                        ? intent === 'check-out'
                          ? 'bg-brand-600 text-white'
                          : 'bg-present-600 text-white'
                        : 'border-2 border-ink-600 text-transparent'
                    }`}
                  >
                    ✓
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {intent === 'done' ? (
        <div className="shrink-0 text-2xl font-semibold text-present-400">✓ Already checked in</div>
      ) : intent === 'check-out' ? (
        <HoldButton
          onHeld={() => onConfirm(chosen)}
          className="w-full max-w-md shrink-0 rounded-2xl bg-brand-600 p-7 text-3xl font-bold text-white"
        >
          {others > 0 ? `Hold to collect all ${chosen.length}` : 'Hold to collect'}
        </HoldButton>
      ) : (
        <button
          type="button"
          tabIndex={-1}
          onPointerDown={(event) => {
            event.preventDefault();
            // The confirmation buzz, on contact rather than on the write — the
            // success screen is painted optimistically for the same reason, and
            // a parent already turning to walk their child in feels this when
            // they have stopped looking at the screen. One buzz for the family,
            // not one per child: it says the button took, and the button is one.
            haptic();
            onConfirm(chosen);
          }}
          className="w-full max-w-md shrink-0 rounded-2xl bg-present-600 p-7 text-3xl font-bold text-white active:bg-present-500"
          style={{ touchAction: 'manipulation' }}
        >
          {others > 0 ? `Check in all ${chosen.length}` : 'Check in'}
        </button>
      )}

      <button
        type="button"
        tabIndex={-1}
        onPointerDown={(event) => {
          event.preventDefault();
          onBack();
        }}
        className="shrink-0 rounded-xl px-8 py-4 text-xl text-ink-400 active:bg-ink-800"
        style={{ touchAction: 'manipulation' }}
      >
        ← Back
      </button>
    </div>
  );
}
