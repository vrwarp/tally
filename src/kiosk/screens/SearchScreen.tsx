/**
 * The screen a parent actually uses.
 *
 * Fixed geometry, top to bottom: event header, a fixed-height results area,
 * the standing offer, the typed buffer, the keyboard. A keystroke changes text
 * and row contents and never the geometry of the frame — nothing reflows, and
 * the keyboard subtree never re-renders (see components/Keyboard.tsx).
 *
 * The buffer sits *at the bottom*, against the keyboard, rather than up under
 * the header where it started. Held upright — which is how a phone and most of
 * these tablets are held — the two halves of one act were a screen apart: the
 * hand was at the bottom edge and what the hand was producing was four hundred
 * pixels away, so a parent typing their name could not see the letters land
 * without leaving the keys. Every phone on earth puts the field on top of the
 * keyboard for that reason, and this screen is a phone as far as the hand
 * holding it is concerned.
 *
 * The results area is the one part that scrolls. A search can return up to
 * MAX_RESULTS rows and a phone in a lobby has room for about four of them, so
 * the region clipped the rest mid-row: it looked scrollable, and wasn't, and a
 * family whose name sorted fifth simply could not be reached. Only that region
 * scrolls — the header, the buffer and the keyboard stay pinned, because a
 * keyboard that scrolls off the bottom is worse than a list that ends early.
 *
 * The search itself happens in KioskApp, not here — the app owns the scoped
 * pool, the "Search everyone" widening, and the silent sweep that fires when a
 * finished search finds nobody anywhere. This screen renders the outcome it is
 * handed and offers the doors.
 *
 * The staff gate is a three-second hold on **Clear**, which opens the prompt
 * that leaves the gathering. It used to be an invisible square over the top-left
 * corner of the header — unfindable by anybody who had not been shown it, and
 * in the wrong place besides. A labelled key in a fixed position can be
 * described over the phone; the prompt is what makes it safe to be findable.
 */
import { useEffect, useRef } from 'react';
import { gradeDescription, haptic } from '@/lib/utils';
import { Keyboard, type KioskKey } from '../components/Keyboard';
import { useTapGuard } from '../components/tapGuard';
import type { KioskRefresh } from '../KioskApp';
import { windowHasClosed, type KioskBinding } from '../binding';
import { MAX_RESULTS, type KioskSearchOutcome, type KioskStudent } from '../search';

function gradeLabel(grade: number | null): string {
  return grade === null ? '' : gradeDescription(grade);
}

/**
 * "6:30 – 8:00 PM" — when this gathering runs.
 *
 * `Intl` rather than the `date-fns` helper the rest of the app formats times
 * with, and that is a deliberate cost: `src/lib/time.ts` would pull the whole
 * library into a bundle with a hard gzipped budget (see
 * `scripts/check-kiosk-budget.mjs`) for one line of text. The browser already
 * has this.
 *
 * The meridiem is written once when both ends share it, because "6:30 PM –
 * 8:00 PM" is the same fact said twice and this line sits under a title it
 * must not compete with.
 */
function eventWindow(binding: KioskBinding): string {
  const clock = (ms: number) =>
    new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const start = clock(binding.startAtMs);
  const end = clock(binding.endAtMs);
  const meridiem = /\s?([AP]M)$/i.exec(start);
  const shared = meridiem && end.toUpperCase().endsWith(meridiem[1]!.toUpperCase());
  return `${shared ? start.slice(0, meridiem.index) : start} – ${end}`;
}

/**
 * **Search everyone**, in the two places it has to be.
 *
 * One component rather than two copies, because the pair must not drift: a
 * parent meets whichever of them their search happens to produce, and a
 * spinner that only one of them wore would make the other look broken.
 *
 * The spinner sits *over* the label rather than instead of it, and the label
 * goes invisible rather than away. The button then has exactly one width in
 * both states, set by its own words rather than by a guess at how wide they
 * are — and a control that changed size under the finger still resting on it
 * is a control that reads as pressed by accident.
 *
 * `aria-label` rather than the label alone, so it keeps its name while its
 * face is a spinner: the button a parent is waiting on is still the same
 * button.
 */
