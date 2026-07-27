import { describe, expect, it } from 'vitest';
import {
  buildIncludedIndex,
  compareIds,
  displayFirstName,
  emailKey,
  extractParentContact,
  hasContactDetails,
  isYouth,
  mapPersonToStudent,
  nameGradeKey,
  pcoGrade,
  splitFirstName,
} from './mapping.js';
import type {
  JsonApiResource,
  PcoEmail,
  PcoHousehold,
  PcoHouseholdMembership,
  PcoPerson,
  PcoPersonAttributes,
  PcoPhoneNumber,
} from './types.js';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const RANGE = { minGrade: 6, maxGrade: 12 };

/** Mid-school-year anchor: February 2026 belongs to the year graduating in 2026. */
const NOW = new Date('2026-02-13T19:30:00Z');

function person(
  id: string,
  attributes: PcoPersonAttributes,
  householdIds: string[] = [],
): PcoPerson {
  return {
    id,
    type: 'Person',
    attributes,
    relationships:
      householdIds.length > 0
        ? { households: { data: householdIds.map((hid) => ({ type: 'Household', id: hid })) } }
        : {},
  };
}

function household(id: string, memberIds: string[]): PcoHousehold {
  return {
    id,
    type: 'Household',
    attributes: { name: 'Rivera', member_count: memberIds.length },
    relationships: { people: { data: memberIds.map((pid) => ({ type: 'Person', id: pid })) } },
  };
}

function membership(id: string, householdId: string, personId: string, role: string): PcoHouseholdMembership {
  return {
    id,
    type: 'HouseholdMembership',
    attributes: { household_role: role },
    relationships: {
      household: { data: { type: 'Household', id: householdId } },
      person: { data: { type: 'Person', id: personId } },
    },
  };
}

function email(id: string, personId: string, address: string, primary = false): PcoEmail {
  return {
    id,
    type: 'Email',
    attributes: { address, primary },
    relationships: { person: { data: { type: 'Person', id: personId } } },
  };
}

function phone(id: string, personId: string, number: string, primary = false): PcoPhoneNumber {
  return {
    id,
    type: 'PhoneNumber',
    attributes: { number, primary },
    relationships: { person: { data: { type: 'Person', id: personId } } },
  };
}

function index(...resources: JsonApiResource[][]) {
  return buildIncludedIndex(resources.flat());
}

/* -------------------------------------------------------------------------- */
/* mapPersonToStudent                                                          */
/* -------------------------------------------------------------------------- */

