/**
 * The pure helpers in the contract module, and the constants screens read.
 *
 * `src/types/index.ts` is the one file every layer imports, so the small
 * functions in it are load-bearing far from where they are written: a search
 * key the roster matches on, a document id an invitation is looked up by, the
 * label a row prints for a backend. `names.test.ts` and `linkage.test.ts` cover
 * the two halves that already had somewhere to live; this covers the rest —
 * the grade guards, the role rank, the upstream-edit predicates, the
 * denormalised-field builders and the label maps.
 *
 * What is asserted is mostly the *edges*: the space that has to be collapsed,
 * the case that has to be folded, the boundary a threshold sits exactly on.
 * That is where these functions are actually used, and where a change to one
 * of them stops matching the copy of the same rule that lives in
 * `functions/src/`.
 */
import { describe, expect, it } from 'vitest';
import {
  BACKEND_LABELS,
  DEFAULT_SETTINGS,
  GRADES,
  PRE_K,
  ROLE_RANK,
  TRANSITION_REASON_LABEL,
  UPSTREAM_EDIT_FIELDS,
  UPSTREAM_EDIT_STALLED_MS,
  asGrade,
  buildSearchName,
  computeProfileComplete,
  editedFields,
  emailKey,
  isGrade,
  isInFlight,
  isStalled,
  needsAHuman,
  roleAtLeast,
  studentFullName,
} from '@/types';

describe('grades', () => {
  it('runs Pre-K to 12, and Pre-K is the negative one', () => {
    expect(PRE_K).toBe(-1);
    expect(GRADES[0]).toBe(-1);
    expect(GRADES.at(-1)).toBe(12);
    expect(GRADES).toHaveLength(14);
  });

  it('admits every grade in the band and nothing outside it', () => {
    for (const grade of GRADES) expect(isGrade(grade)).toBe(true);
    // A nursery child is below Pre-K and a graduate is past 12; both are
    // "no grade" rather than a number, which is what `asGrade` returns null for.
    expect(isGrade(-2)).toBe(false);
    expect(isGrade(13)).toBe(false);
  });

  it('refuses the shapes that are not a grade at all', () => {
    expect(isGrade(3.5)).toBe(false);
    expect(isGrade('3')).toBe(false);
    expect(isGrade(null)).toBe(false);
    expect(isGrade(undefined)).toBe(false);
    expect(isGrade(Number.NaN)).toBe(false);
  });

  it('converts what is a grade and refuses what is not', () => {
    expect(asGrade(0)).toBe(0);
    expect(asGrade(-1)).toBe(-1);
    expect(asGrade(12)).toBe(12);
    expect(asGrade(13)).toBeNull();
    expect(asGrade('6')).toBeNull();
    expect(asGrade(null)).toBeNull();
  });
});

describe('roleAtLeast', () => {
  it('ranks counselor below core below admin', () => {
    expect(ROLE_RANK).toEqual({ counselor: 1, core: 2, admin: 3 });
  });

  it('lets a role clear its own bar and every bar below it', () => {
    expect(roleAtLeast('admin', 'admin')).toBe(true);
    expect(roleAtLeast('admin', 'core')).toBe(true);
    expect(roleAtLeast('core', 'core')).toBe(true);
    expect(roleAtLeast('core', 'counselor')).toBe(true);
    expect(roleAtLeast('counselor', 'counselor')).toBe(true);
  });

  it('refuses a role below the bar', () => {
    expect(roleAtLeast('counselor', 'core')).toBe(false);
    expect(roleAtLeast('core', 'admin')).toBe(false);
  });

  it('refuses nobody at all — being signed in is not a role', () => {
    expect(roleAtLeast(null, 'counselor')).toBe(false);
    expect(roleAtLeast(undefined, 'counselor')).toBe(false);
  });
});

describe('the upstream-edit predicates', () => {
  const edit = (state: string, startedAt: Date | null = null) =>
    ({ state, startedAt }) as never;

  it('says which states are waiting on a person', () => {
    for (const state of ['differs', 'merged', 'failed', 'orphaned']) {
      expect(needsAHuman(edit(state))).toBe(true);
    }
    for (const state of ['queued', 'sending', 'waiting', 'landed', 'cancelled']) {
      expect(needsAHuman(edit(state))).toBe(false);
    }
  });

  it('says which states are still in flight', () => {
    for (const state of ['queued', 'sending', 'waiting']) {
      expect(isInFlight(edit(state))).toBe(true);
    }
    for (const state of ['landed', 'differs', 'failed', 'cancelled']) {
      expect(isInFlight(edit(state))).toBe(false);
    }
  });

  it('calls a job stalled only once it is past the threshold, and only while sending', () => {
    const startedAt = new Date('2026-08-01T12:00:00');
    const at = (ms: number) => new Date(startedAt.getTime() + ms);

    // Exactly on the threshold is not yet past it.
    expect(isStalled(edit('sending', startedAt), at(UPSTREAM_EDIT_STALLED_MS))).toBe(false);
    expect(isStalled(edit('sending', startedAt), at(UPSTREAM_EDIT_STALLED_MS + 1))).toBe(true);

    // A job that is not sending has no clock to be late against.
    expect(isStalled(edit('queued', startedAt), at(UPSTREAM_EDIT_STALLED_MS + 1))).toBe(false);
    expect(isStalled(edit('sending', null), at(UPSTREAM_EDIT_STALLED_MS + 1))).toBe(false);
  });

  it('names the patched fields in the order the form shows them', () => {
    const patch = { lastName: 'Chen', firstName: 'Iris' } as never;
    expect(editedFields({ patch })).toEqual(
      UPSTREAM_EDIT_FIELDS.filter((field) => field === 'firstName' || field === 'lastName'),
    );
  });

  it('names nothing for a patch that touched nothing', () => {
    expect(editedFields({ patch: {} as never })).toEqual([]);
  });
});

