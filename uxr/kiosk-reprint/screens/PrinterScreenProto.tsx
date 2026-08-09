/**
 * `src/kiosk/screens/PrinterScreen.tsx` with one block changed, so the critique
 * can see the change in the screen it lands in rather than on its own.
 *
 * Today the screen's fourth button is **Reprint the last label**, which is the
 * only reprint the kiosk has and is a guess about which label anybody wants: by
 * the time a volunteer has reached this screen the last label is whoever walked
 * up next. The block below replaces it with what the queue could remember
 * instead — the evening's labels, by name, most recent first.
 *
 * Everything else is copied so the frame is the real screen: same selects, same
 * hints, same grid of setup buttons, same Done.
 */
import { haptic } from '@/lib/utils';

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
  onReprint,
  onDone,
}: {
  recent: readonly PrintedLabel[];
  onReprint: (label: PrintedLabel) => void;
  onDone: () => void;
}) {
  return (
    <div className="flex h-full flex-col p-6">
      <div className="pb-4 text-center">
        <div className="text-lg font-medium text-ink-400">Label printer</div>
        <div className="pt-1 text-sm text-present-400">Connected and ready.</div>
      </div>

      <div className="mx-auto min-h-0 w-full max-w-2xl flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-ink-400">Printer model</span>
            <select
              defaultValue="QL-810W"
              className="rounded-xl border-2 border-ink-800 bg-ink-900 p-4 text-lg text-ink-100"
            >
              <option>QL-810W</option>
            </select>
            <span className="text-xs text-ink-500">
              There is no way to detect this — it has to match the printer on the shelf.
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm text-ink-400">Loaded label</span>
            <select
              defaultValue="62mm continuous"
              className="rounded-xl border-2 border-ink-800 bg-ink-900 p-4 text-lg text-ink-100"
            >
              <option>62mm continuous</option>
            </select>
            <span className="text-xs text-ink-500">
              What is in the printer now. Events describe what the label says, never its size.
            </span>
          </label>

          {/* The block under review. */}
          <div className="rounded-xl bg-ink-900 p-4">
            <div className="pb-3 text-sm text-ink-400">Printed tonight</div>
            {recent.length === 0 ? (
              <div className="text-sm text-ink-500">
                Nothing has printed on this kiosk tonight.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {recent.map((label) => (
                  <button
                    key={label.id}
                    type="button"
                    tabIndex={-1}
                    onPointerDown={() => {
                      haptic();
                      onReprint(label);
                    }}
                    className="flex h-14 w-full items-center justify-between rounded-lg bg-ink-800 px-4 text-left active:bg-ink-700"
                  >
                    <span className="min-w-0 truncate text-base font-semibold text-ink-100">
                      {label.name}
                    </span>
                    <span className="flex shrink-0 items-center gap-3 pl-3">
                      <span
                        className={`text-sm ${label.failed ? 'text-warn-400' : 'text-ink-500'}`}
                      >
                        {label.failed ? 'Did not print' : label.at}
                      </span>
                      <span className="rounded-lg bg-brand-600/20 px-3 py-1 text-sm font-semibold text-brand-300 ring-1 ring-brand-500/40">
                        Print again
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2">
            <button
              type="button"
              tabIndex={-1}
              className="rounded-xl bg-brand-600 p-4 text-lg font-semibold text-white"
            >
              Choose a different printer
            </button>
            <button
              type="button"
              tabIndex={-1}
              className="rounded-xl bg-ink-800 p-4 text-lg text-ink-100"
            >
              Check the printer
            </button>
            <button
              type="button"
              tabIndex={-1}
              className="rounded-xl bg-ink-800 p-4 text-lg text-ink-100"
            >
              Print a test label
            </button>
            <button
              type="button"
              tabIndex={-1}
              className="rounded-xl bg-ink-800 p-4 text-lg text-ink-100"
            >
              Reprint a name tag
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-2xl pt-4 pb-[max(1rem,var(--spacing-safe-bottom))]">
        <button
          type="button"
          tabIndex={-1}
          onPointerDown={onDone}
          className="w-full rounded-xl bg-ink-800 p-5 text-xl font-semibold text-ink-100"
        >
          Done
        </button>
      </div>
    </div>
  );
}
