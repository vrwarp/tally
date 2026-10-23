/**
 * The text that ends up pasted into a group chat.
 *
 * Every line is read by somebody who was not looking at the screen it came
 * from, which is why the grade matters here at all — and why a grade Tally
 * invented is worse here than anywhere else. Nobody reading the paste can tell
 * a fact from a fallback.
 */
import { describe, expect, it } from 'vitest';
import { buildContactList } from '@/features/dashboard/contactList';
import type { PcoPersonDetails } from '@/types';
import { testTranslator } from '@/test/translator';
import { makeStudent } from '../../../tests/factories';
import { testGrades } from '@/test/translator';

const grades = testGrades();

// The real English catalogue, so these assertions still measure what a person
// pastes — and now also that the keys behind it render.
const t = testTranslator('FollowUp');

describe('buildContactList', () => {
  it('puts the grade in brackets after the name', () => {
    const line = buildContactList(t, grades, 'Chase:', [
      makeStudent({ firstName: 'Alena', lastName: 'Ruiz', grade: 9 }),
    ]).split('\n')[1];

    expect(line).toBe('- Alena Ruiz (9th) contact in Planning Center');
  });

  it('drops the brackets for somebody Planning Center holds no grade for', () => {
    const line = buildContactList(t, grades, 'Chase:', [
      makeStudent({ firstName: 'Alan', lastName: 'Wan', grade: null }),
    ]).split('\n')[1];

    expect(line).toBe('- Alan Wan contact in Planning Center');
    expect(line).not.toContain('6th');
  });

  describe('contact details', () => {
    const alena = makeStudent({ id: 's-alena', firstName: 'Alena', lastName: 'Ruiz', grade: 9 });
    const details = (phone: string | null, email: string | null) =>
      ({ contactPhone: phone, contactEmail: email }) as PcoPersonDetails;
    const lineFor = (contact: PcoPersonDetails) =>
      buildContactList(t, grades, 'Chase:', [alena], new Map([[alena.id, contact]])).split('\n')[1];

    it('prefers the phone number over the email address', () => {
      expect(lineFor(details('555-0100', 'a@example.com'))).toBe('- Alena Ruiz (9th) 555-0100');
    });

    it('falls back to the email when the phone is blank or only whitespace', () => {
      expect(lineFor(details('   ', ' a@example.com '))).toBe('- Alena Ruiz (9th) a@example.com');
      expect(lineFor(details(null, 'a@example.com'))).toBe('- Alena Ruiz (9th) a@example.com');
    });

    it('says to look in Planning Center when neither is usable', () => {
      expect(lineFor(details('', '  '))).toBe('- Alena Ruiz (9th) contact in Planning Center');
    });
  });

  it('starts with the title and lists everybody, looked up or not', () => {
    const text = buildContactList(t, grades, 'Chase:', [
      makeStudent({ firstName: 'Alena', lastName: 'Ruiz', grade: 9 }),
      makeStudent({ firstName: 'Alan', lastName: 'Wan', grade: null }),
    ]);

    expect(text.split('\n')).toHaveLength(3);
    expect(text.startsWith('Chase:\n')).toBe(true);
  });
});
