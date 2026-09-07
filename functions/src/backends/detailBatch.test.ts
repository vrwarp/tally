/**
 * What a batch of contact reads asks for, and what it does with the ones that
 * fail.
 *
 * The rules here are the ones that decide whether replacing twenty invocations
 * with one is a saving or a regression. Two rows for one student must cost one
 * read; a row that has just written must not be handed the answer from before
 * the write; and one student nobody can look up must not take the other
 * nineteen down with it.
 */
import { describe, expect, it, vi } from 'vitest';
import { planDetailBatch, runDetailBatch } from './detailBatch.js';

const describeError = (error: unknown): { code: string; message: string } => ({
  code: (error as { code?: string })?.code ?? 'internal',
  message: String((error as { message?: string })?.message ?? error),
});

function fail(code: string, message = code): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

describe('planDetailBatch', () => {
  it('reads one student once however many rows asked', () => {
    // A new visitor who has since missed three gatherings is on two of the
    // dashboard's lists at once. That is two rows and one family.
    const { wanted } = planDetailBatch(
      [{ studentId: 'pco_1' }, { studentId: 'pco_2' }, { studentId: 'pco_1' }],
      100,
    );

    expect([...wanted.keys()]).toEqual(['pco_1', 'pco_2']);
  });

  it('lets a forced read win the tie', () => {
    // The row that just added a parent and the row that only ever read share a
    // request; the shared answer has to be good enough for the one that wrote.
    const { wanted } = planDetailBatch(
      [{ studentId: 'pco_1' }, { studentId: 'pco_1', force: true }],
      100,
    );

    expect(wanted.get('pco_1')).toBe(true);
  });

  it('does not force a read nobody asked to force', () => {
    const { wanted } = planDetailBatch([{ studentId: 'pco_1' }], 100);
    expect(wanted.get('pco_1')).toBe(false);
  });

  it('ignores an entry with no student in it', () => {
    const { wanted, errors } = planDetailBatch(
      [{ studentId: '  ' }, {}, { studentId: 'pco_1' }],
      100,
    );

    expect([...wanted.keys()]).toEqual(['pco_1']);
    expect(errors).toEqual({});
  });

  it('trims the id, because a padded one is a different map key', () => {
    const { wanted } = planDetailBatch([{ studentId: ' pco_1 ' }, { studentId: 'pco_1' }], 100);
    expect([...wanted.keys()]).toEqual(['pco_1']);
  });

  it('turns away everything past the cap, by name', () => {
    // Not truncated silently: a student with no answer and no error is a row
    // that spins for ever, which is the one outcome worse than a failure.
    const { wanted, errors } = planDetailBatch(
      [{ studentId: 'a' }, { studentId: 'b' }, { studentId: 'c' }],
      2,
    );

    expect([...wanted.keys()]).toEqual(['a', 'b']);
    expect(errors.c?.code).toBe('resource-exhausted');
  });

  it('still merges a duplicate of somebody already inside the cap', () => {
    // The cap counts students, not entries — a second row for a student who is
    // already being read costs nothing and must not be refused.
    const { wanted, errors } = planDetailBatch(
      [{ studentId: 'a' }, { studentId: 'b' }, { studentId: 'a', force: true }],
      2,
    );

    expect(wanted.get('a')).toBe(true);
    expect(errors).toEqual({});
  });
});

describe('runDetailBatch', () => {
  const options = { concurrency: 2, describe: describeError };

  it('answers every student it was given', async () => {
    const wanted = new Map([
      ['pco_1', false],
      ['pco_2', false],
    ]);

    const { details, errors } = await runDetailBatch(
      wanted,
      async (studentId) => `details for ${studentId}`,
      options,
    );

    expect(details).toEqual({ pco_1: 'details for pco_1', pco_2: 'details for pco_2' });
    expect(errors).toEqual({});
  });

  it('carries a deliberate null through as an answer', async () => {
    // "Read, and the backend has no such person" is not a failure — it is what
    // a merged or deleted student looks like, and the row says so.
    const { details, errors } = await runDetailBatch(
      new Map([['pco_1', false]]),
      async () => null,
      options,
    );

    expect(details).toEqual({ pco_1: null });
    expect(errors).toEqual({});
  });

  it('passes the force flag through per student', async () => {
    const read = vi.fn(async () => 'ok');
    await runDetailBatch(
      new Map([
        ['pco_1', true],
        ['pco_2', false],
      ]),
      read,
      options,
    );

    expect(read).toHaveBeenCalledWith('pco_1', true);
    expect(read).toHaveBeenCalledWith('pco_2', false);
  });

  it("keeps one student's failure to that student", async () => {
    const { details, errors } = await runDetailBatch(
      new Map([
        ['gone', false],
        ['here', false],
      ]),
      async (studentId) => {
        if (studentId === 'gone') throw fail('not-found', 'Not linked to a people backend.');
        return 'details';
      },
      options,
    );

    expect(details).toEqual({ here: 'details' });
    expect(errors.gone).toEqual({ code: 'not-found', message: 'Not linked to a people backend.' });
  });

  it('hands back the raw failures, so a wholesale outage can be reported as one', async () => {
    const { failures, details } = await runDetailBatch(
      new Map([
        ['a', false],
        ['b', false],
      ]),
      async () => {
        throw fail('resource-exhausted', 'rate limited');
      },
      options,
    );

    expect(details).toEqual({});
    expect(failures).toHaveLength(2);
    expect((failures[0] as { code: string }).code).toBe('resource-exhausted');
  });

  it("carries the plan's refusals into the answer", async () => {
    const { errors } = await runDetailBatch(new Map([['a', false]]), async () => 'ok', {
      ...options,
      errors: { c: { code: 'resource-exhausted', message: 'too many' } },
    });

    expect(errors.c?.code).toBe('resource-exhausted');
  });

  it('never has more than `concurrency` reads in the air', async () => {
    // The whole point of batching is that the burst stops here rather than
    // moving from Cloud Functions to Planning Center's rate limit.
    let running = 0;
    let peak = 0;

    await runDetailBatch(
      new Map(Array.from({ length: 9 }, (_, index) => [`pco_${index}`, false])),
      async () => {
        running += 1;
        peak = Math.max(peak, running);
        await Promise.resolve();
        running -= 1;
        return 'ok';
      },
      { ...options, concurrency: 3 },
    );

    expect(peak).toBe(3);
  });

  it('starts no workers for an empty plan', async () => {
    const read = vi.fn(async () => 'ok');
    const { details } = await runDetailBatch(new Map(), read, options);

    expect(read).not.toHaveBeenCalled();
    expect(details).toEqual({});
  });
});
