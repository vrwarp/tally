/**
 * One student, everything the core team needs about them.
 *
 * The page is built around the question a leader actually arrives with: "how
 * long has it been since we saw them, and who do I call?" So contact actions and
 * the consecutive-miss streak sit above the fold, and the attendance history
 * below is the evidence for the streak rather than a report in its own right.
 *
 * History is derived from the events already in memory, read once through
 * `useEventSnapshots` — past attendance does not change while this page is open.
 */
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorBanner,
  LoadingScreen,
  SkeletonRows,
  StatTile,
} from '@/components/ui';
import { useAuth } from '@/context/authContext';
import { useData } from '@/context/dataContext';
import { useToast } from '@/context/toastContext';
import { orderSnapshotsNewestFirst, recurringSnapshots } from '@/features/dashboard/insights';
import { StudentEditorModal } from '@/features/students/StudentEditorModal';
import { useEventSnapshots } from '@/hooks/useEventSnapshots';
import { useNow } from '@/hooks/useNow';
import { formatRelative, formatShortDate } from '@/lib/time';
import { formatPhone, initials, ordinalGrade } from '@/lib/utils';
import { pushStudentToPlanningCenter } from '@/services/functions';
import { setStudentStatus } from '@/services/students';
import { studentFullName } from '@/types';

/** How many finished gatherings the history list reaches back over. */
const HISTORY_WINDOW = 12;

/** Deep link to a person in Planning Center People. Mirrored in StudentEditorModal. */
function pcoPersonUrl(pcoPersonId: string): string {
  return `https://people.planningcenteronline.com/people/AC${pcoPersonId}`;
}

/** `tel:`/`sms:` want a dialable string, not "(555) 010-0100". */
function dialable(phone: string): string {
  return phone.replace(/[^\d+]/g, '');
}

