/**
 * "Who else is with you?" — finding another child, or adding one.
 *
 * ## Why this exists as a screen rather than a link
 *
 * The confirm screen used to carry a bare "+ Add a brother or sister", which
 * went straight to the registration wizard. It read wrong, and the reason is
 * worth stating: to a parent standing there, "add a brother or sister" is
 * plainly an instruction to *include another of my children in this check-in* —
 * and that is a real thing they want, several times a morning. Sending them to
 * a form asking a new child's name and grade answers a question they did not
 * ask.
 *
 * Both readings are legitimate, so this screen holds both. The child the kiosk
 * simply failed to associate — a different phone number on file, a family split
 * across two households, somebody added last week by hand — is found by name
 * and checked in with the first. The child who genuinely is not on the roster
 * gets the two-question wizard, from the same place, as the second offer rather
 * than the only one.
 *
 * Nothing on this screen names a relationship, and that is deliberate. Kinship
 * is the *guess* — `family.ts` infers it from four phone digits — and this is
 * the screen for everyone the guess is wrong about. A parent checking in a
 * nephew should not have to decide whether a box labelled "brother or sister"
 * is asking about somebody else.
 *
 * The kiosk already offers the siblings it *can* see on the confirm screen
 * itself (see family.ts for how much of a guess that is, and why it is
 * deliberately a conservative one). This is the escape hatch for everybody that
 * guess misses, which is exactly the population a conservative guess creates.
 *
 * Searched against the *whole* roster, unlike the front door, which is narrowed
 * to the children who have been to this gathering in the last year. That is not
 * an oversight: the population this screen exists for is precisely the one that
 * narrowing gets wrong — the daughter who comes on Fridays and the son who is
 * new to it, a cousin, a child who has only ever been to a different programme.
 * A parent only reaches here by having already found their family, and the
 * child they pick is ticked because they picked them.
 *
 * ## Shape
 *
 * The search screen's frame, minus the parts that would be lies here: no event
 * header (the gathering is not in question), no staff gate, no phone search —
 * the family has already been found by phone, and offering the same four digits
 * again would return the same people they are standing in front of. Name only.
 */
import { useEffect, useMemo, useRef } from 'react';
import { gradeDescription, haptic } from '@/lib/utils';
import { Keyboard, type KioskKey } from '../components/Keyboard';
import { useTap, useTapGuard } from '../components/tapGuard';
import { searchStudents, MAX_RESULTS, type KioskStudent } from '../search';

export function SiblingScreen({
  student,
  buffer,
  onKey,
  students,
  excludeIds,
  presentIds,
  onPick,
  onRegister,
  onBack,
}: {
  /** The child already on the confirm screen — who the others are *with*. */
  student: KioskStudent;
  buffer: string;
  onKey: (key: KioskKey) => void;
  students: readonly KioskStudent[];
  /** Already on the confirm screen. Offering them again would do nothing. */
  excludeIds: ReadonlySet<string>;
  presentIds: ReadonlySet<string>;
  onPick: (found: KioskStudent) => void;
  /** The other reading: this child is not on the roster at all. */
  onRegister: () => void;
  onBack: () => void;
}) {
  /*
   * Name only — `last4Index` is deliberately not threaded in. The four digits
   * are how this family was found a moment ago, so searching them again
   * returns the people already on the screen behind this one.
   */
  const outcome = useMemo(
    () => searchStudents(buffer, students as KioskStudent[], {}),
    [buffer, students],
  );

  const results = useMemo(
    () => (outcome.mode === 'name' ? outcome.results.filter((row) => !excludeIds.has(row.id)) : []),
    [outcome, excludeIds],
  );

  const rowTap = useTapGuard(onPick);
  const tap = useTap();

  const resultsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (resultsRef.current) resultsRef.current.scrollTop = 0;
  }, [buffer]);

  return (
    /* The column is the glass, never its widest item — the readout's
        truncated buffer has a min-content width of the whole buffer, which on a
        narrow screen is wider than the screen. See the same rule on the search
        screen's root for the mechanism. */
    <div className="grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_1fr_auto_auto]">
      <div className="relative px-6 pt-[max(1rem,var(--spacing-safe-top))] pb-2 text-center">
        <button
          type="button"
          tabIndex={-1}
          {...tap(() => onBack())}
          className="absolute top-[max(0.75rem,var(--spacing-safe-top))] left-4 h-12 rounded-lg px-3 text-base text-ink-400 active:bg-ink-800"
        >
          ← Back
        </button>
        <div className="text-lg font-semibold text-ink-200">
          Who else is with {student.firstName}?
        </div>
        <div className="text-sm text-ink-500">Type their first or last name.</div>
      </div>

      {/*
        "Child's name", not "brother or sister's". The relationship is the
        kiosk's guess, and this screen exists for everyone that guess gets wrong
        — a cousin, a neighbour's boy who came in the same car, a child on a
        different number. Naming a relationship the parent may not have would
        make them hesitate over a box that does not care: it searches the roster
        by name and nothing else. The button that opens this screen dropped its
        noun for the same reason.
      */}
      <div className="px-6 pb-2">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-center rounded-xl bg-ink-900 px-4">
          {buffer ? (
            <span className="truncate text-3xl font-semibold tracking-wide text-ink-50">
              {buffer}
            </span>
          ) : (
            <span className="text-xl text-ink-500">Child&rsquo;s name</span>
          )}
        </div>
      </div>

      <div
        ref={resultsRef}
        className="min-h-0 overflow-y-auto overscroll-contain scroll-touch px-6"
        style={{ touchAction: 'pan-y' }}
      >
        <div className="mx-auto flex max-w-2xl flex-col gap-2 pb-2">
          {buffer.length > 0 && results.length === 0 && (
            <div className="pt-6 text-center text-lg text-ink-400">
              No match — are they new?
            </div>
          )}
          {results.slice(0, MAX_RESULTS).map((found) => {
            /*
             * A child already checked in is shown and inert, not hidden.
             * "Where is Ada?" is a question this screen has to answer, and an
             * absent row answers it with "we have never heard of her".
             */
            const present = presentIds.has(found.id);
            return (
              <button
                key={found.id}
                type="button"
                tabIndex={-1}
                disabled={present}
                {...(present ? {} : rowTap(found))}
                className={`flex h-16 shrink-0 items-center justify-between rounded-xl px-5 text-left ${
                  present ? 'bg-present-600/20' : 'bg-ink-900 active:bg-ink-700'
                }`}
              >
                <span className="truncate text-xl font-semibold text-ink-100">
                  {found.firstName} {found.lastName}
                </span>
                <span className="pl-3 text-base whitespace-nowrap text-ink-400">
                  {present ? (
                    <span className="font-semibold text-present-400">✓ Checked in</span>
                  ) : found.grade === null ? (
                    ''
                  ) : (
                    gradeDescription(found.grade)
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/*
        The second reading of the same question, and the reason this screen is
        not just a search: a child who is not on the roster is not a failed
        search, they are a registration. Standing offer, fixed height, so it is
        there before the parent has typed anything to fail with.
      */}
      <div className="flex h-14 items-center justify-center px-6 pb-1">
        <button
          type="button"
          tabIndex={-1}
          {...tap(() => {
            haptic(8);
            onRegister();
          })}
          className="flex h-12 items-center justify-center rounded-xl bg-brand-600/15 px-6 text-base font-semibold text-brand-300 ring-1 ring-brand-500/40 active:bg-brand-600/30"
        >
          Not on the list? Add a new child
        </button>
      </div>

      <Keyboard onKey={onKey} />
    </div>
  );
}
