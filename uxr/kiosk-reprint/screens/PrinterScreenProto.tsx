/**
 * `src/kiosk/screens/PrinterScreen.tsx` with its reprint block changed and its
 * track re-spent, so the critique can see the change in the screen it lands in
 * rather than on its own.
 *
 * Today the screen's fourth button is **Reprint the last label**, which is the
 * only reprint the kiosk has and is a guess about which label anybody wants: by
 * the time a volunteer has reached this screen the last label is whoever walked
 * up next. It is replaced by what the queue could remember instead — the
 * evening's labels, by name, most recent first.
 *
 * Two things about that block were wrong in the frames, and both were about it
 * sitting in a settings screen:
 *
 * **The rows were a one-tap print.** They fired `onPointerDown` inside a
 * scrolling pane, with no tap guard — so the first touch of a scroll gesture
 * spent a label for whichever child the thumb happened to push off with, and
 * the kiosk has no undo. And they were the *more* dangerous of the two doors
 * onto the same act: the by-name path has a confirm with a sticker preview on
 * it, while Ramona Alvarez and Noah Alvarez sat eight pixels apart with the same
 * surname and the same timestamp. They now commit on lift, and they open the
 * same confirm — including the failed row, which could arguably go direct but
 * is not worth a second rule.
 *
 * **The setup ate the fold.** On 1280×800 the two selects and their hints took a
 * quarter of the track for settings chosen once at unboxing, each offering one
 * option; "Printed tonight" was cut mid-row; all four buttons — including
 * `Reprint a name tag` — started below the fold and were never seen, while 47%
 * of the width was empty page. The setup is a summary that opens, the track
 * splits into two columns where there is width for them, and the reprint door
 * is above the fold on the shortest kiosk because it is the reason the screen is
 * open.
 */
import { haptic } from '@/lib/utils';
import { useTapGuard } from '@/kiosk/components/tapGuard';
import { useOverflowFade } from './useOverflowFade';

export interface PrintedLabel {
  id: string;
  name: string;
  /** "6:41 PM" — when it went to the printer. */
  at: string;
  /** A label that never made it out, so the row says so. */
  failed?: boolean;
}

