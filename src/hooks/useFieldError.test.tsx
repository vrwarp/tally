/**
 * A shared field rule's refusal, in the reader's language.
 *
 * `lib/registrationFields.ts` is copied verbatim into the Cloud Functions and
 * imports nothing, which is the price of one rule enforced at the lobby door
 * and on the Review screen both. So it answers with a code, and this says it.
 */
import { describe, expect, it } from 'vitest';
import { renderHook } from '@/test/rtl';
import { useFieldError } from '@/hooks/useFieldError';
import { FIELD_MESSAGES } from '@/lib/registrationFields';

describe('useFieldError', () => {
  it('says the sentence a field code names', () => {
    const { result } = renderHook(() => useFieldError());
    expect(result.current('field.childFirst.required')).toBe(
      FIELD_MESSAGES['field.childFirst.required'],
    );
  });

  /*
   * Every code, because the catalogue and `FIELD_MESSAGES` are two copies of
   * one set of sentences — `tests/serverCodes.test.ts` pins the words, and this
   * pins that the lookup reaches all of them rather than most.
   */
  it('has a sentence for every rule the door can refuse with', () => {
    const { result } = renderHook(() => useFieldError());
    for (const code of Object.keys(FIELD_MESSAGES) as (keyof typeof FIELD_MESSAGES)[]) {
      expect(result.current(code), code).toBe(FIELD_MESSAGES[code]);
    }
  });
});
