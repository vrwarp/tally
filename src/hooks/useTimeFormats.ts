/**
 * Dates and times, in the reader's language.
 *
 * `lib/time.ts` has no React in it and formats through `Intl`, so it needs to
 * be told the locale and handed the four words `Intl` does not supply — see
 * `TimeStrings` there. This is that argument, memoised so a component can put
 * it in a dependency array.
 *
 * Returned pre-bound rather than as a bare `TimeStrings`, because the
 * alternative is every call site on every screen growing a first argument that
 * is the same object each time.
 */
import { useMemo } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import {
  formatClock,
  formatDateTime,
  formatEventDay,
  formatEventWindow,
  formatRelative,
  formatSeenShort,
  formatShortDate,
  type TimeStrings,
} from '@/lib/time';

export interface TimeFormats {
  /** "Today", "Tomorrow", or "Sun, Feb 15". */
  eventDay: (date: Date, now?: Date) => string;
  /** "7:00 PM – 9:00 PM", with the end's date when it lands on another day. */
  eventWindow: (event: { startAt: Date; endAt?: Date | null }) => string;
  /** "Feb 13, 2026 · 7:00 PM". */
  dateTime: (date: Date) => string;
  /** "Feb 13". */
  shortDate: (date: Date) => string;
  /** "7:00 PM". */
  clock: (date: Date) => string;
  /** "2 hours ago", and "in 2 hours" for a date that has not happened. */
  relative: (date: Date, now?: Date) => string;
  /** The roster column: "Today", "Fri", "3 wks ago". */
  seenShort: (date: Date, now?: Date) => string;
}

export function useTimeStrings(): TimeStrings {
  const t = useTranslations('Time');
  const locale = useLocale();
  return useMemo(() => ({ locale, t: t as unknown as TimeStrings['t'] }), [locale, t]);
}

export function useTimeFormats(): TimeFormats {
  const strings = useTimeStrings();
  return useMemo(
    () => ({
      eventDay: (date, now) => formatEventDay(strings, date, now),
      eventWindow: (event) => formatEventWindow(strings, event),
      dateTime: (date) => formatDateTime(strings, date),
      shortDate: (date) => formatShortDate(strings, date),
      clock: (date) => formatClock(strings, date),
      relative: (date, now) => formatRelative(strings, date, now),
      seenShort: (date, now) => formatSeenShort(strings, date, now),
    }),
    [strings],
  );
}
