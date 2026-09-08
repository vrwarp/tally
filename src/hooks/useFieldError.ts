/**
 * A shared field rule's refusal, in the reader's language.
 *
 * `lib/registrationFields.ts` is copied verbatim into the Cloud Functions and
 * imports nothing — that is the price of one rule enforced in both places — so
 * it answers with a `FieldCode` and the caller says it. The kiosk's door turns
 * one into an `invalid-argument`; the Review screen's form paints one under the
 * box that caused it. This is the second of those two.
 */
import { useCallback } from 'react';
import { useTranslations } from 'use-intl';
import type { FieldCode } from '@/lib/registrationFields';

export function useFieldError(): (code: FieldCode) => string {
  const t = useTranslations('Errors');
  // The cast is where a bare string union meets a catalogue typed against
  // en.json; `tests/serverCodes.test.ts` is what keeps the two in step.
  return useCallback((code) => t(code as never), [t]);
}
