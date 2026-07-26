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
 */
import { memo, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  SelectField,
  SkeletonRows,
  TextField,
} from '@/components/ui';
import { RosterErrorBanner } from '@/components/RosterErrorBanner';
import { useAuth } from '@/context/authContext';
import { useData } from '@/context/dataContext';
import { AddFromPlanningCenterModal } from '@/features/students/AddFromPlanningCenterModal';
import { StudentEditorModal } from '@/features/students/StudentEditorModal';
import { cn, createSearchMatcher, initials, ordinalGrade } from '@/lib/utils';
import { GRADES, studentFullName, type Grade, type Student } from '@/types';

type StatusFilter = 'active' | 'inactive' | 'all';
type QuickFilter = 'none' | 'incomplete' | 'visitors';

export function StudentsPage() {
  const { students, groups, loading, rosterError, refreshRoster } = useData();
  const { user } = useAuth();

  const [query, setQuery] = useState('');
  const [grade, setGrade] = useState<Grade | null>(null);
  const [groupId, setGroupId] = useState<string>('');
  // Inactive students are history, not roster: the default view hides them.
  const [status, setStatus] = useState<StatusFilter>('active');
  const [quick, setQuick] = useState<QuickFilter>('none');
  const [editorOpen, setEditorOpen] = useState(false);
  const [addFromPcoOpen, setAddFromPcoOpen] = useState(false);

  const groupNames = useMemo(
    () => new Map(groups.map((group) => [group.id, group.name])),
    [groups],
  );

  /** Whoever is already here, so the Planning Center search can say so. */
  const rosterIds = useMemo(() => new Set(students.map((student) => student.id)), [students]);

  const visible = useMemo(() => {
    const matcher = createSearchMatcher(query);
    return students.filter((student) => {
      if (status !== 'all' && student.status !== status) return false;
      if (grade !== null && student.grade !== grade) return false;
      if (groupId && student.smallGroupId !== groupId) return false;
      // `profileComplete` has three states and only `false` is a problem:
      // `null` means a roster read did not hydrate households, so nobody has
      // checked. Filtering on truthiness listed the entire ministry.
      if (quick === 'incomplete' && student.profileComplete !== false) return false;
      if (quick === 'visitors' && !student.isVisitor) return false;
      if (!matcher.matches(student.searchName)) return false;
      return true;
    });
  }, [students, status, grade, groupId, quick, query]);

  const incompleteCount = useMemo(
    () =>
      students.filter((student) => student.status === 'active' && student.profileComplete === false)
        .length,
    [students],
  );
  const visitorCount = useMemo(
    () => students.filter((student) => student.status === 'active' && student.isVisitor).length,
    [students],
  );

  const isFiltered =
    query.trim().length > 0 || grade !== null || groupId !== '' || quick !== 'none' || status !== 'active';

  const clearFilters = () => {
    setQuery('');
    setGrade(null);
    setGroupId('');
    setStatus('active');
    setQuick('none');
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-4">
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
            Two ways onto the roster, and the order is the common case first.
            Somebody the church already knows is looked up; a face at the door
            nobody has met is typed in and pushed upstream later.
          */}
          <Button onClick={() => setAddFromPcoOpen(true)}>Add from Planning Center</Button>
          <Button variant="secondary" onClick={() => setEditorOpen(true)}>
            New visitor
          </Button>
        </div>
      </header>

      <RosterErrorBanner />

      <div className="flex flex-col gap-3">
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

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
            label="Small group"
            value={groupId}
            onChange={(changed) => setGroupId(changed.target.value)}
          >
            <option value="">All groups</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
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

        <div role="group" aria-label="Quick filters" className="flex flex-wrap gap-2">
          <FilterChip
            active={quick === 'incomplete'}
            onPress={() => setQuick((current) => (current === 'incomplete' ? 'none' : 'incomplete'))}
          >
            Incomplete profiles ({incompleteCount})
          </FilterChip>
          <FilterChip
            active={quick === 'visitors'}
            onPress={() => setQuick((current) => (current === 'visitors' ? 'none' : 'visitors'))}
          >
            Visitors ({visitorCount})
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
                groupName={student.smallGroupId ? groupNames.get(student.smallGroupId) : undefined}
              />
            ))}
          </ul>
        )}
      </Card>

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
    </div>
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
        'min-h-11 shrink-0 whitespace-nowrap rounded-full px-3.5 text-xs font-semibold ring-1 transition-colors',
        active
          ? 'bg-brand-500/20 text-brand-200 ring-brand-500/40'
          : 'bg-ink-900 text-ink-400 ring-ink-800 hover:bg-ink-800',
      )}
    >
      {children}
    </button>
  );
}

/** Memoised so retyping in the search box only re-renders the rows that change. */
const StudentListRow = memo(function StudentListRow({
  student,
  groupName,
}: {
  student: Student;
  groupName: string | undefined;
}) {
  return (
    <li>
      <Link
        to={`/students/${student.id}`}
        className="flex min-h-16 items-center gap-3 px-3 py-2 hover:bg-ink-800/40"
      >
        <span
          aria-hidden="true"
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-ink-800 text-sm font-bold text-ink-300"
        >
          {initials(student.firstName, student.lastName)}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="truncate text-base font-semibold text-ink-50">
              {studentFullName(student)}
            </span>
            {student.isVisitor ? <Badge tone="brand">Visitor</Badge> : null}
            {student.profileComplete === false ? <Badge tone="warn">Missing info</Badge> : null}
            {student.status === 'inactive' ? <Badge tone="neutral">Inactive</Badge> : null}
          </span>
          <span className="mt-0.5 flex items-center gap-2 text-xs text-ink-500">
            <span className="truncate">
              {ordinalGrade(student.grade)} grade
              {groupName ? ` · ${groupName}` : ''}
            </span>
            <SourceBadge pcoPersonId={student.pcoPersonId} />
          </span>
        </span>

        <span aria-hidden="true" className="shrink-0 text-ink-600">
          ›
        </span>
      </Link>
    </li>
  );
});

/** Where this record came from — it decides which fields anyone can edit. */
function SourceBadge({ pcoPersonId }: { pcoPersonId: string | null }) {
  return pcoPersonId ? (
    <Badge tone="neutral" title="Synced from Planning Center" className="shrink-0">
      <span className="sr-only">Synced from Planning Center</span>
      <span aria-hidden="true">PC</span>
    </Badge>
  ) : (
    <Badge
      tone="neutral"
      title="Created in Tally — not linked to a Planning Center person"
      className="shrink-0"
    >
      Tally only
    </Badge>
  );
}
