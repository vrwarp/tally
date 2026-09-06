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
import { EventName } from '../components/EventName';
import { HoldButton } from '../components/HoldButton';
import { InstallPrompt } from '../components/InstallPrompt';
import { useTap } from '../components/tapGuard';
import type { KioskEventEntry, KioskServices } from '../KioskApp';
import type { KioskBinding } from '../binding';
import type { PrinterState } from '../printing';

function dayLabel(startAtMs: number, nowMs: number): string {
  const start = new Date(startAtMs);
  const today = new Date(nowMs);
  const sameDay = start.toDateString() === today.toDateString();
  if (sameDay) return 'Today';
  /*
   * `short`, and the difference is one line on a phone.
   *
   * Nearly every row on this list says "Today" — it is narrowed to today, plus
   * whatever is still open — so the dated row is the gathering left running
   * from last night, and it is the only row where this string has to share a
   * line with a full time range. "Wednesday, Aug 12" did not fit and took the
   * range onto a second line, leaving the middot that joins them hanging at the
   * end of the first. "Wed" fits, says the same thing, and is the fix that
   * costs the row nothing.
   */
  return start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
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
  /*
   * See the note on the printer screen's unbind. A screen entered from a
   * `useTap` row mounts before that tap's own click is dispatched, so a bare
   * `onClick` on the screen that arrives answers a press nobody made on it —
   * and this screen is reached that way, from the staff screen's `Change
   * event`.
   */
  const tap = useTap();
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

  /** The row the hold button is about, or null while nothing is picked. */
  const selectedEntry = selected === null ? null : (entries?.[selected] ?? null);

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
            /*
             * Taking arrivals now — and the ring that says so is spent on the
             * row somebody should actually bind. A gathering that has finished
             * keeps an open window on purpose (a kiosk rebooting mid-pickup has
             * to find it again), so it satisfied this too, and the loudest
             * signal on the list was pointing at the one row that must not be
             * bound for an ordinary evening. It says "Ended — pickup only" in
             * amber instead; see below.
             */
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
                    : live && !ended
                      ? 'border-present-500/60 bg-ink-900'
                      : 'border-ink-800 bg-ink-900'
                }`}
              >
                {/*
                  * The gathering's mark, in the title rather than in a column
                  * of its own.
                  *
                  * A column was the first answer and it was billed to the wrong
                  * line: sixty pixels off a 390px phone, taken out of the *meta*
                  * line — which is the one line on this screen that tells two
                  * occurrences of the same weekly gathering apart, and the whole
                  * reason this list was narrowed to today. An icon cannot do
                  * that job at all (both Wednesdays wear the same glyph, because
                  * it belongs to the gathering and not to the night), so it must
                  * not be the thing that crowds the line that can.
                  *
                  * Set in the title it costs one character of the title's own
                  * measure, keeps the rows' left edge without a spacer, and is
                  * simply absent on a gathering nobody gave an icon.
                  */}
                <div className="text-xl font-semibold text-ink-100">
                  {/* No slot held open for a gathering with no mark. It was,
                      for a round, so that titles in a half-marked list kept one
                      left edge — and an empty slot beside a filled one reads as
                      a mark that failed to draw rather than as a gathering that
                      never had one. The card's own edge is the column here; the
                      title simply starts with its first letter, which is what
                      the mark does on every other screen it appears on. */}
                  <EventName path={entry.iconPath} title={entry.title} />
                </div>
                <div className="pt-1 text-ink-400">
                  {/*
                    * Bound so a wrap breaks *between* facts, never after the
                    * middot that joins them. On the phone this line always
                    * wraps, and it used to leave a separator hanging at the
                    * right edge of line one and open line two with the tail of
                    * the room — after which the status, set off by nothing but
                    * a word-space, read as a phrase about the room.
                    */}
                  {/*
                    * The day is free to break, the hours are not.
                    *
                    * Both bound together took a dated row — "Wednesday, Aug 12
                    * · 10:31 PM–12:01 AM", which is what a gathering still open
                    * from yesterday looks like — clean out of the card on a
                    * phone. A time range broken across two lines is unreadable,
                    * a date is not, so the range is the half that is held.
                    */}
                  {dayLabel(entry.startAt, nowMs)}
                  {' · '}
                  {/*
                    * The hours, a step louder than the line they are in.
                    *
                    * The one fact that tells two sittings of one gathering
                    * apart, and until now the quietest thing on the row: two
                    * identical titles, two identical marks, one green border on
                    * whichever happened to be open, and the discriminator set
                    * in the base weight of the dimmest line. Everything loud on
                    * the row pointed at the same place; the volunteer picked on
                    * colour. This is the only fact on a row that a mark cannot
                    * carry — an icon belongs to the gathering, so both sittings
                    * wear it — which is exactly why it is the one that had to
                    * come up.
                    */}
                  <span className="font-medium whitespace-nowrap text-ink-200">
                    {timeLabel(entry.startAt)}–{timeLabel(entry.endAt)}
                  </span>
                  {entry.location ? (
                    <>
                      {/* The middot is drawn only where the room follows the
                          hours on the same line. A separator is a join, and a
                          join has nothing to do at the start of a line — which
                          is where the phone puts this, every time, because
                          three facts and a status do not fit in 297 pixels. */}
                      <span className="hidden sm:inline"> · </span>
                      <span className="block whitespace-nowrap sm:inline">{entry.location}</span>
                    </>
                  ) : (
                    ''
                  )}
                  {/* Where the gathering is becomes what the gathering is
                      doing, and on a phone that step has to be a line rather
                      than a wider space — the fold puts them side by side. */}
                  {/*
                    * Open, *unless* the gathering has already ended — the two
                    * were drawn together, because a finished gathering whose
                    * window is still open is both, and the row said "Check-in
                    * open" in green directly above "Ended — pickup only" in
                    * amber. Two statuses on one row is one too many, and the
                    * later fact is the one a volunteer has to act on.
                    */}
                  {live && !ended && (
                    <span className="block font-medium text-present-400 sm:inline sm:pl-4">
                      Check-in open
                    </span>
                  )}
                  {notOpenYet && (
                    <span className="block font-medium text-ink-500 sm:inline sm:pl-4">
                      Check-in opens {timeLabel(entry.checkInOpensAt)}
                    </span>
                  )}
                  {/*
                    * The one status on this list that is a warning rather than
                    * a fact. "Check-in opens 6:30" is the ordinary case — a
                    * volunteer setting a tablet up before doors — and quiet ink
                    * is right for it. A gathering that has *ended* is still
                    * offered only so a kiosk rebooting mid-pickup can find it
                    * again, and binding one for an ordinary evening is a
                    * mistake; it read in the same grey as the ordinary case,
                    * which is the row saying nothing at the one place it has
                    * something to say.
                    */}
                  {ended && (
                    <span className="block font-medium text-warn-400 sm:inline sm:pl-4">
                      Ended — pickup only
                    </span>
                  )}
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
          {...tap(onSetUpPrinter)}
          className="mb-3 w-full rounded-xl border-2 border-ink-800 p-3 text-ink-400 active:bg-ink-800"
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
          {/*
            * What is about to be bound, on the thing being held.
            *
            * The two seconds this button exists to spend were being spent
            * looking at a label that named nothing: the row a volunteer picked
            * is at the top of a tablet and the button is at the bottom — half a
            * phone screen away, three quarters of a portrait kiosk — and where
            * two sittings of one gathering are on the list, the row's border
            * changing colour up there is not an answer to "which one". The
            * hours are what disambiguate, so the hours are what this carries,
            * and the mark comes with them because here it costs one character
            * of a line that had nothing on it.
            *
            * *Above* the instruction, and that is not decoration. A thumb
            * occludes downward from where it lands, so a fact printed under the
            * label is a fact covered for exactly the two seconds it was added
            * for — and a volunteer who lifts to read it has cancelled the hold
            * they were reading about. The instruction goes under the finger
            * instead: it has already been read, and the row above says it too.
            *
            * The name truncates and the time does not. One `truncate` over the
            * whole run clipped from the right, which is where the clock is —
            * so the first thing a long gathering name cost the button was the
            * only fact on it that tells two sittings apart. A long name losing
            * its tail costs nothing here: both sittings share it.
            */}
          {/*
            * The line's height is held whether or not there is anything on it.
            *
            * Added, it grew the button by 28px — and this block is anchored to
            * the bottom of the screen, so the tap that picked a gathering paid
            * for those pixels upward: the printer door and the foot of the
            * scrolling list both jumped under the thumb that had just landed.
            * The band above is empty in both states, so holding the taller
            * geometry costs nothing to look at and keeps the promise the roster
            * makes about its own rows — a tap moves nothing.
            */}
          {(binding || !selectedEntry) && (
            <span aria-hidden className="invisible mb-1 block text-base font-medium">
              &nbsp;
            </span>
          )}
          {!binding && selectedEntry && (
            <span className="mb-1 flex items-baseline justify-center gap-1 text-base font-medium">
              {/* Quieter than the time, for the reason the row is: on a list of
                  two sittings this half is the half they have in common. */}
              <span className="min-w-0 truncate text-white/75">
                <EventName path={selectedEntry.iconPath} title={selectedEntry.title} tone="inherit" />
              </span>
              <span className="shrink-0 text-white">· {timeLabel(selectedEntry.startAt)}</span>
            </span>
          )}
          {binding ? 'Setting up…' : selected !== null ? 'Hold to set kiosk' : 'Pick a gathering'}
        </HoldButton>
      </div>
    </div>
  );
}
