/**
 * What the staff gate opens onto.
 *
 * The two-second hold on **Clear** used to open `ChangeEventScreen` directly, so
 * the only door behind the gate was the one that shuts the kiosk. Everything
 * else a volunteer might want was *through* that door: leave the gathering,
 * meet the chooser, open the printer, come back, hold a row to re-point the
 * kiosk at the event it was already on. A reprint cost the queue at the door.
 *
 * So the gate opens onto the doors instead, and leaving the gathering is one of
 * them rather than all of them. The warning that used to greet the hold goes
 * with it: it belongs to that choice, not to the act of looking.
 *
 * ## A row is a row
 *
 * This screen is a menu of four destinations, and it spent a round reading as
 * a mess because it was written as if it were three different kinds of thing.
 * The first two rows were one object; **Change event** was demoted on four axes
 * at once — 64px against 80, 20px against 24, `ink-200` against `ink-100`, and
 * shorter than its siblings — and the middle row was composed differently from
 * both, a left-aligned label with a right-aligned status. So the group had no
 * common left edge, the eye's path down it went centre, far-left, centre, and
 * the composition claimed a kinship (reprint + printer) that is the opposite of
 * the real one: the reprint is the only thing anybody does mid-evening, and the
 * other two are setup doors touched once.
 *
 * The demotion was inherited. `h-14 text-lg text-ink-200` is `ChangeEventScreen`'s
 * *quiet answer to a yes-or-no question*, which means something there and
 * nothing on a menu.
 *
 * The rule now, and the one a fifth row added next year should follow: **inside
 * this group a row is a row.** One height, one label size, one label ink, the
 * label on the group's shared left inset, and an optional trailing status. The
 * author chooses where a row goes in the order and nothing else — order is what
 * carries rank, which is why the mid-evening errand is first. Only the header
 * may be larger than a row label, and only the terminal button is a different
 * shape.
 *
 * The type is set for the distance rather than one Tailwind step up from the
 * phone's. A label at 24px is about ten arcmin of x-height at the seventy
 * centimetres a lobby tablet on a stand is read from — half of comfortable —
 * and the budget for the extra came off the word `Staff`, which nobody walked
 * over here to read.
 */
import { haptic } from '@/lib/utils';

/**
 * The one row class. See the note above: the whole screen's legibility rests on
 * these three rows being indistinguishable except for their words.
 *
 * `justify-between` with a single child leaves that child on the left, which is
 * what gives the group its shared edge whether or not a row carries a status.
 */
const ROW =
  'flex h-16 w-full items-center justify-between gap-3 rounded-xl px-5 text-left ' +
  'text-xl font-semibold kiosk:h-24 kiosk:px-6 kiosk:text-3xl';

/** A row that is a fact rather than a door — see the `none` branch below. */
const STATEMENT = `${ROW} bg-ink-900 font-normal text-ink-400`;

const DOOR = `${ROW} bg-ink-800 text-ink-100 active:bg-ink-700`;

