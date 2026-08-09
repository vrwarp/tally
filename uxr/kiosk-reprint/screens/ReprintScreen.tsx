/**
 * Find a child, print their name tag again. The staff half of the search screen.
 *
 * It is the search screen because the search screen is the thing on this device
 * that already answers "which child" — same fixed geometry, same rows, same
 * keyboard, same promise that a keystroke changes text and never geometry. A
 * second way to find a name would be a second way to get it wrong.
 *
 * What is different is everything about who is standing there. A volunteer, not
 * a parent; one child they can already name, not a family they are checking in;
 * and a kiosk that is still bound, still holding its queue, and has to go back
 * to being a parent's screen the moment they walk away.
 *
 * So: the parent's doors are gone (nobody registers a child from here), the
 * surface says whose screen this is, and the way out is standing in the console
 * where the register offer used to be — the one row on this layout that is
 * always present and never moves.
 */
import { useEffect, useRef } from 'react';
import { gradeDescription, haptic } from '@/lib/utils';
import { Keyboard, type KioskKey } from '@/kiosk/components/Keyboard';
import { useTapGuard } from '@/kiosk/components/tapGuard';
import type { KioskStudent } from '@/kiosk/search';

export interface ReprintOutcome {
  results: readonly KioskStudent[];
  total: number;
}

function gradeLabel(grade: number | null): string {
  return grade === null ? '' : gradeDescription(grade);
}

export function ReprintScreen({
  buffer,
  outcome,
  presentIds,
  sent,
  onKey,
  onPick,
  onDone,
}: {
  buffer: string;
  outcome: ReprintOutcome;
  /** Checked in tonight — context, never a gate: staff may reprint anybody. */
  presentIds: ReadonlySet<string>;
  /** The last name tag sent to the printer, for the line that says so. */
  sent: string | null;
  onKey: (key: KioskKey) => void;
  onPick: (student: KioskStudent) => void;
  onDone: () => void;
}) {
  const rowTap = useTapGuard(onPick);
  const resultsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (resultsRef.current) resultsRef.current.scrollTop = 0;
  }, [buffer]);

  const rows = outcome.results.length > 0;
  const truncated = outcome.total > outcome.results.length;
  const wraps = outcome.results.length >= 4;

  return (
    <div className="grid h-full grid-rows-[auto_1fr_auto_auto_auto_auto]">
      {/*
        * Whose screen this is, said in the place the gathering's name usually
        * is. A staff surface that looked like the parent's surface would be a
        * kiosk a family walks up to and starts typing into while a volunteer's
        * reprint list is on the glass.
        */}
      <div className="px-6 pt-[max(1rem,var(--spacing-safe-top))] pb-2 text-center">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-center gap-3 rounded-xl bg-brand-600/15 px-4 py-2 ring-1 ring-brand-500/40 lg:max-w-5xl">
          <span className="text-base font-semibold text-brand-300 kiosk:text-lg">
            Staff · reprint a name tag
          </span>
        </div>
        <div className="pt-2 text-base text-ink-500 kiosk:text-lg">
          {sent ? (
            <span className="text-present-400">Name tag sent for {sent}.</span>
          ) : (
            'Nobody is checked in or out from this screen.'
          )}
        </div>
      </div>

      <div
        ref={resultsRef}
        className={`mb-4 flex min-h-0 flex-col overflow-y-auto overscroll-contain scroll-touch px-6 ${
          rows ? 'kiosk-list-fade' : ''
        }`}
        style={{ touchAction: 'pan-y' }}
      >
        <div
          className={`mx-auto w-full max-w-2xl ${!rows ? 'pb-6' : truncated ? 'pb-2' : ''} ${
            rows && !truncated ? 'pb-16 tall:pb-20' : ''
          } flex flex-col gap-2 ${wraps ? 'lg:block lg:columns-2 lg:gap-x-8 lg:max-w-5xl' : ''}`}
        >
          {!rows && (
            <div className="pt-6 text-center">
              <div className="text-2xl font-semibold text-ink-200 kiosk:text-3xl">
                Type the child&apos;s name
              </div>
              <p className="mx-auto max-w-md pt-3 text-lg text-ink-400 kiosk:text-xl">
                Tap a name and a second copy of their name tag prints. Nothing about the register
                changes.
              </p>
            </div>
          )}

          {outcome.results.map((student) => {
            const present = presentIds.has(student.id);
            return (
              <button
                key={student.id}
                type="button"
                tabIndex={-1}
                {...rowTap(student)}
                className="flex h-16 w-full shrink-0 items-center justify-between rounded-xl bg-ink-800 px-5 text-left active:bg-ink-600 tall:h-20 lg:break-inside-avoid lg:not-first:mt-2 lg:w-full"
              >
                <span className="min-w-0 truncate text-xl font-semibold text-ink-100 kiosk:text-2xl">
                  {student.firstName} {student.lastName}
                </span>
                <span className="flex shrink-0 items-center gap-3 pl-3">
                  <span className="text-base whitespace-nowrap text-ink-400 kiosk:text-lg">
                    {present ? (
                      <span className="font-semibold text-present-400">✓ Checked in</span>
                    ) : (
                      gradeLabel(student.grade)
                    )}
                  </span>
                  <span className="rounded-lg bg-brand-600/20 px-3 py-1 text-sm font-semibold text-brand-300 ring-1 ring-brand-500/40 kiosk:text-base">
                    Print
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {truncated && (
          <div className="mx-auto w-full max-w-2xl pt-2 pb-16 text-center text-base text-ink-400 kiosk:text-lg tall:pb-20 lg:max-w-5xl">
            More names than fit — keep typing.
          </div>
        )}
      </div>

      <div className="border-t border-ink-800/70" />

      {/* The console row the parent's screen fills with the register offer.
          Here it is the way out, in the same fixed height, so the two screens
          are the same object with one control swapped. */}
      <div className="mx-auto flex h-14 w-full max-w-2xl items-center justify-center px-2 pt-2 tall:h-20 lg:max-w-5xl">
        <button
          type="button"
          tabIndex={-1}
          onPointerDown={() => {
            haptic(8);
            onDone();
          }}
          className="flex h-11 min-w-0 shrink items-center justify-center truncate rounded-xl bg-ink-800 px-5 text-sm font-semibold whitespace-nowrap text-ink-200 active:bg-ink-700 tall:h-14 tall:px-6 kiosk:text-base"
        >
          Done — back to check-in
        </button>
      </div>

      <div className="px-6 pb-1">
        <div className="relative mx-auto flex h-16 max-w-2xl items-center justify-center text-center tall:h-20 lg:max-w-5xl">
          {buffer && (
            <span className="truncate text-3xl font-semibold tracking-wide text-ink-50 kiosk:text-4xl">
              {buffer}
            </span>
          )}
          {outcome.total > 0 && (
            <span className="absolute right-0 text-sm text-ink-400 kiosk:text-base">
              {outcome.total} {outcome.total === 1 ? 'name' : 'names'}
            </span>
          )}
        </div>
      </div>

      <Keyboard onKey={onKey} />
    </div>
  );
}
