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
 * The staff gate is a two-second hold on **Clear**, which opens the prompt
 * that leaves the gathering. It used to be an invisible square over the top-left
 * corner of the header — unfindable by anybody who had not been shown it, and
 * in the wrong place besides. A labelled key in a fixed position can be
 * described over the phone; the prompt is what makes it safe to be findable.
 */
import { useEffect, useRef } from 'react';
import { gradeDescription, haptic } from '@/lib/utils';
import { Keyboard, type KioskKey } from '../components/Keyboard';
import { useTap, useTapGuard } from '../components/tapGuard';
import type { KioskRefresh } from '../KioskApp';
import { eventWindow, windowHasClosed, type KioskBinding } from '../binding';
import { MAX_RESULTS, type KioskSearchOutcome, type KioskStudent } from '../search';

function gradeLabel(grade: number | null): string {
  return grade === null ? '' : gradeDescription(grade);
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
  const tap = useTap();

  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label="Search everyone"
      aria-busy={widening}
      {...tap(() => {
        haptic(quiet ? 8 : undefined);
        onWiden();
      })}
      className={
        quiet
          ? /* No ring on the standing one. Rows became `ink-800` so a child's
               name would read as a button, and this button carries the same
               fill — so the ring made the *widen* control the strongest edge on
               a screen whose primary targets are the names beside it. */
            'flex h-11 min-w-0 shrink items-center justify-center truncate rounded-xl bg-ink-800/70 px-3 text-sm font-semibold whitespace-nowrap text-ink-300 active:bg-ink-700 tall:h-14 tall:px-5 kiosk:text-base'
          : 'flex h-14 w-full items-center justify-center rounded-xl bg-ink-800 px-8 text-lg font-semibold text-ink-100 active:bg-ink-700 tall:h-16 kiosk:text-xl lg:flex-1'
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
   * The staff gate fired — **Clear**, held for two seconds.
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
  const tap = useTap();

  /*
   * Whether this state has rows in it, which decides where its content sits in
   * the track.
   *
   * A list is top-anchored and has to be: a parent typing one more letter must
   * not have Ramona Alvarez slide down under the thumb already moving toward
   * her. The row-less states have no such promise to keep — nothing in an idle
   * prompt or a no-match panel survives the next keystroke — so they hang from
   * the bottom of the track instead, near the hand.
   *
   * That matters most where it is least obvious. The no-match panel is the one
   * state on this screen where a parent has to decide and press something, and
   * top-anchored on a phone its two buttons sat in the upper third with a
   * hundred and eighty pixels of nothing beneath them.
   */
  const rowless = outcome.results.length === 0;
  /** A finished search that matched nobody — the state with two doors in it. */
  const nobody = (outcome.mode === 'phone' || outcome.mode === 'name') && rowless;

  /*
   * Where a row-less state sits in the track.
   *
   * Sinking all of them put the idle prompt hard against the console on a
   * portrait tablet with the whole void above it, so the emptiness swapped ends
   * the instant somebody typed — the geometry did not move, but the composition
   * did. The idle prompt is text with nothing in it to press, so it takes the
   * middle and the void splits either side of it.
   *
   * The states that ask for a press do not take the middle. No match, and the
   * four-digit prompt that is one keystroke away from becoming one, hang from
   * the bottom where the hand is. That is the whole distinction: a decision a
   * parent has to reach for belongs near the keys; a sentence they only read
   * does not.
   *
   * And all of it is a short-track behaviour, which is what `tall:` undoes.
   * Moving a block toward the hand is worth a few dozen pixels on a phone,
   * where the track is about three hundred tall and the whole screen is within
   * a thumb's sweep. On a tablet stood on end the same rule moves it six
   * hundred, so a parent reads the instruction at the bottom of the glass,
   * types two letters, and the answer appears at the top — the geometry never
   * moved, but everything they were looking at did. Up there the block stays
   * where the rows will be.
   */
  /*
   * What the search found, and whether the list is all of it.
   *
   * `outcome.total` is the count before `MAX_RESULTS` cut the array — the
   * screen used to read the sliced length, so a search matching twenty-three
   * said "8 names", which is a complete-looking number for an incomplete list.
   * At that point a parent has scrolled everything on offer, found nobody
   * theirs, and the doors left to them include the one that makes a duplicate.
   */
  const matchCount = outcome.total ?? outcome.results.length;
  const truncated = matchCount > outcome.results.length;
  /*
   * Whether the landscape kiosk splits the list in two.
   *
   * Not simply "are there rows". A two-column frame with one name in it puts a
   * half-width card against the left margin with the whole right half of the
   * page empty beside it — and strands the count, which hangs off the rows'
   * right edge and would be pointing at an edge no row is flush to. That is the
   * state a parent most wants to reach: enough letters typed, one child left.
   * Four is where both columns have something in them.
   */
  const wraps = outcome.results.length >= 4;

  /*
   * The no-match panel spans the region rather than sitting in it: its heading
   * is pinned to the top and its doors to the bottom, so the column has to fill
   * the track for either end to mean anything.
   *
   * Everything else is top-anchored, at every shape. The idle prompt used to
   * centre itself on short screens to sit nearer the hand, which made one
   * component behave as two: on a phone the first keystroke jumped the reading
   * position a row and a half, because the prompt was not where the rows were
   * going to be. Nothing in that block is pressable, so the reach it was
   * buying was worth nothing, and the rule it was breaking — idle and typed
   * share a top edge — is worth keeping.
   */
  const station = nobody ? 'min-h-full' : '';
  const rows = outcome.results.length > 0;

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
    <div className="grid h-full grid-rows-[auto_1fr_auto_auto_auto_auto]">
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
        <div className="text-2xl font-semibold text-ink-100 kiosk:text-3xl">{binding.title}</div>
        <div className="text-base text-ink-500 kiosk:text-lg">
          {closed ? 'Check-in window has closed — you can still check in.' : eventWindow(binding)}
        </div>
      </div>

      {/*
        * Results — fixed-height rows in a fixed region that scrolls past them.
        *
        * Two things stop a clipped row from bleeding into the console below
        * it. The margin is a dead gutter rather than padding, because padding
        * *inside* a scroll container is scrolled through: at rest the last row
        * was cut flush against buttons nine pixels below it, and nine pixels
        * is what separates two name rows — so the boundary between "more
        * names" and "doors out of the search" was signalled by one pixel.
        *
        * The mask is the other half, and it is the half that matters. A gutter
        * separates the *clip line* from the buttons, but a thumb aims at the
        * letters, and on a clipped row the letters are flush with the clip.
        * Fading the last few pixels of the region leaves a strip of card with
        * no ink in it: a peek that says there is more below without offering
        * anything to press. Written twice because the kiosk runs on whatever
        * tablet the church owns and WebKit still wants the prefix.
        */}
      <div
        ref={resultsRef}
        className={`mb-4 flex min-h-0 flex-col overflow-y-auto overscroll-contain scroll-touch px-6 ${
          /* Only where there is a list to run past. The panel that fills the
             region on a failed search ends with "or see a leader." — the door
             that costs the church nothing — and an unconditional ramp dimmed it
             below legible, so the state read as a block that had been cut off
             rather than one that finished. */
          outcome.results.length > 0 ? 'kiosk-list-fade' : ''
        }`}
        style={{ touchAction: 'pan-y' }}
      >
        {/* The bottom padding rides on the column, not the scroller: end
            padding on a scroll container is not reliably scrollable to.
            `mt-auto` sinks the row-less states toward the hand and collapses
            to nothing the moment the content is taller than the box. */}
        {/*
          * Two columns on a landscape kiosk, one everywhere else.
          *
          * A 1280×800 tablet is the worst of the three shapes for the only
          * thing this screen does. The fixed chrome — header, offer row,
          * readout, keyboard — leaves the track under three hundred pixels, so
          * it showed three matches out of a possible eight, against four on a
          * phone and all eight on the same tablet stood on end. None of that
          * height is recoverable: the keys and the rows are already at the
          * sizes a standing adult needs.
          *
          * The axis nobody was using is the one that is free. The rows sat in a
          * capped column with three hundred pixels of dead page on either side.
          * `columns` rather than a grid because CSS multi-column fills
          * column-major — down the first, then the second — so an A–Z list
          * still reads downward, which a two-column grid would have broken by
          * laying it out in rows.
          *
          * Above `lg` only, which the phone never reaches and the portrait
          * kiosk (800px wide) does not either. Row height, row fill and the
          * promise that a tap never moves a row are all untouched; only the
          * wrap changes.
          */}
        <div
          className={`mx-auto w-full max-w-2xl ${station} ${
            rowless ? 'pb-6' : truncated ? 'pb-2' : ''
          } ${
            /*
             * The ramp's own depth, so the last row clears it at maximum
             * scroll.
             *
             * This clearance used to ride on the truncation sentence, which
             * only renders when the search matched more than the list can show
             * — so a list that overflows the region without being capped (five
             * or six matches on a phone, which is what a common surname
             * prefix produces) had none of it. A parent did exactly what the
             * readout asked: the count said five names, they could see four,
             * they swiped. The list stopped moving and the fifth name was a
             * ghost, with nowhere further to scroll and no state of the screen
             * in which it became readable.
             *
             * Where the sentence does render it carries its own copy of this,
             * because it is a sibling below this column rather than inside it.
             */
            rows && !truncated ? 'pb-16 tall:pb-20' : ''
          } flex flex-col gap-2 ${
            wraps ? 'lg:block lg:columns-2 lg:gap-x-8 lg:max-w-5xl' : ''
          }`}
        >
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
            <div className="flex flex-col items-center pt-6 text-center">
              {/* Two voices, not three. The instruction and its alternative are
                  one unit, set tight; what happens next is separated by air
                  rather than by a third size, which at a 2px step read as one
                  paragraph fading out. */}
              <div className="text-4xl font-semibold text-ink-100 kiosk:text-5xl">Type a name</div>
              <div className="pt-1 text-lg text-ink-400 kiosk:text-xl">or the last 4 digits of your phone</div>
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
              {/*
                * One sentence, in both modes.
                *
                * It carried "…to check in or collect" at a pickup gathering,
                * which said the mode twice on one screen — the header had it
                * too — and wrapped this line onto two, ending in a one-word
                * orphan. Neither copy was where the answer actually is: the
                * row itself says "Tap to collect", "✓ Checked in" or a dimmed
                * "Collected", and that is a thing a parent acts on rather than
                * files.
                *
                * `ink-400`, the same step as the line above it. At `ink-500`
                * the one sentence that tells a parent a name row is pressable
                * was the dimmest text on the glass — below AA on a
                * fingerprinted lobby screen — and skipping it is exactly what
                * sends somebody hunting for a button and finding the register
                * offer.
                */}
              <div className="pt-4 text-lg text-ink-400 kiosk:text-xl">Then tap your child&rsquo;s name.</div>
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
            /* One width for the stacked pair. Auto-width buttons stacked and
               centred missed each other's edges by 11px a side, which nothing
               in the frame explained — because nothing did: it was the length
               of two labels. */
            /*
             * The heading sits where the rows were, because that is where a
             * parent is looking. The doors do not travel with it: they fall to
             * the foot of the region, a hand's width above the console, which
             * is where the standing pair lives in every other state.
             *
             * Without that split, the keystroke that turns one match into none
             * teleported "Search everyone" — the commonest correct move when a
             * scoped search misses a child who is in the directory but not this
             * gathering's pool — from just under the rule to the top third of
             * the screen, seven hundred pixels from the keys the parent was
             * pressing a moment ago.
             */
            <div className="mx-auto flex h-full w-full max-w-xs flex-col items-stretch gap-3 pt-6 text-center tall:max-w-md tall:justify-end tall:gap-4 lg:max-w-2xl">
              {/* The state's own sentence holds the top of the ramp. Set at the
                  bottom of it, the loudest thing in the frame was the query
                  that did not work, echoed in bold white above the keys, and
                  the fact explaining the empty screen read as fine print over
                  two buttons. One thing at the top of a ramp, and here it is
                  the outcome rather than the input. */}
              {/* Its own measure, wider than the doors under it, and balanced.
                  Inheriting the button column broke the sentence inside its own
                  phrase on a phone — "No match — first / time here?" — with the
                  em dash sitting right there unused. */}
              <div className="mx-auto max-w-sm text-center text-3xl font-semibold text-balance text-ink-100 tall:max-w-md kiosk:text-4xl">
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
              {/*
                * Stacked, until the screen is wide and short.
                *
                * On a 1280×800 kiosk the fixed chrome leaves this track 259px
                * and the stack needed about 300, so the closing line — "or see
                * a leader.", the door that costs the church nothing — was cut
                * through its x-height and faded out by the region's mask. A
                * parent deciding whether they have to create a record was
                * reading what looked like a broken screen. That shape has
                * width and no height, so the doors spend the axis it has.
                */}
              {/*
                * The doors hang from the foot of the region — except on a
                * screen stood on end, where the whole block travels down
                * together instead. Anchoring the two ends independently put a
                * third of a portrait tablet between a question and its own two
                * answers, so they stopped reading as one statement and started
                * reading as two blocks sharing a screen. The other shapes hold
                * it together at fifty to ninety pixels; this is the one where
                * the family broke.
                */}
              <div className="mt-auto flex flex-col items-stretch gap-3 pt-6 tall:mt-0 tall:gap-4 lg:flex-row lg:justify-center lg:gap-4">
                <button
                  type="button"
                  tabIndex={-1}
                  {...tap(() => {
                    haptic();
                    onRegister();
                  })}
                  className="flex h-14 items-center justify-center rounded-xl bg-brand-600 px-8 text-lg font-semibold text-white active:bg-brand-500 tall:h-16 kiosk:text-xl lg:flex-1"
                >
                  Register your child
                </button>
                <WidenButton widening={widening} onWiden={onWiden} />
              </div>
              {refresh === 'failed' && (
                <div className="text-base text-ink-500 kiosk:text-lg">
                  Couldn&apos;t reach the network just now.
                </div>
              )}
              {/*
                * "Search everyone" stays, and reports — it used to remove
                * itself the moment it was pressed, which left a parent looking
                * at the place a button had been with no more evidence of the
                * press than one word changing in the line above. And it left
                * the family it had failed with nothing to press: four digits
                * are a small keyspace and names collide, so "widened and still
                * not mine" is a real state, and the answer to it — look again,
                * the church may have added them since — is that control.
                */}
              <div className="text-base text-ink-400 kiosk:text-lg">or see a leader.</div>
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
                /* `lg:w-full` is not decoration. Multi-column flow drops these out of
                   the flex column that was stretching them, and a `button` in
                   normal flow is shrink-to-fit — so every card became as wide as
                   its own name, the grade stopped being a right-hand column, and
                   checking a child in *resized their row*, which is the one thing
                   this list promises never to do. */
                className={`flex h-16 w-full shrink-0 items-center justify-between rounded-xl px-5 text-left tall:h-20 lg:break-inside-avoid lg:not-first:mt-2 ${
                  collected
                    ? 'bg-ink-800/50 opacity-60'
                    : present
                      ? 'bg-present-600/20'
                      : 'bg-ink-800 active:bg-ink-600'
                } ${inert || collected ? '' : 'active:bg-ink-600'}`}
              >
                <span className="truncate text-xl font-semibold text-ink-100 kiosk:text-2xl">
                  {student.firstName} {student.lastName}
                </span>
                <span className="pl-3 text-base whitespace-nowrap text-ink-400 kiosk:text-lg">
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

        {/*
          * After the rows, and outside the column block.
          *
          * The count in the readout says eleven names over a list of eight, and
          * a parent who reads it still has to find where the list stops; the
          * bottom of the last row is the one place somebody who has run out of
          * names is guaranteed to be looking. A sibling of the list rather than
          * its last child, because the landscape shape lays the rows out in
          * multi-column flow, where source order is column order and `order`
          * does nothing — as the list's last child this sentence became the
          * first thing in the left column, a heading over the names that
          * matched best, and it pushed that column out of register with the
          * other one.
          */}
        {truncated && (
          <div className="mx-auto w-full max-w-2xl pt-2 pb-16 text-center text-base text-ink-400 kiosk:text-lg tall:pb-20 lg:max-w-5xl">
            More names than fit — keep typing.
          </div>
        )}
      </div>

      {/*
        * The console: the standing offer, the readout and the keys, declared as
        * one object by the rule along its top.
        *
        * They were three things that had ended up adjacent. The offer row
        * floated in the middle of an idle screen carrying the only accent and
        * the only ring on the glass, with a two-hundred-pixel void above it and
        * a seventy-eight-pixel one below — so it belonged to nothing, and the
        * reserved height under it read as a second hole rather than as the
        * readout's own space. Below one edge, that band is interior; the dead
        * gutter above it is a boundary a clipped row cannot bleed across; and
        * whatever slack the screen has left collects in exactly one field,
        * above the rule and below the content.
        *
        * A hairline rather than a fill. `ink-900` under the page would have
        * flattened the keys, which are `ink-800` and need the page's distance
        * to stay shapes in a dim room.
        */}
      <div className="border-t border-ink-800/70" />

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
      {/*
        * The exit sits on the left, and the gap between the two is wider than
        * the gap between two name rows.
        *
        * These are not a matched pair. **Search everyone** is a retry: press it
        * by accident and the search runs wider, which is a second of waiting.
        * **Register your child** is an exit, and completed it makes a duplicate
        * of a child the church already has, for the review queue to judge. They
        * used to sit six pixels apart — less than the space between two rows on
        * the same screen — with the exit the wider of the two and on the right,
        * which on a phone held one-handed is exactly where a thumb travels.
        * The air comes out of the row's own side margins, which were doing
        * nothing.
        */}
      {/* `pt-2` is the console's interior. The rule and this row's first
              pixel were two apart while every other gap inside the console was
              40 or more, so the edge separated without containing — it read as
              the button's own top border run out to the screen. */}
      <div className="mx-auto flex h-14 w-full max-w-2xl flex-row-reverse items-center justify-center gap-4 overflow-hidden px-2 pt-2 tall:h-20 tall:gap-6 lg:max-w-5xl">
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
            {...tap(() => {
              haptic(8);
              onRegister();
            })}
            /* The `tall:` step every other control got. Quiet in weight — a
               tinted chip beside a keyboard — is a different lever from quiet
               in legibility, and on a portrait tablet this was simultaneously
               the only accented object on the glass and the smallest type on
               it, read at arm's length. */
            className="flex h-11 min-w-0 shrink items-center justify-center truncate rounded-xl bg-brand-600/15 px-3 text-sm font-semibold whitespace-nowrap text-brand-300 ring-1 ring-brand-500/40 active:bg-brand-600/30 tall:h-14 tall:px-5 kiosk:text-base"
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
            {canWiden ? (
              <>
                <span className="sm:hidden">Not yours?&nbsp;Register</span>
                <span className="hidden sm:inline">{offerPrompt}&nbsp;Register your child</span>
              </>
            ) : (
              <>{offerPrompt}&nbsp;Register your child</>
            )}
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
        {/* The same measure as the results column, so the count below hangs off
            the edge the rows are flush to rather than off this band's own
            padding — it is the list's caption, and it was missing the strongest
            vertical line in the frame by sixteen pixels. */}
        <div className="relative mx-auto flex h-16 max-w-2xl items-center justify-center text-center tall:h-20 lg:max-w-5xl">
          {buffer && (
            <span className="truncate text-3xl font-semibold tracking-wide text-ink-50 kiosk:text-4xl">
              {buffer}
            </span>
          )}
          {/*
            * How many names the search found, beside the letters that found
            * them.
            *
            * The list clips, and the peek that says so is a strip of card
            * faded to nothing — `ink-800` on `ink-950` is barely a shape at
            * full strength, so a few pixels of it ramping to the page is not a
            * signal anybody catches in a lobby. A phone fits four rows and
            * MAX_RESULTS is eight, so a family whose name sorts fifth met four
            * confident wrong rows and nothing at all to say a fifth existed —
            * and the doors available to them from there include the one that
            * registers a child the church already has.
            *
            * Here rather than on the list because this band is where a parent
            * is already looking while they type, and because it costs no
            * geometry: absolutely positioned, so the count cannot push the
            * letters off centre or move a row.
            */}
          {matchCount > 0 && (
            <span className="absolute right-0 text-sm text-ink-400 kiosk:text-base">
              {/*
                * A number while the list is all of it, a sentence when it is
                * not. `MAX_RESULTS` is eight, and "8 names" over a list that
                * was cut from twenty-three is a complete-looking answer to an
                * incomplete search — the parent scrolls all eight, finds
                * nobody, and the doors left to them include the one that
                * registers a child the church already has. Past the cap the
                * only useful thing to say is the thing that works.
                */}
              {matchCount} {matchCount === 1 ? 'name' : 'names'}
            </span>
          )}
        </div>
      </div>

      <Keyboard onKey={onKey} onClearHeld={onStaffGate} />
    </div>
  );
}
