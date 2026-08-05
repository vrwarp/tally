/**
 * A staff member binding the kiosk to one gathering.
 *
 * The event is chosen by a person, never by the clock — the same product rule
 * as the main app's chooser. The gathering whose check-in window is open is
 * ringed and sorted first, but somebody still has to pick it, and confirming
 * is a three-second hold so a wandering hand cannot re-point the kiosk.
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

  const bindSelected = async () => {
    if (selected === null || !entries || binding) return;
    const entry = entries[selected];
    if (!entry) return;
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
      <div className="pb-4 text-center text-lg font-medium text-ink-400">
        Which gathering is this kiosk for?
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
              <button
                key={`${entry.chain}:${entry.startAt}`}
                type="button"
                tabIndex={-1}
                onClick={() => setSelected(index)}
                className={`rounded-xl border-2 p-5 text-left transition-colors ${
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
              </button>
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
          onHeld={bindSelected}
          className={`w-full rounded-xl p-5 text-xl font-semibold ${
            selected !== null && !binding
              ? 'bg-brand-600 text-white'
              : 'pointer-events-none bg-ink-800 text-ink-500'
          }`}
        >
          {binding ? 'Setting up…' : selected !== null ? 'Hold to set kiosk' : 'Pick a gathering'}
        </HoldButton>
      </div>
    </div>
  );
}
