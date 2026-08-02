/**
 * A gathering older than the calendar Tally keeps loaded, shown as a record.
 *
 * The check-in screen is a roster: a list of who *might* turn up, ordered by a
 * prediction, with every row a write waiting to happen. None of that is
 * available for a night from two years ago. `DataProvider` holds a fixed
 * window of events, so nothing around this night is loaded — the chain's other
 * instances, the ones the "Recent" filter is computed from, are not there. A
 * roster drawn anyway would order itself from *this term's* attendance and
 * present it as though it described that night, which is a confident wrong
 * answer rather than a missing one.
 *
 * So the night opens as what it unambiguously is: who was checked in, and
 * when. That is the whole reason somebody followed a two-year-old link.
 *
 * Read-only is a consequence of the same fact rather than a policy. Nothing
 * here refuses a write on principle; there is simply no roster to tap, because
 * the app cannot honestly draw one this far back.
 */
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/ui';
import { formatClock, formatEventDay, formatEventWindow } from '@/lib/time';
import { gradeLabel, NO_GRADE } from '@/lib/utils';
import { studentFullName, type AttendanceRecord, type Student, type TallyEvent } from '@/types';

export interface ArchivedNightProps {
  event: TallyEvent;
  attendance: readonly AttendanceRecord[];
  /** The roster, for putting names to the ids on the records. */
  students: readonly Student[];
  now: Date;
}

export function ArchivedNight({ event, attendance, students, now }: ArchivedNightProps) {
  const byId = new Map(students.map((student) => [student.id, student]));

  const present = attendance
    .map((record) => ({ record, student: byId.get(record.studentId) ?? null }))
    .sort((a, b) => a.record.checkedInAt.getTime() - b.record.checkedInAt.getTime());

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-4">
      <Link to="/" className="text-sm font-semibold text-brand-300">
        ‹ Check-in
      </Link>

      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-ink-50">{event.title}</h1>
        <p className="text-sm text-ink-400">
          {formatEventDay(event.startAt, now)} · {formatEventWindow(event)}
        </p>
        {/* Said plainly, because the absence of the usual roster is the first
            thing somebody will notice and the last thing they should have to
            guess at. */}
        <p className="mt-1 text-xs text-ink-500">
          This night is older than the few months Tally keeps loaded, so it opens as a record of
          what happened rather than a roster.
        </p>
      </header>

      <section aria-labelledby="archived-present" className="flex flex-col gap-2">
        <h2
          id="archived-present"
          className="flex items-baseline justify-between text-xs font-bold uppercase tracking-wider text-ink-400"
        >
          <span>Checked in</span>
          <span className="tabular-nums text-ink-300">{present.length}</span>
        </h2>

        {present.length === 0 ? (
          <EmptyState
            icon="🗓"
            title="Nobody was checked in"
            description="Tally reads a finished gathering with no attendance as one that did not happen — it is not a miss for anybody."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {present.map(({ record, student }) => (
              <li
                key={record.id}
                className="flex min-h-12 items-center gap-3 rounded-xl bg-ink-900 px-3 py-2 ring-1 ring-ink-800"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-100">
                  {/* A student taken off the roster since keeps their history;
                      the row says so rather than rendering a blank name. */}
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
      </section>
    </div>
  );
}
