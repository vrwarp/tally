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
   * a Pre-K child, because the row carried whatever number a backend offered
   * and `ordinalGrade` renders whatever it is handed. Pre-K is a real grade now
   * and comes through as one; what must not come through is a number no grade
   * answers to, and this is the guard that covers a document some older sync
   * already wrote one into.
   */
  it('takes a real grade and refuses a number that is not one', () => {
    // Pre-K and kindergarten are grades, and neither is "no grade".
    expect(joinKioskRoster([], [person({ grade: -1 })])[0]!.grade).toBe(-1);
    expect(joinKioskRoster([], [person({ grade: 0 })])[0]!.grade).toBe(0);

    // Below Pre-K, and past 12th, nobody is in a grade at all.
    expect(joinKioskRoster([], [person({ grade: -2 })])[0]!.grade).toBeNull();
    expect(joinKioskRoster([document('student-bree-sandoval', { grade: 14 })], [])[0]!.grade).toBeNull();
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

  it('is not linked to anything by a backend with no person id beside it', () => {
    /*
     * A half-written linkage: something stamped `upstreamBackend` and never got
     * to the person id. The prefix on its own (`a32_`) is not a person, so this
     * document is a visitor who stands on their own name — the guard that says
     * so is the only thing between "no person id" and "joined to whichever row
     * the bare prefix happens to name".
     */
    const rows = joinKioskRoster(
      [document('student-ana-ruiz', { firstName: 'Ana', upstreamBackend: 'a32' })],
      [person({ id: 'a32_', pcoPersonId: '', firstName: 'Nobody', lastName: 'Atall' })],
    );

    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === 'student-ana-ruiz')?.firstName).toBe('Ana');
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

describe('the fields a row ends up with', () => {
  it('takes the allergy flag from the backend, both ways round', () => {
    // The label asks about one child rather than four hundred, so `false` has
    // to mean false — a flag that is always on is the same as no flag at all.
    expect(joinKioskRoster([], [person({ hasAllergies: false })])[0]!.hasAllergies).toBe(false);
    expect(joinKioskRoster([], [person({ hasAllergies: true })])[0]!.hasAllergies).toBe(true);
    // Anything that is not `true` is not a yes: an older sync wrote strings.
    expect(
      joinKioskRoster([], [{ ...person(), hasAllergies: 'yes' as unknown as boolean }])[0]!
        .hasAllergies,
    ).toBe(false);
  });

  it('never claims an allergy for a visitor no backend holds', () => {
    /*
     * `noMirroredPersonalData` in firestore.rules refuses an `allergies` key on
     * a student document, so there is nowhere for a real answer to live. The
     * kiosk says no rather than guessing yes — a label that warns about every
     * quick-added visitor is a label nobody reads.
     */
    const rows = joinKioskRoster([document('student-bree-sandoval', { allergies: 'peanuts' })], []);

    expect(rows[0]!.hasAllergies).toBe(false);
  });

  it('searches by what the document holds, not by the name recomputed from it', () => {
    // The document's own `searchName` is what the app's own search matches on,
    // and it can differ from first + last — a nickname, a maiden name.
    const rows = joinKioskRoster(
      [document('student-bree-sandoval', { searchName: 'bree sandoval bea' })],
      [],
    );

    expect(rows[0]!.searchName).toBe('bree sandoval bea');
  });

  it('falls back to the typed name, folded and trimmed, when there is no search name', () => {
    const rows = joinKioskRoster(
      [{ id: 'student-bree-sandoval', data: { firstName: 'Bree', lastName: 'Sandoval ' } }],
      [],
    );

    // Lower case and trimmed because that is the shape `search.ts` compares
    // against; a stray space off the end of a typed surname made the child
    // unfindable by their own name.
    expect(rows[0]!.searchName).toBe('bree sandoval');
  });

  it('has no name for a document whose name fields are not strings', () => {
    // A number where a name should be is not a name. Drawn, it would put "42"
    // on the lobby glass; kept, it would make the row unsearchable anyway.
    const rows = joinKioskRoster(
      [{ id: 'student-nobody', data: { firstName: 42, lastName: null } }],
      [],
    );

    expect(rows).toHaveLength(0);
  });

  it('draws a row for a child with only one of the two names', () => {
    /*
     * One name is a name. Families give a single name at the door often enough
     * — a first name and a "we'll sort the rest out later" — and refusing the
     * row loses the child rather than the missing surname.
     */
    const first = joinKioskRoster([{ id: 'doc-1', data: { firstName: 'Bree' } }], []);
    expect(first).toHaveLength(1);
    expect(first[0]!.searchName).toBe('bree');

    const last = joinKioskRoster([{ id: 'doc-2', data: { lastName: 'Sandoval' } }], []);
    expect(last).toHaveLength(1);
    expect(last[0]!.searchName).toBe('sandoval');
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
