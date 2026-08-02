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
import { makeStudent } from '../../../tests/factories';

describe('buildContactList', () => {
  it('puts the grade in brackets after the name', () => {
    const line = buildContactList('Chase:', [
      makeStudent({ firstName: 'Alena', lastName: 'Ruiz', grade: 9, gradeOnFile: true }),
    ]).split('\n')[1];

    expect(line).toBe('- Alena Ruiz (9th) contact in Planning Center');
  });

  it('drops the brackets for somebody Planning Center holds no grade for', () => {
    const line = buildContactList('Chase:', [
      makeStudent({ firstName: 'Alan', lastName: 'Wan', grade: 6, gradeOnFile: false }),
    ]).split('\n')[1];

    expect(line).toBe('- Alan Wan contact in Planning Center');
    expect(line).not.toContain('6th');
  });
});
