/**
 * The one-off half of the insights screen (Journey 4 meeting Journey 5).
 *
 * A retreat is not an instance of anything. Nobody can have missed three of
 * them in a row, no streak means anything, and the trend strip has nothing to
 * compare a bus trip against — which is why one-offs sit in their own section
 * below the gathering tabs rather than inside them.
 *
 * Two things a one-off *can* answer, and neither is visible anywhere else:
 * what it drew, and who we met there and have not seen since.
 */
import { Link } from 'react-router-dom';
import { Card, CardHeader, EmptyState } from '@/components/ui';
import { CopyContactsButton, FollowUpActions } from '@/features/dashboard/FollowUpActions';
import type { OneOffOnlyStudent, OneOffRecap } from '@/features/dashboard/insights';
import { formatRelative, formatShortDate } from '@/lib/time';
import { initials, ordinalGrade } from '@/lib/utils';
import { studentFullName } from '@/types';

export interface OneOffRecapListProps {
  items: readonly OneOffRecap[];
}

export function OneOffRecapList({ items }: OneOffRecapListProps) {
  return (
    <Card>
      <CardHeader
        title="One-off events"
        count={items.length}
        description="Retreats and trips. Head count on the night — there is nothing to compare it against."
      />

      {items.length === 0 ? (
        <EmptyState
          title="No one-off events recently."
          description="A retreat or a trip shows up here once somebody has been checked into it."
        />
      ) : (
        <ul className="divide-y divide-ink-800">
          {items.map((item) => (
            <li key={item.event.id} className="flex items-center gap-3 px-4 py-2">
              <Link
                to={`/events/${item.event.id}`}
                className="flex min-h-11 min-w-0 flex-1 flex-col justify-center hover:text-brand-300"
              >
                <span className="truncate text-sm font-semibold text-ink-50">
                  {item.event.title}
                </span>
                <span className="truncate text-xs text-ink-500">
                  {formatShortDate(item.event.startAt)}, {formatRelative(item.event.startAt)}
                </span>
              </Link>
              <span className="shrink-0 text-right">
                <span className="sr-only">{item.count} students checked in.</span>
                <span
                  aria-hidden="true"
                  className="block text-lg font-bold leading-tight tabular-nums text-ink-100"
                >
                  {item.count}
                </span>
                <span
                  aria-hidden="true"
                  className="block text-[10px] uppercase tracking-wide text-ink-400"
                >
                  came
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export interface OneOffOnlyListProps {
  items: readonly OneOffOnlyStudent[];
}

/**
 * Met once, never since.
 *
 * The friend somebody brought on the retreat. They fall through every other
 * list on this screen: never MIA, because they have no gathering to have
 * drifted from, and off the new-faces list as soon as their first visit ages
 * out of the window. Rendered only when it has somebody in it — a permanent
 * empty card here would just be a reminder that retreats exist.
 */
export function OneOffOnlyList({ items }: OneOffOnlyListProps) {
  if (items.length === 0) return null;

  const students = items.map((item) => item.student);

  return (
    <Card>
      <CardHeader
        title="Met once, never since"
        count={items.length}
        description="Came to a one-off and has not been to a regular gathering since."
        action={
          <CopyContactsButton
            students={students}
            title={`Invite — ${items.length} we met once:`}
          />
        }
      />

      <ul className="divide-y divide-ink-800">
        {items.map((item) => (
          <li key={item.student.id} className="px-3 py-2">
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-ink-800 text-sm font-bold text-ink-300"
              >
                {initials(item.student.firstName, item.student.lastName)}
              </span>

              <Link
                to={`/students/${item.student.id}`}
                className="flex min-h-11 min-w-0 flex-1 flex-col justify-center hover:text-brand-300"
              >
                <span className="truncate text-base font-semibold text-ink-50">
                  {studentFullName(item.student)}
                </span>
                <span className="truncate text-xs text-ink-500">
                  {ordinalGrade(item.student.grade)} grade · met at {item.events[0]?.title} ·{' '}
                  {formatShortDate(item.metAt)}, {formatRelative(item.metAt)}
                </span>
              </Link>

              <span className="shrink-0 rounded-xl bg-warn-500/10 px-2.5 py-1 text-center ring-1 ring-warn-500/25">
                <span className="sr-only">
                  {item.missedSince} regular {item.missedSince === 1 ? 'gathering' : 'gatherings'}{' '}
                  since, none of them with this student in it.
                </span>
                <span
                  aria-hidden="true"
                  className="block text-lg font-bold leading-tight tabular-nums text-warn-400"
                >
                  {item.missedSince}
                </span>
                <span
                  aria-hidden="true"
                  className="block text-[10px] uppercase tracking-wide text-ink-400"
                >
                  since
                </span>
              </span>
            </div>

            <FollowUpActions student={item.student} className="mt-1 pb-1 pl-14" />
          </li>
        ))}
      </ul>
    </Card>
  );
}