describe('mapPersonToStudent', () => {
  it('writes the name the way Planning Center writes it', () => {
    const mapped = mapPersonToStudent(
      person('1', { first_name: 'Jonathan', nickname: 'Jonny', last_name: 'Rivera', grade: 8 }),
      RANGE,
    );

    expect(mapped.firstName).toBe('Jonathan “Jonny”');
    // Both spellings are in the search key, so either one finds him.
    expect(mapped.searchName).toBe('jonathan “jonny” rivera');
  });

  it('keeps a non-Latin nickname alongside the first name', () => {
    // The case this format exists for: dropping "Benson" left a profile the
    // church office reads as "Benson Tsai" showing up in Tally as "蔡秉洲 Tsai".
    const mapped = mapPersonToStudent(
      person('1', { first_name: 'Benson', nickname: '蔡秉洲', last_name: 'Tsai', grade: 6 }),
      RANGE,
    );

    expect(mapped.firstName).toBe('Benson “蔡秉洲”');
  });

  it('uses the nickname alone when there is no first name to pair it with', () => {
    const mapped = mapPersonToStudent(
      person('1', { first_name: null, nickname: 'Jonny', last_name: 'Rivera', grade: 8 }),
      RANGE,
    );

    expect(mapped.firstName).toBe('Jonny');
  });

  it('does not repeat a nickname that is already the first name', () => {
    const mapped = mapPersonToStudent(
      person('1', { first_name: 'Ben', nickname: 'ben', last_name: 'Okonkwo', grade: 8 }),
      RANGE,
    );

    expect(mapped.firstName).toBe('Ben');
  });

  it('falls back to the legal given name when both are blank', () => {
    const mapped = mapPersonToStudent(
      person('1', { first_name: '  ', nickname: null, given_name: 'Jonathan', last_name: 'Rivera', grade: 8 }),
      RANGE,
    );

    expect(mapped.firstName).toBe('Jonathan');
  });

  it('derives a missing grade from the graduation year', () => {
    // Feb 2026 sits in the school year that graduates in 2026, so the class of
    // 2030 is four years out: 8th grade.
    const mapped = mapPersonToStudent(
      person('1', { first_name: 'Ada', last_name: 'Lin', grade: null, graduation_year: 2030 }),
      { ...RANGE, now: NOW },
    );

    expect(mapped.grade).toBe(8);
  });

  it('rolls the school year over in the autumn', () => {
    const mapped = mapPersonToStudent(
      person('1', { first_name: 'Ada', last_name: 'Lin', graduation_year: 2030 }),
      { ...RANGE, now: new Date('2026-09-10T12:00:00Z') },
    );

    expect(mapped.grade).toBe(9);
  });

  it('falls back to the lowest configured grade when nothing is known', () => {
    const mapped = mapPersonToStudent(person('1', { first_name: 'Ada', last_name: 'Lin' }), RANGE);

    expect(mapped.grade).toBe(6);
  });

  it('clamps an out-of-range grade into the configured band', () => {
    expect(mapPersonToStudent(person('1', { grade: 3, last_name: 'Lin' }), RANGE).grade).toBe(6);
    expect(mapPersonToStudent(person('1', { grade: 14, last_name: 'Lin' }), RANGE).grade).toBe(12);
  });

  it('carries medical notes across as allergies, blank means none', () => {
    expect(mapPersonToStudent(person('1', { medical_notes: 'Peanuts' }), RANGE).allergies).toBe('Peanuts');
    expect(mapPersonToStudent(person('1', { medical_notes: '   ' }), RANGE).allergies).toBeNull();
    expect(mapPersonToStudent(person('1', {}), RANGE).allergies).toBeNull();
  });

  it('treats an inactivated person as inactive however it is spelled', () => {
    expect(mapPersonToStudent(person('1', { status: 'inactive' }), RANGE).status).toBe('inactive');
    expect(
      mapPersonToStudent(person('1', { status: 'active', inactivated_at: '2026-01-04T00:00:00Z' }), RANGE)
        .status,
    ).toBe('inactive');
    expect(mapPersonToStudent(person('1', { status: 'active' }), RANGE).status).toBe('active');
    expect(mapPersonToStudent(person('1', {}), RANGE).status).toBe('active');
  });

  it('keeps the Planning Center id and update time for the incremental cursor', () => {
    const mapped = mapPersonToStudent(
      person('42', { first_name: 'Ada', last_name: 'Lin', updated_at: '2026-02-01T10:00:00Z' }),
      RANGE,
    );

    expect(mapped.pcoPersonId).toBe('42');
    expect(mapped.pcoUpdatedAt?.toISOString()).toBe('2026-02-01T10:00:00.000Z');
  });
});

/* -------------------------------------------------------------------------- */
/* Names, both directions                                                      */
/* -------------------------------------------------------------------------- */

describe('displayFirstName', () => {
  it('composes the two halves the way Planning Center does', () => {
    expect(displayFirstName({ first_name: 'Benson', nickname: '蔡秉洲' })).toBe('Benson “蔡秉洲”');
  });

  it('uses whichever half exists on its own', () => {
    expect(displayFirstName({ first_name: 'Benson' })).toBe('Benson');
    expect(displayFirstName({ nickname: '蔡秉洲' })).toBe('蔡秉洲');
    expect(displayFirstName({ given_name: 'Jonathan', first_name: '  ' })).toBe('Jonathan');
    expect(displayFirstName({})).toBe('');
  });

  it('ignores a nickname that only restates the first name', () => {
    expect(displayFirstName({ first_name: 'Ben', nickname: ' BEN ' })).toBe('Ben');
  });
});

describe('splitFirstName', () => {
  it('undoes displayFirstName, so a name survives a round trip', () => {
    const attributes = { first_name: 'Benson', nickname: '蔡秉洲' };
    expect(splitFirstName(displayFirstName(attributes))).toEqual({
      firstName: 'Benson',
      nickname: '蔡秉洲',
    });
  });

  it('leaves a plain name alone', () => {
    expect(splitFirstName('Benson')).toEqual({ firstName: 'Benson', nickname: null });
    expect(splitFirstName('  Mary Jane ')).toEqual({ firstName: 'Mary Jane', nickname: null });
  });

  it('reads straight quotes too, since a person may have typed them', () => {
    expect(splitFirstName('Benson "蔡秉洲"')).toEqual({
      firstName: 'Benson',
      nickname: '蔡秉洲',
    });
  });

  it('treats a bare quoted name as the name itself', () => {
    expect(splitFirstName('“Benji”')).toEqual({ firstName: 'Benji', nickname: null });
    expect(splitFirstName('Benson “”')).toEqual({ firstName: 'Benson', nickname: null });
  });
});

