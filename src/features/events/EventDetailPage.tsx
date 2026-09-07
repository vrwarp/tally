/**
 * One event: what it is, who came, and the destructive-ish actions.
 *
 * Cancel is the safe operation and is always available — it is reversible and
 * it keeps the attendance history that the predictive roster and the dashboard
 * are built from, so it stays the thing this page offers beside Edit. Deleting
 * — one gathering with its check-ins, or a whole repeat with all of them — is
 * the thing that cannot be undone, and it lives at the foot of the page behind
 * a typed confirmation. See `EventDangerZone`.
 *
 * ## The frame, and the two columns inside it
 *
 * This page is reached from the calendar, and it was the one screen in that
 * journey that never adopted `PageFrame`: a hand-written 512px column, centred,
 * with no `lg:` anything in it. Beside a 224px rail on a 1280px window that is
 * 992px of content area holding 512px of page — a ~240px void either side, and
 * a left edge that moved every time a leader arrived here from Events. It takes
 * the same frame as its siblings now, and above `lg` it splits: what the
 * gathering *is* on the left, what happened and who may touch it on the right.
 *
 * ## Why the cards reorder
 *
 * An Attendance card on a retreat three weeks out says nothing three times — a
 * `0`, a tile reading "still ahead", and a line saying nobody has been checked
 * in — and it said it above the RSVP list, which is the only thing on the page
 * with anything to report. So when the gathering is still ahead the RSVPs come
 * first and Attendance collapses to its one line. No new data, no new card,
 * just the order they can answer in.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorBanner,
  EventIcon,
  SkeletonRows,
  StatTile,
} from '@/components/ui';
import { PageFrame } from '@/components/PageFrame';
import { useAuth } from '@/context/authContext';
import { useData } from '@/context/dataContext';
import { useEvent } from '@/hooks/useEvent';
import { LockedGathering } from '@/features/events/LockedGathering';
import { AccessSheet } from '@/features/events/AccessSheet';
import { chainKey } from '@/lib/materialize';
import { useToast } from '@/context/toastContext';
import { EventDangerZone } from '@/features/events/EventDangerZone';
import { EventEditorModal } from '@/features/events/EventEditorModal';
import { RsvpManager } from '@/features/events/RsvpManager';
import { buildRegisterCsv, registerRows } from '@/features/events/registerCsv';
import { shortName, useTeam } from '@/features/events/useTeam';
import { ExportCsvButton } from '@/components/ExportCsvButton';
import { useAttendance, useRsvps } from '@/hooks/useAttendance';
import { useNow } from '@/hooks/useNow';
import { exportFilename } from '@/lib/csv';
import { gatheringOptions } from '@/lib/gatherings';
import { describeRecurrence } from '@/lib/recurrence';
import { formatClock, formatEventDay, formatEventWindow, isCheckInOpen } from '@/lib/time';
import { cn, gradeLabel, NO_GRADE } from '@/lib/utils';
import { ensureMaterialized, setEventStatus } from '@/services/events';
import { studentFullName } from '@/types';

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-xs uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-ink-200">{value}</dd>
    </div>
  );
}

export function EventDetailPage() {
  const { eventId } = useParams();
  const { events, series, students, loading, canWork, access, rosterBackends } = useData();
  const { user } = useAuth();
  const { show } = useToast();
  const navigate = useNavigate();
  const now = useNow(60_000);

  // The calendar holds a fixed window; a leader paging the past can reach well
  // past it, and every row down there names a real night. See `useEvent`.
  const { event, loading: eventLoading } = useEvent(eventId);
  // `null` rather than a branch below: the register must not be listened for at
  // all on a gathering this reader is not on. See `CheckInPage` for the whole
  // argument — hooks cannot be skipped, so the way to not mount one is to give
  // it nothing.
  const locked = event ? !canWork(event) : false;
  const { attendance, error: attendanceError } = useAttendance(
    locked ? null : (event?.id ?? null),
  );

  const [editorOpen, setEditorOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [busy, setBusy] = useState(false);

  /*
   * The RSVP list, for the export only, and only where it means something.
   *
   * `RsvpManager` opens its own listener further down the page; this is the
   * second on the same small subcollection and it exists because the export
   * has to name the people who said yes and did not come, which is a question
   * only a one-off has.
   */
  const { rsvps: exportRsvps } = useRsvps(
    !locked && event?.mode === 'oneoff' ? (event?.id ?? null) : null,
  );

  /*
   * Names for the uids on the register, fetched when somebody looks like they
   * are about to need them rather than on every page view.
   *
   * `useTeam` is deliberately outside `DataProvider` — a listener on the whole
   * team is not worth opening for every counselor on every screen. Arming it on
   * hover means the names are usually in hand by the time the button is pressed,
   * and the export never waits on them.
   */
  const [teamArmed, setTeamArmed] = useState(false);
  const team = useTeam(teamArmed);

  if (!event) {
    if (loading || eventLoading) {
      return (
        // The same frame as the loaded page: a skeleton that stands somewhere
        // else is a page that jumps sideways the moment it arrives.
        <PageFrame width="lg">
          <SkeletonRows count={3} />
        </PageFrame>
      );
    }
    return (
      <PageFrame width="lg">
        <EmptyState
          icon="🗓"
          title="That event is not here"
          description="It may have been deleted, or it may be older than the few months Tally keeps loaded."
          action={
            <Link
              to="/events"
              className="inline-flex min-h-11 items-center rounded-xl bg-ink-800 px-4 text-sm font-semibold text-ink-100 ring-1 ring-ink-700"
            >
              Back to events
            </Link>
          }
        />
      </PageFrame>
    );
  }

  /*
   * Branched before anything reads `attendance`, and that ordering is the bug
   * this fixes rather than a tidiness preference.
   *
   * A refused listener leaves `attendance` empty, and `readsAsCancelled` below
   * asks exactly that question — so a restricted gathering that ran perfectly
   * well, with forty students in the room, rendered as "reads as cancelled"
   * with an empty register underneath it presented as fact.
   */
  if (locked) {
    return <LockedGathering event={event} now={now} backTo="/events" backLabel="Events" />;
  }

  const accessList = access.get(chainKey(event));
  const cancelled = event.status === 'cancelled';
  const seriesTitle = series.find((candidate) => candidate.id === event.seriesId)?.title ?? null;
  // Said out loud, because a trip with a predicted roster looks identical to one
  // without until somebody taps "Recent" and wonders where the list came from.
  const predictedFrom =
    gatheringOptions(events, series).find((chain) => chain.key === event.predictFromChain)?.title ??
    null;

  /*
   * A finished gathering with nobody checked in.
   *
   * Every derivation over history already treats this as a cancelled session —
   * see `src/lib/sessionHistory.ts` — so this page says so rather than leaving a
   * leader to wonder why the night is missing from the trend strip.
   */
  const readsAsCancelled = !cancelled && event.checkInClosesAt < now && attendance.length === 0;

  /*
   * Whether Attendance has anything to say yet, and therefore where it goes.
   *
   * On a gathering that has not happened, "checked in" is zero by definition —
   * the number is not news, it is arithmetic. So the card shrinks to the one
   * sentence that *is* news ("still ahead") and the RSVP list, which is the
   * only thing on the page with names in it, takes the place under the hero.
   */
  const stillAhead = event.startAt > now;
  const attendanceAhead = stillAhead && attendance.length === 0;
  const rsvpFirst =
    event.mode === 'oneoff' && (stillAhead || (event.requiresRsvp && attendance.length === 0));

  const studentsById = new Map(students.map((student) => [student.id, student]));
  const present = attendance
    .map((record) => ({ record, student: studentsById.get(record.studentId) ?? null }))
    .sort((a, b) => b.record.checkedInAt.getTime() - a.record.checkedInAt.getTime());

  const checkedOut = attendance.filter((record) => record.checkedOutAt !== null);

  const registerExportRows = registerRows(event, attendance, exportRsvps, studentsById);
  const buildRegisterExport = () => ({
    filename: exportFilename({ kind: 'register', scope: event.title, at: event.startAt }),
    contents: buildRegisterCsv(registerExportRows, {
      event,
      // Resolved here rather than inside the builder, which has no business
      // holding a Firestore subscription.
      namesByUid: new Map(
        [...team.byUid].flatMap(([uid, profile]) => {
          const name = shortName(profile);
          return name ? [[uid, name] as const] : [];
        }),
      ),
      backends: rosterBackends,
    }),
  });

  const toggleStatus = async () => {
    if (!user) return;
    setBusy(true);
    try {
      // Calling off a gathering the rules merely describe is the act that makes
      // it a document — there is nothing to set a status on until there is one.
      const eventId = await ensureMaterialized(event);
      await setEventStatus(eventId, cancelled ? 'scheduled' : 'cancelled', user.uid);
      show(cancelled ? `${event.title} is back on` : `${event.title} cancelled`, {
        tone: 'success',
      });
    } catch {
      show('Could not change this event. Try again.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const rsvpCard = event.mode === 'oneoff' ? <RsvpManager event={event} /> : null;

  return (
    <PageFrame width="lg">
      <Link to="/events" className="text-sm font-semibold text-brand-300">
        ‹ Events
      </Link>

      {/*
        One column under a thumb, two under a pointer.

        The seam is between what the gathering *is* — the hero, its details and
        the actions that change them — and what it has to report: who came, who
        may take the register, and the foot of the page. The left column is
        capped at the measure the whole page used to be, so the prose in it
        reads the way it always did and the recovered width goes to the half
        that is a list.
      */}
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,32rem)_minmax(0,1fr)] lg:items-start lg:gap-8">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <div className="flex flex-col gap-3 p-4">
              <div className="flex min-w-0 items-start gap-3">
                <EventIcon name={event.icon} size="lg" tone="brand" />
                <div className="min-w-0 flex-1">
                  <h1
                    className={cn(
                      'text-xl font-bold',
                      cancelled ? 'text-ink-400 line-through' : 'text-ink-50',
                    )}
                  >
                    {event.title}
                  </h1>
                  <p className="mt-1 text-sm text-ink-400">
                    {formatEventDay(event.startAt, now)} · {formatEventWindow(event)}
                  </p>
                </div>
              </div>

              {event.description ? (
                <p className="text-sm leading-relaxed text-ink-300">{event.description}</p>
              ) : null}

              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={event.mode === 'recurring' ? 'neutral' : 'brand'}>
                  {event.mode === 'recurring' ? 'Recurring' : 'One-off'}
                </Badge>
                {cancelled ? <Badge tone="danger">Cancelled</Badge> : null}
                {!cancelled && isCheckInOpen(event, now) ? (
                  <Badge tone="success">Check-in open</Badge>
                ) : null}
                {event.requiresRsvp ? <Badge tone="warn">RSVP only</Badge> : null}
                {event.requiresCheckOut ? <Badge tone="neutral">Check-out</Badge> : null}
              </div>

              <dl className="divide-y divide-ink-800 border-t border-ink-800 pt-1">
                {seriesTitle ? <DetailRow label="Series" value={seriesTitle} /> : null}
                {predictedFrom ? <DetailRow label="Regulars from" value={predictedFrom} /> : null}
                {event.recurrence ? (
                  <DetailRow
                    label="Repeats"
                    value={describeRecurrence(event.recurrence, event.startAt)}
                  />
                ) : null}
                {event.location ? <DetailRow label="Location" value={event.location} /> : null}
                <DetailRow
                  label="Check-in"
                  value={`${formatClock(event.checkInOpensAt)} – ${formatClock(event.checkInClosesAt)}`}
                />
              </dl>

              {event.notes ? (
                <p className="whitespace-pre-line rounded-xl bg-ink-950 p-3 text-sm text-ink-300 ring-1 ring-ink-800">
                  {event.notes}
                </p>
              ) : null}

              <div className="flex flex-col gap-2">
                <Link
                  to={`/event/${event.id}`}
                  className="inline-flex min-h-14 w-full items-center justify-center rounded-xl bg-brand-500 px-5 text-base font-semibold text-white active:bg-brand-600"
                >
                  Take attendance
                </Link>
                <div className="flex gap-2">
                  <Button variant="secondary" className="flex-1" onClick={() => setEditorOpen(true)}>
                    Edit
                  </Button>

                  {/*
                    * Cancelling used to be one tap, sitting right beside Edit with
                    * only colour between them — a stray thumb calls off a gathering
                    * forty families are expecting. Un-cancelling stays one tap,
                    * because putting friction on the recovery is backwards.
                    */}
                  {cancelled ? (
                    <Button
                      variant="secondary"
                      className="flex-1"
                      loading={busy}
                      onClick={() => void toggleStatus()}
                    >
                      Un-cancel
                    </Button>
                  ) : confirmingCancel ? (
                    <div className="flex flex-1 gap-2">
                      <Button variant="ghost" className="flex-1" onClick={() => setConfirmingCancel(false)}>
                        Keep it
                      </Button>
                      <Button
                        variant="danger"
                        className="flex-1"
                        loading={busy}
                        onClick={() => {
                          setConfirmingCancel(false);
                          void toggleStatus();
                        }}
                      >
                        Yes, cancel
                      </Button>
                    </div>
                  ) : (
                    <Button variant="secondary" className="flex-1" onClick={() => setConfirmingCancel(true)}>
                      Cancel event
                    </Button>
                  )}
                </div>

                {confirmingCancel ? (
                  <p role="alert" className="text-center text-xs text-ink-400">
                    Cancelling hides {event.title} from check-in. Attendance already recorded is kept.
                  </p>
                ) : null}
              </div>
            </div>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {rsvpFirst ? rsvpCard : null}

          <Card>
            <CardHeader
              title="Attendance"
              count={attendance.length}
              action={
                // Not offered on a gathering nothing has been recorded against, and
                // not on a projected one: `materialized === false` means this id
                // names a document that does not exist, so a register read comes
                // back empty and a file would assert nobody came.
                event.materialized && !locked ? (
                  <div onPointerEnter={() => setTeamArmed(true)} onFocus={() => setTeamArmed(true)}>
                    <ExportCsvButton
                      build={buildRegisterExport}
                      count={registerExportRows.length}
                      noun="check-ins"
                    />
                  </div>
                ) : undefined
              }
            />
            {attendanceAhead ? (
              /* One line, where there used to be three ways of saying zero: the
                 header count, a 97px tile, and a sentence under it. */
              <p className="px-4 py-3 text-sm text-ink-500">
                Nothing recorded yet — this event is still ahead.
              </p>
            ) : (
              <div className="flex flex-col gap-3 p-3">
                {attendanceError ? <ErrorBanner message={attendanceError} /> : null}

                <StatTile
                  label="Checked in"
                  value={attendance.length}
                  tone={attendance.length > 0 ? 'success' : 'neutral'}
                  hint={readsAsCancelled ? 'Counted as a cancelled gathering.' : undefined}
                />

                {/* Neutral whatever the number: a gathering where half the children
                    were signed out by a parent who then walked off without telling
                    anybody is a normal morning, not a failure to report. */}
                {event.requiresCheckOut ? (
                  <StatTile
                    label="Checked out"
                    value={checkedOut.length}
                    tone="neutral"
                    hint={
                      attendance.length > 0
                        ? `${checkedOut.length} of ${attendance.length} checked out.`
                        : undefined
                    }
                  />
                ) : null}

                {/* No bare "Nobody has been checked in." under it: the header's count
                    and the tile have both already said zero, and a third copy of it is
                    what pushed the names that far down the page. */}
                {present.length === 0 ? (
                  readsAsCancelled ? (
                    <div className="rounded-xl bg-ink-950 px-3 py-2 ring-1 ring-ink-800">
                      <p className="text-sm text-ink-300">
                        Nobody was checked in, so Tally reads this as a cancelled gathering: it is not
                        counted as a miss for anybody, and it does not inform the predictive roster or the
                        trend strip.
                      </p>
                      <p className="mt-1 text-xs text-ink-500">
                        If it did go ahead and nobody took attendance, you can still take it now. If it
                        was called off, cancelling the event says so on purpose.
                      </p>
                    </div>
                  ) : null
                ) : (
                  <ul className="flex flex-col gap-2">
                    {present.map(({ record, student }) => (
                      <li
                        key={record.id}
                        className="flex min-h-12 items-center gap-3 rounded-xl bg-ink-950 px-3 py-2 ring-1 ring-ink-800"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-100">
                          {student ? studentFullName(student) : 'Former student'}
                        </span>
                        {student ? (
                          <span className="shrink-0 text-xs text-ink-500">
                            {gradeLabel(student) ?? NO_GRADE}
                          </span>
                        ) : null}
                        <span className="shrink-0 text-xs tabular-nums text-ink-500">
                          {formatClock(record.checkedInAt)}
                        </span>
                        {/* Only where there is one. A student with no pickup recorded
                            gets nothing here — no badge, no dash, no colour. */}
                        {event.requiresCheckOut && record.checkedOutAt ? (
                          <span className="shrink-0 text-xs tabular-nums text-ink-400">
                            → {formatClock(record.checkedOutAt)}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Card>

          {rsvpFirst ? null : rsvpCard}

          {/*
            Who's on this gathering.
            Above the danger zone and below the register, because it is an ordinary
            setting rather than something destructive — but it is the one setting on
            this page that changes what other people can see, so it is not buried in
            the editor modal either.
          */}
          <Card>
            <div className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-ink-100">Who's on this gathering</h2>
                <p className="truncate text-xs text-ink-500">
                  {accessList?.restricted
                    ? `${accessList.members.size} ${accessList.members.size === 1 ? 'person' : 'people'} — everyone else sees it locked`
                    : 'Everyone on the team can take this register'}
                </p>
              </div>
              <Button variant="secondary" onClick={() => setAccessOpen(true)}>
                {accessList?.restricted ? 'Change' : 'Limit'}
              </Button>
            </div>
          </Card>

          <EventDangerZone
            event={event}
            checkedIn={attendance.length}
            onDeleted={() => navigate('/events', { replace: true })}
          />
        </div>
      </div>

      <EventEditorModal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        event={event}
      />

      <AccessSheet
        open={accessOpen}
        onClose={() => setAccessOpen(false)}
        event={event}
        now={now}
      />
    </PageFrame>
  );
}
