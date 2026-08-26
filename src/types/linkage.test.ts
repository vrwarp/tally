/**
 * Which backend holds a student, and who they are in it.
 *
 * Two halves of one fact, and they have to come from one place. Deriving the
 * backend from the id prefix while deriving the person id from `pcoPersonId`
 * gave a pair that disagreed for every Attendees student — the backend said
 * `a32` and the person id said null, because `personIdFromStudentId` is the
 * Planning Center compatibility helper and answers for Planning Center alone.
 *
 * Two screens read that pair. `usePersonDetails` treated a null person id as
 * "this student has no upstream record", so every Attendees child's parent
 * contact, allergy note and birthdate rendered as *nothing to look up* rather
 * than being fetched at all. `useAllergyNotes` went to the trouble of naming
 * the backend per person in its request and then dropped every person whose
 * backend was not Planning Center from it.
 *
 * The precedence below is the same one the server uses (`linkageOfData`): the
 * id prefix is the claim when there is one, the server-written linkage fields
 * answer for a Tally-owned document, and the older `pcoPersonId` field has
 * always meant Planning Center.
 */
import { describe, expect, it } from 'vitest';
import { backendLabelOf, backendOfStudent, linkageOfStudent, personIdOfStudent } from '@/types';
import { makeStudent } from '../../tests/factories';

/** Every student shape the linkage has to answer for. */
const CASES = [
  {
    what: 'a Planning Center person, by their id',
    student: makeStudent({ id: 'pco_4200003', pcoPersonId: null }),
    linkage: { backendId: 'pco', personId: '4200003' },
    label: 'Planning Center',
  },
  {
    what: 'an Attendees person, by their id',
    student: makeStudent({ id: 'a32_8c1f2c34-9d1e-4f56-8a7b-0c1d2e3f4a5b', pcoPersonId: null }),
    linkage: { backendId: 'a32', personId: '8c1f2c34-9d1e-4f56-8a7b-0c1d2e3f4a5b' },
    label: 'Attendees',
  },
  {
    what: 'a visitor a push linked, by the fields the server wrote',
    student: makeStudent({
      id: 'tally-9',
      pcoPersonId: null,
      upstreamBackend: 'a32',
      upstreamPersonId: '8c1f2c34',
    }),
    linkage: { backendId: 'a32', personId: '8c1f2c34' },
    label: 'Attendees',
  },
  {
    what: 'a visitor linked before the second backend existed',
    student: makeStudent({ id: 'tally-9', pcoPersonId: '4200003' }),
    linkage: { backendId: 'pco', personId: '4200003' },
    label: 'Planning Center',
  },
] as const;

describe('linkageOfStudent', () => {
  for (const testCase of CASES) {
    it(`answers for ${testCase.what}`, () => {
      expect(linkageOfStudent(testCase.student)).toEqual(testCase.linkage);
    });
  }

  it('has nothing to say about a visitor no push has landed on', () => {
    expect(linkageOfStudent(makeStudent({ id: 'tally-9', pcoPersonId: null }))).toBeNull();
  });

  it('prefers the id prefix over the fields, when the two disagree', () => {
    // The prefix is the claim `firestore.rules` stops a client minting, so it
    // outranks a field a server wrote earlier.
    const student = makeStudent({
      id: 'pco_4200003',
      pcoPersonId: null,
      upstreamBackend: 'a32',
      upstreamPersonId: '8c1f2c34',
    });

    expect(linkageOfStudent(student)).toEqual({ backendId: 'pco', personId: '4200003' });
  });

  it('prefers the generic linkage over the older field', () => {
    const student = makeStudent({
      id: 'tally-9',
      pcoPersonId: '4200003',
      upstreamBackend: 'a32',
      upstreamPersonId: '8c1f2c34',
    });

    expect(linkageOfStudent(student)).toEqual({ backendId: 'a32', personId: '8c1f2c34' });
  });

  it('needs both halves of the generic linkage before it will use either', () => {
    // A backend named with nobody in it is a half-written document, and
    // answering `a32` with no person id is the disagreement this exists to
    // stop.
    const noPerson = makeStudent({ id: 'tally-9', pcoPersonId: null, upstreamBackend: 'a32' });
    const noBackend = makeStudent({ id: 'tally-9', pcoPersonId: null, upstreamPersonId: '8c1f' });

    expect(linkageOfStudent(noPerson)).toBeNull();
    expect(linkageOfStudent(noBackend)).toBeNull();
  });

  it('falls through a half-written linkage to the older field', () => {
    const student = makeStudent({
      id: 'tally-9',
      pcoPersonId: '4200003',
      upstreamBackend: 'a32',
      upstreamPersonId: null,
    });

    expect(linkageOfStudent(student)).toEqual({ backendId: 'pco', personId: '4200003' });
  });

  it('reads an empty person id as no linkage rather than as an empty person', () => {
    const student = makeStudent({
      id: 'tally-9',
      pcoPersonId: '',
      upstreamBackend: 'a32',
      upstreamPersonId: '',
    });

    expect(linkageOfStudent(student)).toBeNull();
  });
});

describe('backendOfStudent and personIdOfStudent', () => {
  for (const testCase of CASES) {
    it(`agree about ${testCase.what}`, () => {
      // The pair disagreeing is the whole defect: one screen asked for the
      // backend and another for the person, and they described different
      // students.
      expect(backendOfStudent(testCase.student)).toBe(testCase.linkage.backendId);
      expect(personIdOfStudent(testCase.student)).toBe(testCase.linkage.personId);
    });
  }

  it('both say nothing for a visitor no push has landed on', () => {
    const visitor = makeStudent({ id: 'tally-9', pcoPersonId: null });

    expect(backendOfStudent(visitor)).toBeNull();
    expect(personIdOfStudent(visitor)).toBeNull();
  });
});

describe('backendLabelOf', () => {
  for (const testCase of CASES) {
    it(`names the backend holding ${testCase.what}`, () => {
      expect(backendLabelOf(testCase.student)).toBe(testCase.label);
    });
  }

  it('says Planning Center for a student no backend holds', () => {
    // Where an unlinked student has always been said to be going — the queued
    // badge, the push button — and where the server still sends them unless a
    // leader has picked otherwise.
    expect(backendLabelOf(makeStudent({ id: 'tally-9', pcoPersonId: null }))).toBe(
      'Planning Center',
    );
  });
});
