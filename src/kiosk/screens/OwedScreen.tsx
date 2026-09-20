/**
 * The name tags the printer owes, offered in one press.
 *
 * `ConfirmScreen`'s grammar, because it is the same kind of act: a fact read
 * back at the top of a flexible track, a committing button a constant distance
 * up from the bezel, and the way out below it. A volunteer who arrives here
 * from three different doors — the printer screen, the staff menu, the notice
 * on the front door — should meet the screen they already know.
 *
 * ## One press settles the whole question
 *
 * The commit prints the ticked rows and lets the rest go, and the line above it
 * says so. The first draft had a separate **Skip** beside it, and the finding
 * that removed it is worth keeping written down: a volunteer who printed three
 * of nine and walked away had settled nothing — the dot was still lit, the
 * staff menu still said nine were waiting, and the next person was asked the
 * same question about children somebody had already decided against. So there
 * is one control, its face carries the count it will print, and where nothing
 * is ticked that face reads *Skip*. Only **← Back** leaves the question open.
 *
 * ## The ticks follow evidence, and the evidence differs by gathering
 *
 * Which rows arrive ticked is `owed.ts`'s question, not this screen's. What
 * this screen does is show the working: on a gathering that hands children
 * back there is one group, *In the room*, because the register says who is
 * still in it; where nobody is checked out the clock stands in for that, so
 * the rows split into the ten minutes a parent might still be in the lobby and
 * everything earlier, which arrives unticked. The heading of each group is its
 * own all-or-none control — a full-width row with its mark in the column the
 * rows use — because the leader back from a walk with nine check-ins is making
 * one decision, not nine.
 *
 * ## What it never does
 *
 * Nothing here touches the register, and the line above the commit says so.
 * That is the same promise the reprint screens make, and it is the reason this
 * screen is allowed to exist at all.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { haptic } from '@/lib/utils';
import { StaffMark } from '../components/StaffMark';
import { useTap, useTapGuard } from '../components/tapGuard';
import { useTranslations } from 'use-intl';

/** One child on the list, with everything already in words. */
export interface OwedConfirmRow {
  studentId: string;
  name: string;
  /** "2nd grade", or empty for a child too young for one. */
  gradeLabel: string;
  /** When this kiosk checked them in — "9:12", the kiosk's own clock format. */
  atLabel: string;
  /** Registered at this kiosk tonight: the room has never seen this child. */
  isNew: boolean;
}

/** Which heading a group of rows carries. See the note above. */
export type OwedGroupKey = 'room' | 'recent' | 'earlier';

export interface OwedGroup {
  key: OwedGroupKey;
  rows: readonly OwedConfirmRow[];
}

/**
 * A row's height and the gap under it — `ConfirmScreen`'s own pitch.
 *
 * The same numbers as the sibling list on the parent's confirm, deliberately:
 * a volunteer and a parent are reading the same kind of list at the same
 * distance, and a staff screen with its own row height would be a second
 * answer to a question this kiosk settled once.
 */
const ROW_HEIGHT = 64;
const ROW_GAP = 8;
const ROW_PITCH = ROW_HEIGHT + ROW_GAP;
/** A group heading, which is also its all-or-none control. */
const HEAD_HEIGHT = 48;
const HEAD_PITCH = HEAD_HEIGHT + ROW_GAP;

/**
 * How many rows fit, counting the headings as the fixed cost they are.
 *
 * Measured rather than counted, and quantised to the pitch, for the reason
 * `ConfirmScreen` gives about its own list: a row is either printed or hidden,
 * and half a child at half value is the one state this screen cannot render.
 * A count would be right until a heading wrapped, a group vanished or the
 * glass changed shape; this is right at every size, and what it leaves over is
 * a positive line saying how many are below rather than a torn row.
 */
export function rowsThatFit(height: number, groups: readonly OwedGroup[]): number {
  let left = height;
  let fits = 0;
  for (const group of groups) {
    if (group.rows.length === 0) continue;
    left -= HEAD_PITCH;
    for (const _row of group.rows) {
      if (left < ROW_HEIGHT) return atLeastOne(fits, groups);
      left -= ROW_PITCH;
      fits += 1;
    }
  }
  return fits;
}

/**
 * A screen with rows to show always shows one.
 *
 * `ConfirmScreen` clamps its own count the same way, and for a harder reason
 * than tidiness: a measurement can come back as zero — a track that has not
 * been laid out yet, a browser mid-rotation — and a screen reading "5 name
 * tags did not print" above nothing but "5 more below" is a volunteer asked
 * to authorise a batch they cannot see. One row over-running its track is a
 * worse layout and a better screen.
 */