export function PrinterScreenProto({
  recent,
  onPick,
  onDone,
}: {
  recent: readonly PrintedLabel[];
  /** Opens the reprint confirm for this label — never prints on its own. */
  onPick: (label: PrintedLabel) => void;
  onDone: () => void;
}) {
  const rowTap = useTapGuard(onPick);
  const { regionRef, contentRef, overflowing } = useOverflowFade();

  return (
    <div className="flex h-full flex-col p-6">
      <div className="pb-4 text-center">
        <div className="text-lg font-medium text-ink-400 kiosk:text-xl">Label printer</div>
        <div className="pt-1 text-sm text-present-400 kiosk:text-base">Connected and ready.</div>
      </div>

      {/*
        * Two columns where there is width for them, one where there is not.
        * The list is the thing that grows through the evening, so it takes the
        * flexible track at every shape and scrolls inside its own card; the
        * doors are `auto` and cannot be pushed off the bottom by it.
        */}
      {/* Stacked at narrow rather than gridded, so the slack of a quiet evening
          falls *below* both blocks instead of between them: a 1fr row for the
          list put five names in a 750px card and left a matching hole under the
          doors, which is how the largest object on the portrait kiosk came to be
          an empty container. Two columns where there is width for them. */}
      <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col gap-4 lg:grid lg:max-w-5xl lg:grid-cols-2 lg:grid-rows-1 lg:gap-6">
        {/* The card is the height of the evening, not the height of the track:
            it hugs the names and gives the overflow back to its own scroller
            the moment the list is longer than the room. */}
        <div className="flex max-h-full min-h-0 flex-col rounded-xl bg-ink-900 p-4 lg:self-start">
          {/* Shares the rows' text edge rather than the card's: the heading is
              inset by the card's padding, the names by the card's *and* their
              own. */}
          <div className="shrink-0 px-4 pb-3 text-sm text-ink-400 kiosk:text-base">
            Printed tonight
          </div>
          {recent.length === 0 ? (
            <div className="px-4 text-sm text-ink-500 kiosk:text-base">
              Nothing has printed on this kiosk tonight.
            </div>
          ) : (
            /* The card's own padding is the dead gutter the list stops against,
               and the ramp is what stops a clipped row from being a row with
               half a name on it flush against the next control. Both were
               missing here and both are worked out on the search screen. */
            <div
              ref={regionRef}
              className={`flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain scroll-touch ${
                overflowing ? 'kiosk-list-fade' : ''
              }`}
              style={{ touchAction: 'pan-y' }}
            >
              <div ref={contentRef} className="flex shrink-0 flex-col gap-2">
                {recent.map((label) => (
                  <button
                    key={label.id}
                    type="button"
                    tabIndex={-1}
                    {...rowTap(label)}
                    className={`flex h-14 w-full shrink-0 items-center justify-between rounded-lg bg-ink-800 px-4 text-left active:bg-ink-700 kiosk:h-16 ${
                      /* The row a volunteer most wants — a label that never came
                         out — was distinguished by fourteen pixels of amber
                         text on the right edge of a five-row list. The ring is
                         the same one the app's tinted chips wear. */
                      label.failed ? 'ring-1 ring-warn-500/40' : ''
                    }`}
                  >
                    <span className="min-w-0 truncate text-base font-semibold text-ink-100 kiosk:text-lg">
                      {label.name}
                    </span>
                    <span
                      className={`shrink-0 pl-3 text-sm whitespace-nowrap kiosk:text-base ${
                        label.failed ? 'font-semibold text-warn-400' : 'text-ink-500'
                      }`}
                    >
                      {label.failed ? 'Did not print' : label.at}
                    </span>
                  </button>
                ))}
              </div>
              {overflowing && <div aria-hidden className="h-16 shrink-0" />}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-3 lg:min-h-0">
          {/*
            * Settings chosen once at unboxing, folded to what they are set to.
            * `details` rather than a state flag: the browser already owns this
            * and the kiosk bundle has a budget.
            */}
          <details className="shrink-0 rounded-xl bg-ink-900">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl p-4 text-base text-ink-200 kiosk:text-lg [&::-webkit-details-marker]:hidden">
              <span className="min-w-0 truncate">QL-810W · 62mm continuous</span>
              {/* Stepped with the rest of the kiosk set: this is the affordance
                  that opens the row, read at arm's length off a wall tablet.
                  Quieter than the summary in colour, not in size. */}
              <span className="shrink-0 text-sm text-ink-400 kiosk:text-lg">Change</span>
            </summary>
            <div className="flex flex-col gap-4 px-4 pb-4">
              <label className="flex flex-col gap-1">
                <span className="text-sm text-ink-400 kiosk:text-base">Printer model</span>
                <select
                  defaultValue="QL-810W"
                  className="rounded-xl border-2 border-ink-800 bg-ink-900 p-4 text-lg text-ink-100"
                >
                  <option>QL-810W</option>
                </select>
                <span className="text-xs text-ink-500 kiosk:text-sm">
                  There is no way to detect this — it has to match the printer on the shelf.
                </span>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-sm text-ink-400 kiosk:text-base">Loaded label</span>
                <select
                  defaultValue="62mm continuous"
                  className="rounded-xl border-2 border-ink-800 bg-ink-900 p-4 text-lg text-ink-100"
                >
                  <option>62mm continuous</option>
                </select>
                <span className="text-xs text-ink-500 kiosk:text-sm">
                  What is in the printer now. Events describe what the label says, never its size.
                </span>
              </label>
            </div>
          </details>

          {/* The saturated control on a screen about reprinting used to be
              **Choose a different printer** — the one that unbinds the printer —
              and a hurried volunteer aims at colour. It is the by-name reprint
              instead: the door this screen is now open for, and the one that
              costs nothing if pressed by mistake. */}
          <button
            type="button"
            tabIndex={-1}
            onPointerDown={() => haptic()}
            className="flex h-16 w-full shrink-0 items-center justify-center rounded-xl bg-brand-600 text-lg font-semibold text-white active:bg-brand-500 kiosk:h-20 kiosk:text-xl"
          >
            Reprint a name tag
          </button>

          <div className="grid shrink-0 grid-cols-2 gap-3">
            <button
              type="button"
              tabIndex={-1}
              className="rounded-xl bg-ink-800 p-4 text-sm text-ink-100 kiosk:text-lg"
            >
              Check the printer
            </button>
            <button
              type="button"
              tabIndex={-1}
              className="rounded-xl bg-ink-800 p-4 text-sm text-ink-100 kiosk:text-lg"
            >
              Print a test label
            </button>
          </div>

          <button
            type="button"
            tabIndex={-1}
            className="shrink-0 rounded-xl bg-ink-800 p-4 text-base text-ink-300 kiosk:text-lg"
          >
            Choose a different printer
          </button>
        </div>
      </div>

      {/* The way out, at the weight of a way out. A full-width slab carrying the
          largest type on the screen made the terminal exit outweigh the blue
          door this screen was reorganised to expose — and it is the same
          control the reprint screen already draws as a pill in its console row,
          so it is drawn the same way here. */}
      <div className="mx-auto flex w-full max-w-2xl justify-center pt-4 pb-[max(1rem,var(--spacing-safe-bottom))] lg:max-w-5xl">
        <button
          type="button"
          tabIndex={-1}
          onPointerDown={onDone}
          className="flex h-14 items-center justify-center rounded-xl bg-ink-800 px-10 text-base font-semibold whitespace-nowrap text-ink-100 active:bg-ink-700 tall:h-16 kiosk:text-lg"
        >
          Done
        </button>
      </div>
    </div>
  );
}
