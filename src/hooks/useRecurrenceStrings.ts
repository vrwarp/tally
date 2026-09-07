/**
 * What `src/lib/recurrence.ts` needs from the catalogue, in one place.
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