function atLeastOne(fits: number, groups: readonly OwedGroup[]): number {
  if (fits > 0) return fits;
  return groups.some((group) => group.rows.length > 0) ? 1 : 0;
}

/** What a group's mark says about the column under it. */
function markOf(rows: readonly OwedConfirmRow[], ticked: ReadonlySet<string>): 'all' | 'some' | 'none' {
  const on = rows.filter((row) => ticked.has(row.studentId)).length;
  if (on === 0) return 'none';
  return on === rows.length ? 'all' : 'some';
}

export function OwedScreen({
  groups,
  ticked,
  onToggleRow,
  onToggleGroup,
  onCommit,
  onBack,
}: {
  /** The offered rows, grouped and in arrival order — see `owed.ts`. */
  groups: readonly OwedGroup[];
  /** Whose tag this press will print. Held by the caller, like the confirm's. */
  ticked: ReadonlySet<string>;
  onToggleRow: (studentId: string) => void;
  /**
   * The heading pressed: every row in the group on, or every row off.
   *
   * To *all* unless the group is already all on, which is the useful direction
   * — the leader back from the walk is ticking six rows, not unticking one.
   */
  onToggleGroup: (key: OwedGroupKey) => void;
  /** Print the ticked rows and let the rest go. Both halves, one press. */
  onCommit: (printing: readonly string[], skipping: readonly string[]) => void;
  onBack: () => void;
}) {
  const t = useTranslations('Staff');
  const tConfirm = useTranslations('Confirm');
  const rowTap = useTapGuard(onToggleRow);
  const headTap = useTapGuard(onToggleGroup);
  const tap = useTap();

  const all = groups.flatMap((group) => group.rows);
  const printing = all.filter((row) => ticked.has(row.studentId)).map((row) => row.studentId);
  const skipping = all.filter((row) => !ticked.has(row.studentId)).map((row) => row.studentId);

  /*
   * How much of the list is on the glass, measured — see `rowsThatFit`.
   *
   * `ConfirmScreen` guards the same effect the same way: jsdom has no
   * `ResizeObserver`, and a kiosk that measured once at mount is still right,
   * because the glass does not resize.
   */
  const listRef = useRef<HTMLDivElement>(null);
  const [visibleRows, setVisibleRows] = useState(all.length);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => setVisibleRows(rowsThatFit(list.clientHeight + ROW_GAP, groups));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
    // The groups' shape is what the measurement depends on: a heading costs
    // the track a row and a bit, so a group appearing or emptying re-measures.
  }, [groups]);
  const hidden = Math.max(0, all.length - visibleRows);

  /* Which rows are actually drawn, in order, with their headings. */
  let drawn = 0;
  const shown = groups
    .map((group) => {
      const room = Math.max(0, visibleRows - drawn);
      const rows = group.rows.slice(0, room);
      drawn += rows.length;
      return { ...group, rows };
    })
    .filter((group) => group.rows.length > 0);

  return (
    <div
      className="grid h-full w-full grid-rows-[minmax(0,1fr)_auto_auto] justify-center justify-items-center p-8 pb-[max(2rem,18vh)] text-center"
      style={{ gridTemplateColumns: 'minmax(0, var(--confirm-measure, 28rem))' }}
    >
      {/* The flexible track, bottom-aligned against the commit — the whole of
          why this shape was kept over one that lays the list from the top: the
          question and its answer stay one object at every length of list. */}
      <div className="flex min-h-0 w-full flex-col items-center justify-end pb-12">
        <div className="w-full shrink-0 pb-4">
          <StaffMark label="staffPrint" />
        </div>

        {/* The fact, and nothing under it. An earlier draft asked "Print them
            now?" here, which is the question the button at the foot both asks
            and answers. */}
        <div className="w-full shrink-0 text-3xl font-bold text-ink-50 kiosk:text-4xl">
          {t('owedTitle', { count: all.length })}
        </div>

        <div ref={listRef} className="mt-7 flex min-h-0 w-full flex-col gap-2 overflow-hidden">
          {shown.map((group) => {
            const mark = markOf(group.rows, ticked);
            /*
             * A group of one draws no mark: its row's own tick already is the
             * all-or-none control, and a second target twelve pixels away for
             * the same decision is a second way to get it wrong.
             */
            const toggles = group.rows.length > 1;
            return (
              <div key={group.key} className="flex shrink-0 flex-col gap-2">
                <button
                  type="button"
                  tabIndex={-1}
                  aria-pressed={toggles ? mark === 'all' : undefined}
                  {...(toggles ? headTap(group.key) : {})}
                  className="flex h-12 w-full shrink-0 items-center justify-between gap-3 rounded-xl px-5 text-left"
                >
                  <span className="min-w-0 truncate text-xl font-semibold text-ink-300">
                    {t(
                      group.key === 'room'
                        ? 'owedInTheRoom'
                        : group.key === 'recent'
                          ? 'owedRecent'
                          : 'owedEarlier',
                    )}
                    {group.rows.length > 1 && (
                      <span className="font-normal text-ink-400">{` · ${group.rows.length}`}</span>
                    )}
                  </span>
                  {toggles && (
                    /*
                     * The mark sits in the rows' own tick column, so "all of
                     * these" reads down the column it governs. Three drawings
                     * for three states: a group half ticked that showed a full
                     * mark would be telling the volunteer something the column
                     * under it contradicts.
                     */
                    <span
                      className={`ml-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xl ${
                        mark === 'all'
                          ? 'bg-brand-600/55 text-ink-50'
                          : mark === 'some'
                            ? 'border-2 border-ink-600 text-ink-300'
                            : 'border-2 border-ink-600 text-transparent'
                      }`}
                    >
                      {mark === 'some' ? '–' : '✓'}
                    </span>
                  )}
                </button>

                {group.rows.map((row) => {
                  const on = ticked.has(row.studentId);
                  return (
                    <button
                      key={row.studentId}
                      type="button"
                      tabIndex={-1}
                      aria-pressed={on}
                      {...rowTap(row.studentId)}
                      /*
                       * Unticked keeps the name's own ink and empties the tick,
                       * which is `ConfirmScreen`'s treatment for a *guess* —
                       * "same row, same weight, empty tick". The other one it
                       * has, receding the whole row, is for a claim the
                       * register makes; nothing here claims anything about a
                       * child, it only says the kiosk would not print by
                       * default.
                       */
                      className={`flex h-16 w-full shrink-0 items-center justify-between rounded-xl px-5 text-left ${
                        on ? 'bg-ink-800' : 'bg-ink-900'
                      }`}
                    >
                      <span className="flex min-w-0 flex-col justify-center">
                        <span className="flex min-w-0 items-center gap-3">
                          <span className="truncate text-xl font-semibold text-ink-100">
                            {row.name}
                          </span>
                          {row.isNew && (
                            /* The one row a room cannot do without: nobody
                               there has met this child, so their tag is the
                               one worth walking to the door first. Marked by
                               ink rather than by the accent the ticks spend,
                               so a fact about the child is not read as a
                               second state chip. */
                            <span className="shrink-0 rounded-lg bg-ink-700 px-3 py-1 text-sm font-semibold whitespace-nowrap text-ink-100 kiosk:text-base">
                              {t('owedNewTonight')}
                            </span>
                          )}
                        </span>
                        <span className="truncate text-lg text-ink-400">
                          {row.gradeLabel ? (
                            <>
                              <span className="text-ink-200">{row.gradeLabel}</span>
                              {' · '}
                            </>
                          ) : null}
                          {row.atLabel}
                        </span>
                      </span>
                      <span
                        className={`ml-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xl ${
                          on ? 'bg-brand-600/55 text-ink-50' : 'border-2 border-ink-600 text-transparent'
                        }`}
                      >
                        ✓
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* What the list is hiding, said as a positive count rather than by
            fading a row somebody cannot then read. `ConfirmScreen`'s line, in
            its own words, for the same reason. */}
        {hidden > 0 && (
          <div className="w-full shrink-0 pt-2 text-left text-xl text-brand-300">
            {tConfirm('moreBelow', { count: hidden })}
          </div>
        )}
      </div>

      {/* The cost of the press, in the band the confirm family keeps above its
          commit: what happens to the rows that are *not* ticked, which is the
          half of a one-press settlement nobody would otherwise expect. */}
      <div className="w-full shrink-0">
        <div className="pb-3 text-lg text-ink-400 kiosk:text-xl">
          {skipping.length > 0 && printing.length > 0
            ? t('owedCost', { count: skipping.length })
            : t('reprintNoRegisterChange')}
        </div>
        <button
          type="button"
          tabIndex={-1}
          {...tap(() => {
            haptic();
            onCommit(printing, skipping);
          })}
          className="w-full rounded-2xl bg-brand-600 p-7 text-2xl font-bold text-white active:bg-brand-500 kiosk:text-3xl"
          style={{ touchAction: 'manipulation' }}
        >
          {printing.length > 0
            ? t('owedPrint', { count: printing.length })
            : t('owedSkip', { count: skipping.length })}
        </button>
      </div>

      <button
        type="button"
        tabIndex={-1}
        {...tap(() => onBack())}
        className="mt-8 shrink-0 rounded-xl px-8 py-4 text-xl text-ink-400 active:bg-ink-800"
        style={{ touchAction: 'manipulation' }}
      >
        {t('back')}
      </button>
    </div>
  );
}
