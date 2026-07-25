/**
 * Profiles that are still just a name and a grade (Journey 3's handoff).
 *
 * Quick-add is intentionally two fields so check-in stays under three seconds;
 * this list is the other half of that bargain. Age matters more than count — a
 * visitor added on Friday is a normal to-do, one from three weeks ago is a
 * student the ministry cannot reach in an emergency — so every row states how
 * long it has been waiting and colours accordingly.
 */
import { Link } from 'react-router-dom';
import { Badge, Card, CardHeader, EmptyState } from '@/components/ui';
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
}

export function IncompleteProfileList({ students, now }: IncompleteProfileListProps) {
  return (
    <Card>
      <CardHeader
        title="Incomplete profiles"
        count={students.length}
        description="Active students with no parent phone or email on file."
      />

      {students.length === 0 ? (
        <EmptyState
          title="Every profile has a parent contact."
          description="Quick-added visitors land here until somebody fills in a number — right now nobody is waiting."
        />
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

function IncompleteRow({ student, now }: { student: Student; now: Date }) {
  const days = Math.max(
    0,
    Math.floor((now.getTime() - student.createdAt.getTime()) / 86_400_000),
  );
  const tone = days >= VERY_STALE_DAYS ? 'danger' : days >= STALE_DAYS ? 'warn' : 'neutral';
  const waiting = days === 0 ? 'Added today' : `Waiting ${days} ${days === 1 ? 'day' : 'days'}`;

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
          {ordinalGrade(student.grade)} grade · added {formatShortDate(student.createdAt)}
        </span>
      </Link>

      <Badge tone={tone} className="shrink-0">
        {waiting}
      </Badge>

      <span aria-hidden="true" className="shrink-0 text-ink-600">
        ›
      </span>
    </li>
  );
}
