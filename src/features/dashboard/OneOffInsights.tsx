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
import { Card, CardHeader, EmptyState, EventIcon } from '@/components/ui';
import { ExportCsvButton } from '@/components/ExportCsvButton';
import { CopyContactsButton, FollowUpActions } from '@/features/dashboard/FollowUpActions';
import {
  buildOneOffOnlyCsv,
  NO_EXPORT_CONTEXT,
  type FollowUpCsvContext,
} from '@/features/dashboard/followUpCsv';
import { exportFilename } from '@/lib/csv';
import type { OneOffOnlyStudent, OneOffRecap } from '@/features/dashboard/insights';
import { initials } from '@/lib/utils';
import { gradeSentence } from '@/lib/grades';
import { studentFullName } from '@/types';
import { useTranslations } from 'use-intl';
import { useGrades } from '@/hooks/usePureStrings';
import { useTimeFormats } from '@/hooks/useTimeFormats';

export interface OneOffRecapListProps {
  items: readonly OneOffRecap[];
}

export function OneOffRecapList({ items, className }: OneOffRecapListProps & { className?: string }) {
  const time = useTimeFormats();
  const t = useTranslations('OneOff');
  return (
    <Card className={className}>
      <CardHeader
        title={t('recapTitle')}
        count={items.length}
        description={t('recapDescription')}
      />

      {items.length === 0 ? (
        <EmptyState
          title={t('recapEmptyTitle')}
          description={t('recapEmptyBody')}
        />
      ) : (
        <ul className="divide-y divide-ink-800">
          {items.map((item) => (
            <li key={item.event.id} className="flex items-center gap-3 px-4 py-2">
              {/* The same tile the events list gives it, so a trip looks like
                  itself on both screens. */}
              <EventIcon name={item.event.icon} size="sm" />
              <Link
                to={`/events/${item.event.id}`}
                className="flex min-h-11 min-w-0 flex-1 flex-col justify-center hover:text-brand-300"
              >
                <span className="truncate text-sm font-semibold text-ink-50">
                  {item.event.title}
                </span>
                <span className="truncate text-xs text-ink-500">
                  {time.shortDate(item.event.startAt)}, {time.relative(item.event.startAt)}
                </span>
              </Link>
              <span className="shrink-0 text-right">
                <span className="sr-only">{t('checkedInSpoken', { count: item.count })}</span>
                <span
                  aria-hidden="true"
                  className="block text-lg font-bold leading-tight tabular-nums text-ink-100"
                >
                  {item.count}
                </span>
                {/* "checked in", not "came": this is the number of people
                    somebody tapped, which is a smaller and more honest claim
                    than the number who were there — and it is the word the
                    event card and the hero card already use for the same count
                    ("Finished · 24 checked in"). Three screens, one noun. */}
                <span
                  aria-hidden="true"
                  className="block text-[10px] uppercase tracking-wide text-ink-400"
                >
                  {t('checkedInUnit')}
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
export function OneOffOnlyList({
  items,
  className,
  exportContext = NO_EXPORT_CONTEXT,
}: OneOffOnlyListProps & { className?: string; exportContext?: FollowUpCsvContext }) {
  const time = useTimeFormats();
  const grades = useGrades();
  const t = useTranslations('OneOff');
  if (items.length === 0) return null;

  const students = items.map((item) => item.student);

  return (
    <Card className={className}>
      <CardHeader
        title={t('onlyTitle')}
        count={items.length}
        description={t('onlyDescription')}
        action={
          // The same pair as every other list card. Presence and absence in
          // this slot look like a decision, so it has to be one: any list of
          // students a leader might want in a spreadsheet gets the same two
          // controls, in the same order, at the same weight.
          <>
            <CopyContactsButton
              students={students}
              title={t('onlyExportTitle', { count: items.length })}
            />
            <ExportCsvButton
              build={() => ({
                filename: exportFilename({ kind: 'follow-up', scope: 'met-once', at: new Date() }),
                contents: buildOneOffOnlyCsv(grades, items, exportContext),
              })}
              count={items.length}
              noun="students"
            />
          </>
        }
      />

      <ul className="divide-y divide-ink-800">
        {items.map((item) => {
          const grade = gradeSentence(grades, item.student);

          return (
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
                    {/* Dropped, not replaced, when Planning Center holds no grade
                        for them: where and when they were met is the line. */}
                    {grade
                      ? t('metAtWithGrade', {
                          grade,
                          event: item.events[0]?.title ?? '',
                          date: time.shortDate(item.metAt),
                          relative: time.relative(item.metAt),
                        })
                      : t('metAt', {
                          event: item.events[0]?.title ?? '',
                          date: time.shortDate(item.metAt),
                          relative: time.relative(item.metAt),
                        })}
                  </span>
                </Link>

                <span className="shrink-0 rounded-xl bg-warn-500/10 px-2.5 py-1 text-center ring-1 ring-warn-500/25">
                  <span className="sr-only">
                    {t('missedSinceAria', { count: item.missedSince })}
                  </span>
                  <span
                    aria-hidden="true"
                    className="block text-lg font-bold leading-tight tabular-nums text-warn-400"
                  >
                    {item.missedSince}
                  </span>
                  {/*
                    The unit belongs on the visible caption, not only in the
                    sentence underneath it.

                    This read "4 / since" — a number over an adverb, with no
                    unit and no object — while the screen-reader line two
                    elements up said the whole thing. And it borrows the MIA
                    list's geometry exactly: a big tabular number over a small
                    caption in a ringed chip, two cards further up, where the
                    number counts *missed instances of one gathering*. A leader
                    scanning both lists was being invited to compare "5 missed"
                    with "4 since" as if they measured the same thing, and to
                    phone the wrong family on the strength of it. Naming the
                    unit is what makes the two numbers visibly different
                    measures.
                  */}
                  <span
                    aria-hidden="true"
                    className="block text-[10px] uppercase tracking-wide text-ink-400"
                  >
                    {t('gatheringsSinceUnit', { count: item.missedSince })}
                  </span>
                </span>
              </div>

              <FollowUpActions student={item.student} className="mt-1 pb-1 pl-14" />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
