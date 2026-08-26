/**
 * The prefix on a student id is a claim about which backend holds the person.
 *
 * It is permanent once any deployment has used it — attendance history points
 * at these ids for ever — and the security rules stop a browser minting one
 * with a person behind it. So the prefixes are asserted literally here rather
 * than derived from the table: a rename would be a data migration, and this
 * suite is where it has to be noticed.
 *
 * Shared verbatim with the Cloud Functions through
 * `scripts/sync-functions-shared.mjs`; both packages must agree or a student
 * stops matching their own roster row.
 */
import { describe, expect, it } from 'vitest';
import {
  BACKEND_IDS,
  BACKEND_PREFIXES,
  PCO_ID_PREFIX,
  isBackendId,
  parseStudentId,
  pcoStudentId,
  personIdFromStudentId,
  studentIdFor,
} from '@/lib/backendIds';

describe('the prefix table', () => {
  it('spells the two prefixes the stored ids already carry', () => {
    expect(BACKEND_PREFIXES).toEqual({ pco: 'pco_', a32: 'a32_' });
  });

  it('lists every backend in the table and nothing else', () => {
    expect([...BACKEND_IDS].sort()).toEqual(['a32', 'pco']);
  });

  it('keeps the Planning Center alias pointing at the same prefix', () => {
    expect(PCO_ID_PREFIX).toBe('pco_');
  });
});

describe('isBackendId', () => {
  it('accepts the ids in the table', () => {
    expect(isBackendId('pco')).toBe(true);
    expect(isBackendId('a32')).toBe(true);
  });

  it('refuses anything else, including things that only look like one', () => {
    expect(isBackendId('pco_')).toBe(false);
    expect(isBackendId('PCO')).toBe(false);
    expect(isBackendId('')).toBe(false);
    expect(isBackendId(null)).toBe(false);
    expect(isBackendId(undefined)).toBe(false);
    expect(isBackendId(0)).toBe(false);
  });

  it('refuses a name inherited from Object.prototype', () => {
    // `value in BACKEND_PREFIXES` walks the prototype chain, and "constructor"
    // arriving from a Firestore document must not name a backend.
    expect(isBackendId('constructor')).toBe(false);
    expect(isBackendId('toString')).toBe(false);
    expect(isBackendId('__proto__')).toBe(false);
  });
});

describe('studentIdFor', () => {
  it('builds the id Tally knows a backend person by', () => {
    expect(studentIdFor('pco', '123')).toBe('pco_123');
    expect(studentIdFor('a32', '9f0c')).toBe('a32_9f0c');
  });

  it('is what the Planning Center shorthand produces', () => {
    expect(pcoStudentId('123')).toBe(studentIdFor('pco', '123'));
  });
});

describe('parseStudentId', () => {
  it('reads the claim a prefixed id makes', () => {
    expect(parseStudentId('pco_123')).toEqual({ backendId: 'pco', personId: '123' });
    expect(parseStudentId('a32_9f0c-11ee')).toEqual({ backendId: 'a32', personId: '9f0c-11ee' });
  });

  it('returns null for a Tally-owned id', () => {
    // A visitor Tally created has a generated Firestore id with no underscore
    // at all, so this cannot misread one.
    expect(parseStudentId('AbC123xyz')).toBeNull();
    expect(parseStudentId('')).toBeNull();
  });

  it('refuses a prefix that is only in the middle', () => {
    expect(parseStudentId('xpco_123')).toBeNull();
  });

  it('reads an empty person id as empty rather than as no claim', () => {
    // `pco_` on its own is a malformed id, not a visitor's — saying so is what
    // lets a caller tell the two apart.
    expect(parseStudentId('pco_')).toEqual({ backendId: 'pco', personId: '' });
  });
});

describe('personIdFromStudentId', () => {
  it('answers for a Planning Center id', () => {
    expect(personIdFromStudentId('pco_123')).toBe('123');
  });

  it('refuses another backend, which is the point of asking this narrowly', () => {
    expect(personIdFromStudentId('a32_9f0c')).toBeNull();
  });

  it('refuses a Tally-owned id', () => {
    expect(personIdFromStudentId('AbC123xyz')).toBeNull();
  });
});
