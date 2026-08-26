/**
 * The read that puts the allergy on the row instead of two screens away.
 *
 * Three properties matter, and they are the three the check-in screen would
 * otherwise be punished for. It asks about the flagged rows and nobody else —
 * this is medical information about minors, and the whole design of the roster
 * read is that it does not travel. It asks once, though the list it is given is
 * rebuilt on every check-in and every keystroke. And when Planning Center
 * cannot be reached it says nothing at all, because a badge reading `Allergy`
 * is the warning this screen has always given and an error banner at a door is
 * noise.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidateAllergyNotes, useAllergyNotes } from '@/hooks/useAllergyNotes';
import { makeStudent } from '../../tests/factories';
import type { RosterEntry, Student } from '@/types';

const getAllergyNotes = vi.hoisted(() => vi.fn());

vi.mock('@/services/functions', () => ({ getAllergyNotes }));

function entry(student: Student): RosterEntry {
  return {
    student,
    isRecent: false,
    hasParticipated: false,
    attendance: null,
    rsvp: null,
    warnings: student.hasAllergies ? ['allergy'] : [],
    recentHits: 0,
    recentWindow: 0,
  };
}

const sofia = makeStudent({
  id: 'pco_4200003',
  firstName: 'Sofia',
  pcoPersonId: '4200003',
  hasAllergies: true,
});

const amara = makeStudent({ id: 'pco_4200001', firstName: 'Amara', pcoPersonId: '4200001' });

describe('useAllergyNotes', () => {
  beforeEach(() => {
    invalidateAllergyNotes();
    getAllergyNotes.mockReset();
  });

  it('answers with the note, keyed by the student the row is for', async () => {
    getAllergyNotes.mockResolvedValue({ data: { notes: { '4200003': 'Peanuts — EpiPen in her bag' } } });

    const { result } = renderHook(() => useAllergyNotes([entry(sofia), entry(amara)]));

    await waitFor(() => expect(result.current.size).toBe(1));
    expect(result.current.get('pco_4200003')).toBe('Peanuts — EpiPen in her bag');
  });

  it('asks about the flagged students only', async () => {
    getAllergyNotes.mockResolvedValue({ data: { notes: {} } });

    renderHook(() => useAllergyNotes([entry(sofia), entry(amara)]));

    await waitFor(() => expect(getAllergyNotes).toHaveBeenCalled());
    expect(getAllergyNotes).toHaveBeenCalledWith({ pcoPersonIds: ['4200003'], personKeys: [] });
  });

  it('names the backend for a flagged student Planning Center does not hold', async () => {
    getAllergyNotes.mockResolvedValue({ data: { notes: {} } });
    const wei = makeStudent({
      id: 'a32_8c1f2c34-9d1e-4f56-8a7b-0c1d2e3f4a5b',
      firstName: 'Wei',
      pcoPersonId: '8c1f2c34-9d1e-4f56-8a7b-0c1d2e3f4a5b',
      hasAllergies: true,
    });

    renderHook(() => useAllergyNotes([entry(sofia), entry(wei)]));

    await waitFor(() => expect(getAllergyNotes).toHaveBeenCalled());
    expect(getAllergyNotes).toHaveBeenCalledWith({
      pcoPersonIds: ['4200003'],
      personKeys: [{ backendId: 'a32', personId: '8c1f2c34-9d1e-4f56-8a7b-0c1d2e3f4a5b' }],
    });
  });

  it('asks nothing at all when nobody on screen is flagged', () => {
    renderHook(() => useAllergyNotes([entry(amara)]));

    expect(getAllergyNotes).not.toHaveBeenCalled();
  });

  it('asks once, however often the roster is rebuilt', async () => {
    getAllergyNotes.mockResolvedValue({ data: { notes: { '4200003': 'Peanuts' } } });

    // `buildRoster` mints fresh entry objects every time, which is exactly the
    // shape that would make a naive effect re-read on every tap.
    const { result, rerender } = renderHook(({ entries }) => useAllergyNotes(entries), {
      initialProps: { entries: [entry(sofia)] },
    });

    await waitFor(() => expect(result.current.size).toBe(1));
    rerender({ entries: [entry(sofia)] });
    rerender({ entries: [entry(sofia), entry(amara)] });

    expect(getAllergyNotes).toHaveBeenCalledTimes(1);
    expect(result.current.get('pco_4200003')).toBe('Peanuts');
  });

  it('asks only about the students it has not already asked about', async () => {
    const elijah = makeStudent({
      id: 'pco_4200008',
      firstName: 'Elijah',
      pcoPersonId: '4200008',
      hasAllergies: true,
    });
    getAllergyNotes.mockResolvedValue({ data: { notes: {} } });

    const { rerender } = renderHook(({ entries }) => useAllergyNotes(entries), {
      initialProps: { entries: [entry(sofia)] },
    });
    await waitFor(() => expect(getAllergyNotes).toHaveBeenCalledTimes(1));

    // A counselor widening the filter, or searching somebody out of the rest of
    // the roster: the new row is asked about, the old one is not asked again.
    rerender({ entries: [entry(sofia), entry(elijah)] });
    await waitFor(() => expect(getAllergyNotes).toHaveBeenCalledTimes(2));
    expect(getAllergyNotes).toHaveBeenLastCalledWith({
      pcoPersonIds: ['4200008'],
      personKeys: [],
    });
  });

  it('says nothing rather than failing the screen when Planning Center is unreachable', async () => {
    getAllergyNotes.mockRejectedValue(new Error('Planning Center is having a minute'));

    const { result } = renderHook(() => useAllergyNotes([entry(sofia)]));

    await waitFor(() => expect(getAllergyNotes).toHaveBeenCalled());
    expect(result.current.size).toBe(0);
  });

  it('tries again on the next rebuild after a failure', async () => {
    getAllergyNotes.mockRejectedValueOnce(new Error('offline in the hallway'));
    getAllergyNotes.mockResolvedValue({ data: { notes: { '4200003': 'Peanuts' } } });

    const { result, rerender } = renderHook(({ entries }) => useAllergyNotes(entries), {
      initialProps: { entries: [entry(sofia)] },
    });
    await waitFor(() => expect(getAllergyNotes).toHaveBeenCalledTimes(1));

    rerender({ entries: [entry(sofia)] });
    await waitFor(() => expect(result.current.get('pco_4200003')).toBe('Peanuts'));
  });

  it('holds the answer for the session, so leaving and coming back paints at once', async () => {
    getAllergyNotes.mockResolvedValue({ data: { notes: { '4200003': 'Peanuts' } } });

    const first = renderHook(() => useAllergyNotes([entry(sofia)]));
    await waitFor(() => expect(first.result.current.size).toBe(1));
    first.unmount();

    const second = renderHook(() => useAllergyNotes([entry(sofia)]));
    expect(second.result.current.get('pco_4200003')).toBe('Peanuts');
    expect(getAllergyNotes).toHaveBeenCalledTimes(1);
  });

  it('never claims a note for a student who has none', async () => {
    // An empty line upstream is not a note. `Allergy:` with nothing after it
    // reads as a failure of the app rather than as an absence of information.
    getAllergyNotes.mockResolvedValue({ data: { notes: { '4200003': '   ' } } });

    const { result } = renderHook(() => useAllergyNotes([entry(sofia)]));

    await waitFor(() => expect(getAllergyNotes).toHaveBeenCalled());
    expect(result.current.size).toBe(0);
  });

  it('paints from what the session already holds, before any read lands', async () => {
    // Coming back to check-in from another screen must not repaint the badges a
    // beat later than the names.
    getAllergyNotes.mockResolvedValue({ data: { notes: { '4200003': 'Peanuts' } } });
    const first = renderHook(() => useAllergyNotes([entry(sofia)]));
    await waitFor(() => expect(first.result.current.get(sofia.id)).toBe('Peanuts'));
    first.unmount();

    const { result } = renderHook(() => useAllergyNotes([entry(sofia)]));

    expect(result.current.get(sofia.id)).toBe('Peanuts');
  });

  it('starts empty when the session holds nothing', () => {
    getAllergyNotes.mockResolvedValue({ data: { notes: {} } });

    const { result } = renderHook(() => useAllergyNotes([entry(sofia)]));

    expect(result.current.size).toBe(0);
  });

  it('drops a note that is nothing but whitespace', async () => {
    // An upstream field somebody cleared by typing a space. A badge that opens
    // to a blank line is worse than the badge on its own.
    getAllergyNotes.mockResolvedValue({ data: { notes: { '4200003': '   ' } } });

    const { result } = renderHook(() => useAllergyNotes([entry(sofia)]));
    await waitFor(() => expect(getAllergyNotes).toHaveBeenCalled());

    expect(result.current.size).toBe(0);
  });

  it('trims the note it does keep', async () => {
    getAllergyNotes.mockResolvedValue({ data: { notes: { '4200003': '  Peanuts  ' } } });

    const { result } = renderHook(() => useAllergyNotes([entry(sofia)]));

    await waitFor(() => expect(result.current.get(sofia.id)).toBe('Peanuts'));
  });

  it('does not re-render for an answer that was entirely empty', async () => {
    let renders = 0;
    getAllergyNotes.mockResolvedValue({ data: { notes: { '4200003': '' } } });

    const { result } = renderHook(() => {
      renders += 1;
      return useAllergyNotes([entry(sofia)]);
    });
    await waitFor(() => expect(getAllergyNotes).toHaveBeenCalled());
    const after = renders;

    expect(result.current.size).toBe(0);
    expect(renders).toBe(after);
  });

  it('does not set state for a screen that has already gone', async () => {
    // The read is deliberately allowed to outlive the effect that started it,
    // but not the component.
    let land: (value: unknown) => void = () => {};
    getAllergyNotes.mockImplementation(
      () =>
        new Promise((resolve) => {
          land = resolve;
        }),
    );
    const noisy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = renderHook(() => useAllergyNotes([entry(sofia)]));
    unmount();
    land({ data: { notes: { '4200003': 'Peanuts' } } });
    await Promise.resolve();

    expect(noisy).not.toHaveBeenCalled();
    noisy.mockRestore();
  });

  it('lets a read started by one roster land during the next', async () => {
    // The effect re-runs on every rebuild, and cancelling per run would mark
    // those ids asked and then throw away the answer they came back with.
    let land: (value: unknown) => void = () => {};
    getAllergyNotes.mockImplementation(
      () =>
        new Promise((resolve) => {
          land = resolve;
        }),
    );

    const { result, rerender } = renderHook(({ rows }) => useAllergyNotes(rows), {
      initialProps: { rows: [entry(sofia)] },
    });

    rerender({ rows: [entry(sofia)] });
    await waitFor(() => expect(getAllergyNotes).toHaveBeenCalledTimes(1));

    land({ data: { notes: { '4200003': 'Peanuts' } } });
    await waitFor(() => expect(result.current.get(sofia.id)).toBe('Peanuts'));
  });

  it('asks about a flagged student whose only link is their document id', async () => {
    // A student Planning Center holds but whose row carries no `pcoPersonId` —
    // the id prefix is the link.
    getAllergyNotes.mockResolvedValue({ data: { notes: {} } });
    const linked = makeStudent({
      id: 'pco_4200009',
      pcoPersonId: null,
      hasAllergies: true,
    });

    renderHook(() => useAllergyNotes([entry(linked)]));

    await waitFor(() =>
      expect(getAllergyNotes).toHaveBeenCalledWith({
        pcoPersonIds: ['4200009'],
        personKeys: [],
      }),
    );
  });

  it('asks nothing for a flagged visitor no backend holds', async () => {
    // Nothing upstream to read — and they never carry the flag anyway, since
    // it comes from the roster read.
    const visitor = makeStudent({ id: 'AbC123xyz', pcoPersonId: null, hasAllergies: true });

    renderHook(() => useAllergyNotes([entry(visitor)]));

    expect(getAllergyNotes).not.toHaveBeenCalled();
  });
});
