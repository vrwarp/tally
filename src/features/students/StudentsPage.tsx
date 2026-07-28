/**
 * The full roster, for the core team.
 *
 * Two audiences share this screen: someone looking up one student ("what is
 * Marcus's mum's number?") and someone working a list ("who still has no parent
 * contact?"). Search serves the first; the two quick-filter chips serve the
 * second, because those are the only two lists the core team actually works.
 *
 * Filtering is a synchronous pass over the roster that is already in memory from
 * the shared snapshot, so there is no virtualisation and no debounce — just a
 * memoised filter and plain rows.
 *
 * Everything a row says is drawn from that same snapshot: last seen, the note
 * somebody typed, the allergy flag, the birthday. Nothing on this list waits on
 * a fetch, which is what lets eighty-five rows appear at once and stay honest
 * while somebody types. The reads that *are* expensive — a medical note, a
 * parent's phone number — happen for one student, when a badge is pressed. See
 * `RowBadgeModal`.
 */
import { memo, useCallback, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  SelectField,
  SkeletonRows,
  TextField,
  WarningBadge,
} from '@/components/ui';
import { PageFrame } from '@/components/PageFrame';
import { RosterErrorBanner } from '@/components/RosterErrorBanner';
import { useAuth } from '@/context/authContext';
import { useData } from '@/context/dataContext';
import { useParentContact } from '@/hooks/useParentContact';
import { isUnreachable } from '@/features/dashboard/insights';
import { AddFromPlanningCenterModal } from '@/features/students/AddFromPlanningCenterModal';
import { RowBadgeModal, type RowBadgeAction } from '@/features/students/RowBadgeModal';
import { StudentEditorModal } from '@/features/students/StudentEditorModal';
import {
  birthdayState,
  formatBirthdayLong,
  formatBirthdayShort,
  type BirthdayState,
} from '@/lib/birthday';
import { formatSeenShort } from '@/lib/time';
import { cn, createSearchMatcher, initials, ordinalGrade } from '@/lib/utils';
import { GRADES, type Grade, type Student } from '@/types';

type StatusFilter = 'active' | 'inactive' | 'all';
type QuickFilter = 'none' | 'incomplete' | 'visitors';

