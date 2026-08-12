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
 *
 * Today, plus whatever is open — the same list the app's own chooser offers,
 * in the same words, for the same reason. The server sends the week because
 * `getKioskEvents` is also what materialises an occurrence nobody has created
 * yet, and because a window that opened yesterday has to survive the calendar
 * boundary; what a volunteer may actually point a tablet at is narrower than
 * that. It used to be the whole week, and a thumb one row off on a list of
 * identically-titled Wednesdays pointed a lobby screen at the wrong one — after
 * which it took an evening's register against a gathering that had not
 * happened, silently, because nothing downstream checks a check-in against a
 * clock.
 *
 * Narrowed here rather than in the callable, and that is the one part of this
 * worth arguing about. "Today" is a fact about the room the tablet is standing
 * in, and only the tablet knows it: the function runs in UTC, so an evening
 * gathering in the Americas is already tomorrow as far as the server is
 * concerned, and a horizon cut server-side would drop exactly the gathering the
 * kiosk is being set up for. The client has the church's own clock. The
 * refusal in `KioskApp.onConfirm` is what covers everything this cannot — a
 * binding made yesterday, a tablet left on overnight, a clock that drifted.
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
  const [received, setReceived] = useState<KioskEventEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [binding, setBinding] = useState(false);
  const nowMs = useMemo(() => Date.now(), []);

  /*
   * Midnight tonight, by the tablet's own clock.
   *
   * `setHours(24, …)` rather than arithmetic on the epoch: a day is not always
   * 86,400,000 milliseconds long, and the two nights a year it is not are
   * nights a church still meets on.
   */
  const dayEndMs = useMemo(() => {
    const end = new Date(nowMs);
    end.setHours(24, 0, 0, 0);
    return end.getTime();
  }, [nowMs]);

  /*
   * What a volunteer may point this tablet at — see the note at the top.
   *
   * An open window beats the calendar boundary, exactly as it does on the app's
   * chooser: a lock-in that began at eleven is on *yesterday* by the date and
   * is the gathering somebody is standing at right now. That branch is also
   * what keeps the "Ended — pickup only" row reachable, since the server only
   * still sends it while its window is open.
   */
  const entries = useMemo(
    () =>
      received?.filter(
        (entry) =>
          entry.startAt < dayEndMs ||
          (nowMs >= entry.checkInOpensAt && nowMs <= entry.checkInClosesAt),
      ) ?? null,
    [received, dayEndMs, nowMs],
  );

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      services
        .listEvents()
        .then((events) => {
          if (!cancelled) setReceived(events);
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
            /*
             * The third state, and the one this list spent longest without.
             *
             * The chooser offers the week on purpose, so most rows on it are
             * ahead — and a volunteer binding one is doing the ordinary thing,
             * setting a tablet up before doors. What was missing was the
             * consequence: the kiosk will not take arrivals there until the
             * window opens, and a row that said nothing left that to be
             * discovered by a family at the front of a queue. The day is
             * already up in `dayLabel`; this is the sentence that turns it
             * from a fact into a warning.
             */
            const notOpenYet = nowMs < entry.checkInOpensAt;
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
                  {notOpenYet && (
                    <span className="pl-2 font-medium text-ink-500">
                      Check-in opens {timeLabel(entry.checkInOpensAt)}
                    </span>
                  )}
                  {ended && <span className="pl-2 font-medium text-ink-500">Ended — pickup only</span>}
                </div>
              </HoldButton>
            );
          })}
          {entries?.length === 0 && (
            <div className="pt-12 text-center text-ink-400">
              {/* "Today" rather than "this week", because that is now what the
                  list holds — and a volunteer reading this on a Tuesday should
                  go looking for tonight's gathering rather than concluding the
                  calendar is empty until Sunday. */}
              Nothing on today. Events are created in Tally itself.
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
