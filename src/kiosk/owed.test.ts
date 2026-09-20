/**
 * Which name tags a printer that came back is allowed to offer, and which of
 * them arrive ticked.
 *
 * The offer is a batch: one press puts a stack of stickers on the tape with
 * nobody watching them come out, so every row that should not have been there
 * is a label on the floor and a child's name on it. That makes the *refusals*
 * the load-bearing half of this file — the child already collected, the child
 * the roster can no longer answer for, the tag so old that a sticker is an
 * errand nobody asked for — and the ticks the second half, because a volunteer
 * who trusts the ticks will press without reading and a volunteer who does not
 * will read all twelve rows every time.
 */
import { describe, expect, it } from 'vitest';

import { OWED_AGE_OUT_MS, OWED_TICK_MS, offeredOwed, type OwedTag } from './owed';

const NOW = Date.parse('2026-05-08T19:12:00Z');

/** The offer as the confirm would list it, with everything defaulted to "fine". */
function offered(
  owed: readonly OwedTag[],
  overrides: Partial<Omit<Parameters<typeof offeredOwed>[0], 'owed'>> = {},
): ReturnType<typeof offeredOwed> {
  return offeredOwed({
    owed,
    now: NOW,
    requiresCheckOut: false,
    checkedOutIds: new Set(),
    knownIds: new Set(owed.map((tag) => tag.studentId)),
    newIds: new Set(),
    ...overrides,
  });
}

/** One tag, `minutes` ago. */
function tag(studentId: string, minutes: number): OwedTag {
  return { studentId, atMs: NOW - minutes * 60_000 };
}

describe('the tags a recovered printer offers', () => {
  it('offers an outage whole, oldest first', () => {
    /* Twelve children checked in while a roll ran out, and the volunteer who
       reloads it gets one list rather than twelve prompts. Arrival order
       because that is the order the stack comes off the printer and the order
       somebody carrying it to a room reads it in — shuffled going in, so the
       sort is doing the work rather than the fixture. */
    const outage = [3, 11, 1, 24, 7, 19, 2, 14, 5, 27, 9, 22].map((minutes) =>
      tag(`child-${minutes}`, minutes),
    );
    const rows = offered(outage);
    expect(rows).toHaveLength(12);
    expect(rows.map((row) => row.atMs)).toEqual([...rows.map((row) => row.atMs)].sort((a, b) => a - b));
    expect(rows[0].studentId).toBe('child-27');
    expect(rows.at(-1)?.studentId).toBe('child-1');
  });

  it('never offers a child who has already been collected', () => {
    /* The one refusal that holds on every gathering: a sticker for a child in
       a car is litter with a name on it. */
    const rows = offered([tag('ada', 2), tag('gus', 3)], {
      checkedOutIds: new Set(['gus']),
    });
    expect(rows.map((row) => row.studentId)).toEqual(['ada']);
  });

  it('never offers a child the roster can no longer answer for', () => {
    /* A label is re-rastered from the roster row, so an id that has gone —
       a registration whose callable never answered — is a count on the glass
       the press could not honour. */
    const rows = offered([tag('ada', 2), tag('ghost', 3)], {
      knownIds: new Set(['ada']),
    });
    expect(rows.map((row) => row.studentId)).toEqual(['ada']);
  });
});

describe('the ticks, where a clock has to stand in for the register', () => {
  it('ticks a tag inside the parent’s own window and not one past it', () => {
    /* To the millisecond, because ten minutes is shared with `reprintOffer`
       and the two are meant to name the same walk. */
    const rows = offered([
      { studentId: 'inside', atMs: NOW - OWED_TICK_MS },
      { studentId: 'outside', atMs: NOW - OWED_TICK_MS - 1 },
    ]);
    expect(rows.find((row) => row.studentId === 'inside')).toMatchObject({
      ticked: true,
      recent: true,
    });
    expect(rows.find((row) => row.studentId === 'outside')).toMatchObject({
      ticked: false,
      recent: false,
    });
  });

  it('still offers the older tags, unticked, for a volunteer who wants them', () => {
    /* The leader back from a walk with the bus group ticks them by hand; the
       kiosk declining to guess is not the kiosk declining to help. */
    const rows = offered([tag('older', 20)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].ticked).toBe(false);
  });

  it('drops a tag once a sticker would be an errand nobody asked for', () => {
    const rows = offered([
      { studentId: 'just-in', atMs: NOW - OWED_AGE_OUT_MS },
      { studentId: 'too-old', atMs: NOW - OWED_AGE_OUT_MS - 1 },
    ]);
    expect(rows.map((row) => row.studentId)).toEqual(['just-in']);
  });
});

describe('the child nobody in the room has met', () => {
  it('ticks a child registered here tonight however long it has been', () => {
    /* The sticker is how the room learns the name, so the clock does not get
       a say — neither the tick nor the age-out. */
    const rows = offered([{ studentId: 'new', atMs: NOW - OWED_AGE_OUT_MS - 60_000 }], {
      newIds: new Set(['new']),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ isNew: true, ticked: true });
  });

  it('files them under the heading their own timestamp agrees with', () => {
    /* Ticked at any age, but the confirm's headings name a *time*: a child who
       arrived twenty minutes ago listed under "Last 10 minutes" is a heading
       above a row that contradicts it. `recent` and `ticked` come apart here
       and only here. */
    const rows = offered([{ studentId: 'new', atMs: NOW - 20 * 60_000 }], {
      newIds: new Set(['new']),
    });

    expect(rows[0]).toMatchObject({ ticked: true, recent: false });
  });

  it('still refuses one who has been collected', () => {
    const rows = offered([tag('new', 2)], {
      newIds: new Set(['new']),
      checkedOutIds: new Set(['new']),
    });
    expect(rows).toEqual([]);
  });
});

describe('a gathering that hands children back', () => {
  it('offers every tag ticked, because the register says they are still here', () => {
    /* No clock, on purpose: the sticker carries the allergy line and the
       pickup match, and a tag is owed until the child is checked out. */
    const rows = offered([tag('ada', 2), tag('gus', 40), tag('mira', 90)], {
      requiresCheckOut: true,
    });
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.ticked)).toBe(true);
  });

  it('still drops the ones the register has handed back', () => {
    const rows = offered([tag('ada', 2), tag('gus', 40)], {
      requiresCheckOut: true,
      checkedOutIds: new Set(['ada']),
    });
    expect(rows.map((row) => row.studentId)).toEqual(['gus']);
  });
});