export function StudentDetailPage() {
  const { studentId } = useParams();
  const { students, events, groups, settings, loading } = useData();
  const { user } = useAuth();
  const { show } = useToast();
  const now = useNow(60_000);

  const [editorOpen, setEditorOpen] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [push, setPush] = useState<{ state: 'idle' | 'busy' | 'done' | 'error'; message: string }>({
    state: 'idle',
    message: '',
  });

  const student = students.find((candidate) => candidate.id === studentId) ?? null;

  // Only finished gatherings: a night still in progress is not an absence.
  const recentEvents = useMemo(
    () =>
      events
        .filter((event) => event.status !== 'cancelled' && event.checkInClosesAt < now)
        .sort((a, b) => b.startAt.getTime() - a.startAt.getTime())
        .slice(0, HISTORY_WINDOW),
    [events, now],
  );

  const { snapshots, loading: historyLoading, error: historyError } = useEventSnapshots(recentEvents);

  const history = useMemo(
    () =>
      student
        ? orderSnapshotsNewestFirst(snapshots).map((snapshot) => ({
            event: snapshot.event,
            present: snapshot.presentStudentIds.has(student.id),
          }))
        : [],
    [snapshots, student],
  );

  /**
   * Consecutive missed recurring gatherings, newest first — the same rule the
   * MIA list uses, including the "events before they joined are not misses"
   * exclusion, so this page and the dashboard never disagree.
   */
  const streak = useMemo(() => {
    if (!student) return 0;
    let misses = 0;
    for (const snapshot of recurringSnapshots(snapshots)) {
      if (snapshot.event.startAt < student.createdAt) break;
      if (snapshot.presentStudentIds.has(student.id)) break;
      misses += 1;
    }
    return misses;
  }, [snapshots, student]);

  if (!student) {
    if (loading) return <LoadingScreen message="Loading student…" />;
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-4">
        <Card>
          <EmptyState
            icon="🤷"
            title="No student with that link."
            description="They may have been removed, or the link is stale."
            action={
              <Link
                to="/students"
                className="inline-flex min-h-11 items-center rounded-xl bg-ink-800 px-4 text-sm font-semibold text-ink-100 ring-1 ring-ink-700"
              >
                Back to students
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  const name = studentFullName(student);
  const groupName = groups.find((group) => group.id === student.smallGroupId)?.name ?? null;
  const phone = student.parentPhone?.trim() ?? '';
  const email = student.parentEmail?.trim() ?? '';
  const parentLabel = student.parentName?.trim() || `${name}'s parent`;

  const toggleStatus = async () => {
    if (!user || statusBusy) return;
    const next = student.status === 'active' ? 'inactive' : 'active';
    setStatusBusy(true);
    try {
      await setStudentStatus(student.id, next, user.uid);
      show(next === 'active' ? `${name} is back on the roster` : `${name} marked inactive`, {
        tone: 'success',
      });
    } catch {
      show(`Could not change ${name}'s status.`, { tone: 'error' });
    } finally {
      setStatusBusy(false);
    }
  };

  const pushToPlanningCenter = async () => {
    setPush({ state: 'busy', message: '' });
    try {
      const result = await pushStudentToPlanningCenter({ studentId: student.id });
      setPush({ state: 'done', message: result.data.message });
      show(result.data.message, { tone: result.data.status === 'skipped' ? 'info' : 'success' });
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'Planning Center did not accept the push.';
      setPush({ state: 'error', message });
      show(message, { tone: 'error' });
    }
  };

  const streakTone = streak >= settings.miaConsecutiveMisses ? 'danger' : streak > 0 ? 'warn' : 'success';

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-4">
      <Link
        to="/students"
        className="inline-flex min-h-11 w-fit items-center gap-1 text-sm text-ink-400 hover:text-ink-100"
      >
        <span aria-hidden="true">‹</span> All students
      </Link>

      <header className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-14 shrink-0 items-center justify-center rounded-full bg-ink-800 text-lg font-bold text-ink-300"
        >
          {initials(student.firstName, student.lastName)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-ink-50">{name}</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            {ordinalGrade(student.grade)} grade{groupName ? ` · ${groupName}` : ''}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {student.isVisitor ? <Badge tone="brand">Visitor</Badge> : null}
            {!student.profileComplete ? <Badge tone="warn">Missing parent contact</Badge> : null}
            {student.status === 'inactive' ? <Badge tone="neutral">Inactive</Badge> : null}
            {student.allergies ? <Badge tone="warn">Allergies</Badge> : null}
          </div>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setEditorOpen(true)}>Edit profile</Button>
        <Button
          variant={student.status === 'active' ? 'secondary' : 'success'}
          onClick={() => void toggleStatus()}
          loading={statusBusy}
          /* `status` is one of the Planning-Center-managed fields, so flipping
             it here would last only until the next pull. */
          disabled={Boolean(student.pcoPersonId)}
          title={
            student.pcoPersonId ? 'Active or inactive is managed in Planning Center.' : undefined
          }
        >
          {student.status === 'active' ? 'Mark inactive' : 'Reactivate'}
        </Button>
        {student.pcoPersonId ? (
          <span className="text-xs text-ink-500">
            Archive them in Planning Center to take them off the roster.
          </span>
        ) : null}
      </div>

      <Card>
        <CardHeader title="Profile" />
        <div className="flex flex-col gap-4 px-4 py-3">
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-ink-400">
              Parent contact
            </h3>
            {phone || email ? (
              <>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {phone ? (
                    <>
                      <ContactLink
                        href={`tel:${dialable(phone)}`}
                        label={`Call ${parentLabel} at ${formatPhone(phone)}`}
                        icon="📞"
                      >
                        Call
                      </ContactLink>
                      <ContactLink
                        href={`sms:${dialable(phone)}`}
                        label={`Text ${parentLabel} at ${formatPhone(phone)}`}
                        icon="💬"
                      >
                        Text
                      </ContactLink>
                    </>
                  ) : null}
                  {email ? (
                    <ContactLink
                      href={`mailto:${email}`}
                      label={`Email ${parentLabel} at ${email}`}
                      icon="✉"
                    >
                      Email
                    </ContactLink>
                  ) : null}
                </div>
                <p className="mt-2 text-sm text-ink-300">
                  {student.parentName ? `${student.parentName} · ` : ''}
                  {phone ? <span className="tabular-nums">{formatPhone(phone)}</span> : null}
                  {phone && email ? ' · ' : ''}
                  {email ? <span className="break-all">{email}</span> : null}
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-warn-400">
                Nothing on file — nobody can reach this family in an emergency.
              </p>
            )}
          </div>

          {student.allergies ? (
            <div className="rounded-xl bg-warn-500/10 px-3 py-2 ring-1 ring-warn-500/25">
              <p className="text-xs font-semibold uppercase tracking-wide text-warn-400">
                Allergies
              </p>
              <p className="mt-0.5 text-sm text-ink-100">{student.allergies}</p>
            </div>
          ) : null}

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Detail label="Small group" value={groupName ?? 'None'} />
            <Detail label="Status" value={student.status === 'active' ? 'Active' : 'Inactive'} />
            <Detail
              label="First seen"
              value={student.firstAttendedAt ? formatShortDate(student.firstAttendedAt) : 'Never'}
            />
            <Detail
              label="Last seen"
              value={student.lastAttendedAt ? formatShortDate(student.lastAttendedAt) : 'Never'}
            />
          </dl>

          {student.notes ? (
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wide text-ink-400">Notes</h3>
              <p className="mt-1 whitespace-pre-line text-sm text-ink-200">{student.notes}</p>
            </div>
          ) : null}

          <div className="border-t border-ink-800 pt-3">
            <h3 className="text-xs font-medium uppercase tracking-wide text-ink-400">
              Planning Center
            </h3>
            {student.pcoPersonId ? (
              <p className="mt-1 text-sm text-ink-300">
                Synced from Planning Center
                {student.pcoSyncedAt ? ` · ${formatRelative(student.pcoSyncedAt)}` : ''}.{' '}
                <a
                  href={pcoPersonUrl(student.pcoPersonId)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-brand-300 underline"
                >
                  Open their profile
                </a>
              </p>
            ) : (
              <div className="mt-1 flex flex-col gap-2">
                <p className="text-sm text-ink-300">
                  {student.pcoPushPending
                    ? 'Created in Tally. Waiting to be pushed to Planning Center — the scheduled sync will do it, or you can send them now.'
                    : 'Created in Tally and not linked to a Planning Center person.'}
                </p>
                {student.pcoPushPending ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => void pushToPlanningCenter()}
                      loading={push.state === 'busy'}
                      disabled={push.state === 'done'}
                    >
                      {push.state === 'done' ? 'Pushed' : 'Push to Planning Center'}
                    </Button>
                    <span
                      role="status"
                      aria-live="polite"
                      className={
                        push.state === 'error' ? 'text-xs text-danger-400' : 'text-xs text-ink-400'
                      }
                    >
                      {push.message}
                    </span>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Attendance"
          description={`The last ${recentEvents.length} finished ${
            recentEvents.length === 1 ? 'gathering' : 'gatherings'
          }.`}
        />

        <div className="grid grid-cols-2 gap-2 px-4 py-3">
          <StatTile
            label="Missed in a row"
            value={streak}
            hint={
              streak >= settings.miaConsecutiveMisses
                ? `on the MIA list at ${settings.miaConsecutiveMisses}`
                : 'recurring gatherings only'
            }
            tone={streakTone}
          />
          <StatTile
            label="Last seen"
            value={student.lastAttendedAt ? formatRelative(student.lastAttendedAt) : 'Never'}
            hint={student.lastAttendedAt ? formatShortDate(student.lastAttendedAt) : 'no check-ins yet'}
          />
        </div>

        {historyError ? (
          <div className="px-4 pb-3">
            <ErrorBanner message={`Could not load attendance history. ${historyError}`} />
          </div>
        ) : null}

        {historyLoading && history.length === 0 ? (
          <SkeletonRows count={4} />
        ) : history.length === 0 ? (
          <EmptyState
            title="No gatherings on record yet."
            description="Attendance appears here as soon as this student has been checked into something."
          />
        ) : (
          <ul className="divide-y divide-ink-800">
            {history.map((entry) => (
              <li key={entry.event.id} className="flex items-center gap-3 px-4 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink-100">
                    {entry.event.title}
                  </span>
                  <span className="block text-xs text-ink-500">
                    {formatShortDate(entry.event.startAt)}
                  </span>
                </span>
                {entry.present ? (
                  <Badge tone="success">Present</Badge>
                ) : entry.event.mode === 'oneoff' ? (
                  /* A retreat they never signed up for is not an absence. */
                  <Badge tone="neutral" title="One-off event — they were not on this trip">
                    Not on the list
                  </Badge>
                ) : (
                  <Badge tone="neutral">Missed</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <StudentEditorModal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        student={student}
      />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink-100">{value}</dd>
    </div>
  );
}

function ContactLink({
  href,
  label,
  icon,
  children,
}: {
  href: string;
  label: string;
  icon: string;
  children: string;
}) {
  return (
    <a
      href={href}
      aria-label={label}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-ink-800 px-3 text-sm font-semibold text-ink-100 ring-1 ring-ink-700 hover:bg-ink-700"
    >
      <span aria-hidden="true">{icon}</span>
      {children}
    </a>
  );
}
