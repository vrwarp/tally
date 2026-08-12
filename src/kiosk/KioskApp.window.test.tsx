/**
 * The floor under a kiosk's register.
 *
 * The chooser offers the week on purpose — a volunteer sets a tablet up before
 * doors, and next Sunday is on the list because a kiosk asks "what could I be
 * for, this week?". What it did not have was a floor: a binding was live from
 * the moment it was made until the later of the event ending and its window
 * closing, so a thumb one row off pointed a lobby screen at next Wednesday and
 * the screen then took a whole evening's attendance against it, silently,
 * showing nothing but a pair of clock times that looked entirely ordinary.
 *
 * Nowhere else in Tally can that be done. The app's own chooser offers today
 * and a short tail of finished gatherings and nothing at all ahead, because
 * recording a Friday somebody forgot is real work and recording a Friday that
 * has not happened yet is always a mistake. This file pins the kiosk to the
 * same rule, and pins the one asymmetry that makes it the right rule: a *closed*
 * window still writes, because a family collected at nine from a gathering
 * whose doors shut at eight really did walk out of the building.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskApp, type KioskServices } from '@/kiosk/KioskApp';
import { KIOSK_KEYS } from '@/kiosk/storage';
import type { KioskBinding } from '@/kiosk/binding';
import type { KioskStudent } from '@/kiosk/search';

const NOAH: KioskStudent = {
  id: 's-noah',
  firstName: 'Noah',
  lastName: 'Adeyemi',
  grade: 6,
  searchName: 'noah adeyemi',
  hasAllergies: false,
};

const ROSTER = [NOAH];
const LAST4: Record<string, string[]> = { '5150': ['s-noah'] };

const HOUR = 3_600_000;

/** Everything but the window, which every test below sets for itself. */
function bindingWith(window: Partial<KioskBinding>): KioskBinding {
  const now = Date.now();
  return {
    eventId: 'friday',
    seriesId: null,
    predictsFrom: 'friday-fellowship',
    title: 'Friday Fellowship',
    startAtMs: now,
    endAtMs: now + HOUR,
    checkInOpensAtMs: now,
    checkInClosesAtMs: now + HOUR,
    requiresCheckOut: false,
    labelTemplate: null,
    boundAtMs: now,
    ...window,
  };
}

/** Doors open in half an hour. The kiosk is set up and waiting. */
const BEFORE_DOORS = (): KioskBinding =>
  bindingWith({
    startAtMs: Date.now() + HOUR,
    endAtMs: Date.now() + 3 * HOUR,
    checkInOpensAtMs: Date.now() + HOUR / 2,
    checkInClosesAtMs: Date.now() + 3 * HOUR,
  });

/** The misbinding this whole file exists for: one row off, a week out. */
const NEXT_WEEK = (): KioskBinding =>
  bindingWith({
    startAtMs: Date.now() + 7 * 24 * HOUR,
    endAtMs: Date.now() + 7 * 24 * HOUR + 2 * HOUR,
    checkInOpensAtMs: Date.now() + 7 * 24 * HOUR - HOUR / 2,
    checkInClosesAtMs: Date.now() + 7 * 24 * HOUR + 2 * HOUR,
  });

/** Running now — the ordinary evening. */
const OPEN_NOW = (): KioskBinding =>
  bindingWith({
    startAtMs: Date.now() - HOUR,
    endAtMs: Date.now() + HOUR,
    checkInOpensAtMs: Date.now() - 2 * HOUR,
    checkInClosesAtMs: Date.now() + HOUR,
  });

/** Doors shut an hour ago; the gathering runs on. Still writes — see the note. */
const DOORS_SHUT = (): KioskBinding =>
  bindingWith({
    startAtMs: Date.now() - 2 * HOUR,
    endAtMs: Date.now() + HOUR,
    checkInOpensAtMs: Date.now() - 3 * HOUR,
    checkInClosesAtMs: Date.now() - HOUR,
  });

/** A binding written before `checkInOpensAtMs` existed. Must not lock a lobby out. */
const LEGACY = (): KioskBinding => {
  const stored = OPEN_NOW();
  delete stored.checkInOpensAtMs;
  return stored;
};

