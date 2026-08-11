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
import { ExportCsvButton } from '@/components/ExportCsvButton';
import { PageFrame } from '@/components/PageFrame';
import { RosterErrorBanner } from '@/components/RosterErrorBanner';
import { useAuth } from '@/context/authContext';
import { useData } from '@/context/dataContext';
import { useParentContact } from '@/hooks/useParentContact';
import { isUnreachable } from '@/features/dashboard/insights';
import { AddFromPlanningCenterModal } from '@/features/students/AddFromPlanningCenterModal';
import { PartialRosterDialog } from '@/features/students/PartialRosterDialog';
import { buildRosterCsv } from '@/features/students/rosterCsv';
import { RowBadgeModal, type RowBadgeAction } from '@/features/students/RowBadgeModal';
import { StudentEditorModal } from '@/features/students/StudentEditorModal';
import { JobChip } from '@/features/students/JobChip';
import { describeFields } from '@/features/students/syncStripCopy';
import { latestByStudent } from '@/features/roster/pendingEdits';
import {
  birthdayState,
  formatBirthdayLong,
  formatBirthdayShort,
  type BirthdayState,
} from '@/lib/birthday';
import { exportFilename } from '@/lib/csv';
import { formatSeenShort } from '@/lib/time';
import {
  cn,
  createSearchMatcher,
  gradeName,
  gradeSentence,
  initials,
  NO_GRADE,
} from '@/lib/utils';
import {
  GRADES,
  backendLabelOf,
  backendOfStudent,
  isInFlight,
  needsAHuman,
  type Grade,
  type Student,
  type UpstreamEdit,
} from '@/types';

type StatusFilter = 'active' | 'inactive' | 'all';
type QuickFilter = 'none' | 'incomplete' | 'visitors' | 'inFlight' | 'needsYou';