function WidenButton({
  widening,
  onWiden,
  quiet,
}: {
  widening: boolean;
  onWiden: () => void;
  /** The standing row's weight, beside a keyboard somebody is aiming at. */
  quiet?: boolean;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label="Search everyone"
      aria-busy={widening}
      onPointerDown={(event) => {
        event.preventDefault();
        haptic(quiet ? 8 : undefined);
        onWiden();
      }}
      className={
        quiet
          ? 'flex h-11 min-w-0 shrink items-center justify-center truncate rounded-xl bg-ink-800/70 px-3 text-sm font-semibold whitespace-nowrap text-ink-200 ring-1 ring-ink-600/60 active:bg-ink-700'
          : 'flex h-14 items-center justify-center rounded-xl bg-ink-800 px-8 text-lg font-semibold text-ink-100 active:bg-ink-700'
      }
      style={{ touchAction: 'manipulation' }}
    >
      <span className="relative flex items-center justify-center">
        <span className={widening ? 'invisible' : undefined}>Search everyone</span>
        {widening && (
          <span
            className={`absolute block animate-spin rounded-full border-2 border-ink-600 border-t-ink-100 ${
              quiet ? 'h-5 w-5' : 'h-6 w-6'
            }`}
          />
        )}
      </span>
    </button>
  );
}

