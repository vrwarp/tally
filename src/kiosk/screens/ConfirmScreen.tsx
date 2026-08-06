/**
 * "Is this you?" — one big name, one big button.
 *
 * The check-in itself is a single tap, not a hold: speed of confirmation is
 * the kiosk's whole point, and the worst a mis-tap can do is mark somebody
 * present who then walks in anyway. Undo lives with the staff in the main app,
 * deliberately not here.
 *
 * A pickup holds for three seconds instead, and that is not ceremony. Marking
 * a child collected is a claim that somebody took them out of the building,
 * made on an unattended screen in a lobby — and unlike a stray check-in it is
 * not self-correcting when the child walks in anyway. Undoing one needs a
 * volunteer and the main app, so the gesture is worth a deliberate second.
 *
 * ## The rest of the family
 *
 * When the kiosk can see brothers and sisters who need the same thing (see
 * family.ts for how much of a guess that is), they are listed here, ticked, and
 * the one button does all of them. Ticked rather than waiting to be chosen:
 * a family arrives together, and the parent who tapped the first name is
 * already reaching for the button — an unticked list would be a second thing to
 * do rather than a saved trip through the whole flow.
 *
 * What keeps that honest is that every name is on the glass, above the finger
 * that is about to press, and each one unticks with a tap. The kiosk's guess at
 * a family can be wrong; a parent looking at a stranger's child in their own
 * list cannot miss it.
 *
 * ## The one who is not on it
 *
 * The guess above misses people, on purpose, and this is where they are found.
 * A sibling on a different number, a family split across two households, a
 * child added by hand last week, a second child who is finally old enough —
 * all of them are a parent looking at one name and knowing there should be
 * two. `onFindSibling` opens a screen that searches for them by name and, if
 * they genuinely are not on the roster, registers them.
 *
 * It used to say "add a brother or sister" and go straight to the wizard,
 * which read as the first thing and did the second. Underneath the confirm
 * button and in the smaller weight either way — it is the rarer of the two
 * things a parent came to this screen to do.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { gradeDescription, haptic } from '@/lib/utils';
import { HoldButton } from '../components/HoldButton';
import { useTapGuard } from '../components/tapGuard';
import type { KioskIntent } from '../KioskApp';
import type { KioskStudent } from '../search';

/** A sibling row and the gap under it — the pitch the list quantises to. */
const ROW_HEIGHT = 64;
const ROW_GAP = 8;
const ROW_PITCH = ROW_HEIGHT + ROW_GAP;

