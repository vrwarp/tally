/**
 * Merging Planning Center's roster with Tally's own documents.
 *
 * This is the join that replaced the mirror, and it has one failure mode that
 * matters more than the rest: a student appearing twice. A duplicate row at a
 * door is not a cosmetic bug — two counselors check in two different rows for
 * the same child and the count is wrong for the rest of the night.
 */
import { describe, expect, it } from 'vitest';
import { mergeRoster } from '@/features/roster/mergeRoster';
import { makeStudent } from '../../../tests/factories';

/** A row as it arrives from Planning Center. */
function rosterEntry(pcoPersonId: string, overrides = {}) {
  return makeStudent({
    id: `pco_${pcoPersonId}`,
    pcoPersonId,
    fromPlanningCenter: true,
    notes: null,
    createdAt: new Date(0),
    ...overrides,
  });
}

/** A document Tally wrote about somebody. */
function tallyDocument(id: string, overrides = {}) {
  return makeStudent({
    id,
    fromPlanningCenter: false,
    profileComplete: false,
    hasAllergies: false,
    pcoPersonId: null,
    ...overrides,
  });
}

describe('mergeRoster', () => {
  it('returns the Planning Center roster when Tally has nothing to add', () => {
    const roster = [rosterEntry('1'), rosterEntry('2')];
    expect(mergeRoster(roster, [])).toHaveLength(2);
  });

  it('keeps a visitor Tally created and Planning Center has never seen', () => {
    const visitor = tallyDocument('tally-abc', { firstName: 'Nia', isVisitor: true });
    const merged = mergeRoster([rosterEntry('1')], [visitor]);

    expect(merged.map((student) => student.id).sort()).toEqual(['pco_1', 'tally-abc']);
  });

  it('layers an annotation onto the Planning Center row without duplicating it', () => {
    const roster = [rosterEntry('1', { firstName: 'Amara', lastName: 'Okonkwo' })];
    const annotation = tallyDocument('pco_1', {
      firstName: 'Amara',
      lastName: 'Okonkwo',
      notes: 'Plays trumpet.',
    });

    const merged = mergeRoster(roster, [annotation]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.notes).toBe('Plays trumpet.');
  });

  it('lets Planning Center keep the name and grade', () => {
    // A stale name in a Tally document must not override the church's record —
    // that is the entire reason Planning Center is the source of truth.
    const roster = [rosterEntry('1', { firstName: 'Benji', grade: 9 })];
    const annotation = tallyDocument('pco_1', { firstName: 'Benjamin', grade: 7 });

    const merged = mergeRoster(roster, [annotation]);

    expect(merged[0]?.firstName).toBe('Benji');
    expect(merged[0]?.grade).toBe(9);
  });

  it('collapses a visitor who has since been linked upstream, under the document id', () => {
    // The push created the person in Planning Center and wrote the id back. The
    // same child is now reachable under two ids; showing both would be a
    // duplicate row for the one case where a duplicate is most likely. The row
    // keeps the *document's* id — every attendance record, tonight's included,
    // was written against it — and takes Planning Center's fields.
    const roster = [rosterEntry('900', { firstName: 'Nia', lastName: 'Mbeki' })];
    const linked = tallyDocument('tally-abc', {
      firstName: 'N.',
      lastName: 'Mbeki',
      pcoPersonId: '900',
      isVisitor: true,
      notes: 'Plays trumpet.',
    });

    const merged = mergeRoster(roster, [linked]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe('tally-abc');
    // Planning Center keeps the name; the annotation still travels.
    expect(merged[0]?.firstName).toBe('Nia');
    expect(merged[0]?.notes).toBe('Plays trumpet.');
  });

  it('grafts the birthday Planning Center holds onto a linked visitor', () => {
    // The bug this whole branch exists for: the document pins `birthday: null`
    // — Tally keeps no copy of what Planning Center owns — so without the
    // roster answering for a linked visitor, a birthday saved upstream read
    // "No birthday" on the roster for ever.
    const roster = [rosterEntry('900', { birthday: '02-07' })];
    const linked = tallyDocument('tally-abc', { pcoPersonId: '900', birthday: null });

    const merged = mergeRoster(roster, [linked]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.birthday).toBe('02-07');
  });

  it('prefers the typed grade over nothing at all upstream', () => {
    // Planning Center has been measured discarding `grade` on create with a
    // 200, so a pushed visitor can be grade-less upstream. The document holds
    // the 9 a human typed at the door.
    const roster = [rosterEntry('900', { grade: null })];
    const linked = tallyDocument('tally-abc', { pcoPersonId: '900', grade: 9 });

    expect(mergeRoster(roster, [linked])[0]?.grade).toBe(9);
  });

  it('does not claim a grade when neither side holds one', () => {
    // Nothing to print, and nothing invented to print instead. This used to
    // need a boolean kept in step with a sentinel 6.
    const roster = [rosterEntry('900', { grade: null })];
    const linked = tallyDocument('tally-abc', { pcoPersonId: '900', grade: null });

    expect(mergeRoster(roster, [linked])[0]?.grade).toBeNull();
  });

  it('lets Planning Center keep a grade it genuinely holds for a linked visitor', () => {
    const roster = [rosterEntry('900', { grade: 8 })];
    const linked = tallyDocument('tally-abc', { pcoPersonId: '900', grade: 9 });

    expect(mergeRoster(roster, [linked])[0]?.grade).toBe(8);
  });

  it('keeps the Planning Center id when a membership document exists too', () => {
    // Somebody deliberately added the person from Planning Center as well:
    // that document is the membership, and the `pco_` id stays canonical.
    const roster = [rosterEntry('900')];
    const membership = tallyDocument('pco_900', { notes: 'Core kid.' });
    const linked = tallyDocument('tally-abc', { pcoPersonId: '900', isVisitor: true });

    const merged = mergeRoster(roster, [membership, linked]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe('pco_900');
  });

  it('folds two documents linked to the same person into one row', () => {
    // Two quick-adds for one child, both pushed, both matched to the same
    // Planning Center person. One row, whichever document got there first.
    const roster = [rosterEntry('900')];
    const first = tallyDocument('tally-a', { pcoPersonId: '900' });
    const second = tallyDocument('tally-b', { pcoPersonId: '900', notes: 'Same kid.' });

    const merged = mergeRoster(roster, [first, second]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe('tally-a');
    expect(merged[0]?.notes).toBe('Same kid.');
  });

  it('keeps the document creation date, which is what MIA depends on', () => {
    // A roster row alone carries the epoch, so every past gathering counts as
    // one the student could have attended. A visitor added last Friday has a
    // real date, and must not be reported as having missed the Fridays before
    // they existed.
    const joined = new Date('2026-02-13T19:00:00Z');
    const roster = [rosterEntry('1')];
    const annotation = tallyDocument('pco_1', { createdAt: joined });

    expect(mergeRoster(roster, [annotation])[0]?.createdAt).toEqual(joined);
  });

  it('clears the visitor badge once Planning Center can reach a parent', () => {
    // Journey 3's payoff: "we do not know this child yet" stops being true when
    // the church's own records know them and how to phone home.
    const roster = [rosterEntry('900', { profileComplete: true })];
    const linked = tallyDocument('tally-abc', { pcoPersonId: '900', isVisitor: true });

    expect(mergeRoster(roster, [linked])[0]?.isVisitor).toBe(false);
  });

  it('keeps the visitor badge while Planning Center still has no contact', () => {
    const roster = [rosterEntry('900', { profileComplete: false })];
    const linked = tallyDocument('tally-abc', { pcoPersonId: '900', isVisitor: true });

    expect(mergeRoster(roster, [linked])[0]?.isVisitor).toBe(true);
  });

  it('sorts by search name, so a roster does not reshuffle between reads', () => {
    const merged = mergeRoster(
      [
        rosterEntry('1', { searchName: 'zoe adeyemi' }),
        rosterEntry('2', { searchName: 'amara okonkwo' }),
      ],
      [tallyDocument('tally-1', { searchName: 'marcus lee' })],
    );

    expect(merged.map((student) => student.searchName)).toEqual([
      'amara okonkwo',
      'marcus lee',
      'zoe adeyemi',
    ]);
  });

  it('survives an empty Planning Center roster', () => {
    // Planning Center unreachable on a first run: whatever Tally owns is still
    // better than a blank screen.
    const visitor = tallyDocument('tally-abc');
    expect(mergeRoster([], [visitor])).toHaveLength(1);
  });

  it('never emits the same id twice', () => {
    const roster = [rosterEntry('1'), rosterEntry('2')];
    const documents = [
      tallyDocument('pco_1'),
      tallyDocument('tally-a', { pcoPersonId: '2' }),
      tallyDocument('tally-b'),
    ];

    const ids = mergeRoster(roster, documents).map((student) => student.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /* ---- A second backend on the same roster ------------------------------- */

  /** A row as it arrives from Attendees. */
  function a32Entry(personId: string, overrides = {}) {
    return makeStudent({
      id: `a32_${personId}`,
      pcoPersonId: personId,
      upstreamBackend: 'a32',
      upstreamPersonId: personId,
      fromPlanningCenter: true,
      notes: null,
      createdAt: new Date(0),
      ...overrides,
    });
  }

  const UUID = '8c1f2c34-9d1e-4f56-8a7b-0c1d2e3f4a5b';

  it('layers an annotation onto an Attendees row without duplicating it', () => {
    const roster = [a32Entry(UUID, { firstName: 'Priya' })];
    const annotation = tallyDocument(`a32_${UUID}`, { notes: 'Plays veena.' });

    const merged = mergeRoster(roster, [annotation]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.firstName).toBe('Priya');
    expect(merged[0]?.notes).toBe('Plays veena.');
  });

  it('collapses a visitor linked to Attendees under the document id', () => {
    // The generic linkage pair, without any legacy `pcoPersonId` — an Attendees
    // push writes only the generics. The join must read them, or this child is
    // two rows.
    const roster = [a32Entry(UUID, { firstName: 'Wei', lastName: 'Suzuki' })];
    const linked = tallyDocument('tally-abc', {
      firstName: 'W.',
      upstreamBackend: 'a32',
      upstreamPersonId: UUID,
      isVisitor: true,
      notes: 'Sister of Hana.',
    });

    const merged = mergeRoster(roster, [linked]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe('tally-abc');
    expect(merged[0]?.firstName).toBe('Wei');
    expect(merged[0]?.notes).toBe('Sister of Hana.');
  });

  it('keeps the two backends apart when their people share nothing but a roster', () => {
    const roster = [rosterEntry('900', { searchName: 'amara okonkwo' }), a32Entry(UUID, { searchName: 'priya raghunathan' })];
    const documents = [
      tallyDocument('tally-a', { pcoPersonId: '900' }),
      tallyDocument('tally-b', { upstreamBackend: 'a32', upstreamPersonId: UUID }),
    ];

    const merged = mergeRoster(roster, documents);

    expect(merged.map((student) => student.id).sort()).toEqual(['tally-a', 'tally-b']);
  });

  it('does not blank-row an Attendees membership whose person went unresolved', () => {
    // Same rule as the Planning Center case above it: a document holding no
    // name, whose upstream person the roster did not return, is not a row.
    const orphan = tallyDocument(`a32_${UUID}`, {
      firstName: '',
      upstreamBackend: 'a32',
      upstreamPersonId: UUID,
    });

    expect(mergeRoster([], [orphan])).toHaveLength(0);
  });
});
