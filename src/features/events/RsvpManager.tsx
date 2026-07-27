/**
 * Who is coming on the retreat.
 *
 * With `requiresRsvp` set this list *is* the check-in roster, so the screen is
 * built for the two things that actually change it: adding a batch of students
 * off a sign-up sheet, and moving one student between going, maybe and no as
 * they make up their mind. Success is visible in the live data, so only failures
 * raise a toast.
 *
 * A declined student keeps their row rather than being removed. `no` is often
 * reversed by a parent a day later, and a row that vanished would have to be
 * found and re-added from scratch.
 */
import { useMemo, useRef, useState } from 'react';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorBanner,
  Modal,
  SkeletonRows,
  StatTile,
} from '@/components/ui';
import { useAuth } from '@/context/authContext';
import { useData } from '@/context/dataContext';
import { useToast } from '@/context/toastContext';
import { useRsvps } from '@/hooks/useAttendance';
import { cn, createSearchMatcher, ordinalGrade, sortByName } from '@/lib/utils';
import { addRsvps, removeRsvp, setRsvpStatus } from '@/services/rsvps';
import { studentFullName, type Rsvp, type RsvpStatus, type Student, type TallyEvent } from '@/types';

const STATUS_OPTIONS: { value: RsvpStatus; label: string; active: string }[] = [
  { value: 'yes', label: 'Going', active: 'bg-present-500/20 text-present-400' },
  { value: 'maybe', label: 'Maybe', active: 'bg-warn-500/20 text-warn-400' },
  { value: 'no', label: 'No', active: 'bg-ink-700 text-ink-200' },
];

interface RsvpRow {
  rsvp: Rsvp;
  /** Null when the student record is gone but the RSVP document survived. */
  student: Student | null;
  name: string;
}

