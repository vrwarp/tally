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
 *
 * ## The two controls on a row, and why they are sized the way they are
 *
 * Going / Maybe / No used to be three segments packed into one strip with no
 * gap between them: 44px tall, and "No" about 38px wide, so the smallest target
 * on the row was the one that does the most damage. With `requiresRsvp` set, a
 * student on `no` fails the eligibility gate — they are not on the predictive
 * roster and search does not find them either, so a mis-tap on a Tuesday is a
 * teenager standing at the coach on Friday who does not exist in the app. The
 * three are equal-width, spaced and 48px now.
 *
 * Removing is the other write that cannot be seen afterwards: the row that
 * would have reported it is the row that just disappeared. So it is the one
 * place in this file that raises a toast on success, and the toast carries the
 * Undo — one tap, restoring the status the student had rather than a bare `yes`.
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
import { cn, createSearchMatcher, sortByName } from '@/lib/utils';
import { gradeLabel } from '@/lib/grades';
import { addRsvps, removeRsvp, setRsvpStatus } from '@/services/rsvps';
import { studentFullName, type Rsvp, type RsvpStatus, type Student, type TallyEvent } from '@/types';
import { useTranslations } from 'use-intl';
import { useGrades } from '@/hooks/usePureStrings';

const STATUS_OPTIONS: { value: RsvpStatus; label: 'statusYes' | 'statusMaybe' | 'statusNo'; active: string }[] = [
  { value: 'yes', label: 'statusYes', active: 'bg-present-500/20 text-present-400 ring-present-500/40' },
  { value: 'maybe', label: 'statusMaybe', active: 'bg-warn-500/20 text-warn-400 ring-warn-500/40' },
  { value: 'no', label: 'statusNo', active: 'bg-ink-700 text-ink-100 ring-ink-600' },
];

/**
 * How long the undo stays up.
 *
 * Longer than an ordinary toast, because this one is not a receipt — it is the
 * only way back from a write that took the row reporting it off the screen.
 */
