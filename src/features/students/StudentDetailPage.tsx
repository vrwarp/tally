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
import { Link, useNavigate, useParams } from 'react-router-dom';
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
import { RosterErrorBanner } from '@/components/RosterErrorBanner';
import { useAuth } from '@/context/authContext';
import { useData } from '@/context/dataContext';
import { useToast } from '@/context/toastContext';
import { orderSnapshotsNewestFirst, recurringSnapshots } from '@/features/dashboard/insights';
import { StudentEditorModal } from '@/features/students/StudentEditorModal';
import { useEventSnapshots } from '@/hooks/useEventSnapshots';
import { useNow } from '@/hooks/useNow';
import { usePersonDetails } from '@/hooks/usePersonDetails';
import { sessionOutcome } from '@/lib/sessionHistory';
import { formatRelative, formatShortDate } from '@/lib/time';
import { formatPhone, initials, ordinalGrade } from '@/lib/utils';
import {
  addRosterMember,
  pushStudentToPlanningCenter,
  removeRosterMember,
} from '@/services/functions';
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
  const navigate = useNavigate();
  const { students, events, settings, loading, rosterError, refreshRoster } = useData();
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
  const { details, loading: detailsLoading, error: detailsError } = usePersonDetails(student);

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
            // A night nobody was checked into is not an absence: it is a night
            // that did not happen. Labelling it here is what makes the streak
            // above legible — otherwise it looks like the count skipped a row.
            outcome: sessionOutcome(snapshot),
          }))
        : [],
    [snapshots, student],
  );

  /**
   * Consecutive missed recurring gatherings, newest first — the same rule the
   * MIA list uses, including the "events before they joined are not misses" and
   * "a night nobody attended did not happen" exclusions, so this page and the
   * dashboard never disagree.
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
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-4 py-4">
        {/* Without this the screen blames the link, which is the one thing that
            is not wrong: the student is on the roster, their name is not. */}
        <RosterErrorBanner />
        <Card>
          <EmptyState
            icon={rosterError ? '⚠️' : '🤷'}
            title={rosterError ? 'This student cannot be read right now.' : 'No student with that link.'}
            description={
              rosterError
                ? 'Their name and grade come from Planning Center, which Tally cannot reach.'
                : 'They may have been removed, or the link is stale.'
            }
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
  const phone = details?.parentPhone?.trim() ?? '';
  const email = details?.parentEmail?.trim() ?? '';
  const parentLabel = details?.parentName?.trim() || `${name}'s parent`;

  /*
   * Whether anyone can actually be reached — answered from what is on screen.
   *
   * This screen is the one place that has the contact details in hand, so it
   * does not have to trust the roster's flag. That matters because the flag is
   * usually `null`: a roster read does not hydrate households, and reading
   * `null` as "incomplete" put a warning badge directly above a parent's phone
   * number. Until the lookup lands, nobody is accused of anything.
   */
  const unreachable = details ? !phone && !email : student.profileComplete === false;

  /**
   * On or off the roster.
   *
   * Two paths, because membership and identity live in different places. A
   * student Planning Center knows is added and removed through a callable: the
   * document id is a claim about which upstream person this row is, so a
   * browser may not write it. A visitor Tally created is entirely Tally's, and
   * an ordinary write is right.
   *
   * Neither path deletes anything. Every attendance record points at a student
   * id, so erasing the row would drop past head counts and leave history
   * pointing at nobody.
   */
  const toggleStatus = async () => {
    if (!user || statusBusy) return;
    const next = student.status === 'active' ? 'inactive' : 'active';
    setStatusBusy(true);
    try {
      if (student.pcoPersonId) {
        if (next === 'inactive') await removeRosterMember({ studentId: student.id });
        else await addRosterMember({ pcoPersonId: student.pcoPersonId });
        await refreshRoster(true);
      } else {
        await setStudentStatus(student.id, next, user.uid);
      }
      show(next === 'active' ? `${name} is back on the roster` : `${name} taken off the roster`, {
        tone: 'success',
      });

      /*
       * Somebody taken off the roster has no screen left to be on.
       *
       * Their name lives in Planning Center and is only read for people the
       * roster asked about, so once they are off it there is nothing to render
       * here — the alternative is a detail page with a blank name on it. The
       * list is where they were, so that is where this goes.
       */
      if (next === 'inactive' && student.pcoPersonId) navigate('/students');
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
            {ordinalGrade(student.grade)} grade
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {student.isVisitor ? <Badge tone="brand">Visitor</Badge> : null}
            {unreachable ? <Badge tone="warn">Missing parent contact</Badge> : null}
            {student.status === 'inactive' ? <Badge tone="neutral">Inactive</Badge> : null}
            {student.hasAllergies ? <Badge tone="warn">Allergies</Badge> : null}
          </div>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setEditorOpen(true)}>Edit profile</Button>
        <Button
          variant={student.status === 'active' ? 'secondary' : 'success'}
          onClick={() => void toggleStatus()}
          loading={statusBusy}
        >
          {student.status === 'active' ? 'Remove from roster' : 'Add back to roster'}
        </Button>
        <span className="text-xs text-ink-500">
          {student.pcoPersonId
            ? 'Removing them here leaves their Planning Center record alone, and keeps every night they attended.'
            : 'Keeps every night they attended; they just stop appearing at the door.'}
        </span>
      </div>

      <Card>
        <CardHeader title="Profile" />
        <div className="flex flex-col gap-4 px-4 py-3">
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-ink-400">
              Parent contact
            </h3>
            {detailsError ? (
              // A Planning Center outage must not read as "this family has no
              // phone number" — those look identical and mean opposite things.
              <p className="mt-1 text-sm text-danger-400">{detailsError}</p>
            ) : detailsLoading ? (
              <p className="mt-1 text-sm text-ink-500">Looking this up in Planning Center…</p>
            ) : phone || email ? (
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
                  {details?.parentName ? `${details.parentName} · ` : ''}
                  {phone ? <span className="tabular-nums">{formatPhone(phone)}</span> : null}
                  {phone && email ? ' · ' : ''}
                  {email ? <span className="break-all">{email}</span> : null}
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-warn-400">
                Nothing in Planning Center — nobody can reach this family in an emergency.
              </p>
            )}
          </div>

          {student.hasAllergies ? (
            <div className="rounded-xl bg-warn-500/10 px-3 py-2 ring-1 ring-warn-500/25">
              <p className="text-xs font-semibold uppercase tracking-wide text-warn-400">
                Allergies
              </p>
              <p className="mt-0.5 text-sm text-ink-100">
                {details?.allergies ?? (detailsLoading ? 'Loading…' : 'Recorded in Planning Center.')}
              </p>
            </div>
          ) : null}

          <dl className="grid grid-cols-2 gap-3 text-sm">
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
                {/* Not "synced": nothing was copied. This screen read Planning
                    Center a moment ago and is showing what it said. */}
                Read from Planning Center.{' '}
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
                ) : entry.outcome !== 'held' ? (
                  /* Nobody at all was checked in, so this is not their absence.
                     The streak above skips it for the same reason. */
                  <Badge
                    tone="neutral"
                    title={
                      entry.outcome === 'cancelled'
                        ? 'Cancelled — not counted as a miss'
                        : 'Nobody was checked in, so this counts as cancelled rather than as a miss'
                    }
                  >
                    {entry.outcome === 'cancelled' ? 'Cancelled' : 'No attendance'}
                  </Badge>
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
