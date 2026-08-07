/**
 * Which children this kiosk is willing to find.
 *
 * The search used to run over every active student in Tally, which is not the
 * population standing in front of a lobby screen. A parent at Friday Fellowship
 * typing four digits could be shown a family who has only ever come to Sunday
 * nursery — and because four digits are four digits, a newcomer could be shown
 * somebody else's children, sorted and spelled correctly and looking exactly
 * like the answer.
 *
 * So the front door is scoped to the children who have been to *this* gathering
 * in the last year. What is pinned here is the scope's edges, because every one
 * of them fails towards a family who cannot find themselves: the escape hatch,
 * the children in the building tonight, the sibling search behind the door, and
 * the gathering that has no history to scope by at all.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskApp, type KioskServices } from '@/kiosk/KioskApp';
import { KIOSK_KEYS } from '@/kiosk/storage';
import type { KioskBinding } from '@/kiosk/binding';
import type { KioskStudent } from '@/kiosk/search';

function student(id: string, firstName: string, lastName: string): KioskStudent {
  return {
    id,
    firstName,
    lastName,
    grade: 6,
    searchName: `${firstName} ${lastName}`.toLowerCase(),
    hasAllergies: false,
  };
}

/** Comes to this gathering every week. */
const NOAH = student('s-noah', 'Noah', 'Adeyemi');
/** On the roster, and has only ever come to a different programme. */
const SOFIA = student('s-sofia', 'Sofia', 'Adeyemi');
/**
 * The same, and on nobody's phone number either — a child the family guess
 * cannot reach at all. She is what the sibling search is for.
 */
const MARA = student('s-mara', 'Mara', 'Okonjo');

const ROSTER = [NOAH, SOFIA, MARA];

/** Both children answer to the household's number. */
const LAST4: Record<string, string[]> = { '5150': ['s-noah', 's-sofia'] };

/** What the nightly aggregate says about this chain. Reassigned per test. */
let scope = {
  participated: new Set(['s-noah']),
  recent: new Set(['s-noah']),
};
let present = new Set<string>();

function binding(): KioskBinding {
  const now = Date.now();
  return {
    eventId: 'friday-today',
    seriesId: null,
    predictsFrom: 'friday-fellowship',
    title: 'Friday Fellowship',
    startAtMs: now - 60_000,
    endAtMs: now + 3_600_000,
    checkInClosesAtMs: now + 3_600_000,
    requiresCheckOut: false,
    labelTemplate: null,
    boundAtMs: now,
  };
}

const services = {
  restoredUid: vi.fn(async () => 'staff-uid'),
  loadRoster: vi.fn(async () => ROSTER),
  loadPhoneIndex: vi.fn(async () => LAST4),
  loadParticipation: vi.fn(async () => scope),
  fetchPulse: vi.fn(async () => null),
  rememberPulse: vi.fn(),
  refetchRoster: vi.fn(async () => {}),
  refetchPhoneIndex: vi.fn(async () => {}),
  refetchParticipation: vi.fn(async () => {}),
  fetchAttendance: vi.fn(async () => ({
    present,
    checkedOut: new Set<string>(),
    arrivals: new Map<string, string>(),
  })),
  replayQueue: vi.fn(async () => 0),
  /*
   * Deliberately answers with the roster the kiosk already has: the silent
   * sweep may fire behind a no-match, and a no-op here keeps every widening
   * assertion below about the widening — which is free, instant, and entirely
   * local.
   */
  refreshDirectory: vi.fn(async () => {}),
  performCheckIn: vi.fn(async () => {}),
  performCheckOut: vi.fn(async () => {}),
  warmStudentDates: vi.fn(),
  forgetStudentDates: vi.fn(),
  enqueueCheckIn: vi.fn(),
  enqueueCheckOut: vi.fn(),
} as unknown as KioskServices;

