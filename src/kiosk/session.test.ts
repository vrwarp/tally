/**
 * The one question `session.ts` answers, and why its shape matters.
 *
 * `isRefusal` is what tells a kiosk that a write did not fail — it was
 * *refused*. The difference decides whether the tablet retries quietly or
 * stops taking a register and shows its pairing code, so every way an error
 * can arrive has to land on the right side of it: the two SDKs spell the code
 * differently, a network failure carries no code at all, and a thrown
 * primitive carries nothing.
 */
import { describe, expect, it } from 'vitest';
import { isRefusal } from '@/kiosk/session';

describe('isRefusal', () => {
  it('is true for the code the rules refuse with', () => {
    expect(isRefusal({ code: 'permission-denied' })).toBe(true);
  });

  it('is true however the SDK prefixes it', () => {
    // Firestore says `permission-denied`; the callable SDK says
    // `functions/permission-denied`. Both are the rules saying no.
    expect(isRefusal({ code: 'functions/permission-denied' })).toBe(true);
    expect(isRefusal({ code: 'firestore/permission-denied' })).toBe(true);
  });

  it('is false for every other failure, which is what makes a retry right', () => {
    expect(isRefusal({ code: 'unavailable' })).toBe(false);
    expect(isRefusal({ code: 'deadline-exceeded' })).toBe(false);
    expect(isRefusal({ code: 'not-found' })).toBe(false);
  });

  it('is false, rather than throwing, for an error carrying no code at all', () => {
    // A dropped connection arrives as a plain Error. Throwing here would turn
    // a kiosk's offline minute into an unpairing.
    expect(isRefusal(new Error('network request failed'))).toBe(false);
    expect(isRefusal({})).toBe(false);
  });

  it('is false, rather than throwing, when there is no error object', () => {
    expect(isRefusal(null)).toBe(false);
    expect(isRefusal(undefined)).toBe(false);
  });
});