function AddStudentsModal({
  open,
  onClose,
  candidates,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  candidates: readonly Student[];
  onAdd: (studentIds: string[]) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [saving, setSaving] = useState(false);

  const matcher = createSearchMatcher(query);
  const visible = candidates.filter((student) => matcher.matches(student.searchName));

  const toggle = (studentId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  };

  const close = () => {
    setQuery('');
    setSelected(new Set());
    onClose();
  };

  const submit = async () => {
    setSaving(true);
    try {
      await onAdd([...selected]);
      close();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add students"
      description="Tick everyone going, then add them in one go."
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={close}>
            Cancel
          </Button>
          <Button
            size="lg"
            loading={saving}
            disabled={selected.size === 0}
            onClick={() => void submit()}
          >
            Add {selected.size > 0 ? selected.size : ''}{' '}
            {selected.size === 1 ? 'student' : 'students'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <input
          type="search"
          inputMode="search"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          aria-label="Search students by name"
          placeholder="Search students…"
          value={query}
          onChange={(changed) => setQuery(changed.target.value)}
          className="min-h-12 w-full rounded-xl bg-ink-950 px-3 text-ink-100 ring-1 ring-ink-700 placeholder:text-ink-500 focus:outline-none focus:ring-2 focus:ring-brand-400"
        />

        {visible.length === 0 ? (
          <EmptyState
            title={candidates.length === 0 ? 'Everyone is already on the list' : 'No match'}
            description={
              candidates.length === 0
                ? undefined
                : 'Students already on the RSVP list are not shown here.'
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {visible.map((student) => {
              const checked = selected.has(student.id);
              return (
                <li key={student.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    onClick={() => toggle(student.id)}
                    className={cn(
                      'flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-left ring-1 transition-colors',
                      checked
                        ? 'bg-brand-500/15 ring-brand-500/40'
                        : 'bg-ink-950 ring-ink-800 active:bg-ink-800',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-bold ring-1',
                        checked
                          ? 'bg-brand-500 text-white ring-brand-400'
                          : 'bg-ink-900 text-transparent ring-ink-700',
                      )}
                    >
                      ✓
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-100">
                      {studentFullName(student)}
                    </span>
                    <span className="shrink-0 text-xs text-ink-500">
                      {ordinalGrade(student.grade)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}

export interface RsvpManagerProps {
  event: TallyEvent;
}

export function RsvpManager({ event }: RsvpManagerProps) {
  const { students } = useData();
  const { user } = useAuth();
  const { show } = useToast();
  const { rsvps, loading, error } = useRsvps(event.id);

  const [addOpen, setAddOpen] = useState(false);
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const [announcement, setAnnouncement] = useState('');
  // Guarding on a ref rejects a double-tap before React has re-rendered.
  const inFlight = useRef(new Set<string>());

  const studentsById = useMemo(
    () => new Map(students.map((student) => [student.id, student])),
    [students],
  );

  const rows = useMemo<RsvpRow[]>(() => {
    return rsvps
      .map((rsvp) => {
        const student = studentsById.get(rsvp.studentId) ?? null;
        return {
          rsvp,
          student,
          name: student ? studentFullName(student) : 'Former student',
        };
      })
      .sort((a, b) =>
        a.student && b.student ? sortByName(a.student, b.student) : a.name.localeCompare(b.name),
      );
  }, [rsvps, studentsById]);

  const summary = useMemo(
    () => ({
      going: rows.filter((row) => row.rsvp.status === 'yes').length,
      maybe: rows.filter((row) => row.rsvp.status === 'maybe').length,
      declined: rows.filter((row) => row.rsvp.status === 'no').length,
    }),
    [rows],
  );

  const candidates = useMemo(() => {
    const onList = new Set(rsvps.map((rsvp) => rsvp.studentId));
    return students
      .filter((student) => student.status === 'active' && !onList.has(student.id))
      .sort(sortByName);
  }, [students, rsvps]);

  const run = async (key: string, action: () => Promise<void>, failure: string) => {
    if (!user || inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setPending((current) => new Set(current).add(key));
    try {
      await action();
    } catch {
      show(failure, { tone: 'error' });
    } finally {
      inFlight.current.delete(key);
      setPending((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const handleStatus = (row: RsvpRow, status: RsvpStatus) => {
    if (!user || row.rsvp.status === status) return;
    void run(
      `${row.rsvp.studentId}:status`,
      () => setRsvpStatus(event.id, row.rsvp.studentId, status, user.uid),
      `Could not update ${row.name}'s RSVP.`,
    );
  };

  const handleRemove = (row: RsvpRow) => {
    void run(
      `${row.rsvp.studentId}:remove`,
      async () => {
        await removeRsvp(event.id, row.rsvp.studentId);
        setAnnouncement(`${row.name} removed from the RSVP list`);
      },
      `Could not remove ${row.name}.`,
    );
  };

  const handleAdd = async (studentIds: string[]) => {
    if (!user || studentIds.length === 0) return;
    try {
      await addRsvps(event.id, studentIds, user.uid);
      setAnnouncement(
        `${studentIds.length} ${studentIds.length === 1 ? 'student' : 'students'} added to the RSVP list`,
      );
    } catch {
      show('Could not add those students. Try again.', { tone: 'error' });
    }
  };

  return (
    <Card>
      <CardHeader
        title="RSVPs"
        count={rows.length}
        description={
          event.requiresRsvp
            ? 'Only these students appear at check-in.'
            : 'This event is open to everyone — RSVPs are for planning.'
        }
        action={<Button onClick={() => setAddOpen(true)}>Add students</Button>}
      />

      <div className="flex flex-col gap-3 p-3">
        {error ? <ErrorBanner message={error} /> : null}

        <div className="grid grid-cols-3 gap-2">
          <StatTile label="Going" value={summary.going} tone="success" />
          <StatTile label="Maybe" value={summary.maybe} />
          <StatTile label="Declined" value={summary.declined} />
        </div>

        {loading && rows.length === 0 ? (
          <SkeletonRows count={3} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="🚌"
            title="Nobody has RSVP’d yet"
            description={
              event.requiresRsvp
                ? 'The check-in roster for this event stays empty until students are added here.'
                : 'Add the students you expect, so the head count has something to compare against.'
            }
            action={<Button onClick={() => setAddOpen(true)}>Add students</Button>}
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => {
              const { rsvp } = row;

              return (
                <li key={rsvp.id} className="rounded-xl bg-ink-950 p-3 ring-1 ring-ink-800">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-baseline gap-2">
                        <span className="truncate font-semibold text-ink-50">{row.name}</span>
                        {row.student ? (
                          <span className="shrink-0 text-xs text-ink-500">
                            {ordinalGrade(row.student.grade)}
                          </span>
                        ) : null}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRemove(row)}
                      disabled={pending.has(`${rsvp.studentId}:remove`)}
                      aria-label={`Remove ${row.name} from the RSVP list`}
                      className="-mr-1 -mt-1 flex size-11 shrink-0 items-center justify-center rounded-xl text-xl leading-none text-ink-500 active:bg-ink-800 disabled:opacity-50"
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  </div>

                  <div className="mt-2">
                    <div
                      role="group"
                      aria-label={`RSVP for ${row.name}`}
                      className="inline-flex rounded-xl bg-ink-900 p-0.5 ring-1 ring-ink-800"
                    >
                      {STATUS_OPTIONS.map((option) => {
                        const active = rsvp.status === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            aria-pressed={active}
                            aria-label={`${option.label} — ${row.name}`}
                            disabled={pending.has(`${rsvp.studentId}:status`)}
                            onClick={() => handleStatus(row, option.value)}
                            className={cn(
                              'min-h-11 rounded-lg px-3 text-xs font-semibold transition-colors disabled:opacity-50',
                              active ? option.active : 'text-ink-400 active:bg-ink-800',
                            )}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <AddStudentsModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        candidates={candidates}
        onAdd={handleAdd}
      />

      <span aria-live="polite" role="status" className="sr-only">
        {announcement}
      </span>
    </Card>
  );
}
