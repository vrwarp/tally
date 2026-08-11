/**
 * The sentences the record shows while an edit is on its way.
 *
 * Worth a test of its own even though it returns strings, because two of the
 * things this file gets wrong are invisible to every other kind of test: a
 * state machine that is entirely correct can still be described in a sentence
 * that tells a leader the opposite of what is true, and a screenshot only
 * catches it if somebody reads the screenshot.
 */
import { describe, expect, it } from 'vitest';
import { describeFields, syncStripCopy } from '@/features/students/syncStripCopy';
import type { UpstreamEdit } from '@/types';

const NOW = new Date('2026-03-14T09:00:00Z');

function job(over: Partial<UpstreamEdit> = {}): UpstreamEdit {
  return {
    id: 'edit-1',
    studentId: 'pco_101',
    patch: { lastName: 'Chen-Ito' },
    baseline: { lastName: 'Chen' },
    state: 'failed',
    attempts: 4,
    nextAttemptAt: null,
    leaseUntil: null,
    failure: null,
    message: null,
    field: null,
    observed: null,
    survivorPersonId: null,
    survivorName: null,
    createdAt: NOW,
    createdBy: 'dana',
    createdByName: 'Dana Ruiz',
    updatedAt: NOW,
    startedAt: null,
    settledAt: null,
    pendingOnDevice: false,
    ...over,
  };
}

function copy(edit: UpstreamEdit) {
  return syncStripCopy({
    edit,
    now: NOW,
    backend: 'Planning Center',
    mine: true,
    authorFirstName: 'Dana',
    ago: '15 seconds ago',
  });
}

describe('a job that could not be delivered', () => {
  /**
   * The two failures wear one state, and the difference decides what a leader
   * does next: an unreachable backend is worth pressing again, and a rejected
   * value is worth reading first. Calling both of them "refused" sent people
   * to look for a mistake in a form that never had one.
   */
  it('does not call an unreachable backend a refusal', () => {
    const words = copy(job({ failure: 'exhausted' }));

    expect(words.heading).toBe('Could not reach Planning Center');
    expect(words.heading).not.toMatch(/refused/i);
  });

  it('says a refusal was a refusal, in the backend’s own words', () => {
    const words = copy(
      job({ failure: 'validation', message: 'Planning Center rejected the grade.' }),
    );

    expect(words.heading).toBe('Planning Center refused this edit');
    expect(words.body).toContain('Planning Center rejected the grade.');
  });

  /**
   * The sentence and the button beside it have to agree.
   *
   * A rotated credential said "an admin has to reconnect it; retrying will
   * not help" over a button offering to open the editor — two wrong things at
   * once, in the same strip: nothing in the form is broken, and the one move
   * offered was the one the text had just ruled out. Only a validation
   * refusal is about what somebody typed.
   */
  it('sends a leader to the form only when the values are what was refused', () => {
    expect(copy(job({ failure: 'validation', message: 'No.' })).body).toContain('No.');
    // The auth message must not tell somebody that sending again is pointless,
    // because after an admin reconnects it is exactly the move.
    expect(copy(job({ failure: 'auth' })).body).not.toMatch(/will not help\b/);
  });

  /*
   * Both of them promise the same thing, and it is the promise that lets
   * somebody walk away from the screen: whatever went wrong upstream, the
   * words they typed are still here.
   */
  it('promises in both cases that nothing was saved', () => {
    for (const failure of ['exhausted', 'validation'] as const) {
      expect(copy(job({ failure })).body).toContain('Nothing was saved');
    }
  });

  /**
   * The house order is the field sentence first, then the backend's own words.
   * It was inverted here alone, and a backend message ends in a full stop — so
   * the paragraph opened with the message and then ran on into a lowercase
   * fragment: "…will not help. last name, by you 15 seconds ago."
   */
  it('starts with a capital letter and does not run a sentence into a fragment', () => {
    const body = copy(
      job({ failure: 'auth', message: 'Planning Center refused Tally’s credentials.' }),
    ).body;

    expect(body).toMatch(/^[A-Z]/);
    // Every full stop is followed by a space and a capital, or ends the text.
    expect(body).not.toMatch(/\.\s+[a-z]/);
  });
});

describe('every state a leader can be looking at', () => {
  const states = [
    'queued',
    'sending',
    'waiting',
    'landed',
    'differs',
    'merged',
    'orphaned',
    'failed',
  ] as const;

  it('never promises an automatic retry on a state that has stopped trying', () => {
    // `waiting` is the only state where "it resumes on its own" is a promise
    // Tally can keep; `queued` makes the same kind of promise about a job the
    // server already has.
    for (const state of states) {
      if (state === 'queued' || state === 'waiting') continue;
      const words = copy(job({ state, failure: state === 'failed' ? 'exhausted' : null }));
      expect(words.body, state).not.toMatch(/tr(y|ies) again on its own|resumes on its own/i);
    }
  });

  it('writes a heading and a body for all of them', () => {
    for (const state of states) {
      const words = copy(job({ state }));
      expect(words.heading, state).not.toBe('');
      expect(words.body.length, state).toBeGreaterThan(20);
    }
  });
});

describe('naming the fields somebody changed', () => {
  it('reads as English rather than as a field list', () => {
    expect(describeFields({ patch: { lastName: 'Ito' } })).toBe('Last name');
    expect(describeFields({ patch: { lastName: 'Ito', grade: 8 } })).toBe('Last name and grade');
    expect(describeFields({ patch: { lastName: 'Ito', grade: 8, birthday: '2011-04-02' } })).toBe(
      'Last name, grade and birthday',
    );
  });

  it('says something rather than nothing for an empty patch', () => {
    expect(describeFields({ patch: {} })).toBe('This profile');
  });
});
