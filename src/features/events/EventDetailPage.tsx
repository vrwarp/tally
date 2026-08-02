/**
 * One event: what it is, who came, and the destructive-ish actions.
 *
 * Cancel is the safe operation and is always available — it is reversible and
 * it keeps the attendance history that the predictive roster and the dashboard
 * are built from, so it stays the thing this page offers beside Edit. Deleting
 * — one gathering with its check-ins, or a whole repeat with all of them — is
 * the thing that cannot be undone, and it lives at the foot of the page behind
 * a typed confirmation. See `EventDangerZone`.
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
import { useAuth } from '@/context/authContext';
import { useData } from '@/context/dataContext';
import { useToast } from '@/context/toastContext';
import { EventDangerZone } from '@/features/events/EventDangerZone';
import { EventEditorModal } from '@/features/events/EventEditorModal';
import { RsvpManager } from '@/features/events/RsvpManager';
import { useAttendance } from '@/hooks/useAttendance';
import { useNow } from '@/hooks/useNow';
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
  const { events, series, students, loading } = useData();
  const { user } = useAuth();
  const { show } = useToast();
  const navigate = useNavigate();
  const now = useNow(60_000);

  const event = events.find((candidate) => candidate.id === eventId) ?? null;
  const { attendance, error: attendanceError } = useAttendance(event?.id ?? null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!event) {
    if (loading) {
      return (
        <div className="mx-auto max-w-lg px-4 py-4">
          <SkeletonRows count={3} />
        </div>
      );
    }
    return (
      <div className="mx-auto max-w-lg px-4 py-4">
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
      </div>
    );
  }

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

  const studentsById = new Map(students.map((student) => [student.id, student]));
  const present = attendance
    .map((record) => ({ record, student: studentsById.get(record.studentId) ?? null }))
    .sort((a, b) => b.record.checkedInAt.getTime() - a.record.checkedInAt.getTime());

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

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-4">
      <Link to="/events" className="text-sm font-semibold text-brand-300">
        ‹ Events
      </Link>

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

      <Card>
        <CardHeader title="Attendance" count={attendance.length} />
        <div className="flex flex-col gap-3 p-3">
          {attendanceError ? <ErrorBanner message={attendanceError} /> : null}

          <StatTile
            label="Checked in"
            value={attendance.length}
            tone={attendance.length > 0 ? 'success' : 'neutral'}
            hint={
              event.startAt > now
                ? 'Nothing recorded yet — this event is still ahead.'
                : readsAsCancelled
                  ? 'Counted as a cancelled gathering.'
                  : undefined
            }
          />

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
            ) : (
              <p className="px-1 text-sm text-ink-500">Nobody has been checked in.</p>
            )
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
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {event.mode === 'oneoff' ? <RsvpManager event={event} /> : null}

      <EventDangerZone
        event={event}
        checkedIn={attendance.length}
        onDeleted={() => navigate('/events', { replace: true })}
      />

      <EventEditorModal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        event={event}
      />
    </div>
  );
}