export function StudentsPage() {
  const {
    students,
    loading,
    rosterError,
    refreshRoster,
    rosterBackends,
    rosterLoading,
    rosterSettled,
    upstreamEdits,
  } = useData();
  // With a second backend connected, "Planning Center" stops being the name
  // for where students come from — the buttons say the neutral thing instead.
  const multiBackend = rosterBackends.length >= 2;
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

  /*
   * The queue, keyed by student, so a row does not scan a list to draw a mark.
   *
   * `latestByStudent` keeps the newest job per student, which is the one a row
   * has room for. The counts below cut the same three ways the marks do —
   * running, needs-a-human, done — because a screen whose pills and whose marks
   * disagreed about which pile a row was in would be worse than either alone.
   */
  const editsByStudent = useMemo(() => latestByStudent(upstreamEdits), [upstreamEdits]);

  const inFlightCount = useMemo(
    () => [...editsByStudent.values()].filter(isInFlight).length,
    [editsByStudent],
  );
  const needsYouCount = useMemo(
    () => [...editsByStudent.values()].filter(needsAHuman).length,
    [editsByStudent],
  );

  const visible = useMemo(() => {
    const matcher = createSearchMatcher(query);
    return students.filter((student) => {
      if (status !== 'all' && student.status !== status) return false;
      // Somebody with no grade is in no grade. Asking for 6th graders and
      // getting the ministry's adult volunteers back is the same bug as
      // printing "6th grade" under their name.
      if (grade !== null && student.grade !== grade) return false;
      if (quick === 'incomplete' && !isUnreachable(student, reachable)) return false;
      if (quick === 'visitors' && !student.isVisitor) return false;
      if (quick === 'inFlight') {
        const edit = editsByStudent.get(student.id);
        if (!edit || !isInFlight(edit)) return false;
      }
      if (quick === 'needsYou') {
        const edit = editsByStudent.get(student.id);
        if (!edit || !needsAHuman(edit)) return false;
      }
      if (!matcher.matches(student.searchName)) return false;
      return true;
    });
  }, [students, status, grade, quick, query, reachable, editsByStudent]);

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

  /*
   * Whether this roster is fit to leave the app, in three tiers.
   *
   * A screen can be honest about a stale roster with a banner beside it; a file
   * cannot, because it gets forwarded. So the first read in flight disables the
   * control (nothing trustworthy to export yet), a failed read refuses outright
   * (`students` is a local copy of unknown age), and a single backend being down
   * is confirmed and then annotated — see `PartialRosterDialog`.
   */
  const backendsDown = useMemo(
    () => rosterBackends.filter((backend) => !backend.ok),
    [rosterBackends],
  );
  const unresolved = useMemo(
    () => rosterBackends.reduce((total, backend) => total + (backend.unresolved ?? 0), 0),
    [rosterBackends],
  );

  const exportBlockedReason = !rosterSettled
    ? 'Still reading the roster — nothing to export yet.'
    : rosterError
      ? 'The roster could not be read, so an export would not be a true list.'
      : null;

  const [confirmingPartial, setConfirmingPartial] = useState<{
    resolve: (proceed: boolean) => void;
  } | null>(null);

  const confirmExport = useCallback(async () => {
    if (backendsDown.length === 0 && unresolved === 0) return true;
    return new Promise<boolean>((resolve) => {
      setConfirmingPartial({ resolve });
    });
  }, [backendsDown.length, unresolved]);

  const settlePartial = useCallback((proceed: boolean) => {
    setConfirmingPartial((pending) => {
      pending?.resolve(proceed);
      return null;
    });
  }, []);

  const buildExport = useCallback(
    () => ({
      filename: exportFilename({
        kind: 'roster',
        at: new Date(),
        flags: [
          // Both facts a reader needs before they trust the row count, in the
          // one label the file keeps once the screen is gone.
          ...(isFiltered ? ['filtered'] : []),
          ...(backendsDown.length > 0 ? ['partial'] : []),
        ],
      }),
      // `visible`, never `students`: the file is the rows on screen.
      contents: buildRosterCsv(visible, { reachable, backends: rosterBackends }),
    }),
    [visible, reachable, rosterBackends, isFiltered, backendsDown.length],
  );

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
            {multiBackend ? 'Add from directory' : 'Add from Planning Center'}
          </Button>
          {/*
            The third control, and the only one on this page whose output leaves
            the app. It exports what is on screen under the filters applied —
            which is why it reads `visible` and why the count is on its label.
          */}
          <ExportCsvButton
            build={buildExport}
            count={visible.length}
            noun="students"
            blockedReason={exportBlockedReason}
            confirm={confirmExport}
          />
        </div>
      </header>

      <RosterErrorBanner />

      <PartialRosterDialog
        open={confirmingPartial !== null}
        down={backendsDown}
        unresolved={unresolved}
        retrying={rosterLoading}
        onConfirm={() => settlePartial(true)}
        onCancel={() => settlePartial(false)}
        onRetry={() => {
          // Stands the export down rather than holding the dialog open over a
          // read in flight: if the retry lands, the warning banner clears and
          // the button is one press away, now describing a whole roster.
          void refreshRoster(true);
          settlePartial(false);
        }}
      />

      {/*
        One toolbar row where there is a pointer — and one that wraps rather
        than pushing the page sideways.

        Stacked, the search field, the two selects and the chips terminated at
        three different right edges — three controls dropped in at their
        natural widths rather than a set — and cost a row and a half of
        students. So they are one row.

        `lg:flex-wrap` is what keeps that from becoming a lie. The quick
        filters grew from two chips to four when the queue arrived, and four
        chips plus a 448px pair of selects plus a search field do not fit
        beside a 224px sidebar at 1280: the group ran 51px off the right edge,
        taking the last chip with it. A chip nobody can reach is worse than a
        chip on its own line, and this is the one screen where the widths are
        genuinely content-dependent — a count going from 3 to 13 moves them.
        Above 1440 they still ride up onto the first row.
      */}
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end lg:gap-4">
        {/* `min-w-0`: a flex item defaults to `min-width: auto` and refuses to
            shrink below its content, which is the usual way this page learns
            it can scroll sideways. */}
        <div className="lg:min-w-56 lg:flex-1">
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
                {gradeName(value)}
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

        {/*
          Two groups, not four loose chips.

          The pair that answers this journey's question — what is running, what
          needs me — has to stay on one line, and flex-wrap fills greedily, so
          ordering alone would not hold it: at 390px the widest standing count
          packs onto line one and splits the pair. Making the grouping
          structural means the break is a fact about the content rather than a
          coincidence of two chip widths, and it survives a count going from 3
          to 13.
        */}
        <div
          role="group"
          aria-label="Quick filters"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 lg:shrink-0"
        >
          <span className="flex shrink-0 flex-wrap gap-2">
            <FilterChip
              active={quick === 'inFlight'}
              onPress={() => setQuick((current) => (current === 'inFlight' ? 'none' : 'inFlight'))}
            >
              In flight
              <ChipCount active={quick === 'inFlight'}>{inFlightCount}</ChipCount>
            </FilterChip>
            <FilterChip
              active={quick === 'needsYou'}
              onPress={() => setQuick((current) => (current === 'needsYou' ? 'none' : 'needsYou'))}
            >
              Needs you
              <ChipCount active={quick === 'needsYou'}>{needsYouCount}</ChipCount>
            </FilterChip>
          </span>
          <span className="flex shrink-0 flex-wrap gap-2">
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
          </span>
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
              description="Whoever is on it is still on it — Tally needs their backend to put names to them. The banner above has the details."
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
                  : 'Add students from your church directory, or add one by hand.'
              }
              action={
                isFiltered ? (
                  <Button variant="secondary" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : (
                  <Button onClick={() => setAddFromPcoOpen(true)}>
                    {multiBackend ? 'Add from directory' : 'Add from Planning Center'}
                  </Button>
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
                edit={editsByStudent.get(student.id) ?? null}
                uid={user?.uid ?? null}
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
  edit,
  uid,
  onBadge,
}: {
  student: Student;
  /** Passed in rather than read here, so the row and the chip count agree. */
  unreachable: boolean;
  /** Today, decided once by the page. See the note where it is built. */
  now: Date;
  /**
   * The one job this student has, or null. Passed in for the same reason
   * `unreachable` is: the row and the counts above it must not be able to
   * disagree about which pile it is in.
   */
  edit: UpstreamEdit | null;
  /** Whoever is reading, so the band can say "you" rather than their own name. */
  uid: string | null;
  onBadge: (student: Student, action: RowBadgeAction) => void;
}) {
  const name = `${student.firstName} ${student.lastName}`;
  const birthday = birthdayState(student.birthday, now);
  const spokenGrade = gradeSentence(student);

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
      {/* `rounded-lg` on an invisible layer is there for one thing: the focus
          ring traces the border radius, and a square ring over a rounded row
          reads as a misalignment. The ring itself is the app's, from
          `index.css` — drawn inward, so the row cannot clip it. */}
      <Link
        to={`/students/${student.id}`}
        aria-label={
          spokenGrade ? `${name}, ${spokenGrade}` : `${name}, no grade on file`
        }
        className="absolute inset-0 rounded-lg"
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
        {/*
          The band, or the note — never both, and never neither.

          Both want the one elastic slot this row has, and a row can only
          give it to one of them. The job wins it for as long as it is a
          job: a note is a standing fact that will read the same tomorrow,
          and an edit on its way to the church's database is the only thing
          on this row that has a clock on it. It hands the slot straight
          back when the job settles, so a list at rest is the list that was
          always here.
        */}
        {edit ? (
          <JobBand edit={edit} now={now} uid={uid} />
        ) : (
          <NoteSnippet notes={student.notes} />
        )}
        <LastSeen at={student.lastAttendedAt} />
        {/*
          Badges annotate the row; they do not restructure it.

          Laid out as part of the name they inherited its variable width, so
          on a phone five rows in forty-five wrapped their badges to a second
          line and pushed the grade to a third — the one fact every row shares
          was the one whose position moved. On a laptop the same mistake put
          the no-contact flag at five different x positions, so the thing a
          leader came to find was a ragged mid-row scan rather than a column.

          `min-w-72` rather than a fixed width: the lane holds its column for
          the rows everybody has, and grows into the note's space on the rare
          row carrying four flags at once, instead of overflowing them back
          across the columns to its left.

          It was `min-w-80`, and gave 32px back to the slot on its left when
          that slot stopped being only a note. A row carrying a job spends
          that slot on the two facts a mark cannot hold — what is changing
          and who asked for it — and at 1280 with the sidebar open there was
          not room for a sixth word of it. The lane still holds every badge
          the common rows wear; it reaches for the extra width only on the
          rare four-flag row, exactly as before.

          The grade sits at the lane's leading edge and the badges are pushed to
          its trailing edge by a spacer that takes the slack. Packed together
          against the right instead, the grade moved with the badge count — the
          one fact every row shares, at a different x on every row, which is the
          precise thing this lane was given a fixed width to stop.
        */}
        <span className="relative z-10 mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-500 lg:mt-0 lg:min-w-72 lg:shrink-0 lg:flex-nowrap">
          {/*
            Never the thing that gives way.

            On a phone this line is the width of a card, and three badges on it
            used to squeeze the grade until it truncated — "7…" on the one row
            in the list that most needed reading, because a row wearing three
            flags is a row somebody is looking at. It holds its width now and
            the badges wrap beneath it instead, which costs a few pixels of
            height on a handful of rows and costs the grade nothing. The wrap is
            only below `lg`; the wide layout has a lane for this.
          */}
          <span className="shrink-0 lg:w-20 lg:text-right">
            {spokenGrade ?? NO_GRADE}
          </span>
          {/*
            The job mark rides in the row's meta line below `lg`, and beside
            the name at pointer widths — one component, two slots. Below `lg`
            it is the word alone: a phone row has no room for an age, and the
            caption carrying the field and the author is `lg:` only.
          */}
          {edit ? <JobChip edit={edit} now={now} short className="lg:hidden" /> : null}
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
            student={student}
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
/**
 * What is changing on this row, and who asked for it.
 *
 * The wide layout's answer to the question a mark alone raises. "Queued" on a
 * row tells a leader something is happening to a child's record and not what,
 * which on a shared roster is the moment they open it to find out — so the two
 * facts that stop them are the ones the mark cannot carry: the fields, and the
 * name of whoever typed them.
 *
 * The chip's lane is fixed rather than shrink-to-fit. Its word is the widest
 * thing about it and its age ticks, so a lane sized to its contents would move
 * the caption beside it as the seconds passed and put a different left edge on
 * every row of a filtered list — the whole reason this screen has columns.
 */
function JobBand({
  edit,
  now,
  uid,
}: {
  edit: UpstreamEdit;
  now: Date;
  uid: string | null;
}) {
  const mine = edit.createdBy === uid;
  const author = mine ? 'you' : (edit.createdByName.split(/\s+/)[0] ?? 'somebody');
  const caption = `${describeFields(edit)} · ${author}`;

  return (
    <span className="hidden min-w-0 flex-1 items-center gap-2 text-xs text-ink-500 lg:flex">
      <span className="flex min-w-36 shrink-0">
        <JobChip edit={edit} now={now} />
      </span>
      {/*
        The first thing to truncate on a narrow laptop, and deliberately so:
        it is the only part of the row whose full text a pointer can get back
        by hovering, and the record itself says the same thing in prose one
        press away. Everything either side of it is a column, and a column
        that truncates on some rows and not others is worse than a phrase
        that ends in an ellipsis.
      */}
      <span title={caption} className="min-w-0 truncate">
        {caption}
      </span>
    </span>
  );
}

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
     * Not on a student no backend has heard of.
     *
     * A quick-added visitor has no birthday for the same reason they have no
     * anything: their push has not landed. "Queued" already says that, and it
     * is the chip with the action on it — so this one would be a second way of
     * saying the same sentence, on precisely the rows that are already carrying
     * the most badges.
     */
    if (backendOfStudent(student) === null) return null;

    /*
     * Desk work, so: the wide layout only.
     *
     * The other three faces are about a person — there is cake this week, or
     * there was and nobody said anything — and they belong wherever the roster
     * is being read. This one is about a record, and filling it in means being
     * upstream with a keyboard. On a phone it would be the most common badge
     * in the list and the least actionable thing in it, crowding the two that
     * a counselor actually stops for.
     */
    return (
      <Badge
        tone="neutral"
        title={`${backendLabelOf(student)} holds no birthdate for this student`}
        onPress={onPress}
        pressLabel={`No birthday on file for ${name}`}
        className="hidden lg:inline-flex"
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
  student,
  onPress,
  name,
}: {
  student: Student;
  onPress: () => void;
  name: string;
}) {
  if (backendOfStudent(student) !== null) return null;

  const label = backendLabelOf(student);
  return (
    <Badge
      tone="neutral"
      title={`Waiting to be created in ${label}`}
      onPress={onPress}
      pressLabel={`${name} is not in ${label} yet — push them now`}
    >
      Queued
    </Badge>
  );
}
