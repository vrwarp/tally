/**
 * The MIA call list (Journey 5, step 2).
 *
 * The single most important list in Tally: a student who has quietly stopped
 * coming is invisible in every other view. Longest-absent first, because that
 * is the order a leader should work the phone, and every row carries the way to
 * reach the family so nobody has to go hunting for a number.
 */
import { Link } from 'react-router-dom';
import { Card, CardHeader, EmptyState } from '@/components/ui';
import { CopyContactsButton, FollowUpActions } from '@/features/dashboard/FollowUpActions';
import { formatRelative, formatShortDate } from '@/lib/time';
import { initials, ordinalGrade } from '@/lib/utils';
import { studentFullName, type MiaStudent } from '@/types';

export interface MiaListProps {
  items: readonly MiaStudent[];
  /** `settings.miaConsecutiveMisses`, quoted back so the list explains itself. */
  threshold: number;
}

export function MiaList({ items, threshold }: MiaListProps) {
  const students = items.map((item) => item.student);

  return (
    <Card>
      <CardHeader
        title="Missing in action"
        count={items.length}
        description={`Missed ${threshold} or more gatherings in a row.`}
        action={
          items.length > 0 ? (
            <CopyContactsButton
              students={students}
              title={`Footprints follow-up — ${items.length} students we have not seen:`}
            />
          ) : undefined
        }
      />

      {items.length === 0 ? (
        <EmptyState
          title={`Nobody has missed ${threshold} in a row — nice.`}
          description="Everyone on the active roster has turned up at one of the recent gatherings."
        />
      ) : (
        <ul className="divide-y divide-ink-800">
          {items.map((item) => (
            <MiaRow key={item.student.id} item={item} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function MiaRow({ item }: { item: MiaStudent }) {
  const { student, consecutiveMisses, lastAttendedAt, lastAttendedEventTitle } = item;
  const name = studentFullName(student);

  const lastSeen = lastAttendedAt
    ? `Last seen ${formatShortDate(lastAttendedAt)}, ${formatRelative(lastAttendedAt)}${
        lastAttendedEventTitle ? ` at ${lastAttendedEventTitle}` : ''
      }`
    : 'Never checked in';

  return (
    <li className="px-3 py-2">
      <div className="flex items-center gap-3">
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
          <span className="truncate text-base font-semibold text-ink-50">{name}</span>
          <span className="truncate text-xs text-ink-500">
            {ordinalGrade(student.grade)} grade · {lastSeen}
          </span>
        </Link>

        <span className="shrink-0 rounded-xl bg-danger-500/10 px-2.5 py-1 text-center ring-1 ring-danger-500/25">
          <span className="sr-only">Missed {consecutiveMisses} gatherings in a row.</span>
          <span
            aria-hidden="true"
            className="block text-lg font-bold leading-tight tabular-nums text-danger-400"
          >
            {consecutiveMisses}
          </span>
          <span aria-hidden="true" className="block text-[10px] uppercase tracking-wide text-ink-400">
            missed
          </span>
        </span>
      </div>

      <FollowUpActions student={student} className="mt-1 pb-1 pl-14" />
    </li>
  );
}
