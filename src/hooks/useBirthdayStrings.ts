/**
 * The birthday box's words and locale, for `lib/birthdayField.ts`.
 *
 * Same arrangement as `useTimeFormats` and `useGrades`: the module that reads
 * and describes the box is pure and shared between two screens, so a component
 * hands it the catalogue rather than the module reaching for one.
 */
import { useMemo } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import type { BirthdayStrings } from '@/lib/birthdayField';

export function useBirthdayStrings(): BirthdayStrings {
  const t = useTranslations('Birthday');
  const locale = useLocale();
  return useMemo(
    () => ({ locale, t: t as unknown as BirthdayStrings['t'] }),
    [locale, t],
  );
}
