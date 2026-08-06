/**
 * The screen a parent actually uses.
 *
 * Fixed geometry, top to bottom: event header, the typed buffer, a
 * fixed-height results area, the keyboard. A keystroke changes text and row
 * contents and never the geometry of the frame — nothing reflows, and the
 * keyboard subtree never re-renders (see components/Keyboard.tsx).
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
 * The top-left corner hides the staff gate: a three-second hold returns to
 * the event chooser. Invisible on purpose — parents have no business there,
 * and staff are told where it is.
 */
import { useEffect, useRef } from 'react';
import { gradeDescription, haptic } from '@/lib/utils';
import { HoldButton } from '../components/HoldButton';
import { Keyboard, type KioskKey } from '../components/Keyboard';
import { useTapGuard } from '../components/tapGuard';
import type { KioskRefresh } from '../KioskApp';
import { windowHasClosed, type KioskBinding } from '../binding';
import { MAX_RESULTS, type KioskSearchOutcome, type KioskStudent } from '../search';

function gradeLabel(grade: number | null): string {
  return grade === null ? '' : gradeDescription(grade);
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
  widened,
  onWiden,
  onPick,
  onRegister,
  justRegisteredRemotely,
  onUnbind,
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
  /** Whether this search already covers the whole ministry. */
  widened: boolean;
  /** Widens this one search to all of Tally. Resets when the buffer clears. */
  onWiden: () => void;
  onPick: (student: KioskStudent) => void;
  /** Opens the registration offer — the other door off this screen. */
  onRegister: () => void;
  /**
   * Set when a family has just come back from registering on their phone, until
   * they start typing. The kiosk has re-read the roster for them; what is left
   * is telling them which four digits to type, on the screen where they type it.
   */
  justRegisteredRemotely?: boolean;
  onUnbind: () => void;
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
    <div className="grid h-full grid-rows-[auto_auto_1fr_auto_auto]">
      {/* Header — with the invisible staff gate over its left corner. */}
      <div className="relative px-6 pt-[max(1rem,var(--spacing-safe-top))] pb-2 text-center">
        <HoldButton
          onHeld={onUnbind}
          className="absolute top-0 left-0 h-16 w-16 opacity-0"
          aria-label="Change event (staff)"
        >
          {''}
        </HoldButton>
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
        <div className="text-lg font-semibold text-ink-200">{binding.title}</div>
        <div className="text-sm text-ink-500">
          {tracksCheckOut
            ? 'Welcome! Check in below, or tap a name to collect.'
            : closed
              ? 'Check-in window has closed — you can still check in.'
              : 'Welcome! Check in below.'}
        </div>
      </div>

      {/* The buffer. A div, never an input — the native keyboard must not rise. */}
      <div className="px-6 pb-2">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-center rounded-xl bg-ink-900 px-4">
          {buffer ? (
            <span className="truncate text-3xl font-semibold tracking-wide text-ink-50">{buffer}</span>
          ) : (
            <span className="text-xl text-ink-500">Type a name, or the last 4 digits of your phone</span>
          )}
        </div>
      </div>

      {/* Results — fixed-height rows in a fixed region that scrolls past them. */}
      <div
        ref={resultsRef}
        className="min-h-0 overflow-y-auto overscroll-contain scroll-touch px-6"
        style={{ touchAction: 'pan-y' }}
      >
        {/* The bottom padding rides on the column, not the scroller: end
            padding on a scroll container is not reliably scrollable to. */}
        <div className="mx-auto flex max-w-2xl flex-col gap-2 pb-2">
          {/*
            * Inside the scrolling region, like every other message here, so the
            * frame's geometry is the same with it and without it.
            */}
          {justRegisteredRemotely && outcome.mode === 'idle' && (
            <div className="pt-6 text-center text-lg text-brand-300">
              You&rsquo;re on the list — type the last 4 digits of your phone.
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
             * The commonest reason is being new, so the register door leads.
             * The second is a child who belongs to a *different* gathering —
             * the search is scoped to the children who have been to this one,
             * and "Search everyone" is that scope's honest way out, in the
             * slot where "I already registered" used to widen as a side effect
             * of a network read nobody could see. The third reason — somebody
             * added the family online moments ago — needs no door at all any
             * more: the kiosk notices registrations by itself (the pulse), and
             * for the rare backend-direct addition the church-wide sweep now
             * runs silently the moment a finished search comes up empty. Its
             * only remaining surfaces are the headline's "Still" and the
             * network-failure line below.
             *
             * Inside the scrolling results region on purpose: this file
             * promises that typing never moves the keyboard, and a block that
             * appeared the moment a name matched nobody would be the one thing
             * that did.
             */
            <div className="flex flex-col items-center gap-3 pt-6 text-center">
              <div className="text-lg text-ink-400">
                {refresh === 'done'
                  ? 'Still no match — first time here?'
                  : 'No match — first time here?'}
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
              {!widened && (
                <button
                  type="button"
                  tabIndex={-1}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    haptic();
                    onWiden();
                  }}
                  className="flex h-14 items-center justify-center rounded-xl bg-ink-800 px-8 text-lg font-semibold text-ink-100 active:bg-ink-700"
                  style={{ touchAction: 'manipulation' }}
                >
                  {/*
                    * Says what it does, unlike its predecessor. The search
                    * only covers the children who come to *this* gathering;
                    * a child who belongs to Sunday mornings is one tap away,
                    * instantly — the wider list is already on the device, so
                    * nothing loads and nothing waits.
                    */}
                  Search everyone
                </button>
              )}
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
                className={`flex h-16 shrink-0 items-center justify-between rounded-xl px-5 text-left ${
                  collected
                    ? 'bg-ink-900/60 opacity-60'
                    : present
                      ? 'bg-present-600/20'
                      : 'bg-ink-900 active:bg-ink-700'
                } ${inert || collected ? '' : 'active:bg-ink-700'}`}
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
        * Tapping it opens the QR screen, whose own largest button is "I've
        * registered" — so a family who came through this door by mistake, having
        * already filled the form in on their phone, is offered the way back
        * before the form rather than a second registration.
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
      <div className="flex h-12 items-center justify-center px-6">
        {!offeredAbove && (
          <button
            type="button"
            tabIndex={-1}
            onPointerDown={() => {
              haptic(8);
              onRegister();
            }}
            className="flex h-11 items-center justify-center rounded-xl bg-brand-600/15 px-6 text-base font-semibold text-brand-300 ring-1 ring-brand-500/40 active:bg-brand-600/30"
          >
            {offerPrompt} Register your child
          </button>
        )}
      </div>

      <Keyboard onKey={onKey} />
    </div>
  );
}