export function StaffScreen({
  title,
  window: eventWindow,
  printer,
  onReprint,
  onPrinter,
  onChangeEvent,
  onStay,
}: {
  title: string;
  window: string;
  /**
   * What the printer is doing. `none` means *nothing here to print* — no
   * printing module, no printer ever configured, or a gathering with no label
   * template — and is the one state in which the reprint door is not drawn at
   * all. Anything configured and not ready is `trouble`: a door that opens, and
   * says what it knows first.
   */
  printer: 'ready' | 'trouble' | 'none';
  onReprint: () => void;
  onPrinter: () => void;
  onChangeEvent: () => void;
  onStay: () => void;
}) {
  /*
   * One or two words, never a sentence — the full sentence lives on the printer
   * screen, which is where somebody who cares is going.
   *
   * Set at the row label's own size, and separated from it by colour and weight
   * rather than by size as well. This is the only thing on the screen that ever
   * changes, and it had been demoted three times over: the smallest type in the
   * frame, the only text in the group that was not semibold, *and* tinted. Two
   * of those were doing the same job twice and the third made the one varying
   * fact the lightest object on the glass.
   */
  const printerLine =
    printer === 'ready'
      ? { text: 'Ready', tone: 'text-present-400' }
      : printer === 'trouble'
        ? { text: 'Trouble', tone: 'text-warn-400' }
        : { text: 'Not set up', tone: 'text-ink-500' };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 p-8 text-center kiosk:gap-10">
      <div className="flex flex-col gap-2">
        {/* `Staff` is a label on the screen, not the reason anybody is on it,
            and at 48px it was the largest thing in the frame by half again. The
            ladder is title, then label, then the line you read once. */}
        <div className="text-4xl font-semibold text-ink-100">Staff</div>
        <p className="mx-auto max-w-xl text-lg text-ink-400 kiosk:text-2xl">
          <span className="text-ink-200">{title}</span> ·{' '}
          <span className="whitespace-nowrap">{eventWindow}</span>
        </p>
      </div>

      <div className="flex w-full max-w-md flex-col gap-3 kiosk:max-w-xl kiosk:gap-4">
        {printer === 'none' ? (
          /*
           * No printer, so no door — a statement in its place.
           *
           * This used to be the reprint row rendered `disabled`: the biggest,
           * first, most obviously-the-thing-I-came-for control on the screen,
           * greyed out, answering a press with nothing at all — no haptic, no
           * `active:` flash, no change — which on a lobby tablet is
           * indistinguishable from a device that has frozen. The predictable
           * next move is to press it again, then fetch somebody. What the
           * volunteer actually needs is the sentence.
           */
          <div className={STATEMENT}>No printer on this kiosk</div>
        ) : (
          <>
            <button
              type="button"
              tabIndex={-1}
              onPointerDown={() => {
                haptic();
                onReprint();
              }}
              className={DOOR}
            >
              Reprint a name tag
            </button>
            {printer === 'trouble' && (
              /*
               * The condition, on the door it gates.
               *
               * It was reported only on the row beside this one, in the
               * smallest type on the screen: between the ready and the trouble
               * frames, 0.068% of the glass changed and this button was
               * byte-identical in both. So a volunteer who came *because* a
               * sticker failed pressed a control that looked equally willing in
               * both worlds, walked through a search and a confirm, and met the
               * warning three screens later. This is staff glass; it can say so
               * in a sentence.
               */
              <p className="px-5 text-left text-base text-warn-400 kiosk:px-6 kiosk:text-xl">
                The printer needs attention — a name tag may not come out.
              </p>
            )}
          </>
        )}

        <button
          type="button"
          tabIndex={-1}
          onPointerDown={() => {
            haptic();
            onPrinter();
          }}
          className={DOOR}
        >
          <span className="min-w-0 truncate">Label printer</span>
          <span className={`shrink-0 font-normal whitespace-nowrap ${printerLine.tone}`}>
            {printerLine.text}
          </span>
        </button>

        <button
          type="button"
          tabIndex={-1}
          onPointerDown={() => {
            haptic();
            onChangeEvent();
          }}
          className={DOOR}
        >
          Change event
        </button>
      </div>

      {/* The loud one is the way back to the door, as it is on the screen this
          replaces: everything else here costs somebody standing at the kiosk.
          Centred and filled, which on this screen is what marks the terminal
          button — the three doors above are left-aligned rows. */}
      <div className="w-full max-w-md kiosk:max-w-xl">
        <button
          type="button"
          tabIndex={-1}
          onPointerDown={() => {
            haptic();
            onStay();
          }}
          className="flex h-16 w-full items-center justify-center rounded-xl bg-brand-600 text-xl font-semibold text-white active:bg-brand-500 kiosk:h-24 kiosk:text-3xl"
        >
          Keep checking in
        </button>
      </div>
    </div>
  );
}
