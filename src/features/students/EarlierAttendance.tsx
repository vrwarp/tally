/**
 * Every night this student has been checked in to, however long ago.
 *
 * The card above this one is the *analysis*: the last few nights of each
 * gathering, with the misses marked and a streak counted. It can only say that
 * much about nights the app has loaded, because a miss is a fact about the
 * gathering's calendar — you have to know a night happened to know somebody was
 * not at it — and the calendar in memory is a fixed window.
 *
 * This is the record underneath it, and it answers the one question the window
 * makes unanswerable: when *has* this student come. It reads the student's own
 * attendance documents, which reach back as far as the ministry has records —
 * for a roster imported out of Planning Center Check-Ins, years.
 *
 * What it deliberately does not do is infer absences. Every row here is a night
 * they were present; nothing is claimed about the nights between them, because
 * establishing that would mean paging every instance of every gathering back to
 * the beginning. The heading says so, so that a sparse-looking list is not read
 * as a patchy attender.
 *
 * Nothing loads until somebody presses. See `useStudentHistory`.
 */
import { Button, Card, CardHeader, ErrorBanner, SkeletonRows } from '@/components/ui';
import { useStudentHistory } from '@/hooks/useStudentHistory';
import { formatShortDate } from '@/lib/time';

export interface EarlierAttendanceProps {
  studentId: string;
}

export function EarlierAttendance({ studentId }: EarlierAttendanceProps) {
  const { entries, started, loading, hasMore, error, loadMore } = useStudentHistory(studentId);

  return (
    <Card>
      <CardHeader
        title="Every night they came"
        {...(started && entries.length > 0 ? { count: entries.length } : {})}
      />

      <div className="flex flex-col gap-3 px-4 pb-4">
        <p className="text-xs text-ink-500">
          Read from this student&rsquo;s own check-in records, so it reaches back as far as Tally
          has them — further than the year the screens above keep loaded. Only nights they
          were here; nothing is claimed about the ones in between.
        </p>

        {error ? (
          <ErrorBanner message="Could not read this student's attendance history." />
        ) : null}

        {started && entries.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {entries.map(({ record, event }) => (
              <li
                key={`${record.eventId}:${record.id}`}
                className="flex min-h-11 items-center justify-between gap-3 rounded-xl bg-ink-950 px-3 py-2 ring-1 ring-ink-800"
              >
                <span className="min-w-0 truncate text-sm text-ink-200">
                  {/* A record whose event document is gone still happened, and
                      saying so is more honest than dropping the row. */}
                  {event?.title ?? 'A gathering no longer on record'}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-ink-500">
                  {formatShortDate(event?.startAt ?? record.checkedInAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {loading ? <SkeletonRows count={3} /> : null}

        {started && !loading && entries.length === 0 && !error ? (
          <p className="text-sm text-ink-400">Tally has no check-ins on record for them.</p>
        ) : null}

        {!loading && hasMore ? (
          <Button variant="secondary" fullWidth onClick={loadMore}>
            {started ? 'Show more' : 'Show every night they came'}
          </Button>
        ) : null}

        {started && !hasMore && entries.length > 0 ? (
          <p className="text-center text-xs text-ink-600">That is everything on record.</p>
        ) : null}
      </div>
    </Card>
  );
}
