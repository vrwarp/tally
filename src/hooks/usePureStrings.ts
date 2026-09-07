/**
 * What the pure sentence-builders need from the catalogue, in one place.
 *
 * The describers there build a *sentence* — "Every 2 weeks on Fri and Sun,
 * until Mar 5, 2027" — out of clauses whose order, whose list separator and
 * whose date format all differ per language. They are pure functions in a
 * module with no React in it, so they take the translator and the locale as an
 * argument rather than reaching for them; this hook is the argument.
 *
 * Memoised on both, so the object identity is stable across renders and a
 * caller can safely put it in a `useMemo` dependency array.
 */
import { useMemo } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import type { RecurrenceStrings } from '@/lib/recurrence';
import type { SyncStripStrings } from '@/features/students/syncStripCopy';
import type { GradeStrings } from '@/lib/grades';

export function useRecurrenceStrings(): RecurrenceStrings {
  const t = useTranslations('Recurrence');
  const locale = useLocale();
  return useMemo(
    () => ({
      // The catalogue is typed against en.json and these keys are looked up by
      // index out of static tables, so the cast is where the two meet. The
      // parity test is what keeps the key set honest.
      t: t as unknown as RecurrenceStrings['t'],
      locale,
    }),
    [t, locale],
  );
}

/**
 * The same arrangement for `syncStripCopy`, which builds a paragraph out of a
 * field list, who made the edit and how long ago — all of which move around
 * the sentence differently per language.
 */
export function useSyncStripStrings(): SyncStripStrings {
  const t = useTranslations('SyncStrip');
  const locale = useLocale();
  return useMemo(
    () => ({ t: t as unknown as SyncStripStrings['t'], locale }),
    [t, locale],
  );
}

/**
 * The grade catalogue, for `lib/grades.ts`.
 *
 * A component calls this; a pure formatter takes the result as an argument.
 * `useTranslations` already returns a stable function per (locale, messages),
 * so there is nothing to memoise.
 */
export function useGrades(): GradeStrings {
  return useTranslations('Grades') as unknown as GradeStrings;
}

