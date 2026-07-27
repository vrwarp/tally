/**
 * One student, everything the core team needs about them.
 *
 * The page is built around the question a leader actually arrives with: "how
 * long has it been since we saw them, and who do I call?" So contact actions and
 * the consecutive-miss streak sit above the fold, and the attendance history
 * below is the evidence for the streak rather than a report in its own right.
 *
 * The history is grouped by gathering, exactly as the dashboard is, and for the
 * same reason: one pooled list of nights alternating Friday, Sunday, Friday made
 * a Sunday-only student look like somebody missing half of everything. Each
 * gathering carries its own streak — the one the MIA list computed, from the
 * same function — and one-off events sit in a group of their own at the bottom,
 * where "missed" is not a word that applies.
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
import {
  groupByGathering,
  orderSnapshotsNewestFirst,
  standingIn,
  type GatheringStanding,
} from '@/features/dashboard/insights';
import { StudentEditorModal } from '@/features/students/StudentEditorModal';
import { useEventSnapshots } from '@/hooks/useEventSnapshots';
import { useNow } from '@/hooks/useNow';
import { usePersonDetails } from '@/hooks/usePersonDetails';
import { chainKey } from '@/lib/materialize';
import { sessionOutcome, type SessionOutcome } from '@/lib/sessionHistory';
import { formatRelative, formatShortDate } from '@/lib/time';
import { cn, formatPhone, initials, ordinalGrade } from '@/lib/utils';
import {
  addRosterMember,
  pushStudentToPlanningCenter,
  removeRosterMember,
} from '@/services/functions';
import { setStudentStatus } from '@/services/students';
import { studentFullName, type TallyEvent } from '@/types';

/**
 * How many finished nights of *each* gathering the history reaches back over.
 *
 * Per gathering rather than across the calendar: a pooled twelve split between
 * two weekly gatherings left six of each, and a student's Sunday history ran
 * out halfway down a page that claimed to be showing their attendance.
 */
const PER_GATHERING_WINDOW = 8;

/** Recent one-off events to show alongside them. */
const ONE_OFF_WINDOW = 4;

/** Ceiling on the attendance reads one student page costs. */
const MAX_EVENTS = 24;

/** The group one-off events go in. Not a `chainKey`, and cannot collide with one. */
const ONE_OFF_GROUP = 'one-off';

interface HistoryEntry {
  event: TallyEvent;
  present: boolean;
  outcome: SessionOutcome;
}