export function StudentsPage() {
  const { students, loading, rosterError, refreshRoster } = useData();
  const { user } = useAuth();

  const [query, setQuery] = useState('');
  const [grade, setGrade] = useState<Grade | null>(null);
  // Inactive students are history, not roster: the default view hides them.
  const [status, setStatus] = useState<StatusFilter>('active');
  const [quick, setQuick] = useState<QuickFilter>('none');
  const [editorOpen, setEditorOpen] = useState(false);
  const [addFromPcoOpen, setAddFromPcoOpen] = useState(false);
  /** Which badge on which row is open. See `RowBadgeModal`. */
  const [badge, setBadge] = useState<{ student: Student; action: RowBadgeAction } | null>(null);

  /*
   * Today, decided once.
   *
   * The birthday badges need to know what day it is, and reading the clock
   * inside a row would hand every row a new value on every keystroke in the
   * search box — which defeats the memo the rows exist behind. One date, held
   * for as long as the screen is open, and every row agrees what "this week"
   * means.
   */
  const now = useMemo(() => new Date(), []);

  /** Stable, so a row's props do not change identity as the list re-renders. */
  const openBadge = useCallback((student: Student, action: RowBadgeAction) => {
    setBadge({ student, action });
  }, []);

  /** Whoever is already here, so the Planning Center search can say so. */
  const rosterIds = useMemo(() => new Set(students.map((student) => student.id)), [students]);

  /*
   * Who has nobody to ring is Planning Center's answer, not the roster's, and
   * this screen asks the same question the insights screen does — through the
   * same session-held read, so opening one after the other costs nothing.
   *
   * It used to filter on `profileComplete === false` alone. That flag is `null`
   * on every student a roster read did not hydrate, so the chip counted only
   * Tally's own quick-adds and disagreed with the dashboard tile beside it in
   * the sidebar: seven there, five here, same three words.
   */
  const { reachable } = useParentContact();

  const visible = useMemo(() => {
    const matcher = createSearchMatcher(query);
    return students.filter((student) => {
      if (status !== 'all' && student.status !== status) return false;
      if (grade !== null && student.grade !== grade) return false;
      if (quick === 'incomplete' && !isUnreachable(student, reachable)) return false;
      if (quick === 'visitors' && !student.isVisitor) return false;
      if (!matcher.matches(student.searchName)) return false;
      return true;
    });
  }, [students, status, grade, quick, query, reachable]);

  const incompleteCount = useMemo(
    () => students.filter((student) => isUnreachable(student, reachable)).length,
    [students, reachable],
  );
  const visitorCount = useMemo(
    () => students.filter((student) => student.status === 'active' && student.isVisitor).length,
    [students],
  );

  const isFiltered =
    query.trim().length > 0 || grade !== null || quick !== 'none' || status !== 'active';

  const clearFilters = () => {
    setQuery('');
    setGrade(null);
    setStatus('active');
    setQuick('none');
  };

  return (
    <PageFrame width="2xl">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink-50">Students</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            <span className="tabular-nums">{visible.length}</span>
            {visible.length === students.length ? ' students' : ` of ${students.length}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {/*
            Two ways onto the roster, weekly first.

            Both are quiet now. The import used to be the only brand-filled
            thing on the screen — the loudest, widest object on a page whose job
            is finding one student among forty-five, for an administrative act
            somebody does twice a year. What this page is actually for is
            search, and search is an input rather than a button; at `lg` it
            takes the top line of the toolbar to itself.
          */}
          <Button variant="secondary" onClick={() => setEditorOpen(true)}>
            New visitor
          </Button>
          <Button variant="secondary" onClick={() => setAddFromPcoOpen(true)}>
            Add from Planning Center
          </Button>
        </div>
      </header>

      <RosterErrorBanner />

      {/* One toolbar row where there is a pointer. Stacked, the search field,
          the two selects and the two chips terminated at three different right
          edges — three controls dropped in at their natural widths rather than
          a set — and cost a row and a half of students. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:gap-4">
        <div className="lg:flex-1">
          <TextField
            label="Search"
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Name…"
            value={query}
            onChange={(changed) => setQuery(changed.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:w-[28rem] lg:shrink-0 lg:grid-cols-2">
          <SelectField
            label="Grade"
            value={grade ?? ''}
            onChange={(changed) =>
              setGrade(changed.target.value ? (Number(changed.target.value) as Grade) : null)
            }
          >
            <option value="">All grades</option>
            {GRADES.map((value) => (
              <option key={value} value={value}>
                {ordinalGrade(value)}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Status"
            value={status}
            onChange={(changed) => setStatus(changed.target.value as StatusFilter)}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">Everyone</option>
          </SelectField>
        </div>

        <div role="group" aria-label="Quick filters" className="flex flex-wrap gap-2 lg:shrink-0">
          <FilterChip
            active={quick === 'incomplete'}
            onPress={() => setQuick((current) => (current === 'incomplete' ? 'none' : 'incomplete'))}
          >
            Incomplete profiles
            <ChipCount active={quick === 'incomplete'}>{incompleteCount}</ChipCount>
          </FilterChip>
          <FilterChip
            active={quick === 'visitors'}
            onPress={() => setQuick((current) => (current === 'visitors' ? 'none' : 'visitors'))}
          >
            Visitors
            <ChipCount active={quick === 'visitors'}>{visitorCount}</ChipCount>
          </FilterChip>
          {isFiltered ? (
            <button
              type="button"
              onClick={clearFilters}
              className="min-h-11 rounded-full px-3 text-xs font-semibold text-ink-400 underline underline-offset-4 hover:text-ink-100"
            >
              Clear filters
            </button>
          ) : null}
        </div>
      </div>

      <Card>
        {loading && students.length === 0 ? (
          <SkeletonRows count={8} />
        ) : visible.length === 0 ? (
          /*
            Three different nothings, and only one of them is "add a student".
            An empty list because Planning Center could not be read used to
            offer the button that had just failed, under a sentence saying the
            roster was empty — which it was not.
          */
          rosterError ? (
            <EmptyState
              icon="⚠️"
              title="The roster could not be read."
              description="Whoever is on it is still on it — Tally needs Planning Center to put names to them. The banner above has the details."
              action={
                <Button variant="secondary" onClick={() => void refreshRoster(true)}>
                  Try again
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon="🔍"
              title={isFiltered ? 'Nobody matches those filters.' : 'No students on the roster yet.'}
              description={
                isFiltered
                  ? 'Widen the search, or add the student if this is their first time.'
                  : 'Students arrive from the Planning Center sync, or you can add one by hand.'
              }
              action={
                isFiltered ? (
                  <Button variant="secondary" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : (
                  <Button onClick={() => setAddFromPcoOpen(true)}>Add from Planning Center</Button>
                )
              }
            />
          )
        ) : (
          <ul className="divide-y divide-ink-800">
            {visible.map((student) => (
              <StudentListRow
                key={student.id}
                student={student}
                unreachable={isUnreachable(student, reachable)}
                now={now}
                onBadge={openBadge}
              />
            ))}
          </ul>
        )}
      </Card>

      {badge ? (
        <RowBadgeModal
          student={badge.student}
          action={badge.action}
          now={now}
          onClose={() => setBadge(null)}
        />
      ) : null}

      {user ? (
        <StudentEditorModal open={editorOpen} onClose={() => setEditorOpen(false)} />
      ) : null}

      <AddFromPlanningCenterModal
        open={addFromPcoOpen}
        onClose={() => {
          setAddFromPcoOpen(false);
          // The modal refreshes after each add, but a read that failed on the
          // way out would otherwise leave the list a student short with no way
          // to notice short of a reload.
          void refreshRoster(true);
        }}
        onRoster={rosterIds}
      />
    </PageFrame>
  );
}

function FilterChip({
  active,
  onPress,
  children,
}: {
  active: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-pressed={active}
      className={cn(
        'inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5',
        'text-xs font-semibold ring-1 transition-colors pointer-fine:min-h-9',
        active
          ? 'bg-brand-500/20 text-brand-200 ring-brand-500/40'
          : 'bg-ink-900 text-ink-400 ring-ink-800 hover:bg-ink-800',
      )}
    >
      {children}
    </button>
  );
}

/**
 * A count beside a chip's label, in the form the rest of the app uses — the
 * roster's "Recent 24", the dashboard's "Missing in action 10". These two chips
 * printed theirs in parentheses inside the label, which buried the number in a
 * run of 12px text and made two screens describe the same quantity two ways.
 */
function ChipCount({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        'rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
        active ? 'bg-brand-500/25 text-brand-100' : 'bg-ink-800 text-ink-400',
      )}
    >
      {children}
    </span>
  );
}

/** Memoised so retyping in the search box only re-renders the rows that change. */
const StudentListRow = memo(function StudentListRow({
  student,
  unreachable,
  now,
  onBadge,
}: {
  student: Student;
  /** Passed in rather than read here, so the row and the chip count agree. */
  unreachable: boolean;
  /** Today, decided once by the page. See the note where it is built. */
  now: Date;
  onBadge: (student: Student, action: RowBadgeAction) => void;
}) {
  const name = `${student.firstName} ${student.lastName}`;
  const birthday = birthdayState(student.birthday, now);

  return (
    /*
      Two rows, not one row at two heights.

      On a phone this is a 64px card with the grade on a second line, because a
      thumb needs the target. On a laptop the same facts become columns on a
      44px line — sixteen names above the fold instead of nine — which is the
      responsive difference the two audiences actually need rather than a
      compromise height that serves neither.

      The wide layout is where the spare width is, and it is where the two
      desktop-only columns live: a name renders at 120–250px against a 1192px
      row, so a fully elastic name column was sitting on some 650px of nothing
      on every row. Last seen takes 112px of it and the note takes what is left.

      ## Why the link is a layer rather than a wrapper

      The row used to *be* the `<Link>`. The badges are buttons now, and a
      button inside an anchor is not something a browser will lay out or a
      screen reader will describe — it is invalid, and the one that loses is
      whichever the parser decides. So the link is a transparent layer over the
      whole row, carrying the name for anybody navigating by link, and the
      badges sit above it. Pressing anywhere else still opens the student, which
      is what the row was always for.
    */
    <li className="relative flex min-h-16 items-center gap-3 px-3 py-2 hover:bg-ink-800/40 lg:min-h-11 lg:py-1">
      <Link
        to={`/students/${student.id}`}
        aria-label={`${name}, ${ordinalGrade(student.grade)} grade`}
        className="absolute inset-0 rounded-lg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-400"
      />

      <span
        aria-hidden="true"
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-ink-800 text-sm font-bold text-ink-300 lg:size-8 lg:text-xs"
      >
        {initials(student.firstName, student.lastName)}
      </span>

      <span className="min-w-0 flex-1 lg:flex lg:items-center lg:gap-4">
        {/*
          `block` is load-bearing, not tidiness.

          `truncate` is `overflow: hidden` plus `white-space: nowrap`, and
          overflow does not apply to a non-replaced *inline* box. Below `lg`
          this span's parent is not a flex container, so without `block` the
          name is inline: it refuses to wrap and is never clipped, and one
          student with a very long name pushes the whole page sideways —
          every other row's content off the right edge of a phone. It worked
          before only because the span used to be a flex item, which
          blockifies it.

          Pinned at `lg`, not elastic: the note beside it needs one left edge
          down the whole list, and a note that starts wherever a name happens to
          end is a column of ragged text nobody reads. This is what that costs —
          long names truncate sooner on a laptop than they used to.
        */}
        <span className="block min-w-0 truncate text-base text-ink-50 lg:w-48 lg:shrink-0">
          <span className="font-semibold">{student.firstName}</span>{' '}
          <span className="font-normal text-ink-300">{student.lastName}</span>
        </span>
        <NoteSnippet notes={student.notes} />
        <LastSeen at={student.lastAttendedAt} />
        {/*
          Badges annotate the row; they do not restructure it.

          Laid out as part of the name they inherited its variable width, so
          on a phone five rows in forty-five wrapped their badges to a second
          line and pushed the grade to a third — the one fact every row shares
          was the one whose position moved. On a laptop the same mistake put
          the no-contact flag at five different x positions, so the thing a
          leader came to find was a ragged mid-row scan rather than a column.

          `min-w-80` rather than a fixed width: the lane holds its column for
          the rows everybody has, and grows into the note's space on the rare
          row carrying four flags at once, instead of overflowing them back
          across the columns to its left.

          The grade sits at the lane's leading edge and the badges are pushed to
          its trailing edge by a spacer that takes the slack. Packed together
          against the right instead, the grade moved with the badge count — the
          one fact every row shares, at a different x on every row, which is the
          precise thing this lane was given a fixed width to stop.
        */}
        <span className="relative z-10 mt-0.5 flex items-center gap-2 text-xs text-ink-500 lg:mt-0 lg:min-w-80 lg:shrink-0">
          <span className="truncate lg:w-20 lg:shrink-0 lg:text-right">
            {ordinalGrade(student.grade)} grade
          </span>
          <span className="hidden lg:block lg:flex-1" />

          {student.isVisitor ? (
            <Badge
              tone="brand"
              title={`${student.firstName} is marked as a new visitor`}
              onPress={() => onBadge(student, 'visitor')}
              pressLabel={`${name} is marked as a visitor — change that`}
            >
              Visitor
            </Badge>
          ) : null}

          <BirthdayBadge
            state={birthday}
            student={student}
            now={now}
            onPress={() => onBadge(student, 'birthday')}
          />

          {/*
            Both of these go through `WarningBadge` rather than a hand-written
            `Badge`, which is the only thing keeping this row and the check-in
            row telling the same story.

            They had drifted. `warnings.ts` rules that amber means a physical
            consequence at the door and that an allergy is the only flag that
            earns it — the check-in row obeyed that, and this one still
            printed "Missing info" in amber, so one navigation apart the same
            student's missing phone number was a warning here and a neutral
            chip there. Reading the meaning off the shared table means the two
            screens can no longer disagree, and it is what makes it safe to
            put the allergy on this row at all: an amber that appears beside
            a clerical amber is an amber nobody reads.
          */}
          {student.hasAllergies ? (
            <WarningBadge
              warning="allergy"
              onPress={() => onBadge(student, 'allergy')}
              pressLabel={`Read what ${name} is allergic to`}
            />
          ) : null}
          {unreachable ? (
            <WarningBadge
              warning="incomplete-profile"
              onPress={() => onBadge(student, 'contact')}
              pressLabel={`Add a parent contact for ${name}`}
            />
          ) : null}
          {student.status === 'inactive' ? (
            <Badge
              tone="neutral"
              onPress={() => onBadge(student, 'inactive')}
              pressLabel={`${name} is inactive — put them back on the roster`}
            >
              Inactive
            </Badge>
          ) : null}
          <QueuedBadge
            pcoPersonId={student.pcoPersonId}
            onPress={() => onBadge(student, 'queued')}
            name={name}
          />
        </span>
      </span>

      <span aria-hidden="true" className="shrink-0 text-ink-600">
        ›
      </span>
    </li>
  );
});

/**
 * Whatever somebody typed about this student, at a glance.
 *
 * The only free-form thing on the model, and the only fact on the row that
 * genuinely wants a wide left-aligned space rather than a column. It is sparse
 * by nature — most students have none — which is exactly the shape a faded lane
 * needs: it costs nothing on the rows that are empty and it is the whole reason
 * a leader recognises the row on the ones that are not.
 *
 * A shade below everything else on the row on purpose. Notes are written to be
 * read on a detail page, and sixty characters of one can land differently out
 * of context, so this is set to read as annotation rather than as content —
 * the row's own facts stay the brighter thing.
 */
function NoteSnippet({ notes }: { notes: string | null }) {
  // Rendered even when empty. It is the only elastic thing left in the row now
  // that the name is pinned, so a row without a note that skipped it would pull
  // its last-seen column and its badges leftward and out of line with every
  // row that has one.
  return (
    <span
      title={notes ?? undefined}
      className="hidden min-w-0 flex-1 truncate text-xs text-ink-600 lg:block"
    >
      {notes}
    </span>
  );
}

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

/**
 * When this student was last at anything, in the width of a column.
 *
 * The fact that turns a directory into a roster. It is what the detail page
 * leads its attendance card with and what every missing-in-action row is built
 * from, and it was the one screen you would scan for it that did not have it.
 * It costs nothing to show: `lastAttendedAt` is merged onto every student when
 * the roster is assembled, so this is a read of memory the page already holds
 * rather than a fetch — which is what lets it sit on a list that promises a
 * synchronous filter and no spinners.
 *
 * Desktop only. The phone row is a 64px card whose second line is already
 * spoken for, and a date is not what a thumb came to that screen for.
 *
 * Nothing renders when nobody has seen them, rather than the word "Never".
 * Half a roster can be blank here in a ministry that adopted Tally this year,
 * and a column that is grey text on most of its rows is a column the eye
 * learns to skip — including on the rows that do say something. The blank
 * carries its own meaning anyway: on an *active* student it is not missing
 * data, it is the question somebody should be asking.
 */
function LastSeen({ at }: { at: Date | null }) {
  return (
    <span
      className={cn(
        'hidden shrink-0 text-xs tabular-nums lg:block lg:w-28 lg:text-right',
        // Dimmer once it is measured in months. The lane is for scanning, not
        // alarm: a stale date is less precise than a weekday and is set to read
        // that way, so the rows still worth landing on are the recent ones.
        at && Date.now() - at.getTime() >= THIRTY_DAYS ? 'text-ink-600' : 'text-ink-500',
      )}
    >
      {at ? formatSeenShort(at) : null}
    </span>
  );
}

/**
 * Cake, and the absence of a date to put it on.
 *
 * Two jobs in one badge, which is why it has four faces. Three of them are a
 * fortnight wide and say a birthday is about to happen, is happening, or has
 * just been missed — a ministry usually finds out three weeks late, from the
 * student. The fourth says nobody has ever filled the date in, which is the
 * kind of gap that is invisible until a list is willing to say it out loud.
 *
 * Green for the day itself, because it is the one piece of good news a roster
 * row ever carries and the only one worth interrupting a scan for. Sky for the
 * week ahead — something to plan. Grey for the week behind and for the blank,
 * because neither is urgent and a lane that shouts twice is a lane that is
 * ignored once. Amber is never used here: it belongs to the allergy.
 *
 * The date is spelled out rather than said in relative words. "🎂 9 Mar" beside
 * a row on the 14th is unmistakably behind, where "recently" and "soon" at
 * eleven pixels are two words a hurried eye reads as the same word.
 */
function BirthdayBadge({
  state,
  student,
  now,
  onPress,
}: {
  state: BirthdayState;
  student: Student;
  now: Date;
  onPress: () => void;
}) {
  if (state === 'quiet') return null;

  const name = student.firstName;

  if (state === 'missing') {
    /*
     * Not on a student Planning Center has never heard of.
     *
     * A quick-added visitor has no birthday for the same reason they have no
     * anything: their push has not landed. "Queued" already says that, and it
     * is the chip with the action on it — so this one would be a second way of
     * saying the same sentence, on precisely the rows that are already carrying
     * the most badges.
     */
    if (!student.pcoPersonId) return null;

    return (
      <Badge
        tone="neutral"
        title="Planning Center holds no birthdate for this student"
        onPress={onPress}
        pressLabel={`No birthday on file for ${name}`}
      >
        No birthday
      </Badge>
    );
  }

  const day = formatBirthdayShort(student.birthday, now);
  const spoken = formatBirthdayLong(student.birthday);

  const TITLES: Record<'today' | 'soon' | 'recent', string> = {
    today: `${name}'s birthday is today`,
    soon: `${name}'s birthday is on ${spoken}`,
    recent: `${name}'s birthday was on ${spoken}`,
  };

  return (
    <Badge
      tone={state === 'today' ? 'success' : state === 'soon' ? 'brand' : 'neutral'}
      title={TITLES[state]}
      onPress={onPress}
      pressLabel={TITLES[state]}
    >
      <span aria-hidden="true">🎂</span>
      <span aria-hidden="true">{state === 'today' ? 'Today' : day}</span>
    </Badge>
  );
}

/**
 * Marks the rare student who has no Planning Center person yet.
 *
 * There used to be a badge on every row saying which side a student came from,
 * which meant the common case — read from Planning Center, like almost everyone
 * — carried a mark of its own and the list said nothing. Only the exception is
 * worth a badge, and "Queued" names the state somebody can act on rather than
 * the collection the row happens to live in.
 *
 * Neutral, not warn: amber on this row belongs to the allergy alone, and a
 * visitor added ninety seconds ago is not a problem.
 */
function QueuedBadge({
  pcoPersonId,
  onPress,
  name,
}: {
  pcoPersonId: string | null;
  onPress: () => void;
  name: string;
}) {
  if (pcoPersonId) return null;

  return (
    <Badge
      tone="neutral"
      title="Waiting to be created in Planning Center"
      onPress={onPress}
      pressLabel={`${name} is not in Planning Center yet — push them now`}
    >
      Queued
    </Badge>
  );
}