/* -------------------------------------------------------------------------- */
/* isYouth                                                                     */
/* -------------------------------------------------------------------------- */

describe('isYouth', () => {
  it('accepts a grade inside the band and rejects one outside', () => {
    expect(isYouth(person('1', { grade: 6 }), RANGE)).toBe(true);
    expect(isYouth(person('1', { grade: 12 }), RANGE)).toBe(true);
    expect(isYouth(person('1', { grade: 5 }), RANGE)).toBe(false);
    expect(isYouth(person('1', { grade: 13 }), RANGE)).toBe(false);
  });

  it('refuses to guess: an adult with no grade is not a youth', () => {
    expect(isYouth(person('1', { first_name: 'Sam', child: false }), RANGE)).toBe(false);
  });

  it('uses the graduation year when an anchor is supplied', () => {
    expect(isYouth(person('1', { graduation_year: 2030 }), { ...RANGE, now: NOW })).toBe(true);
    expect(isYouth(person('1', { graduation_year: 2020 }), { ...RANGE, now: NOW })).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* pcoGrade                                                                    */
/* -------------------------------------------------------------------------- */

describe('pcoGrade', () => {
  it('says nothing rather than guessing when Planning Center holds no grade', () => {
    expect(pcoGrade(person('1', { first_name: 'Sam', child: false }))).toBeNull();
    expect(pcoGrade(person('1', { graduation_year: 2030 }))).toBeNull();
  });

  it('reports what Planning Center holds, unclamped', () => {
    expect(pcoGrade(person('1', { grade: 3 }))).toBe(3);
    expect(pcoGrade(person('1', { graduation_year: 2030 }), NOW)).toBe(8);
  });
});

/* -------------------------------------------------------------------------- */
/* extractParentContact                                                        */
/* -------------------------------------------------------------------------- */

describe('extractParentContact', () => {
  const student = person('100', { first_name: 'Jamie', last_name: 'Rivera', child: true }, ['H1']);

  it('prefers the parent_guardian over another adult in the same household', () => {
    const contact = extractParentContact(
      student,
      index(
        [household('H1', ['100', '301', '302'])],
        [
          person('301', { first_name: 'Chris', last_name: 'Rivera', child: false }),
          person('302', { first_name: 'Alex', last_name: 'Rivera', child: false }),
        ],
        [
          membership('m1', 'H1', '100', 'child_or_dependent'),
          membership('m2', 'H1', '301', 'adult'),
          membership('m3', 'H1', '302', 'parent_guardian'),
        ],
        [email('e1', '302', 'Alex.Rivera@example.org', true), email('e2', '301', 'chris@example.org', true)],
        [phone('p1', '302', '555-0100', true), phone('p2', '301', '555-0199', true)],
      ),
    );

    expect(contact).toEqual({
      parentName: 'Alex Rivera',
      parentPhone: '555-0100',
      parentEmail: 'alex.rivera@example.org',
    });
  });

  it('breaks a tie between two equal adults on id, every single run', () => {
    const resources = index(
      [household('H1', ['100', '302', '301'])],
      [
        person('302', { first_name: 'Alex', last_name: 'Rivera', child: false }),
        person('301', { first_name: 'Chris', last_name: 'Rivera', child: false }),
      ],
      [membership('m2', 'H1', '302', 'adult'), membership('m3', 'H1', '301', 'adult')],
      [phone('p1', '301', '555-0199', true), phone('p2', '302', '555-0100', true)],
    );

    const first = extractParentContact(student, resources);
    const second = extractParentContact(student, resources);

    expect(first.parentName).toBe('Chris Rivera');
    expect(first.parentPhone).toBe('555-0199');
    expect(second).toEqual(first);
  });

  it('returns nothing when the household holds no adults', () => {
    const contact = extractParentContact(
      student,
      index(
        [household('H1', ['100', '101'])],
        [person('101', { first_name: 'Sam', last_name: 'Rivera', child: true })],
        [
          membership('m1', 'H1', '100', 'child_or_dependent'),
          membership('m2', 'H1', '101', 'child_or_dependent'),
        ],
        [phone('p1', '101', '555-0111', true)],
      ),
    );

    expect(contact).toEqual({ parentName: null, parentPhone: null, parentEmail: null });
  });

  it('returns nothing when the student has no household at all', () => {
    expect(extractParentContact(person('100', { first_name: 'Jamie' }), index())).toEqual({
      parentName: null,
      parentPhone: null,
      parentEmail: null,
    });
  });

  it('prefers a primary contact method and otherwise takes the lowest id', () => {
    const contact = extractParentContact(
      student,
      index(
        [household('H1', ['100', '301'])],
        [person('301', { first_name: 'Chris', last_name: 'Rivera', child: false })],
        [membership('m2', 'H1', '301', 'parent_guardian')],
        [phone('p9', '301', '555-0000'), phone('p2', '301', '555-0100', true)],
        [email('e9', '301', 'work@example.org'), email('e2', '301', 'home@example.org')],
      ),
    );

    expect(contact.parentPhone).toBe('555-0100');
    // No primary email, so the lowest id wins rather than array order.
    expect(contact.parentEmail).toBe('home@example.org');
  });

  it('falls back to the child flag when no membership records were fetched', () => {
    const contact = extractParentContact(
      student,
      index(
        [household('H1', ['100', '301'])],
        [person('301', { first_name: 'Chris', last_name: 'Rivera', child: false })],
        [phone('p1', '301', '555-0123', true)],
      ),
    );

    expect(contact.parentName).toBe('Chris Rivera');
    expect(contact.parentPhone).toBe('555-0123');
  });
});

/* -------------------------------------------------------------------------- */
/* hasContactDetails                                                           */
/* -------------------------------------------------------------------------- */

describe('hasContactDetails', () => {
  const adult = person('301', { first_name: 'Chris', last_name: 'Rivera', child: false });

  it('accepts a phone number or an email address on its own', () => {
    expect(hasContactDetails(adult, index([phone('p1', '301', '555-0123')]))).toBe(true);
    expect(hasContactDetails(adult, index([email('e1', '301', 'chris@example.org')]))).toBe(true);
  });

  it('says no when Planning Center holds neither', () => {
    expect(hasContactDetails(adult, index())).toBe(false);
  });

  it('does not count somebody else in the household as a way to reach them', () => {
    // The index carries a whole page of people; an Email belongs to the person
    // its relationship names, not to whoever is being asked about.
    const other = index([phone('p1', '999', '555-0123'), email('e1', '999', 'other@example.org')]);
    expect(hasContactDetails(adult, other)).toBe(false);
  });

  it('ignores a blank number or address', () => {
    expect(hasContactDetails(adult, index([phone('p1', '301', '   ')]))).toBe(false);
    expect(hasContactDetails(adult, index([email('e1', '301', '')]))).toBe(false);
  });

  it('falls back to the address on the person when no Email was side-loaded', () => {
    const withPrimary = person('301', { first_name: 'Chris', primary_email_address: 'chris@example.org' });
    expect(hasContactDetails(withPrimary, index())).toBe(true);
  });
});

describe('keys', () => {
  it('indexes included resources by type and id', () => {
    const built = index([email('e1', '500', 'sam@example.org')], [household('H1', ['1'])]);

    expect(built.byKey.get('Email:e1')?.id).toBe('e1');
    expect(built.byType.get('Household')).toHaveLength(1);
    expect(built.byKey.get('Email:missing')).toBeUndefined();
  });

  it('matches a quick-added visitor to the same person despite accents and case', () => {
    expect(nameGradeKey('José', 'Núñez', 8)).toBe(nameGradeKey('  jose ', 'nunez', 8));
    expect(nameGradeKey('Jose', 'Nunez', 8)).not.toBe(nameGradeKey('Jose', 'Nunez', 9));
  });

  it('keeps two different non-Latin names apart', () => {
    // Stripping to [a-z0-9] leaves both of these empty, which would collapse
    // every 6th-grade Tsai in the church onto whichever one synced first.
    expect(nameGradeKey('蔡秉洲', 'Tsai', 6)).not.toBe(nameGradeKey('蔡小明', 'Tsai', 6));
    expect(nameGradeKey('蔡秉洲', 'Tsai', 6)).toBe(nameGradeKey(' 蔡秉洲 ', 'tsai', 6));
  });

  it('sorts Planning Center ids numerically so 9 comes before 10', () => {
    expect(['10', '9', '100'].sort(compareIds)).toEqual(['9', '10', '100']);
    expect(compareIds('abc', 'abd')).toBeLessThan(0);
  });

  it('spells the emailKey exactly the way the app does', () => {
    expect(emailKey(' Sam.Smith@Example.ORG ')).toBe('sam,smith@example,org');
  });
});