interface HistoryGroup {
  key: string;
  title: string;
  /** Null for the one-off group, and for a gathering with no held night loaded. */
  standing: GatheringStanding | null;
  /** Every loaded night of it, newest first, cancelled ones included. */
  entries: HistoryEntry[];
}

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
  const { students, events, series, settings, loading, rosterError, refreshRoster } = useData();
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
  // Taken per gathering, so a fortnight of Fridays cannot crowd out Sunday.
  const recentEvents = useMemo(() => {
    const finished = events
      .filter((event) => event.status !== 'cancelled' && event.checkInClosesAt < now)
      .sort((a, b) => b.startAt.getTime() - a.startAt.getTime());

    const takenPerGathering = new Map<string, number>();
    let oneOffs = 0;
    const picked: TallyEvent[] = [];

    for (const event of finished) {
      if (picked.length >= MAX_EVENTS) break;

      if (event.mode === 'oneoff') {
        if (oneOffs >= ONE_OFF_WINDOW) continue;
        oneOffs += 1;
      } else {
        const key = chainKey(event);
        const taken = takenPerGathering.get(key) ?? 0;
        if (taken >= PER_GATHERING_WINDOW) continue;
        takenPerGathering.set(key, taken + 1);
      }

      picked.push(event);
    }

    return picked;
  }, [events, now]);

  const { snapshots, loading: historyLoading, error: historyError } = useEventSnapshots(recentEvents);

  /**
   * The history, split into the gatherings it belongs to, with each gathering's
   * own streak — computed by `standingIn`, the same function behind the MIA
   * list, so this page and the dashboard can never disagree about a number a
   * leader is about to phone a family over.
   *
   * Built from every loaded snapshot rather than from `groupByGathering`'s held
   * ones, because a cancelled night still earns a row here: it is the evidence
   * for why the streak skipped it, and without the row the count looks wrong.
   */
  const groups = useMemo<HistoryGroup[]>(() => {
    if (!student) return [];

    const standings = new Map(
      groupByGathering(snapshots, series).map((gathering) => [
        gathering.key,
        { title: gathering.title, standing: standingIn(gathering, student, settings) },
      ]),
    );

    const recurring = new Map<string, HistoryGroup>();
    const oneOff: HistoryEntry[] = [];

    for (const snapshot of orderSnapshotsNewestFirst(snapshots)) {
      const entry: HistoryEntry = {
        event: snapshot.event,
        present: snapshot.presentStudentIds.has(student.id),
        // A night nobody was checked into is not an absence: it is a night that
        // did not happen. Labelling it here is what makes the streak legible —
        // otherwise it looks like the count skipped a row.
        outcome: sessionOutcome(snapshot),
      };

      if (snapshot.event.mode === 'oneoff') {
        oneOff.push(entry);
        continue;
      }

      const key = chainKey(snapshot.event);
      const existing = recurring.get(key);
      if (existing) {
        existing.entries.push(entry);
        continue;
      }

      // A gathering whose every loaded night was cancelled has no standing —
      // there is nothing it could tell us — but its nights still show.
      const known = standings.get(key);
      recurring.set(key, {
        key,
        title: known?.title ?? snapshot.event.title,
        standing: known?.standing ?? null,
        entries: [entry],
      });
    }

    const groups = [...recurring.values()];
    // One-offs last: they are not a gathering, and nothing above them applies.
    if (oneOff.length > 0) {
      groups.push({ key: ONE_OFF_GROUP, title: 'One-off events', standing: null, entries: oneOff });
    }
    return groups;
  }, [snapshots, series, student, settings]);

  /**
   * The streak the tile reports: the gathering they have drifted furthest from,
   * counting only the ones they actually come to.
   *
   * A Friday regular has "missed" every Sunday School there has ever been, and
   * leading the page with that number would accuse them of drifting from a
   * gathering that was never theirs — the same exclusion the MIA list makes.
   * Somebody no gathering has seen falls through to the pooled count, which is
   * what the dashboard shows them as too.
   */
  const worst = useMemo(() => {
    const theirs = groups.filter((group) => group.standing?.wasRegular);

    if (theirs.length > 0) {
      const leader = theirs.reduce((best, group) =>
        group.standing!.consecutiveMisses > best.standing!.consecutiveMisses ? group : best,
      );
      return { streak: leader.standing!.consecutiveMisses, scope: leader.title };
    }

    const seenAtAll = groups.some((group) => group.entries.some((entry) => entry.present));
    if (seenAtAll) return { streak: 0, scope: null };

    // Seen at nothing. Every night since they joined is a night they missed.
    return {
      streak: groups.reduce((sum, group) => sum + (group.standing?.eligible ?? 0), 0),
      scope: null,
    };
  }, [groups]);
  const streak = worst.streak;

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
            recentEvents.length === 1 ? 'night' : 'nights'
          }, by gathering.`}
        />

        <div className="grid grid-cols-2 gap-2 px-4 py-3">
          <StatTile
            label="Missed in a row"
            value={streak}
            hint={
              // Named, always. "Missed 3 in a row" without saying three of what
              // is the pooled number this page used to print, and it read as an
              // accusation about the whole ministry rather than about a Friday.
              worst.scope
                ? streak >= settings.miaConsecutiveMisses
                  ? `${worst.scope} — on the MIA list at ${settings.miaConsecutiveMisses}`
                  : `${worst.scope}, their worst run`
                : streak > 0
                  ? 'not seen at any gathering'
                  : 'no gathering of their own yet'
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

        {historyLoading && groups.length === 0 ? (
          <SkeletonRows count={4} />
        ) : groups.length === 0 ? (
          <EmptyState
            title="No gatherings on record yet."
            description="Attendance appears here as soon as this student has been checked into something."
          />
        ) : (
          groups.map((group) => (
            <section key={group.key} className="border-t border-ink-800">
              <header className="flex items-baseline justify-between gap-3 bg-ink-950/40 px-4 py-2">
                <h3 className="min-w-0 truncate text-sm font-semibold text-ink-100">
                  {group.title}
                </h3>
                <p className="shrink-0 text-xs text-ink-500">
                  {group.key === ONE_OFF_GROUP
                    ? // Nothing to be missed: a retreat is not an instance of
                      // anything, and a streak over trips would mean nothing.
                      'Trips and retreats — no streak applies'
                    : group.standing === null
                      ? 'None of these nights happened'
                      : !group.standing.wasRegular
                        ? // Nobody was expecting them here, so nothing was
                          // missed. A bare "8 missed in a row" beside a student
                          // who goes on Fridays, or who dropped in once in the
                          // spring, is an accusation rather than a count — and
                          // the MIA list will not name them here either.
                          group.standing.attended === 0
                          ? 'Not one they come to'
                          : `Drops in — ${group.standing.attended} of ${group.standing.eligible}`
                        : group.standing.consecutiveMisses === 0
                          ? 'At the most recent one'
                          : `${group.standing.consecutiveMisses} missed in a row${
                              group.standing.consecutiveMisses >= settings.miaConsecutiveMisses
                                ? ' · MIA'
                                : ''
                            }`}
                </p>
              </header>

              {/* Oldest to newest, left to right, which is how a run of misses
                  reads as a run rather than as a list to count backwards. */}
              <ul className="flex flex-wrap gap-1.5 px-4 py-3">
                {[...group.entries].reverse().map((entry) => (
                  <NightChip
                    key={entry.event.id}
                    entry={entry}
                    // A trip is nobody's regular gathering, but "not on it" is
                    // still worth saying out loud, so one-offs always count.
                    theirs={group.key === ONE_OFF_GROUP || Boolean(group.standing?.wasRegular)}
                  />
                ))}
              </ul>
            </section>
          ))
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

/**
 * One night, as a chip: the date, and what happened under it in small type.
 *
 * A dozen full-width rows of "Friday Fellowship / Jul 24 / Missed" repeated the
 * gathering's name once per night and pushed the trip section off the screen.
 * Grouped by gathering the title is already in the heading above, so all a
 * night has left to say is when it was and whether they were there — and colour
 * says the second part faster than any of the words do.
 */
function NightChip({ entry, theirs }: { entry: HistoryEntry; theirs: boolean }) {
  const { present, outcome, event } = entry;

  // Not held is not missed. A cancelled night is nobody's absence, so it reads
  // as neither green nor grey — it fades out of the run entirely. A gathering
  // the student does not come to fades for the same reason: eight grey
  // "Missed" chips under a heading that says it was never theirs is the pooled
  // accusation all over again, one night at a time.
  const held = outcome === 'held';
  const counts = held && (theirs || present);

  const label = present
    ? 'Present'
    : !counts
      ? !held
        ? outcome === 'cancelled'
          ? 'Cancelled'
          : 'No one'
        : '—'
      : event.mode === 'oneoff'
        ? 'Not on it'
        : 'Missed';

  const spoken = present
    ? 'present'
    : !held
      ? 'this night did not happen, so it counts as neither'
      : !theirs
        ? 'not a gathering they come to'
        : event.mode === 'oneoff'
          ? 'not on this trip'
          : 'missed';

  return (
    <li
      title={`${event.title} · ${formatShortDate(event.startAt)}: ${spoken}`}
      className={cn(
        'w-16 rounded-xl px-1.5 py-1 text-center ring-1',
        present
          ? 'bg-present-500/15 ring-present-500/30'
          : counts
            ? 'bg-ink-800/60 ring-ink-700'
            : 'bg-ink-900/40 opacity-60 ring-ink-800',
      )}
    >
      <span className="sr-only">
        {formatShortDate(event.startAt)}: {spoken}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          'block text-xs font-semibold tabular-nums',
          present ? 'text-present-300' : counts ? 'text-ink-200' : 'text-ink-600',
        )}
      >
        {formatShortDate(event.startAt)}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          'block text-[10px] leading-tight',
          present ? 'text-present-400/90' : counts ? 'text-ink-500' : 'text-ink-600',
        )}
      >
        {label}
      </span>
    </li>
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
