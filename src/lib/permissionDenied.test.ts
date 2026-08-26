/**
 * Telling "you may not read this" apart from "this went wrong".
 *
 * A failed read is a thing to retry; a refused one is a settled fact, and
 * retrying it is a loop. Firestore raises `permission-denied` while the
 * callables raise `functions/permission-denied`, so the test is containment
 * rather than equality — and that is exactly the claim worth pinning down,
 * because the substring is what makes a shell decide between an apology and a
 * locked door.
 */
import { describe, expect, it } from 'vitest';
import { isPermissionDenied } from '@/lib/permissionDenied';

describe('isPermissionDenied', () => {
  it('recognises the Firestore code', () => {
    expect(isPermissionDenied({ code: 'permission-denied' })).toBe(true);
  });

  it('recognises the callable code, which carries a namespace', () => {
    expect(isPermissionDenied({ code: 'functions/permission-denied' })).toBe(true);
  });

  it('recognises a real FirebaseError-shaped object', () => {
    const error = Object.assign(new Error('Missing or insufficient permissions.'), {
      code: 'permission-denied',
    });
    expect(isPermissionDenied(error)).toBe(true);
  });

  it('refuses every other failure, which are the ones worth retrying', () => {
    expect(isPermissionDenied({ code: 'unavailable' })).toBe(false);
    expect(isPermissionDenied({ code: 'not-found' })).toBe(false);
    expect(isPermissionDenied({ code: 'failed-precondition' })).toBe(false);
  });

  it('refuses anything without a string code', () => {
    expect(isPermissionDenied(new Error('permission-denied'))).toBe(false);
    expect(isPermissionDenied({ code: 7 })).toBe(false);
    expect(isPermissionDenied({})).toBe(false);
  });

  it('refuses things that are not objects at all', () => {
    // A rejected promise carries whatever it was rejected with, which is not
    // always an error.
    expect(isPermissionDenied(null)).toBe(false);
    expect(isPermissionDenied(undefined)).toBe(false);
    expect(isPermissionDenied('permission-denied')).toBe(false);
  });
});
