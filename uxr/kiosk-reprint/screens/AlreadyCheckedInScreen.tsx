/**
 * The dead end, given one thing to press.
 *
 * `ConfirmScreen`'s `done` branch is a statement — "✓ Already checked in" — and
 * nothing else: a parent who taps a child the register already holds is
 * checking, and the answer is on the screen. That is right, and it is also the
 * exact spot where somebody notices the sticker is missing. The child is
 * standing there, their name is already on the glass, and the only way to a
 * second copy today is to find a volunteer who will unbind the kiosk.
 *
 * The rule this has to keep is written in `printing/index.ts` and in
 * `KioskApp.onConfirm`: a parent-facing reprint button is a roll of labels on
 * the floor, and a re-tapped row that prints is a runaway loop. Three things
 * hold it:
 *
 * **It is a hold, not a tap.** The gesture the kiosk already teaches, and the
 * one a wandering hand, a coat sleeve and a four-year-old all lose.
 *
 * **It is once per child, per evening.** After that the control is a statement
 * again and points at the people who can print another. The worst case is one
 * label per child on the register — the same number check-in already printed —
 * rather than one per tap.
 *
 * **It is quiet.** The statement stays the answer to the question the parent
 * came with; this sits under it in the page's own greys. Nothing green, nothing
 * that competes with the tick they are looking for.
 *
 * It renders at all only where a label would actually come out: a gathering
 * with a template, a printer configured and not in trouble. A parent holding a
 * button for two seconds against a printer with its cover open would be told
 * nothing, because a parent is never told about a printer — so the control is
 * absent instead of disappointing.
 */
import { gradeDescription } from '@/lib/utils';
import { HoldButton } from '@/kiosk/components/HoldButton';
import type { KioskStudent } from '@/kiosk/search';

export type ReprintOffer =
  /** A label would come out, and this child has not had a second one tonight. */
  | 'offer'
  /** They have. The way to another is a person, not this button. */
  | 'spent'
  /** No template, no printer, or a printer in trouble: say nothing at all. */
  | 'none';

export function AlreadyCheckedInScreen({
  student,
  offer,
  onReprint,
  onBack,
}: {
  student: KioskStudent;
  offer: ReprintOffer;
  onReprint: () => void;
  onBack: () => void;
}) {
  return (
    <div
      className="grid h-full w-full grid-rows-[minmax(0,1fr)_auto_auto] justify-center justify-items-center p-8 pb-[max(2rem,18vh)] text-center"
      style={{ gridTemplateColumns: 'minmax(0, var(--confirm-measure, 28rem))' }}
    >
      <div className="flex min-h-0 w-full flex-col items-center justify-end pb-12">
        <div className="w-full shrink-0">
          <div className="text-5xl/[1.15] font-bold text-ink-50">
            {student.firstName} {student.lastName}
          </div>
          {student.grade !== null && (
            <div className="pt-3 text-2xl text-ink-400">{gradeDescription(student.grade)}</div>
          )}
        </div>
      </div>

      {/* The answer to the question they came with, unchanged and still in the
          slot the commit occupies on every other version of this screen. */}
      <div className="shrink-0 text-2xl font-semibold text-present-400">✓ Already checked in</div>

      <div className="mt-8 flex w-full shrink-0 flex-col items-center">
        {/* `text-lg` on a phone because at `text-xl` the label wrapped onto two
            lines inside its own button — the one control on this screen a
            parent has to read as a single instruction. The `kiosk:` step is the
            one the rest of this flow takes; the name and the tick above are
            deliberately still `ConfirmScreen`'s, because this screen is that
            screen with one thing added. */}
        {offer === 'offer' && (
          <HoldButton
            onHeld={onReprint}
            className="w-full rounded-xl bg-ink-800 px-4 py-5 text-lg font-semibold text-ink-200 kiosk:p-6 kiosk:text-2xl"
          >
            Hold to print a name tag
          </HoldButton>
        )}
        {offer === 'spent' && (
          <div className="w-full rounded-xl px-5 py-4 text-lg text-ink-500 kiosk:text-xl">
            Name tag printed. A leader can print another.
          </div>
        )}

        <button
          type="button"
          tabIndex={-1}
          onPointerDown={(event) => {
            event.preventDefault();
            onBack();
          }}
          className="mt-4 shrink-0 rounded-xl px-8 py-4 text-xl text-ink-400 active:bg-ink-800"
          style={{ touchAction: 'manipulation' }}
        >
          ← Back
        </button>
      </div>
    </div>
  );
}
