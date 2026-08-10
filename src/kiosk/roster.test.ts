/**
 * The kiosk's roster join.
 *
 * The case that matters most here is the one it used to get wrong, and it was
 * found by looking at a photograph rather than by any of these: the lobby
 * screen drew two identical rows for every quick-added visitor whose push had
 * landed. Both were the same child; one answered to the document id every
 * attendance record points at, and one to the `pco_…` id the roster read
 * returned. A parent had a coin-flip, and the losing half wrote a check-in the
 * app's own roster could not show.
 *
 * So these pin the *identity* rules rather than the field-copying ones: which
 * id a row ends up under, and how many rows exist at all.
 */
import { describe, expect, it } from 'vitest';

import { joinKioskRoster, type KioskRosterDocument } from '@/kiosk/roster';
import type { PcoRosterPerson } from '@/types';

function person(overrides: Partial<PcoRosterPerson> = {}): PcoRosterPerson {
  return {
    id: 'pco_500',
    pcoPersonId: '500',
    firstName: 'Bree',
    lastName: 'Sandoval',
    grade: 7,
    status: 'active',
    searchName: 'bree sandoval',
    profileComplete: true,
    hasAllergies: false,
    birthday: null,
    ...overrides,
  };
}

function document(
  id: string,
  data: Record<string, unknown> = {},
): KioskRosterDocument {
  return {
    id,
    data: { firstName: 'Bree', lastName: 'Sandoval', grade: 7, searchName: 'bree sandoval', ...data },
  };
}

describe('a visitor Tally created', () => {
  it('is one row before the push, under the id the door will write against', () => {
    const rows = joinKioskRoster([document('student-bree-sandoval')], []);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe('student-bree-sandoval');
    expect(rows[0]!.firstName).toBe('Bree');
  });

  it('is still one row after the push, and keeps the document id', () => {
    /*
     * The regression. The push creates the person upstream and stamps the
     * document with their id; it deliberately never renames the document,
     * because attendance, RSVPs and the prediction window all point there. So
     * the same child arrives from two directions in the same read, and used to
     * be drawn twice.
     */
    const rows = joinKioskRoster(
      [document('student-bree-sandoval', { pcoPersonId: '500' })],
      [person()],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe('student-bree-sandoval');
  });

  it('takes the backend fields once linked, because upstream owns the name', () => {
    const rows = joinKioskRoster(
      [
        document('student-bree-sandoval', {
          pcoPersonId: '500',
          firstName: 'Bre',
          searchName: 'bre sandoval',
        }),
      ],
      [person({ hasAllergies: true })],
    );

    // The door typed "Bre"; the office corrected it upstream. The kiosk must
    // search for what the office holds, and the allergy flag only ever comes
    // from there — a student document may not carry one at all.
    expect(rows[0]!.firstName).toBe('Bree');
    expect(rows[0]!.searchName).toBe('bree sandoval');
    expect(rows[0]!.hasAllergies).toBe(true);
  });

  it('keeps a grade typed at the door when the backend holds none', () => {
    const rows = joinKioskRoster(
      [document('student-bree-sandoval', { pcoPersonId: '500', grade: 7 })],
      [person({ grade: null })],
    );

    expect(rows[0]!.grade).toBe(7);
  });

  /*
   * A number is not a grade. The kiosk drew "-1th grade" on the lobby glass for
   * a child whose backend derived one from a graduation year years out, and
   * then wrote that number onto their permanent record at check-in. Fixed
   * upstream too — this is the row's own guard, and it is the one that covers a
   * document some older sync already wrote a nonsense grade into.
   */
  it('shows no grade rather than a number outside K-12', () => {
    const fromBackend = joinKioskRoster([], [person({ grade: -1 })]);
    expect(fromBackend[0]!.grade).toBeNull();

    const fromDocument = joinKioskRoster([document('student-bree-sandoval', { grade: 14 })], []);
    expect(fromDocument[0]!.grade).toBeNull();

    // Kindergarten is a grade, and zero is not "no grade".
    expect(joinKioskRoster([], [person({ grade: 0 })])[0]!.grade).toBe(0);
  });

  it('follows the generic linkage, not only the Planning Center one', () => {
    const rows = joinKioskRoster(
      [
        document('student-bree-sandoval', {
          upstreamBackend: 'a32',
          upstreamPersonId: '9f0c',
        }),
      ],
      [person({ id: 'a32_9f0c', pcoPersonId: '9f0c', backendId: 'a32' })],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe('student-bree-sandoval');
  });

  it('stands alone when the roster does not hold their person', () => {
    // A linkage the roster did not answer for: removed from the roster, or the
    // person was deleted upstream. The document still has the name typed at the
    // door, so the family can still be found — see the note in roster.ts.
    const rows = joinKioskRoster([document('student-bree-sandoval', { pcoPersonId: '500' })], []);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.firstName).toBe('Bree');
  });
});

describe('a membership the church added from its own system', () => {
  it('draws one row, named by the backend, with no document line beside it', () => {
    // The annotation document: `pco_500` with nothing on it the kiosk wants.
    const rows = joinKioskRoster([{ id: 'pco_500', data: {} }], [person()]);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe('pco_500');
  });

  it('wins the id when a linked visitor points at the same person', () => {
    /*
     * Somebody quick-added a child at the door who was already on the roster,
     * and a push matched the two. There is one child, and the membership
     * document is the one that was added on purpose — so the row is theirs.
     */
    const rows = joinKioskRoster(
      [{ id: 'pco_500', data: {} }, document('student-bree-sandoval', { pcoPersonId: '500' })],
      [person()],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe('pco_500');
  });

  it('folds two quick-adds matched to one person into a single row', () => {
    const rows = joinKioskRoster(
      [
        document('student-bree-sandoval', { pcoPersonId: '500' }),
        document('student-bree-s', { pcoPersonId: '500' }),
      ],
      [person()],
    );

    expect(rows).toHaveLength(1);
  });

  it('leaves an inactive person off the glass entirely', () => {
    const rows = joinKioskRoster([{ id: 'pco_500', data: {} }], [person({ status: 'inactive' })]);

    expect(rows).toHaveLength(0);
  });

  it('draws no blank line for a document with no name and no person', () => {
    const rows = joinKioskRoster([{ id: 'pco_500', data: {} }], []);

    expect(rows).toHaveLength(0);
  });
});
