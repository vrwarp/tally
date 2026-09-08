/**
 * A real translator over the English catalogue, for tests of pure modules.
 *
 * Extraction turns some formatters — the contact-list paste, the CSV headers —
 * into functions that take a `t` instead of holding English literals. Their
 * tests still want to assert the exact sentence a person ends up reading, so
 * rather than stubbing `t` with an identity function (which would assert
 * nothing about the catalogue) they build one from `messages/en.json`.
 *
 * That makes those tests strictly stronger than they were: a key whose ICU is
 * malformed, or whose arguments do not match the call site, now fails there
 * rather than on somebody's screen.
 *
 * Components do not need this — `src/test/rtl.tsx` wraps them in the real
 * provider.
 */
import { createTranslator } from 'use-intl';
import { DEFAULT_LOCALE } from '@/lib/locales';
import en from '../../messages/en.json';
import type { GradeStrings } from '@/lib/grades';

export function testTranslator<Namespace extends keyof typeof en>(namespace: Namespace) {
  return createTranslator({ locale: DEFAULT_LOCALE, messages: en, namespace });
}

/**
 * The grade names, in the shape `lib/grades.ts` takes.
 *
 * Its own export because half a dozen pure formatters need it and the cast is
 * the same every time: `GradeStrings` is a narrow call signature, and
 * `createTranslator` is typed against the whole catalogue.
 */
export function testGrades(): GradeStrings {
  return testTranslator('Grades') as unknown as GradeStrings;
}
