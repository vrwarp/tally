/**
 * What the staff gate opens onto — the proposal, not the app.
 *
 * Today the two-second hold on **Clear** opens `ChangeEventScreen` directly, so
 * the only door behind the gate is the one that shuts the kiosk. Everything
 * else a volunteer might want is *through* that door: leave the gathering,
 * meet the chooser, open the printer, come back, hold a row to re-point the
 * kiosk at the event it was already on. A reprint costs the queue at the door.
 *
 * So the gate opens onto the doors instead, and leaving the gathering becomes
 * one of them rather than all of them. The warning that used to be on this
 * screen goes with it: it belongs to that choice, not to the act of looking.
 *
 * Shaped after `ChangeEventScreen` deliberately — centred column, one loud way
 * back, the quiet things stacked above it — because a volunteer who has met one
 * of these screens has met both.
 */
import { haptic } from '@/lib/utils';

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
  /** What the printer is doing, in the words the chooser already uses. */
  printer: 'ready' | 'trouble' | 'none';
  onReprint: () => void;
  onPrinter: () => void;
  onChangeEvent: () => void;
  onStay: () => void;
}) {
  /*
   * One or two words, never a sentence.
   *
   * "Connected and ready" beside "Label printer" wrapped *both* halves of the
   * row onto two lines inside its own fixed 64px height on a phone, which made
   * the least important row the busiest object on the screen. The full sentence
   * lives on the printer screen, which is where somebody who cares is going.
   */
  const printerLine =
    printer === 'ready'
      ? { text: 'Ready', tone: 'text-present-400' }
      : printer === 'trouble'
        ? /*
           * One word, because the row is a fixed 64px and the phone's column is
           * 326 of them: "Needs attention" is 140px of nowrap type against a
           * 146px label, and the pair overran the row's own `px-5` to within
           * four pixels of the card's right edge — so the one state this row
           * exists to render was the lopsided one, with the left label still
           * on its inset. "Trouble" is the word this codebase already uses for
           * the state, and the sentence that explains it lives one tap away on
           * the printer screen, which is where somebody who cares is going.
           */
          { text: 'Trouble', tone: 'text-warn-400' }
        : { text: 'Not set up', tone: 'text-ink-500' };

  /*
   * This screen is the entrance to the reprint flow and was the only screen in
   * the set taking no `kiosk:` step — 36px title and 20px labels on 800×1280
   * glass read at arm's length, leading to screens with 80px rows and a 48px
   * name on them. The entrance was set smaller than everything behind it.
   */
  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 p-8 text-center kiosk:gap-10">
      <div className="flex flex-col gap-2">
        <div className="text-4xl font-semibold text-ink-100 kiosk:text-5xl">Staff</div>
        {/* One line on a phone. At `text-xl` the sentence ran two pixels past
            the column and wrapped between "8:00" and "PM", orphaning the
            meridiem on a centred second line; the window is also nowrap now, so
            a longer gathering name breaks at the separator instead of inside a
            time. The kiosk step is unchanged. */}
        <p className="mx-auto max-w-xl text-lg text-ink-400 kiosk:text-2xl">
          <span className="text-ink-200">{title}</span> ·{' '}
          <span className="whitespace-nowrap">{eventWindow}</span>
        </p>
      </div>

      <div className="flex w-full max-w-md flex-col gap-3 kiosk:max-w-lg kiosk:gap-4">
        {/* The reprint is first because it is the one thing on this screen a
            volunteer does mid-evening; the other two are setup. */}
        <button
          type="button"
          tabIndex={-1}
          onPointerDown={() => {
            haptic();
            onReprint();
          }}
          disabled={printer === 'none'}
          className="flex h-16 w-full items-center justify-center rounded-xl bg-ink-800 text-xl font-semibold text-ink-100 active:bg-ink-700 disabled:opacity-40 kiosk:h-20 kiosk:text-2xl"
        >
          Reprint a name tag
        </button>

        <button
          type="button"
          tabIndex={-1}
          onPointerDown={() => {
            haptic();
            onPrinter();
          }}
          className="flex h-16 w-full items-center justify-between rounded-xl bg-ink-800 px-5 text-left text-xl font-semibold text-ink-100 active:bg-ink-700 kiosk:h-20 kiosk:text-2xl"
        >
          <span className="min-w-0 truncate">Label printer</span>
          {/* The half that actually varies was the smallest type on the screen. */}
          <span
            className={`shrink-0 pl-3 text-lg font-normal whitespace-nowrap kiosk:text-xl ${printerLine.tone}`}
          >
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
          className="flex h-14 w-full items-center justify-center rounded-xl bg-ink-800 text-lg font-semibold text-ink-200 active:bg-ink-700 kiosk:h-16 kiosk:text-xl"
        >
          Change event
        </button>
      </div>

      {/* The loud one is the way back to the door, as it is on the screen this
          replaces: everything else here costs somebody standing at the kiosk. */}
      <div className="w-full max-w-md kiosk:max-w-lg">
        <button
          type="button"
          tabIndex={-1}
          onPointerDown={() => {
            haptic();
            onStay();
          }}
          className="flex h-16 w-full items-center justify-center rounded-xl bg-brand-600 text-xl font-semibold text-white active:bg-brand-500 kiosk:h-20 kiosk:text-2xl"
        >
          Keep checking in
        </button>
      </div>
    </div>
  );
}
