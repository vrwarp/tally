/**
 * Students nobody can be reached about (Journey 3's handoff).
 *
 * Two kinds of row, and they are fixed in different places:
 *
 *  - A visitor quick-added at the door. Quick-add is intentionally two fields
 *    so check-in stays under three seconds; this list is the other half of that
 *    bargain. Age matters more than count — one added on Friday is a normal
 *    to-do, one from three weeks ago is a student the ministry cannot reach in
 *    an emergency — so the row states how long it has been waiting and colours
 *    accordingly.
 *  - A student the church already has on file whose Planning Center profile has
 *    no parent contact on it. Nothing was "added" here and nothing is waiting on
 *    Tally: somebody has to put a number into Planning Center, and the row says
 *    so rather than inventing an age for a record Tally never created.
 */
import { Link } from 'react-router-dom';
import { Badge, Card, CardHeader, EmptyState, Spinner } from '@/components/ui';
import { formatShortDate } from '@/lib/time';
import { initials, ordinalGrade } from '@/lib/utils';
import { studentFullName, type Student } from '@/types';

/** Past this many days an unfinished profile stops being a fresh to-do. */
const STALE_DAYS = 7;
const VERY_STALE_DAYS = 21;

export interface IncompleteProfileListProps {
  students: readonly Student[];
  /** Passed in rather than read from the clock, so the ageing is testable. */
  now: Date;
  /**
   * True while Planning Center is still being asked which profiles have a
   * parent contact. Said out loud: a list that is still counting looks exactly
   * like a list with nothing on it.
   */
  checking?: boolean;
  /** Why the check could not be made, if it could not. */
  error?: string | null;
}

export function IncompleteProfileList({
  students,
  now,
  checking = false,
  error = null,
}: IncompleteProfileListProps) {
  return (
    <Card>
      <CardHeader
        title="Incomplete profiles"
        count={students.length}
        description="Active students with no parent phone or email on file."
      />

      {error ? (
        <p className="px-3 py-2 text-xs text-danger-400">{error}</p>
      ) : null}

      {students.length === 0 ? (
        checking ? (
          <p className="flex items-center gap-2 px-3 py-2 text-xs text-ink-500">
            <Spinner /> Checking who has a parent contact…
          </p>
        ) : error ? null : (
          <EmptyState
            title="Every profile has a parent contact."
            description="Quick-added visitors and students with nobody on file land here — right now nobody is waiting."
          />
        )
      ) : (
        <ul className="divide-y divide-ink-800">
          {students.map((student) => (
            <IncompleteRow key={student.id} student={student} now={now} />
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * How long this profile has been waiting, or null when the question does not
 * apply.
 *
 * A student who came from Planning Center carries the epoch as `createdAt` —
 * deliberately, so that no past gathering predates them on the MIA list — and
 * rendering that would tell a leader the profile has been waiting since 1970.
 */
function waitingDays(student: Student, now: Date): number | null {
  if (student.createdAt.getTime() <= 0) return null;
  return Math.max(0, Math.floor((now.getTime() - student.createdAt.getTime()) / 86_400_000));
}

function IncompleteRow({ student, now }: { student: Student; now: Date }) {
  const days = waitingDays(student, now);
  const tone =
    days === null ? 'warn' : days >= VERY_STALE_DAYS ? 'danger' : days >= STALE_DAYS ? 'warn' : 'neutral';
  const badge =
    days === null
      ? 'Nobody on file'
      : days === 0
        ? 'Added today'
        : `Waiting ${days} ${days === 1 ? 'day' : 'days'}`;

  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <span
        aria-hidden="true"
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-ink-800 text-sm font-bold text-ink-300"
      >
        {initials(student.firstName, student.lastName)}
      </span>

      <Link
        to={`/students/${student.id}`}
        className="flex min-h-11 min-w-0 flex-1 flex-col justify-center hover:text-brand-300"
      >
        <span className="flex items-baseline gap-2">
          <span className="truncate text-base font-semibold text-ink-50">
            {studentFullName(student)}
          </span>
          {student.isVisitor ? (
            <Badge tone="brand" className="shrink-0">
              Visitor
            </Badge>
          ) : null}
        </span>
        <span className="truncate text-xs text-ink-500">
          {ordinalGrade(student.grade)} grade ·{' '}
          {days === null
            ? 'no parent contact in Planning Center'
            : `added ${formatShortDate(student.createdAt)}`}
        </span>
      </Link>

      <Badge tone={tone} className="shrink-0">
        {badge}
      </Badge>

      <span aria-hidden="true" className="shrink-0 text-ink-600">
        ›
      </span>
    </li>
  );
}