vi.mock('@/kiosk/services', () => services);

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function mount(): Promise<void> {
  localStorage.setItem(KIOSK_KEYS.binding, JSON.stringify(binding()));
  localStorage.setItem(
    KIOSK_KEYS.roster,
    JSON.stringify({ fetchedAtMs: Date.now(), students: ROSTER }),
  );
  localStorage.setItem(
    KIOSK_KEYS.phoneIndex,
    JSON.stringify({ fetchedAtMs: Date.now(), builtAtMs: Date.now(), last4: LAST4 }),
  );
  render(<KioskApp />);
  await settle();
}

async function type(text: string): Promise<void> {
  for (const key of text.toUpperCase()) {
    await act(async () => {
      fireEvent.pointerDown(screen.getByText(key, { selector: '[data-key]' }));
    });
  }
  await settle();
}

async function clear(): Promise<void> {
  await act(async () => {
    fireEvent.pointerDown(screen.getByText('⌫', { selector: '[data-key]' }));
  });
  await settle();
}

async function tap(text: RegExp | string): Promise<void> {
  await act(async () => {
    fireEvent.pointerDown(screen.getByText(text).closest('button')!);
  });
  await settle();
}

async function pick(name: string): Promise<void> {
  const row = screen.getByText(name).closest('button')!;
  await act(async () => {
    fireEvent.pointerDown(row);
    fireEvent.pointerUp(row);
  });
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  localStorage.clear();
  scope = { participated: new Set(['s-noah']), recent: new Set(['s-noah']) };
  present = new Set();
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('the front door', () => {
  it('finds a child who comes to this gathering', async () => {
    await mount();
    await type('noah');
    expect(screen.getByText('Noah Adeyemi')).toBeTruthy();
  });

  it('does not find one who has only ever come to something else', async () => {
    await mount();
    await type('sofia');
    expect(screen.queryByText('Sofia Adeyemi')).toBeNull();
    expect(screen.getByText(/first time here/i)).toBeTruthy();
  });

  it('leaves her out of a phone search too', async () => {
    await mount();
    await type('5150');
    expect(screen.getByText('Noah Adeyemi')).toBeTruthy();
    expect(screen.queryByText('Sofia Adeyemi')).toBeNull();
  });

  it('finds her once she is on tonight’s register', async () => {
    // Whatever the aggregate said at 03:20, she is in the building — and on a
    // gathering that hands children back, a parent has to be able to reach her.
    present = new Set(['s-sofia']);
    await mount();
    await type('sofia');
    expect(screen.getByText('Sofia Adeyemi')).toBeTruthy();
  });

  it('finds everybody when the gathering has no history to scope by', async () => {
    // The first night of a new gathering, a one-off, a binding written before
    // any of this existed, a failed read of the aggregate — all the same.
    scope = { participated: new Set(), recent: new Set() };
    await mount();
    await type('sofia');
    expect(screen.getByText('Sofia Adeyemi')).toBeTruthy();
  });

  it('is scoped from the first paint on a warm kiosk', async () => {
    /*
     * The disk answers before the network does, exactly as it does for the
     * roster and the phone index. Without this a rebooted kiosk searches the
     * whole ministry for the first second of every boot — safe, because every
     * failure here widens rather than narrows, but not something to leave to
     * whichever promise resolves first.
     */
    localStorage.setItem(
      KIOSK_KEYS.participation,
      JSON.stringify({
        fetchedAtMs: Date.now(),
        builtAtMs: Date.now(),
        chains: { 'friday-fellowship': { participated: ['s-noah'], recent: ['s-noah'] } },
      }),
    );
    // The network never answers, so anything on screen came off the disk.
    vi.mocked(services.loadParticipation).mockImplementation(() => new Promise(() => {}));

    await mount();
    await type('sofia');
    expect(screen.queryByText('Sofia Adeyemi')).toBeNull();
    expect(screen.getByText(/first time here/i)).toBeTruthy();
  });
});

describe('the escape hatch', () => {
  it('widens the search to all of Tally on "Search everyone"', async () => {
    await mount();
    await type('sofia');
    expect(screen.queryByText('Sofia Adeyemi')).toBeNull();

    await tap(/Search everyone/i);

    // The widening half is instant, and does not wait on the church-wide
    // re-read the same press starts: the wider roster is already in memory,
    // and a child who belongs to another gathering is on this device now.
    expect(screen.getByText('Sofia Adeyemi')).toBeTruthy();
    /*
     * The button is still there, in the standing row beside the register
     * offer, because the no-match panel it was living in has gone.
     *
     * It used to leave with that panel, which meant it was on screen for
     * exactly the family who did not need it. A parent whose child's name is
     * common gets rows back — somebody else's Noah — and is in the one state
     * where the scope is hiding their child behind a confident wrong answer.
     */
    expect(screen.getByRole('button', { name: 'Search everyone' })).toBeTruthy();
    /*
     * And no church-wide read behind that first press. Widening is free and
     * already answered: this child was on the device, so reading the whole
     * church would be spent on a question the free half settled.
     */
    expect(services.refreshDirectory).not.toHaveBeenCalled();

    /*
     * The second press is the one that reads, and this is what makes the
     * button worth keeping on screen. There is nothing left to widen — the
     * pool is already everybody — so the only thing that could still find a
     * missing child is asking the church whether they were added since this
     * device last looked.
     */
    await tap(/Search everyone/i);
    expect(services.refreshDirectory).toHaveBeenCalled();
  });

  it('stands while a match is showing, for the family the match is not', async () => {
    /*
     * The state the button used to be missing from, and the commonest one it
     * is needed in.
     *
     * A surname the gathering already has: Noah comes every week, Sofia has
     * only ever come to another programme. A parent searching for Sofia types
     * their own name and is handed Noah — a real child, correctly spelled,
     * who is not theirs. Nothing on the screen says the search was narrowed,
     * so a rows-on-screen result reads as *the* answer, and the only door the
     * screen used to leave open here was the one that registers a child the
     * church already has.
     */
    await mount();
    await type('adeyemi');
    expect(screen.getByText('Noah Adeyemi')).toBeTruthy();
    expect(screen.queryByText('Sofia Adeyemi')).toBeNull();
    // No no-match panel — this is a successful search, which is the point.
    expect(screen.queryByText(/first time here/i)).toBeNull();

    await tap(/Search everyone/i);
    expect(screen.getByText('Sofia Adeyemi')).toBeTruthy();
    expect(screen.getByText('Noah Adeyemi')).toBeTruthy();
  });

  it('narrows again for the next family at the kiosk', async () => {
    await mount();
    await type('sofia');
    await tap(/Search everyone/i);
    expect(screen.getByText('Sofia Adeyemi')).toBeTruthy();

    // The buffer emptying is the next person walking up. They are owed the
    // same offer this family got, not the answer this family unlocked.
    for (let i = 0; i < 'sofia'.length; i += 1) await clear();
    await type('sofia');
    expect(screen.queryByText('Sofia Adeyemi')).toBeNull();
  });
});

describe('behind the door', () => {
  it('searches the whole roster for another child', async () => {
    await mount();
    await type('noah');
    await pick('Noah Adeyemi');
    await tap(/Another child/i);

    /*
     * The population this screen exists for is exactly the one the scope gets
     * wrong, twice over: Mara has never been to this gathering and answers to
     * no number the kiosk holds. A parent only reaches here by having already
     * found their family, and the child they name is ticked because they named
     * them.
     */
    await type('mara');
    expect(screen.getByText('Mara Okonjo')).toBeTruthy();

    await pick('Mara Okonjo');
    await tap(/Check in all 2/i);
    expect(
      vi
        .mocked(services.performCheckIn)
        .mock.calls.map((call) => call[0].student.id)
        .sort(),
    ).toEqual(['s-mara', 's-noah']);
  });

  it('still offers her on the confirm screen, unticked', async () => {
    await mount();
    await type('noah');
    await pick('Noah Adeyemi');

    // The phone guess is not scoped either — the offer stays as wide as the
    // household, and only the tick follows the prediction.
    expect(screen.getByText('Sofia Adeyemi')).toBeTruthy();
    expect(screen.getByText(/^Check in$/)).toBeTruthy();
  });
});