const UNDO_MS = 8000;

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
  const grades = useGrades();
  const t = useTranslations('Rsvp');
  const tCommon = useTranslations('Common');
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
      title={t('addTitle')}
      description={t('addDescription')}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={close}>
            {tCommon('cancel')}
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
          aria-label={t('searchAria')}
          placeholder={t('searchPlaceholder')}
          value={query}
          onChange={(changed) => setQuery(changed.target.value)}
          className="min-h-12 w-full rounded-xl bg-ink-950 px-3 text-ink-100 ring-1 ring-ink-700 placeholder:text-ink-500 focus:outline-none focus:ring-2 focus:ring-brand-400"
        />

        {visible.length === 0 ? (
          <EmptyState
            title={candidates.length === 0 ? t('allAddedTitle') : t('noMatchTitle')}
            description={
              candidates.length === 0
                ? undefined
                : t('allAddedBody')
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
                      {gradeLabel(grades, student) ?? grades('none')}
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
  const grades = useGrades();
  const t = useTranslations('Rsvp');
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
          name: student ? studentFullName(student) : t('formerStudent'),
        };
      })
      .sort((a, b) =>
        a.student && b.student ? sortByName(a.student, b.student) : a.name.localeCompare(b.name),
      );
  }, [rsvps, studentsById, t]);

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
      t('updateFailed', { name: row.name }),
    );
  };

  /** Puts back exactly what was removed, `maybe` and `no` included. */
  const restore = async (row: RsvpRow, status: RsvpStatus, uid: string) => {
    try {
      await addRsvps(event.id, [row.rsvp.studentId], uid, status);
      setAnnouncement(t('putBack', { name: row.name }));
    } catch {
      show(t('putBackFailed', { name: row.name }), { tone: 'error' });
    }
  };

  const handleRemove = (row: RsvpRow) => {
    const actor = user;
    if (!actor) return;
    // Read now: by the time the toast is pressed this row is gone from `rows`.
    const previous = row.rsvp.status;

    void run(
      `${row.rsvp.studentId}:remove`,
      async () => {
        await removeRsvp(event.id, row.rsvp.studentId);
        setAnnouncement(t('removedAnnounce', { name: row.name }));
        show(t('removedToast', { name: row.name }), {
          tone: 'info',
          durationMs: UNDO_MS,
          action: { label: t('undo'), onPress: () => void restore(row, previous, actor.uid) },
        });
      },
      t('removeFailed', { name: row.name }),
    );
  };

  const handleAdd = async (studentIds: string[]) => {
    if (!user || studentIds.length === 0) return;
    try {
      await addRsvps(event.id, studentIds, user.uid);
      setAnnouncement(
        t('added', { count: studentIds.length }),
      );
    } catch {
      show(t('addFailed'), { tone: 'error' });
    }
  };

  return (
    <Card>
      <CardHeader
        title={t('title')}
        count={rows.length}
        description={
          event.requiresRsvp
            ? t('descriptionLimited')
            : t('descriptionOpen')
        }
        action={<Button onClick={() => setAddOpen(true)}>{t('addStudents')}</Button>}
      />

      <div className="flex flex-col gap-3 p-3">
        {error ? <ErrorBanner message={error} /> : null}

        <div className="grid grid-cols-3 gap-2">
          <StatTile label={t('tileGoing')} value={summary.going} tone="success" />
          <StatTile label={t('tileMaybe')} value={summary.maybe} />
          <StatTile label={t('tileDeclined')} value={summary.declined} />
        </div>

        {loading && rows.length === 0 ? (
          <SkeletonRows count={3} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="🚌"
            title={t('emptyTitle')}
            description={
              event.requiresRsvp
                ? t('emptyBodyLimited')
                : t('emptyBodyOpen')
            }
            action={<Button onClick={() => setAddOpen(true)}>{t('addStudents')}</Button>}
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => {
              const { rsvp } = row;

              return (
                /*
                 * One line where there is a pointer, two where there is a thumb.
                 *
                 * `order` rather than a second copy of the remove button: the
                 * segmented control takes the whole width below `lg`, which
                 * wraps it under the name, and moves between the name and the ×
                 * above it. One button, one accessible name, both layouts.
                 */
                <li
                  key={rsvp.id}
                  className="flex flex-wrap items-center gap-2 rounded-xl bg-ink-950 p-3 ring-1 ring-ink-800"
                >
                  <div className="order-1 min-w-0 flex-1">
                    <p className="flex items-baseline gap-2">
                      <span className="truncate font-semibold text-ink-50">{row.name}</span>
                      {row.student ? (
                        <span className="shrink-0 text-xs text-ink-500">
                          {gradeLabel(grades, row.student) ?? grades('none')}
                        </span>
                      ) : null}
                    </p>
                    {/* Said on the row it is true of, because with `requiresRsvp`
                        a declined student is not merely marked — they are off
                        the check-in roster and search will not find them. */}
                    {event.requiresRsvp && rsvp.status === 'no' ? (
                      <p className="mt-0.5 text-xs text-ink-500">{t('notOnRoster')}</p>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleRemove(row)}
                    disabled={pending.has(`${rsvp.studentId}:remove`)}
                    aria-label={t('removeAria', { name: row.name })}
                    className="order-2 -mr-1 flex size-11 shrink-0 items-center justify-center rounded-xl text-xl leading-none text-ink-500 hover:bg-ink-800 active:bg-ink-800 disabled:opacity-50 lg:order-3"
                  >
                    <span aria-hidden="true">×</span>
                  </button>

                  {/*
                    Three equal columns with air between them, 48px tall.
                    "No" is the destructive third — it takes a student off the
                    roster entirely on an RSVP-only event — and it used to be
                    the smallest target on the row.
                  */}
                  <div
                    role="group"
                    aria-label={t('rsvpForAria', { name: row.name })}
                    className="order-3 grid w-full max-w-xs grid-cols-3 gap-2 lg:order-2 lg:w-64 lg:shrink-0"
                  >
                    {STATUS_OPTIONS.map((option) => {
                      const active = rsvp.status === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={active}
                          aria-label={t('statusOptionAria', { option: t(option.label), name: row.name })}
                          disabled={pending.has(`${rsvp.studentId}:status`)}
                          onClick={() => handleStatus(row, option.value)}
                          className={cn(
                            'min-h-12 w-full rounded-xl px-2 text-sm font-semibold ring-1',
                            'transition-colors disabled:opacity-50 pointer-fine:min-h-10',
                            active
                              ? option.active
                              : 'bg-ink-900 text-ink-400 ring-ink-800 hover:bg-ink-800 hover:text-ink-200 active:bg-ink-800',
                          )}
                        >
                          {t(option.label)}
                        </button>
                      );
                    })}
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