const services = {
  restoredUid: vi.fn(async () => 'staff-uid'),
  loadRoster: vi.fn(async () => ROSTER),
  loadPhoneIndex: vi.fn(async () => LAST4),
  loadParticipation: vi.fn(async () => ({
    participated: new Set(['s-noah']),
    recent: new Set(['s-noah']),
  })),
  fetchPulse: vi.fn(async () => null),
  rememberPulse: vi.fn(),
  refetchRoster: vi.fn(async () => {}),
  refetchPhoneIndex: vi.fn(async () => {}),
  refetchParticipation: vi.fn(async () => {}),
  fetchAttendance: vi.fn(async () => ({
    present: new Set<string>(),
    checkedOut: new Set<string>(),
    arrivals: new Map<string, string>(),
  })),
  replayQueue: vi.fn(async () => 0),
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

async function mount(binding: KioskBinding): Promise<void> {
  localStorage.setItem(KIOSK_KEYS.binding, JSON.stringify(binding));
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

async function tap(text: RegExp | string): Promise<void> {
  const button = screen.getByText(text).closest('button')!;
  await act(async () => {
    fireEvent.pointerDown(button);
    fireEvent.pointerUp(button);
  });
  await settle();
}

/** Type the household's digits, take the row, and press the button on the confirm. */
async function checkInNoah(): Promise<void> {
  await type('5150');
  await tap('Noah Adeyemi');
  await tap(/^Check in$/);
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('a gathering that has not opened', () => {
  it('refuses the check-in rather than writing one', async () => {
    await mount(BEFORE_DOORS());
    await checkInNoah();

    expect(services.performCheckIn).not.toHaveBeenCalled();
    // And not queued either: an arrival that is wrong now is wrong in thirty
    // seconds, so the retry queue must not be the way round the front door.
    expect(services.enqueueCheckIn).not.toHaveBeenCalled();
    expect(screen.getByText(/not open yet/i)).toBeTruthy();
  });

  it('never tells the family they are checked in', async () => {
    await mount(BEFORE_DOORS());
    await checkInNoah();

    // The tick is painted optimistically, before the network, so the refusal
    // has to land ahead of it or a parent walks away believing the opposite.
    expect(screen.queryByText(/Welcome!/)).toBeNull();
    expect(screen.queryByText('✓')).toBeNull();
  });

  it('says when, and says the day when the day is the problem', async () => {
    await mount(NEXT_WEEK());
    await checkInNoah();

    // A bare clock time would read as "come back after supper" on a tablet
    // that is actually set to a gathering seven days out. The date is the
    // half aimed at the volunteer who can fix it.
    const opens = new Date(NEXT_WEEK().checkInOpensAtMs!);
    const day = opens.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
    expect(screen.getByText(new RegExp(`Check-in opens ${day}`, 'i'))).toBeTruthy();
  });

  it('says so on the search screen too, under the gathering it is set to', async () => {
    await mount(BEFORE_DOORS());
    // Before any tap: the sentence is for the volunteer walking past, because
    // the parent reading it cannot rebind a tablet.
    expect(screen.getByText(/^Check-in opens /)).toBeTruthy();
  });

  it('turns the registration door away at the door', async () => {
    await mount(BEFORE_DOORS());
    await tap(/Register your child/);

    // Refused before the first question rather than after the last one: the
    // wizard's own submit checks the family in, so a family who typed three
    // birthdays would have been asked for all of it for nothing.
    expect(screen.getByText(/not open yet/i)).toBeTruthy();
  });
});

describe('a gathering that is open', () => {
  it('checks in exactly as it always has', async () => {
    await mount(OPEN_NOW());
    await checkInNoah();

    expect(services.performCheckIn).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/not open yet/i)).toBeNull();
  });

  it('still writes after the doors have shut — that is the other direction', async () => {
    await mount(DOORS_SHUT());
    // Said out loud, and then not acted on — the header advises, and the tap
    // still writes. Asserted before the tap because the tick covers the screen.
    expect(screen.getByText(/window has closed/i)).toBeTruthy();

    await checkInNoah();

    // The asymmetry, stated. Late is a fact about a family who really did
    // arrive; early is a claim about an evening that has not happened.
    expect(services.performCheckIn).toHaveBeenCalledTimes(1);
  });

  it('does not lock out a binding written before the field existed', async () => {
    await mount(LEGACY());
    await checkInNoah();

    // A deploy must not turn a paired lobby screen into a tablet that refuses
    // everyone on the strength of a key it never stored.
    expect(services.performCheckIn).toHaveBeenCalledTimes(1);
  });
});