describe('computeProfileComplete', () => {
  it('is complete once either way of reaching a parent exists', () => {
    expect(computeProfileComplete({ parentPhone: '5550100' })).toBe(true);
    expect(computeProfileComplete({ parentEmail: 'a@example.org' })).toBe(true);
  });

  it('is incomplete with neither, and with whitespace pretending to be either', () => {
    expect(computeProfileComplete({})).toBe(false);
    expect(computeProfileComplete({ parentPhone: null, parentEmail: null })).toBe(false);
    // The trim is the point: a field holding a space is not a way to reach
    // anybody, and this flag is what the "Incomplete profiles" query reads.
    expect(computeProfileComplete({ parentPhone: '   ' })).toBe(false);
    expect(computeProfileComplete({ parentEmail: '  ' })).toBe(false);
  });
});

describe('studentFullName', () => {
  it('joins the two names', () => {
    expect(studentFullName({ firstName: 'Iris', lastName: 'Chen' })).toBe('Iris Chen');
  });

  it('does not leave the joining space behind when half the name is missing', () => {
    // A quick-added visitor can arrive with one name, and " Chen" reads as a
    // rendering bug everywhere this string is printed.
    expect(studentFullName({ firstName: '', lastName: 'Chen' })).toBe('Chen');
    expect(studentFullName({ firstName: 'Iris', lastName: '' })).toBe('Iris');
  });
});

describe('buildSearchName', () => {
  it('folds case, because the roster matches what somebody types at a door', () => {
    expect(buildSearchName('Iris', 'Chen')).toBe('iris chen');
    expect(buildSearchName('IRIS', 'CHEN')).toBe('iris chen');
  });

  it('collapses every run of space to one', () => {
    // Planning Center composites carry a nickname — `Benson "秉洲" Tsai` — and
    // a double space in the stored key is a key no typed query produces.
    expect(buildSearchName('Iris   Mei', 'Chen')).toBe('iris mei chen');
    expect(buildSearchName('Iris\tMei', 'Chen')).toBe('iris mei chen');
  });

  it('trims the ends, so half a name does not key on a leading space', () => {
    expect(buildSearchName('', 'Chen')).toBe('chen');
    expect(buildSearchName('Iris', '')).toBe('iris');
    expect(buildSearchName('  Iris  ', '  Chen  ')).toBe('iris chen');
  });
});

describe('emailKey', () => {
  it('folds case and turns the dots into commas', () => {
    // Must stay identical to `emailKey` in functions/src/pco/mapping.ts, or an
    // invitation an admin wrote is not the one a sign-in looks up.
    expect(emailKey('Sam.Smith@Example.org')).toBe('sam,smith@example,org');
  });

  it('trims, because an address pasted into a form carries whitespace', () => {
    expect(emailKey('  sam@example.org  ')).toBe('sam@example,org');
  });

  it('replaces every dot, not just the first', () => {
    expect(emailKey('a.b.c@d.e.f')).toBe('a,b,c@d,e,f');
  });
});

describe('the label maps a row prints from', () => {
  it('names both people backends', () => {
    expect(BACKEND_LABELS.pco).toBe('Planning Center');
    expect(BACKEND_LABELS.a32).toBe('Attendees');
  });

  it('names both transition reasons', () => {
    // The stored values are short; these are the sentences a leader chooses
    // between, and the difference between them is what the pooled list reads.
    expect(TRANSITION_REASON_LABEL['moved-on']).toBe('Moved on within the ministry');
    expect(TRANSITION_REASON_LABEL.departed).toBe('No longer with us');
  });
});

describe('DEFAULT_SETTINGS', () => {
  it('is the predictive rule the whole app agrees on when nothing is stored', () => {
    expect(DEFAULT_SETTINGS.predictiveMinAttended).toBe(2);
    expect(DEFAULT_SETTINGS.predictiveOfLastN).toBe(3);
    expect(DEFAULT_SETTINGS.miaConsecutiveMisses).toBe(3);
    expect(DEFAULT_SETTINGS.newVisitorWindowDays).toBe(7);
  });

  it('keeps a window that its own threshold can be satisfied inside', () => {
    // `predictiveOfLastN` below `predictiveMinAttended` makes "Recent"
    // unsatisfiable, and the roster renders empty rather than wrong.
    expect(DEFAULT_SETTINGS.predictiveOfLastN).toBeGreaterThanOrEqual(
      DEFAULT_SETTINGS.predictiveMinAttended,
    );
  });
});