export function SearchScreen({
  binding,
  buffer,
  onKey,
  outcome,
  presentIds,
  checkedOutIds,
  tracksCheckOut,
  printerNeedsAttention,
  refresh,
  widening,
  onWiden,
  onPick,
  onRegister,
  onStaffGate,
}: {
  binding: KioskBinding;
  buffer: string;
  onKey: (key: KioskKey) => void;
  /** The search, already run — over the scoped pool, or everybody once widened. */
  outcome: KioskSearchOutcome;
  presentIds: ReadonlySet<string>;
  checkedOutIds: ReadonlySet<string>;
  tracksCheckOut: boolean;
  printerNeedsAttention: boolean;
  /**
   * How the silent church-wide sweep behind an empty result is doing. No
   * button drives it any more; what remains on screen is its headline ("Still
   * no match" once it has landed) and its failure line.
   */
  refresh: KioskRefresh;
  /**
   * Whether the **Search everyone** press is still working. It is the button's
   * only feedback, so it is the button's face while it is true.
   */
  widening: boolean;
  /**
   * Widens this one search to all of Tally *and* re-reads the church. Both
   * halves are wanted: the first finds a child who belongs to another
   * gathering, the second finds one who was added since this kiosk last
   * looked. Resets when the buffer clears.
   */
  onWiden: () => void;
  onPick: (student: KioskStudent) => void;
  /** Opens the registration offer — the other door off this screen. */
  onRegister: () => void;
  /**
   * The staff gate fired — **Clear**, held for three seconds.
   *
   * Named for the gesture rather than for unbinding, because this screen no
   * longer decides what it means: it opens a prompt, and the prompt is what
   * leaves the gathering. A screen that unbound on a hold could not ask first.
   */
  onStaffGate: () => void;
}) {
  const closed = windowHasClosed(binding, Date.now());

  /*
   * The no-match panel is showing this same offer, in the same words, as its
   * primary button — so the standing one steps aside rather than appearing
   * twice on one screen a hand's width apart.
   *
   * Its *row* stays, empty. This file promises that a keystroke changes text
   * and never geometry, and a row that vanished the moment a search matched
   * nobody would move the keyboard under a thumb already on its way down.
   */
  const offeredAbove =
    (outcome.mode === 'phone' || outcome.mode === 'name') && outcome.results.length === 0;

  /*
   * Whether there is a search here to widen at all.
   *
   * Rows on screen means a finished search that found somebody, which is
   * exactly the state the standing button exists for. An empty buffer has
   * nothing to widen, and a half-typed number is not a question yet — the same
   * reason that state gets none of the other doors either.
   */
  const canWiden = outcome.results.length > 0;

  /*
   * A match is not proof, and this is the sentence that says so.
   *
   * Four digits are a weak credential and a small keyspace: a family nobody has
   * met can type theirs and be shown somebody else's children, sorted, spelled
   * correctly, and looking exactly like the answer. A name search is looser
   * still. Nothing on the screen distinguishes that from a hit, so the door out
   * has to be open while the rows are up — not only after a search fails, which
   * is the one state a coincidence guarantees will never happen.
   *
   * Only the words change, never the geometry. "First time here?" beside a list
   * of strangers asks the wrong question: the parent is not wondering whether
   * they are new, they are wondering what to do about a Ramirez who is not
   * theirs. And it stays the quiet weight, because most matches are real and a
   * screen that doubted itself loudly would make a correct answer feel wrong.
   */
  const offerPrompt = outcome.results.length > 0 ? 'Not your family?' : 'First time here?';

  /*
   * A row commits on lift, not on contact, because this list scrolls — see
   * components/tapGuard.ts for why that has to be, and what counts as a tap.
   */
  const rowTap = useTapGuard(onPick);

  /*
   * Every keystroke starts the list again from the top. Without this, a parent
   * who scrolled down a broad match and then typed one more letter would be
   * looking at the bottom of a list short enough to have no bottom — an empty
   * box, under a buffer that says their name is being searched for.
   */
  const resultsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (resultsRef.current) resultsRef.current.scrollTop = 0;
  }, [buffer]);

  return (
    <div className="grid h-full grid-rows-[auto_1fr_auto_auto_auto]">
      {/* Header. The staff gate used to be an invisible square over its left
          corner; it is a hold on **Clear** now — see `onStaffGate`. */}
      <div className="relative px-6 pt-[max(1rem,var(--spacing-safe-top))] pb-2 text-center">
        {/*
          * The printer, when it has stopped working.
          *
          * A dot, absolutely positioned, and only ever in the corner: a parent
          * cannot fix a printer and telling them about it beside a green tick
          * reads as "your check-in failed". Absolute because this file promises
          * that a keystroke changes text and never geometry, and a warning that
          * appears mid-evening must not push the results down by a line.
          *
          * What a volunteer does about it is hold the opposite corner and look
          * at the printer screen, which says what is actually wrong.
          */}
        {printerNeedsAttention && (
          <span
            aria-label="The label printer needs attention"
            className="absolute top-[max(1rem,var(--spacing-safe-top))] right-4 h-3 w-3 rounded-full bg-warn-500"
          />
        )}
        {/*
          * The header answers *where and when*, and nothing else.
          *
          * It used to answer "what do I do" as well — "Welcome! Check in
          * below." — which put the one instruction a parent needs in the
          * smallest type on the screen, four hundred pixels above the keys, in
          * a line they read after the title and forget before the keyboard.
          * That sentence has moved into the body, where a parent's eye
          * actually goes and where the results will replace it (see the idle
          * panel below).
          *
          * What is left is identity. A parent walking up wants to know they
          * are at the right screen for the right evening — a church can run
          * two gatherings in two rooms on one night — so the title carries
          * real weight, and the window under it is the fact that settles it.
          * Not a display size: the loudest thing on this screen has to stay
          * what the parent is doing, not the label on the room they are
          * standing in.
          */}
        <div className="text-2xl font-semibold text-ink-100">{binding.title}</div>
        <div className="text-base text-ink-500">
          {closed
            ? 'Check-in window has closed — you can still check in.'
            : tracksCheckOut
              ? `${eventWindow(binding)} · Check in or collect`
              : eventWindow(binding)}
        </div>
      </div>

      {/* Results — fixed-height rows in a fixed region that scrolls past them.
          The margin is a dead gutter, not padding: end padding *inside* a
          scroll container is scrolled through, so at rest the last row was
          being cut flush against the offer buttons a pixel below it — two
          adjacent targets, one of which checks a child in, with nothing
          between them. The margin comes out of the track instead, where
          nothing can scroll into it. */}
      <div
        ref={resultsRef}
        className="mb-2 min-h-0 overflow-y-auto overscroll-contain scroll-touch px-6"
        style={{ touchAction: 'pan-y' }}
      >
        {/* The bottom padding rides on the column, not the scroller: end
            padding on a scroll container is not reliably scrollable to. */}
        <div className="mx-auto flex max-w-2xl flex-col gap-2 pb-2">
          {/*
            * The screen a parent actually walks up to.
            *
            * The instruction lives here — at the top of the region the results
            * will fill — rather than in the readout above the keys, and both
            * critics of this screen arrived at that from opposite directions.
            * A parent reads top-down: they used to cross four hundred pixels
            * of nothing and meet **Register your child** as the first lit
            * object on the glass, which is the door for the minority and the
            * one that makes a duplicate of a child the church already has.
            * The instruction for everybody else was below it, and dimmer.
            *
            * And it gives the empty screen an edge. That gap was not
            * whitespace, it was whatever the flexible track had left over, so
            * the idle screen was a title stranded above a cluster sunk to the
            * bottom with nothing saying the two were one screen. Now idle and
            * typed share a top edge: what a keystroke does is replace this
            * with rows, in the place the rows were always going to be.
            *
            * Inside the scrolling region on purpose — the one part of this
            * layout allowed to change with what has been typed. The keyboard
            * cannot move.
            */}
          {outcome.mode === 'idle' && (
            <div className="flex flex-col items-center gap-2 pt-6 text-center">
              <div className="text-4xl font-semibold text-ink-100">Type a name</div>
              <div className="text-lg text-ink-400">or the last 4 digits of your phone</div>
              {/*
                * What happens next, said before it has to be guessed.
                *
                * A name row is a button and does not look like one — no ring,
                * no chevron, a card a fraction off the page it sits on — and
                * the only unmistakably pressable thing on the screen is the
                * register offer. A parent who finds their child and then hunts
                * for the button to press is a parent one tap from the wrong
                * door. This is the sentence that stops that, and it is free
                * here: the space is empty and the eye is already on it.
                */}
              <div className="pt-1 text-base text-ink-500">
                {tracksCheckOut
                  ? "Then tap your child's name to check in or collect."
                  : "Then tap your child's name."}
              </div>
            </div>
          )}
          {outcome.mode === 'phone-partial' && (
            <div className="pt-6 text-center text-lg text-ink-400">
              Enter all 4 digits of a phone number in your family.
            </div>
          )}
          {(outcome.mode === 'phone' || outcome.mode === 'name') && outcome.results.length === 0 && (
            /*
             * Nothing matched, and the answer is three different doors.
             *
             * The commonest reason is being new, so the register door leads —
             * straight into the wizard now, one tap. The second is a child who
             * belongs to a *different* gathering — the search is scoped to the
             * children who have been to this one, and "Search everyone" is
             * that scope's honest way out. The third reason — somebody added
             * the family minutes ago, at the welcome desk or in the main app —
             * needs no door of its own: the pulse delivers additions within a
             * minute, and the church-wide sweep runs silently the moment a
             * finished search comes up empty. "Search everyone" is also how a
             * greeter asks for that read by hand, which is what its spinner is
             * spinning about; the sweep's other surfaces are the headline's
             * "Still" and the network-failure line below.
             *
             * Inside the scrolling results region on purpose: this file
             * promises that typing never moves the keyboard, and a block that
             * appeared the moment a name matched nobody would be the one thing
             * that did.
             */
            <div className="flex flex-col items-center gap-3 pt-6 text-center">
              <div className="text-lg text-ink-400">
                {refresh === 'done' ? (
                  <>
                    {/*
                      * The one word that carries the whole answer, and the one
                      * a parent watching their own finger did not see change.
                      * It brightens three times and stops: long enough to
                      * catch an eye coming back up from the button, short
                      * enough that a lobby screen is not blinking at anybody.
                      * The word is what changed, so the word is what moves —
                      * animating the sentence would say the sentence is new.
                      */}
                    <span className="animate-word-pulse text-ink-100">Still</span> no match — first
                    time here?
                  </>
                ) : (
                  'No match — first time here?'
                )}
              </div>
              <button
                type="button"
                tabIndex={-1}
                onPointerDown={() => {
                  haptic();
                  onRegister();
                }}
                className="flex h-14 items-center justify-center rounded-xl bg-brand-600 px-8 text-lg font-semibold text-white active:bg-brand-500"
              >
                Register your child
              </button>
              {refresh === 'failed' && (
                <div className="text-base text-ink-500">Couldn&apos;t reach the network just now.</div>
              )}
              {/*
                * Stays, and reports.
                *
                * It used to remove itself the moment it was pressed, which
                * left a parent looking at the place a button had been with
                * no more evidence of the press than one word changing in the
                * line above. And it left the family it had failed with
                * nothing to press: four digits are a small keyspace and
                * names collide, so "widened and still not mine" is a real
                * state, and the answer to it — look again, the church may
                * have added them since — is this control.
                *
                * `aria-label` rather than the label alone, so it keeps its
                * name while its face is a spinner: the button a parent is
                * waiting on is still the same button.
                */}
              <WidenButton widening={widening} onWiden={onWiden} />
              <div className="text-base text-ink-500">or see a leader.</div>
            </div>
          )}
          {outcome.results.slice(0, MAX_RESULTS).map((student) => {
            const present = presentIds.has(student.id);
            /*
             * Three states where check-out is tracked, two everywhere else.
             *
             * A present child stops being an inert "already done" row and
             * becomes the collect target — which is the whole pickup flow.
             * A collected one goes inert again, dimmed, so a parent cannot
             * hand the same child back twice.
             */
            const collected = tracksCheckOut && checkedOutIds.has(student.id);
            const inert = present && !tracksCheckOut;
            return (
              <button
                key={student.id}
                type="button"
                tabIndex={-1}
                {...rowTap(student)}
                /*
                 * `ink-800`, not `ink-900`: a row is a button and has to look
                 * like one in a dim lobby. Against `ink-950` a 900 card is
                 * 1.24:1 — not a shape, just a bright name floating in the
                 * dark — and the only object on the screen that unmistakably
                 * read as pressable was the register offer, which is the wrong
                 * door. It is the same fill the quiet **Search everyone**
                 * carries, so nothing new enters the palette.
                 */
                className={`flex h-16 shrink-0 items-center justify-between rounded-xl px-5 text-left ${
                  collected
                    ? 'bg-ink-800/50 opacity-60'
                    : present
                      ? 'bg-present-600/20'
                      : 'bg-ink-800 active:bg-ink-600'
                } ${inert || collected ? '' : 'active:bg-ink-600'}`}
              >
                <span className="truncate text-xl font-semibold text-ink-100">
                  {student.firstName} {student.lastName}
                </span>
                <span className="pl-3 text-base whitespace-nowrap text-ink-400">
                  {collected ? (
                    <span className="font-semibold text-ink-400">Collected</span>
                  ) : present && tracksCheckOut ? (
                    <span className="font-semibold text-brand-300">Tap to collect</span>
                  ) : present ? (
                    <span className="font-semibold text-present-400">✓ Checked in</span>
                  ) : (
                    gradeLabel(student.grade)
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/*
        * The standing offer: the one door off this screen that is never closed.
        *
        * A parent who has been told "just put your name in" types their child's
        * name and gets a list — the no-match state above never fires for them,
        * because somebody else's Noah is on the roster. Nor does it fire for the
        * newcomer whose last four digits happen to belong to a family the church
        * already has. Both meet a screen full of confident, wrong rows, and for
        * both the way out is here.
        *
        * Tapping it opens the registration wizard directly — one tap from the
        * question to the first question.
        *
        * It used to be a line of text with a coloured phrase in it, which read
        * as a footnote next to the same offer's *button* two hundred pixels
        * higher up. A family meets whichever of the two happens to fire first,
        * so they have to be the same object: same shape, same words, one step
        * quieter here because this one is standing next to a keyboard somebody
        * is aiming at.
        *
        * Still exactly one grid row and still a fixed height, which is the
        * promise this file makes about geometry: present from the first paint,
        * so it cannot be the thing that moves when a keystroke lands.
        */}
      {/* `overflow-hidden` is load-bearing, not tidiness: two nowrap labels
          side by side have a min-content width, and a grid track will widen
          past the screen to honour it rather than let them shrink — which took
          the header, the results and the keyboard sideways with it on a narrow
          phone. Hidden overflow lets the track fall back to zero, so a screen
          too narrow for both labels crops them instead of scrolling the whole
          kiosk. */}
      <div className="flex h-12 items-center justify-center gap-2 overflow-hidden px-2">
        {/*
          * The way out of the scope, standing beside the way out of the search.
          *
          * It used to live only on the no-match panel, which meant it appeared
          * for exactly the family who did not need it and was missing for the
          * one who did. A scoped search that returns *somebody* — the other
          * Noah, the Ramirez who is not theirs — is the commonest way a parent
          * is shown confident, wrong rows, and until now the only door open to
          * them was the one that registers a child the church already has.
          *
          * Hidden only while the no-match panel is up, because that panel is
          * showing this same control in its primary weight a hand's width
          * higher: the standing pair steps aside rather than appearing twice.
          */}
        {!offeredAbove && canWiden && <WidenButton widening={widening} onWiden={onWiden} quiet />}
        {!offeredAbove && (
          <button
            type="button"
            tabIndex={-1}
            onPointerDown={() => {
              haptic(8);
              onRegister();
            }}
            className="flex h-11 min-w-0 shrink items-center justify-center truncate rounded-xl bg-brand-600/15 px-3 text-sm font-semibold whitespace-nowrap text-brand-300 ring-1 ring-brand-500/40 active:bg-brand-600/30"
          >
            {/*
              * The question goes first and, on a narrow screen standing beside
              * **Search everyone**, goes away.
              *
              * Both controls and the question do not fit across a phone held
              * upright: what they did instead was wrap the button onto three
              * lines, which overran this row's fixed height and painted over
              * the last row of the results. Dropping the question there rather
              * than truncating the label keeps the half that says what the
              * button does — and it is only ever dropped where the other
              * button is crowding it, so the wider screens, where the pair fits
              * with room to spare, still get the sentence.
              *
              * On width, never on state: this row's height is fixed and its
              * contents must not reflow because a keystroke found somebody.
              */}
            <span className={canWiden ? 'hidden sm:inline' : undefined}>{offerPrompt}&nbsp;</span>
            Register your child
          </button>
        )}
      </div>

      {/*
        * The buffer. A div, never an input — the native keyboard must not rise.
        *
        * And, deliberately, not a box either: no fill, no border, no rounded
        * corners. Everything that looks like a text field on a touchscreen is
        * a text field, and a parent meeting one taps it before typing —
        * waiting for a caret and a keyboard that are already there. The tap
        * does nothing, because there is nothing here to focus, and the second
        * of confusion it buys is spent at the front of a queue. Bare text on
        * the background instead: the keys are lit, the readout is where the
        * letters appear, and nothing on the screen invites a press that has no
        * answer.
        *
        * Empty on an untouched screen, and that is the point of the row
        * rather than a gap in it. The instruction used to live here, and it
        * was the loudest thing on the glass for as long as nobody had typed —
        * which put the sentence a parent reads *first* at the bottom of the
        * screen, beneath the register offer, four hundred pixels below where
        * their eye lands. It is at the top of the results now. This row keeps
        * its height either way, because a keystroke must not move the
        * keyboard, and the empty band it leaves is doing a second job: it is
        * the one place a thumb reaching for the top row of keys could
        * otherwise commit the register offer by accident.
        */}
      <div className="px-6 pb-1">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-center px-4 text-center">
          {buffer && (
            <span className="truncate text-3xl font-semibold tracking-wide text-ink-50">{buffer}</span>
          )}
        </div>
      </div>

      <Keyboard onKey={onKey} onClearHeld={onStaffGate} />
    </div>
  );
}
