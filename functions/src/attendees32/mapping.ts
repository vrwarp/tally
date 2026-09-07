/**
 * Attendees attendee -> Tally record. Pure functions, no I/O — the same
 * discipline, and the same stakes, as ../pco/mapping.ts: a mistake here
 * quietly writes the wrong grade or surfaces the wrong parent for a real
 * child.
 *
 * The two mappings share their backend-independent pieces through
 * ../backends/mappingShared.ts — the search key, the composite-name
 * convention, the grade clamp — so a student reads the same on a mixed
 * roster whichever backend holds them.
 */
import {
  buildSearchName,
  clampGrade,
  composeFirstName,
  splitFirstName,
  trimmed,
} from '../backends/mappingShared.js';
import { studentIdFor } from '../generated/backendIds.js';
import type { AdultContact } from '../pco/mapping.js';
import type { RosterPerson } from '../pco/roster.js';
import {
  A32_FAMILY_CATEGORY,
  type A32Attendee,
  type A32FolkAttendee,
  type A32Relation,
} from './types.js';

/** The app's own "day known, year unknown" sentinel on `estimated_birthday`. */
export const A32_UNKNOWN_BIRTH_YEAR = 1800;

/* -------------------------------------------------------------------------- */
/* Fields                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The CJK name halves, as one string with no separator — `鈴木` + `偉` reads
 * `鈴木偉`, family name first, exactly as the app's own `name2()` renders it.
 */
export function cjkNameOf(attendee: Pick<A32Attendee, 'first_name2' | 'last_name2'>): string | null {
  const combined = `${attendee.last_name2 ?? ''}${attendee.first_name2 ?? ''}`.trim();
  return combined.length > 0 ? combined : null;
}

/**
 * The display first name: the roman first name with the CJK name riding as
 * the quoted nickname — the same composite convention the Planning Center
 * mapping uses, so `splitFirstName` pulls it apart again on write and either
 * spelling finds the student in search.
 */
export function displayFirstNameOf(attendee: A32Attendee): string {
  return composeFirstName(attendee.first_name, cjkNameOf(attendee));
}

