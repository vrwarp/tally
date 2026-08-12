/**
 * A staff member binding the kiosk to one gathering.
 *
 * The event is chosen by a person, never by the clock — the same product rule
 * as the main app's chooser. The gathering whose check-in window is open is
 * ringed and sorted first, but somebody still has to pick it, and confirming
 * is a two-second hold so a wandering hand cannot re-point the kiosk.
 *
 * The hold is on the rows as well as on the button: holding a gathering sets
 * the kiosk to it outright, so the usual setup is one gesture rather than a tap
 * and then a hold somewhere else on the screen. The button stays because it is
 * what says the word "hold" — the rows carry no such label, and a control whose
 * only instruction is a subtitle is a control most people tap once and give up
 * on. Tapping a row still only selects, which is what keeps the button honest
 * and what keeps a scrolling thumb from re-pointing anything.
 */
import { useEffect, useMemo, useState } from 'react';
import { HoldButton } from '../components/HoldButton';
import { InstallPrompt } from '../components/InstallPrompt';
import type { KioskEventEntry, KioskServices } from '../KioskApp';
import type { KioskBinding } from '../binding';
import type { PrinterState } from '../printing';

function dayLabel(startAtMs: number, nowMs: number): string {
  const start = new Date(startAtMs);
  const today = new Date(nowMs);
  const sameDay = start.toDateString() === today.toDateString();
  if (sameDay) return 'Today';
  return start.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function EventChooser({
  services,
  printerState,
  onSetUpPrinter,
  onBound,
}: {
  services: KioskServices;
  /** Null when this kiosk has no printer and nothing has asked for one yet. */
  printerState: PrinterState | null;
  onSetUpPrinter: () => void;
  onBound: (binding: KioskBinding) => void;
}) {
  const [entries, setEntries] = useState<KioskEventEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [binding, setBinding] = useState(false);
  const nowMs = useMemo(() => Date.now(), []);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      services
        .listEvents()
        .then((events) => {
          if (!cancelled) setEntries(events);
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    void load();
    return () => {
      cancelled = true;
    };
  }, [services]);

  /**
   * Sets the kiosk to one row, from either hold.
   *
   * `setSelected` even though the screen is about to be replaced: a bind takes
   * a round trip, and for that second the ringed row has to be the one the
   * thumb is on — otherwise holding a row while another is selected reads as
   * setting up the wrong gathering.
   */
  const bind = async (index: number) => {
    const entry = entries?.[index];
    if (!entry || binding) return;
    setSelected(index);
    setBinding(true);
    try {
      const bound = await services.bindEntry(entry);
      onBound(bound);
    } catch {
      setBinding(false);
      setFailed(true);
    }
  };

  return (
    <div className="flex h-full flex-col p-6">
      <div className="pb-4 text-center">
        <div className="text-lg font-medium text-ink-400">Which gathering is this kiosk for?</div>
        {/* The only place the rows' hold is written down. Kept to one line and
            below the question, because the person reading it is a volunteer
            setting a tablet up once, not somebody using this screen daily. */}
        <div className="pt-1 text-sm text-ink-500">Hold one to set the kiosk to it.</div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {entries === null && !failed && <div className="pt-12 text-center text-ink-400">Loading…</div>}
        {failed && (
          <div className="pt-12 text-center text-ink-300">
            Couldn&apos;t load the calendar. Check the network, then reopen the kiosk.
          </div>
        )}
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          {entries?.map((entry, index) => {
            const live = nowMs >= entry.checkInOpensAt && nowMs <= entry.checkInClosesAt;
            // Finished, but still offered because its window has not closed —
            // the row a kiosk rebooting mid-pickup needs to find. Said out
            // loud so it cannot be mistaken for something upcoming.
            const ended = nowMs > entry.endAt;
            const isSelected = selected === index;
            return (
              <HoldButton
                key={`${entry.chain}:${entry.startAt}`}
                onTap={() => setSelected(index)}
                onHeld={() => void bind(index)}
                /*
                 * `active:` on a row, and the transition narrowed to the border
                 * to let it land.
                 *
                 * A row is held as well as tapped, and a hold now waits
                 * `HOLD_DELAY_MS` before its bar appears — so without a pressed
                 * state the first fifth of a second of every press on this
                 * screen was a row doing nothing at all. `transition-colors`
                 * covered the background too, which would have faded that
                 * answer in over its own 150ms and spent the delay twice; the
                 * ring it was written for is the border, and that still moves.
                 */
                className={`rounded-xl border-2 p-5 text-left transition-[border-color] active:bg-ink-700 ${
                  binding ? 'pointer-events-none ' : ''
                }${
                  isSelected
                    ? 'border-brand-500 bg-ink-800'
                    : live
                      ? 'border-present-500/60 bg-ink-900'
                      : 'border-ink-800 bg-ink-900'
                }`}
              >
                <div className="text-xl font-semibold text-ink-100">{entry.title}</div>
                <div className="pt-1 text-ink-400">
                  {dayLabel(entry.startAt, nowMs)} · {timeLabel(entry.startAt)}–{timeLabel(entry.endAt)}
                  {entry.location ? ` · ${entry.location}` : ''}
                  {live && <span className="pl-2 font-medium text-present-400">Check-in open</span>}
                  {ended && <span className="pl-2 font-medium text-ink-500">Ended — pickup only</span>}
                </div>
              </HoldButton>
            );
          })}
          {entries?.length === 0 && (
            <div className="pt-12 text-center text-ink-400">
              Nothing on the calendar this week. Events are created in Tally itself.
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-2xl pt-4 pb-[max(1rem,var(--spacing-safe-bottom))]">
        {/*
          * The second way in to installing, for a kiosk that was paired in a
          * browser tab and is being tidied up afterwards. The first is the
          * pairing screen, which is where it does the most good — see
          * components/InstallPrompt.tsx. Renders nothing once installed, which
          * is the state this screen is usually in.
          */}
        <InstallPrompt className="mb-3" />

        {/*
          * The way in to the printer, and the only one.
          *
          * Here rather than behind a second hidden gesture: this screen is
          * already past the staff gate on the search screen, and a setup step
          * nobody can find is a setup step nobody does. A plain button rather
          * than a hold — the chooser's hold guards re-pointing a kiosk mid-
          * service, and looking at the printer settings breaks nothing.
          */}
        <button
          type="button"
          tabIndex={-1}
          onClick={onSetUpPrinter}
          className="mb-3 w-full rounded-xl border-2 border-ink-800 p-3 text-ink-400"
        >
          {printerState === null || printerState.kind === 'idle'
            ? 'Set up a label printer'
            : printerState.kind === 'ready'
              ? 'Label printer connected'
              : 'Label printer needs attention'}
        </button>

        <HoldButton
          onHeld={() => {
            if (selected !== null) void bind(selected);
          }}
          className={`w-full rounded-xl p-5 text-xl font-semibold ${
            selected !== null && !binding
              ? 'bg-brand-600 text-white active:bg-brand-500'
              : 'pointer-events-none bg-ink-800 text-ink-500'
          }`}
        >
          {binding ? 'Setting up…' : selected !== null ? 'Hold to set kiosk' : 'Pick a gathering'}
        </HoldButton>
      </div>
    </div>
  );
}
