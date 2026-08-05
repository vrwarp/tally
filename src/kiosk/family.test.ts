/**
 * Who the kiosk is willing to call a family.
 *
 * The rule is the interesting part, and it is deliberately stricter than the
 * search that feeds it: siblings share a *nested* set of family digits by how
 * the index is built, while two families who merely happen to end a number the
 * same way do not. See family.ts.
 */
import { describe, expect, it } from 'vitest';
import { buildFamilyDigits, familyOf, MAX_FAMILY_OFFER } from '@/kiosk/family';
import type { KioskStudent } from '@/kiosk/search';

function student(id: string, firstName: string, lastName: string): KioskStudent {
  return {
    id,
    firstName,
    lastName,
    grade: 9,
    searchName: `${firstName} ${lastName}`.toLowerCase(),
    hasAllergies: false,
  };
}

const MAYA = student('s-maya', 'Maya', 'Chen');
const AMARA = student('s-amara', 'Amara', 'Osei');
const MARCUS = student('s-marcus', 'Marcus', 'Osei');
/** Marcus and Amara's half-brother: their household, plus his father's. */
const NOAH = student('s-noah', 'Noah', 'Osei');
const JORDAN = student('s-jordan', 'Jordan', 'Reyes');

const ROSTER = [MAYA, AMARA, MARCUS, NOAH, JORDAN];

function familyIn(last4: Record<string, string[]>, of: KioskStudent): string[] {
  return familyOf(of, ROSTER, buildFamilyDigits(last4)).map((member) => member.id);
}

describe('familyOf', () => {
  it('offers the siblings who answer to the same family numbers', () => {
    const last4 = {
      '0134': ['s-amara', 's-marcus', 's-noah'],
      '7788': ['s-amara', 's-marcus', 's-noah'],
    };
    expect(familyIn(last4, MARCUS)).toEqual(['s-amara', 's-noah']);
  });

  it('keeps a sibling whose own set is wider — a second household is still family', () => {
    // Noah is in his father's household too, so his set is a strict superset
    // of his brother's. Nesting is what the index guarantees for co-members.
    const last4 = {
      '0134': ['s-amara', 's-marcus', 's-noah'],
      '7788': ['s-amara', 's-marcus', 's-noah'],
      '5150': ['s-noah'],
    };
    expect(familyIn(last4, MARCUS)).toEqual(['s-amara', 's-noah']);
    expect(familyIn(last4, NOAH)).toEqual(['s-amara', 's-marcus']);
  });

  it('drops a coincidence — a shared tail is not a shared family', () => {
    // Maya's family and the Oseis both end a number 0134. Neither set contains
    // the other, so neither is offered under the other's name.
    const last4 = {
      '0134': ['s-amara', 's-marcus', 's-maya'],
      '7788': ['s-amara', 's-marcus'],
      '2200': ['s-maya'],
    };
    expect(familyIn(last4, MARCUS)).toEqual(['s-amara']);
    expect(familyIn(last4, MAYA)).toEqual([]);
  });

  it('offers nobody to a student the index has never heard of', () => {
    // A visitor quick-added at the door tonight: nothing on file yet.
    expect(familyIn({ '0134': ['s-amara', 's-marcus'] }, JORDAN)).toEqual([]);
  });

  it('offers nobody when the group is too large to be a family', () => {
    const crowd = ['s-maya', 's-amara', 's-marcus', 's-noah', 's-jordan'];
    const roster = [...ROSTER];
    for (let index = 0; index <= MAX_FAMILY_OFFER; index += 1) {
      const extra = student(`s-extra-${index}`, `Extra${index}`, 'Case');
      roster.push(extra);
      crowd.push(extra.id);
    }

    const digits = buildFamilyDigits({ '0134': crowd });
    // Nine children answering to one number is a digit collision wearing a
    // family's clothes; it is offered as nothing rather than trimmed to seven.
    expect(familyOf(MARCUS, roster, digits)).toEqual([]);
  });

  it('never includes the student who was tapped', () => {
    const last4 = { '0134': ['s-marcus'] };
    expect(familyIn(last4, MARCUS)).toEqual([]);
  });

  it('sorts the offer by name, like every other list of students', () => {
    const last4 = { '0134': ['s-noah', 's-marcus', 's-amara'] };
    expect(familyIn(last4, NOAH)).toEqual(['s-amara', 's-marcus']);
  });
});

describe('buildFamilyDigits', () => {
  it('inverts the index, and shrugs at a bucket that is not a list', () => {
    const digits = buildFamilyDigits({
      '0134': ['s-marcus'],
      '7788': ['s-marcus', 's-amara'],
      '9999': null as unknown as string[],
    });
    expect([...(digits.get('s-marcus') ?? [])].sort()).toEqual(['0134', '7788']);
    expect([...(digits.get('s-amara') ?? [])]).toEqual(['7788']);
  });
});