/** The grade Attendees holds (`infos.fixed.grade`), or null when it says nothing. */
export function a32Grade(attendee: A32Attendee): number | null {
  const raw = attendee.infos?.fixed?.grade;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * `MM-DD`, or null when Attendees holds no usable birthday.
 *
 * `actual_birthday` wins; `estimated_birthday` answers too because its 1800
 * year means exactly "the day is known" — which is all Tally keeps anyway.
 * The year never leaves the server, same boundary as the Planning Center
 * mapping.
 */
export function birthdayOf(attendee: A32Attendee): string | null {
  for (const raw of [attendee.actual_birthday, attendee.estimated_birthday]) {
    const value = trimmed(raw);
    if (value === null) continue;
    const match = /^\d{4}-(\d{2})-(\d{2})/.exec(value);
    if (!match) continue;
    const month = Number(match[1]);
    const day = Number(match[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    return `${match[1]}-${match[2]}`;
  }
  return null;
}

/**
 * The whole birthday for the one-person read — `YYYY-MM-DD`, or `MM-DD` when
 * the only year on file is the 1800 "day known, year unknown" sentinel, or
 * null. The same two shapes the Planning Center mapping's `fullBirthdayOf`
 * answers with, because they are one wire contract: what the edit form opens
 * on and what it saves back.
 */
export function fullBirthdayOf(attendee: A32Attendee): string | null {
  const monthDay = birthdayOf(attendee);
  if (monthDay === null) return null;

  for (const raw of [attendee.actual_birthday, attendee.estimated_birthday]) {
    const value = trimmed(raw);
    if (value === null) continue;
    const year = Number(/^(\d{4})-/.exec(value)?.[1]);
    if (!Number.isFinite(year) || year === A32_UNKNOWN_BIRTH_YEAR) continue;
    return `${year}-${monthDay}`;
  }
  return monthDay;
}

export function allergiesOf(attendee: A32Attendee): string | null {
  return trimmed(attendee.infos?.fixed?.allergies);
}

/** A dead person is the one "inactive" Attendees can express. */
export function statusOf(attendee: A32Attendee): 'active' | 'inactive' {
  return trimmed(attendee.deathday) !== null ? 'inactive' : 'active';
}

/* -------------------------------------------------------------------------- */
/* Person -> roster row                                                        */
/* -------------------------------------------------------------------------- */

export function mapAttendeeToRosterPerson(attendee: A32Attendee): RosterPerson {
  const firstName = displayFirstNameOf(attendee);
  const lastName = trimmed(attendee.last_name) ?? '';
  const { grade } = clampGrade(a32Grade(attendee));

  return {
    id: studentIdFor('a32', attendee.id),
    pcoPersonId: attendee.id,
    backendId: 'a32',
    firstName,
    lastName,
    grade,
    status: statusOf(attendee),
    searchName: buildSearchName(firstName, lastName),
    // Same contract as the Planning Center roster: a roster read does not
    // hydrate families, and null means "we did not look".
    profileComplete: null,
    hasAllergies: allergiesOf(attendee) !== null,
    birthday: birthdayOf(attendee),
  };
}

/* -------------------------------------------------------------------------- */
/* Writes: patches the profile editor produces                                 */
/* -------------------------------------------------------------------------- */

/**
 * The two name fields a Tally first-name edit writes back. The quoted
 * nickname half of the composite is the CJK name, which Attendees stores in
 * its own fields — pushing the composite whole into `first_name` would render
 * doubled on the next read and stop the matcher recognising the student.
 *
 * `first_name2`/`last_name2` are deliberately left alone: Tally cannot tell
 * which half of a CJK string is the family name, and a wrong split written
 * upstream is worse than a stale nickname.
 */
export function firstNamePatch(wanted: string): { first_name: string } {
  return { first_name: splitFirstName(wanted).firstName };
}

/**
 * Where a birthday edit lands. `MM-DD` alone means "this day, keeping
 * whatever year is on file" — on a person with no birthday at all it becomes
 * `estimated_birthday` under the app's own 1800 sentinel, never an invented
 * year on `actual_birthday`.
 */
export function birthdayPatch(
  wanted: string,
  current: Pick<A32Attendee, 'actual_birthday' | 'estimated_birthday'>,
):
  | { actual_birthday: string }
  | { estimated_birthday: string }
  | null {
  const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(wanted);
  if (full) return { actual_birthday: wanted };

  const dayOnly = /^(\d{2})-(\d{2})$/.exec(wanted);
  if (!dayOnly) return null;

  const actual = trimmed(current.actual_birthday);
  if (actual && /^\d{4}-/.test(actual)) {
    return { actual_birthday: `${actual.slice(0, 4)}-${wanted}` };
  }
  return { estimated_birthday: `${A32_UNKNOWN_BIRTH_YEAR}-${wanted}` };
}

/* -------------------------------------------------------------------------- */
/* Families                                                                    */
/* -------------------------------------------------------------------------- */

export interface A32ContactCandidate {
  /** The parent's attendee id. */
  id: string;
  /** The family folk the relationship lives in. */
  folkId: string;
  roleTitle: string;
}

/**
 * The family co-members who count as parents, from a student's
 * `datagrid_data_familyattendees` rows.
 *
 * A row qualifies when it is somebody else, in a *family* folk the student is
 * also in, holding a relation whose vocabulary entry says
 * `emergency_contact` — `parent`, `father`, `mother`, `guardian` — and not
 * the student-side `child`. Ordered by role title then id so repeated reads
 * pick the same parent every time.
 */
export function findContactCandidates(
  studentId: string,
  edges: readonly A32FolkAttendee[],
  relationsById: ReadonlyMap<number, A32Relation>,
): A32ContactCandidate[] {
  const familyFolkIds = new Set(
    edges
      .filter(
        (edge) =>
          edge.attendee === studentId &&
          edge.folk.category === A32_FAMILY_CATEGORY &&
          edge.is_removed !== true,
      )
      .map((edge) => edge.folk.id),
  );
  if (familyFolkIds.size === 0) return [];

  const candidates: A32ContactCandidate[] = [];
  for (const edge of edges) {
    if (edge.is_removed === true) continue;
    if (edge.attendee === studentId) continue;
    if (!familyFolkIds.has(edge.folk.id)) continue;
    const relation = relationsById.get(edge.role);
    if (!relation || !relation.emergency_contact) continue;
    if (relation.title === 'child') continue;
    candidates.push({ id: edge.attendee, folkId: edge.folk.id, roleTitle: relation.title });
  }
  return candidates.sort((a, b) =>
    a.roleTitle < b.roleTitle ? -1 : a.roleTitle > b.roleTitle ? 1 : a.id < b.id ? -1 : 1,
  );
}

/** The contact fields Attendees keeps in `infos.contacts`, first slot wins. */
export function contactsOf(attendee: A32Attendee): { phone: string | null; email: string | null } {
  const contacts = attendee.infos?.contacts ?? {};
  const firstMatching = (test: (value: string) => boolean): string | null => {
    // Slot order (phone1 before phone2) rather than object order, so the
    // answer does not depend on JSON key serialization.
    const keys = Object.keys(contacts).sort();
    for (const key of keys) {
      const value = trimmed(contacts[key]);
      if (value && test(value)) return value;
    }
    return null;
  };
  return {
    email: firstMatching((value) => value.includes('@')),
    phone: firstMatching((value) => !value.includes('@') && /\d/.test(value)),
  };
}

/**
 * Every phone-like value in `infos.contacts`, in slot order.
 *
 * All of them, unlike `contactsOf`'s first: the kiosk's last-4 index answers
 * "does any number in this family end in these digits", and a family types
 * whichever of its numbers comes to mind.
 */
export function allPhonesOf(attendee: A32Attendee): string[] {
  const contacts = attendee.infos?.contacts ?? {};
  const values: string[] = [];
  for (const key of Object.keys(contacts).sort()) {
    const value = trimmed(contacts[key]);
    if (value && !value.includes('@') && /\d/.test(value)) values.push(value);
  }
  return values;
}

/** Parent name/phone/email for a student, from an already-fetched parent. */
export function adultContactOf(parent: A32Attendee): AdultContact {
  const { phone, email } = contactsOf(parent);
  const name = [
    composeFirstName(parent.first_name, cjkNameOf(parent)),
    trimmed(parent.last_name) ?? '',
  ]
    .join(' ')
    .trim();
  return {
    contactName: name.length > 0 ? name : null,
    contactPhone: phone,
    contactEmail: email ? email.toLowerCase() : null,
  };
}
