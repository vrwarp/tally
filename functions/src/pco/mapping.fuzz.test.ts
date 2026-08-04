/**
 * Properties of the Planning Center mapping.
 *
 * This code reads a database Tally does not own and cannot validate. Fields are
 * free text, optional, and occasionally absent entirely — a grade arrives as a
 * number, a graduation year, or nothing at all. A mapper that throws on one odd
 * record aborts the whole sync; one that lets a bad value through writes it
 * into a child's profile.
 */
import { describe, expect, it } from 'vitest';
import { buildIncludedIndex, extractParentContact, isYouth, mapPersonToStudent } from './mapping.js';
import type { PcoPerson } from './types.js';

/**
 * mulberry32, inlined.
 *
 * The app has the same generator in `tests/fuzz/prng.ts`, but this package
 * compiles under NodeNext against `firebase-admin` while that one is
 * bundler-resolved app code using the `@/` alias. Eight duplicated lines is a
 * better trade than making the two module systems agree.
 */
function createRng(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  return { next, int, bool: (p = 0.5) => next() < p };
}

const RUNS = Number.parseInt(process.env.TALLY_FUZZ_RUNS ?? '', 10) || 200;
const SEED = Number.parseInt(process.env.TALLY_FUZZ_SEED ?? '', 10) || 0x7a11;

const NASTY_STRINGS = [
  '', ' ', '\t\n', 'a'.repeat(5000), 'José', '👨‍👩‍👧', '中文', '__proto__',
  'Male', 'M', 'male', 'FEMALE', 'f', 'Non-binary', 'Prefer not to say',
];
const NASTY_NUMBERS = [
  0, -1, 5, 6, 12, 13, 99, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER,
];
const NASTY_VALUES: unknown[] = [...NASTY_STRINGS, ...NASTY_NUMBERS, null, undefined, true, false, {}, []];

const CTX = { minGrade: 6, maxGrade: 12, now: new Date('2026-02-13T00:00:00Z') };

function arbitraryPerson(seed: number): PcoPerson {
  const rng = createRng(seed);
  const pick = <T>(items: readonly T[]): T => items[rng.int(0, items.length - 1)]!;

  const attributes: Record<string, unknown> = {};
  const FIELDS = [
    'first_name', 'last_name', 'nickname', 'given_name', 'grade', 'graduation_year',
    'gender', 'birthdate', 'child', 'medical_notes', 'status', 'inactivated_at',
    'people_permissions', 'site_administrator', 'primary_email_address',
    'created_at', 'updated_at', '__proto__',
  ];
  for (const field of FIELDS) {
    if (rng.bool(0.6)) attributes[field] = pick(NASTY_VALUES);
  }

  return {
    id: rng.bool(0.9) ? String(rng.int(1, 999_999)) : '',
    type: 'Person',
    attributes: attributes as PcoPerson['attributes'],
    relationships: rng.bool(0.5)
      ? { households: { data: [{ type: 'Household', id: `H${rng.int(1, 5)}` }] } }
      : {},
  };
}

function forEachPerson(name: string, check: (person: PcoPerson, index: number) => void): void {
  it(`${name} [${RUNS} runs, seed ${SEED}]`, () => {
    for (let index = 0; index < RUNS; index += 1) {
      const person = arbitraryPerson(SEED + index * 2654435761);
      try {
        check(person, index);
      } catch (cause) {
        throw new Error(
          `Failed on run ${index} (TALLY_FUZZ_SEED=${SEED}).\n` +
            `Person: ${JSON.stringify(person)}\n` +
            `${cause instanceof Error ? cause.message : String(cause)}`,
          { cause },
        );
      }
    }
  });
}

describe('Planning Center mapping properties', () => {
  forEachPerson('mapPersonToStudent never throws on an arbitrary person', (person) => {
    expect(() => mapPersonToStudent(person, CTX)).not.toThrow();
  });

  forEachPerson('a mapped student carries a real grade or none at all', (person) => {
    const student = mapPersonToStudent(person, CTX);

    // Never a rounded-off guess: whatever the backend holds, or null. An
    // out-of-band value is the roster's problem to filter, not the mapper's to
    // rewrite into a claim nobody made.
    if (student.grade !== null) expect(Number.isFinite(student.grade)).toBe(true);
    expect(['active', 'inactive']).toContain(student.status);
    expect(typeof student.firstName).toBe('string');
    expect(typeof student.lastName).toBe('string');
    expect(student.searchName).toBe(student.searchName.toLowerCase());
  });

  forEachPerson('mapping is deterministic', (person) => {
    expect(mapPersonToStudent(person, CTX)).toEqual(mapPersonToStudent(person, CTX));
  });

  forEachPerson('isYouth never throws and always answers a boolean', (person) => {
    expect(typeof isYouth(person, { minGrade: 6, maxGrade: 12 })).toBe('boolean');
  });

  forEachPerson('extractParentContact never throws and is stable', (person) => {
    const index = buildIncludedIndex([]);
    const first = extractParentContact(person, index);
    const second = extractParentContact(person, index);

    // A contact that changed between syncs would rewrite the record every run.
    expect(second).toEqual(first);
  });

  it('never pollutes Object.prototype from a person payload', () => {
    for (let index = 0; index < RUNS; index += 1) {
      mapPersonToStudent(arbitraryPerson(SEED + index), CTX);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