export function ConfirmScreen({
  student,
  intent,
  family,
  skipped,
  onToggle,
  onConfirm,
  onFindSibling,
  onBack,
}: {
  student: KioskStudent;
  intent: KioskIntent;
  /**
   * Others this tap could cover — already filtered to the ones a confirm would
   * do the very same thing to. A check-in screen never offers a collection.
   */
  family: readonly KioskStudent[];
  /**
   * Which of `family` the parent has unticked — held by the caller, not here.
   *
   * It used to be this component's own state, and that was wrong the moment
   * there was anywhere to go and come back from: opening "find a brother or
   * sister" unmounted the screen, and returning silently re-ticked the sibling
   * the parent had deliberately left alone. A decision somebody made with their
   * thumb outlives the screen they made it on.
   */
  skipped: ReadonlySet<string>;
  onToggle: (studentId: string) => void;
  /** Everyone the parent is confirming, the tapped student first. */
  onConfirm: (chosen: KioskStudent[]) => void;
  /**
   * Opens the "who else is with them" screen against this family. Absent when
   * there is nothing to anchor to — a collection, or a kiosk with no
   * registration flow.
   */
  onFindSibling?: (anchors: KioskStudent[]) => void;
  onBack: () => void;
}) {
  // Empty means everybody: a family arrives together. See the note above.
  const memberTap = useTapGuard(onToggle);

  const chosen = [student, ...family.filter((member) => !skipped.has(member.id))];
  const others = chosen.length - 1;

  /*
   * How many names the list can print, measured rather than counted.
   *
   * The height is quantised to the row pitch so the scroll edge always lands in
   * the gap between two cards: a row is either printed or hidden, and half a
   * ticked child at half value is the one state this screen cannot render — a
   * receded name beside a dimmed tick says "not included" in the column a
   * parent scans precisely for that.
   *
   * Measured, because a count is a guess that is right until the thing it is
   * guessing about moves: a name that wraps, a taller grade line, a platform
   * that reserves a scrollbar gutter, a shorter kiosk.
   */
  const listRef = useRef<HTMLDivElement>(null);
  const [visibleRows, setVisibleRows] = useState(family.length);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const fits = Math.max(1, Math.floor((list.clientHeight + ROW_GAP) / ROW_PITCH));
      setVisibleRows(Math.min(family.length, fits));
    };
    measure();
    // Guarded exactly as `useHeightVar` guards it: jsdom has no
    // ResizeObserver, and a kiosk that measured once at mount is still correct
    // — the glass does not resize.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [family.length]);
  const unread = Math.max(0, family.length - visibleRows);

  /*
   * "Who else?" — one slot, in the same place whether the kiosk guessed a
   * sibling or not.
   *
   * It used to be two answers to one question with the commit laid across the
   * seam: a ticked list above the button when the guess worked, and a line of
   * grey text below it when it did not. The volume of the ask was inversely
   * proportional to how badly the parent needed it — family.ts refuses every
   * digit-set that does not nest, so it manufactures the very population that
   * got the whisper. And nothing below a terminal button can be rescued by
   * treatment: it is read after the decision has already been made.
   */
  /*
   * Only on a check-in. A collection is not the moment to change who is on the
   * roster — a parent taking a child home is answering a different question —
   * and a child who is already checked in has no button for the offer to sit
   * above.
   */
  const askSibling = Boolean(onFindSibling) && intent === 'check-in';
  const whoElse =
    askSibling || family.length > 0 ? (
      <div className="mt-7 flex min-h-0 w-full flex-col gap-2">
        {/* The question rather than the list's heading, short enough that the
            row below is legibly its answer. Dropping it left a bare noun phrase
            whose nearest noun was the child's name — "not this child, show me a
            different one", to exactly the parent this exists for. */}
        <div className="shrink-0 pb-1 text-left text-xl text-ink-400">
          {intent === 'check-out' ? 'Collecting anyone else?' : 'Anyone else?'}
        </div>

        {family.length > 0 && (
          /*
           * The rows commit on lift for the same reason the search results do —
           * a list that can scroll must not act on the first touch of a drag.
           *
           * The only element here allowed to absorb variation, and so the only
           * one that may shrink: the question and the way to add a child hold
           * their intrinsic height, or a long list rides the offer down *under*
           * the commit and two doors to different places fuse into one band.
           */
          <div
            ref={listRef}
            className="flex min-h-0 shrink flex-col gap-2 overflow-y-auto overscroll-contain scroll-touch"
            style={{
              touchAction: 'pan-y',
              height: unread > 0 ? visibleRows * ROW_PITCH - ROW_GAP : undefined,
            }}
          >
            {family.map((member) => {
              const taking = !skipped.has(member.id);
              return (
                <button
                  key={member.id}
                  type="button"
                  tabIndex={-1}
                  aria-pressed={taking}
                  {...memberTap(member.id)}
                  className={`flex h-16 shrink-0 items-center justify-between rounded-xl pr-5 pl-12 text-left ${
                    taking ? 'bg-ink-800' : 'bg-ink-900 opacity-60'
                  }`}
                >
                  <span className="truncate text-xl font-semibold text-ink-100">
                    {member.firstName} {member.lastName}
                  </span>
                  {/* State, stepped down from the commit's own value: at five
                      rows a column of fully saturated chips resolved before the
                      names it belongs to, and the accent meaning "this row is
                      selected" was indistinguishable from the accent meaning
                      "this button performs the check-in". */}
                  <span
                    className={`ml-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xl ${
                      taking
                        ? intent === 'check-out'
                          ? 'bg-brand-600/55 text-ink-50'
                          : 'bg-present-600/55 text-ink-50'
                        : 'border-2 border-ink-600 text-transparent'
                    }`}
                  >
                    ✓
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/*
          What the list is hiding, said where it is hidden and as a positive
          mark. A fade says "more" by taking legibility away, which is a strange
          way to tell somebody that a child they are about to check in exists
          below the line — and where the fade fell through a row it rendered a
          *ticked* child as the most receded thing on the glass. The count in
          the commit cannot carry this either: it sits below the decision.
        */}
        {unread > 0 && (
          <div className="shrink-0 pt-1 text-left text-xl text-brand-300">
            {unread === 1 ? '1 more below' : `${unread} more below`}
          </div>
        )}

        {/*
          The last row of the list rather than a caption under the button.

          "Another child" carries no verb on purpose. The registration wizard's
          own next-child control is labelled "Add another child" word for word,
          and the screen this opens wears the same brand tint for its *register*
          offer — so a verb here would put the wizard's sentence one tap
          upstream of the wizard, and a parent who pressed the matching pill on
          the next screen would create a duplicate of a child already on the
          roster. "Find" is no better: it fights the plus and promises only half
          of what the destination does.
        */}
        {askSibling && (
          <button
            type="button"
            tabIndex={-1}
            onPointerDown={(event) => {
              event.preventDefault();
              haptic();
              onFindSibling?.([student, ...family]);
            }}
            className="flex h-16 shrink-0 items-center rounded-xl bg-brand-600/30 pr-5 pl-12 text-left text-xl font-semibold text-brand-300 ring-1 ring-brand-500/40 active:bg-brand-600/45"
            style={{ touchAction: 'manipulation' }}
          >
            {/* A gutter the whole region shares rather than a glyph hung off
                one row: inline, a light 13px mark cannot hold an edge against a
                20px semibold cap, and the label read as indented from its own
                list. */}
            <span className="-ml-7 w-7 shrink-0 font-normal">+</span>
            Another child
            <span className="ml-auto pl-3 text-2xl font-normal">›</span>
          </button>
        )}
      </div>
    ) : null;

  return (
    /*
     * Only the bottom is anchored, and that is the whole layout decision.
     *
     * A centred column made the height of the most important text on the screen
     * a function of how many siblings the kiosk happened to guess: across the
     * one journey this screen exists to serve — tap a child, go and find the one
     * the guess missed, come back — the name rose 60px while the commit fell 60,
     * around a centre line that is not an element. Nothing was fixed.
     *
     * So the commit and the exit sit a constant distance up from the bezel and
     * never move, and the identity and the who-else region ride one flexible
     * track above them, bottom-aligned against the button. The commit is the
     * right end to anchor: it is the irreversible one on a device with no undo,
     * and the one a thumb travels toward. The name floats, and the name is read
     * rather than tapped.
     */
    <div
      className="grid h-full w-full grid-rows-[minmax(0,1fr)_auto_auto] justify-center justify-items-center p-8 pb-[max(2rem,18vh)] text-center"
      style={{ gridTemplateColumns: 'minmax(0, var(--confirm-measure, 28rem))' }}
    >
      <div className="flex min-h-0 w-full flex-col items-center justify-end">
        <div className="w-full shrink-0">
          {/* Leading that survives a second line: set solid, a name one
              character longer than the column dropped its descenders into the
              caps beneath — on the one element the parent is here to verify. */}
          <div className="text-5xl/[1.15] font-bold text-ink-50">
            {student.firstName} {student.lastName}
          </div>
          {student.grade !== null && (
            <div className="pt-3 text-2xl text-ink-400">{gradeDescription(student.grade)}</div>
          )}
        </div>

        {whoElse}
      </div>

      {intent === 'done' ? (
        <div className="shrink-0 text-2xl font-semibold text-present-400">✓ Already checked in</div>
      ) : intent === 'check-out' ? (
        <HoldButton
          onHeld={() => onConfirm(chosen)}
          className="w-full shrink-0 rounded-2xl bg-brand-600 p-7 text-3xl font-bold text-white"
        >
          {others > 0 ? `Hold to collect all ${chosen.length}` : 'Hold to collect'}
        </HoldButton>
      ) : (
        <button
          type="button"
          tabIndex={-1}
          onPointerDown={(event) => {
            event.preventDefault();
            // The confirmation buzz, on contact rather than on the write — the
            // success screen is painted optimistically for the same reason, and
            // a parent already turning to walk their child in feels this when
            // they have stopped looking at the screen. One buzz for the family,
            // not one per child: it says the button took, and the button is one.
            haptic();
            onConfirm(chosen);
          }}
          className="w-full shrink-0 rounded-2xl bg-present-600 p-7 text-3xl font-bold text-white active:bg-present-500"
          style={{ touchAction: 'manipulation' }}
        >
          {others > 0 ? `Check in all ${chosen.length}` : 'Check in'}
        </button>
      )}

      <button
        type="button"
        tabIndex={-1}
        onPointerDown={(event) => {
          event.preventDefault();
          onBack();
        }}
        className="mt-8 shrink-0 rounded-xl px-8 py-4 text-xl text-ink-400 active:bg-ink-800"
        style={{ touchAction: 'manipulation' }}
      >
        ← Back
      </button>
    </div>
  );
}
