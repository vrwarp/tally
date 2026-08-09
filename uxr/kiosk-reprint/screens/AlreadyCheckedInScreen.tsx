/**
 * The dead end, given one thing to press — inside one narrow window.
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
 * the floor, and a re-tapped row that prints is a runaway loop. Who the control
 * appears *for* is `reprintOffer.ts`'s question and the whole of the answer to
 * that rule — a ten-minute window on this kiosk's own arrivals, once per child,
 * spent by any label including a staff one. This file is only what the three
 * answers look like, and there are three things it has to get right:
 *
 * **The tick does not move.** It is the answer the parent came for, and it sits
 * at `ConfirmScreen`'s own height in all three states — which means anything
 * this screen adds rides the flexible track *above* it, with the identity, and
 * collapses to nothing when there is no offer. In `none` the frame is today's
 * screen and one line.
 *
 * **Nothing lives in the band above the commit.** That band is 48px of clear
 * page on every version of this screen and no scene may spend it: a parent who
 * taps a child *because they think they still need to check in* travels to
 * where the green button always is, and what they must not find there is a
 * control that spends a label. The offer sits where `ConfirmScreen` puts
 * "Anyone else?" — attached to the child's name, above the clearance.
 *
 * **It stays a step under the statement.** Not a filled slab at the full
 * measure carrying the same 24px semibold as the tick: squinted, that reads
 * name → slab → green line, which is the wrong order for a screen whose job is
 * to answer a question. It is a pill sized to its own words, one type step
 * below the statement at *every* size.
 *
 * The gesture is a hold, and it cancels on drift (`cancelOnStray`) — the slab
 * is 448px wide on a lobby tablet that people lean on, and without the check
 * any contact persisting two seconds anywhere inside it prints.
 */
import { gradeDescription } from '@/lib/utils';
import { HoldButton } from '@/kiosk/components/HoldButton';
import type { KioskStudent } from '@/kiosk/search';
import type { ReprintOffer } from './reprintOffer';

export type { ReprintOffer };

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

        {/* One slot, three answers, and no slot at all is not one of them: the
            `mt-8` belongs to the block rather than to an empty wrapper, so the
            common case is `ConfirmScreen` to the pixel plus its one line. */}
        <div className="mt-8 w-full shrink-0">
          {offer === 'offer' && (
            /* `text-lg` on a phone because at `text-xl` the label wrapped onto
               two lines inside its own button. The `kiosk:` step stops at
               `text-xl`: the statement below is `text-2xl` at every size, and
               the control has to stay under it at every size too. */
            <HoldButton
              onHeld={onReprint}
              cancelOnStray
              className="rounded-xl bg-ink-800 px-6 py-4 text-lg font-semibold text-ink-200 active:bg-ink-700 kiosk:px-8 kiosk:py-5 kiosk:text-xl"
            >
              Hold to print a name tag
            </HoldButton>
          )}

          {offer === 'spent' && (
            /*
             * Two arrivals, two tenses.
             *
             * One parent has just held the button for two seconds — and this is
             * the only signal they get, because `haptic()` is
             * `navigator.vibrate` and these are iPads, so nothing happens in
             * the hand. The slab under their thumb is replaced *in place* by
             * the brightest line in the frame; a receipt that arrived as the
             * dimmest one is how a parent concludes nothing happened and goes
             * to fetch a leader, which is how one held button becomes two
             * labels.
             *
             * The other pressed nothing: their child's label was reprinted at
             * the desk ten minutes ago and the counter is shared. For them the
             * first line is news and the second is the way on — a place to walk
             * to rather than a role to go and find.
             *
             * "sent", not "printed", because the kiosk only knows it queued the
             * job, and every staff surface in this flow says so.
             */
            <div className="w-full">
              <div className="text-lg font-semibold text-brand-300 kiosk:text-xl">
                Name tag sent for {student.firstName}.
              </div>
              <div className="pt-2 text-base text-ink-400 kiosk:text-lg">
                For another, ask at the check-in desk.
              </div>
            </div>
          )}

          {offer === 'none' && (
            /* The common case, and the only thing added to it: where a name tag
               comes from, for the parent holding a child with no sticker on. */
            <div className="w-full text-lg text-ink-400 kiosk:text-xl">
              Name tags come from the check-in desk.
            </div>
          )}
        </div>
      </div>

      {/* The answer to the question they came with, unchanged and still in the
          slot the commit occupies on every other version of this screen. */}
      <div className="shrink-0 text-2xl font-semibold text-present-400">✓ Already checked in</div>

      <button
        type="button"
        tabIndex={-1}
        onPointerDown={(event) => {
          event.preventDefault();
          onBack();
        }}
        className="mt-8 shrink-0 rounded-xl px-8 py-4 text-xl text-ink-400 active:bg-ink-800"
        style={{ touchAction: 'manipulation' }}
      >
        ← Back
      </button>
    </div>
  );
}
