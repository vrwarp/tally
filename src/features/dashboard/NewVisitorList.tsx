/**
 * First-timers inside the new-visitor window (Journey 5).
 *
 * A visitor's second visit is decided in the week after their first, so this
 * list is deliberately short-lived: it shows who arrived, which gathering they
 * arrived at, and the fastest way to say "great to meet you". Most of these
 * students were quick-added at the door and still have no parent contact, so
 * the row's action is either "reach them" or "finish their profile" — never
 * both, and never nothing.
 */
import { Link } from 'react-router-dom';
import { Badge, Card, CardHeader, EmptyState } from '@/components/ui';
import { FollowUpActions } from '@/features/dashboard/FollowUpActions';
import { formatRelative, formatShortDate } from '@/lib/time';
import { initials, ordinalGrade } from '@/lib/utils';
import { studentFullName, type NewVisitor } from '@/types';

export interface NewVisitorListProps {
  items: readonly NewVisitor[];
  /** `settings.newVisitorWindowDays`. */
  windowDays: number;
}

export function NewVisitorList({ items, windowDays }: NewVisitorListProps) {
  return (
    <Card>
      <CardHeader
        title="New faces"
        count={items.length}
        description={`First time at Footprints in the last ${windowDays} days.`}
      />

      {items.length === 0 ? (
        <EmptyState
          title="No first-timers this week."
          description="Anyone checked in for the first time shows up here while the visit is still fresh."
        />
      ) : (
        <ul className="divide-y divide-ink-800">
          {items.map((visitor) => (
            <NewVisitorRow key={visitor.student.id} visitor={visitor} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function NewVisitorRow({ visitor }: { visitor: NewVisitor }) {
  const { student, firstEventTitle, firstAttendedAt } = visitor;

  return (
    <li className="px-3 py-2">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-sm font-bold text-brand-300"
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
            <span className="shrink-0 text-xs text-ink-500">
              {ordinalGrade(student.grade)}
            </span>
          </span>
          <span className="truncate text-xs text-ink-500">
            {firstEventTitle} · {formatShortDate(firstAttendedAt)}, {formatRelative(firstAttendedAt)}
          </span>
        </Link>

        {!student.profileComplete ? (
          <Badge tone="warn" title="No parent contact on file">
            <span aria-hidden="true">⚠</span>
            Incomplete
          </Badge>
        ) : null}
      </div>

      {student.profileComplete ? (
        <FollowUpActions student={student} className="mt-1 pb-1 pl-14" />
      ) : (
        <Link
          to={`/students/${student.id}`}
          aria-label={`Add parent contact for ${studentFullName(student)}`}
          className="mt-1 ml-14 mb-1 inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-warn-500/10 px-3 text-sm font-semibold text-warn-400 ring-1 ring-warn-500/25 hover:bg-warn-500/15"
        >
          <span aria-hidden="true">＋</span>
          Add parent contact
        </Link>
      )}
    </li>
  );
}
