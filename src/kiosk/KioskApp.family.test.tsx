/**
 * Checking a family in — and out — in one pass.
 *
 * A parent with three children used to walk the whole flow three times. The
 * kiosk already knows the other two, because they came back from the same four
 * digits, so the confirm screen offers them.
 *
 * What is pinned here is not the offer itself so much as its edges, which are
 * where a bulk action goes wrong: that it only ever offers what the button says
 * it will do, that a name unticked is a child left alone, that a family's
 * pickup still costs a three-second hold, and that one confirm produces one
 * write per child and no more.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskApp, type KioskServices } from '@/kiosk/KioskApp';
import { HOLD_MS } from '@/kiosk/components/HoldButton';
import { KIOSK_KEYS } from '@/kiosk/storage';
import type { KioskBinding } from '@/kiosk/binding';
import type { KioskStudent } from '@/kiosk/search';

function student(id: string, firstName: string, lastName: string): KioskStudent {
  return { id, firstName, lastName, grade: 9, searchName: `${firstName} ${lastName}`.toLowerCase() };
}

const AMARA = student('s-amara', 'Amara', 'Osei');
const MARCUS = student('s-marcus', 'Marcus', 'Osei');
/** Same four digits, different family — the coincidence family.ts throws out. */
const MAYA = student('s-maya', 'Maya', 'Chen');

const ROSTER = [AMARA, MARCUS, MAYA];

const LAST4: Record<string, string[]> = {
  // The Osei household answers to two numbers; Maya's family only shares one.
  '0134': ['s-amara', 's-marcus', 's-maya'],
  '7788': ['s-amara', 's-marcus'],
  '2200': ['s-maya'],
};

function binding(overrides: Partial<KioskBinding> = {}): KioskBinding {
  const now = Date.now();
  return {
    eventId: 'nursery-today',
    seriesId: null,
    title: 'Sunday Nursery',
    startAtMs: now - 60_000,
    endAtMs: now + 3_600_000,
    checkInClosesAtMs: now + 3_600_000,
    requiresCheckOut: true,
    labelTemplate: null,
    boundAtMs: now,
    ...overrides,
  };
}

/** Who the register says is already here. Reassigned per test. */
let present = new Set<string>();
let checkedOut = new Set<string>();

const services = {
  restoredUid: vi.fn(async () => 'staff-uid'),
  loadRoster: vi.fn(async () => ROSTER),
  loadPhoneIndex: vi.fn(async () => LAST4),
  fetchAttendance: vi.fn(async () => ({ present, checkedOut })),
  replayQueue: vi.fn(async () => 0),
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

/** Boot the kiosk straight into a bound, ready screen. */
async function mount(bound: KioskBinding = binding()): Promise<void> {
  localStorage.setItem(KIOSK_KEYS.binding, JSON.stringify(bound));
  localStorage.setItem(KIOSK_KEYS.roster, JSON.stringify({ fetchedAtMs: Date.now(), students: ROSTER }));
  localStorage.setItem(
    KIOSK_KEYS.phoneIndex,
    JSON.stringify({ fetchedAtMs: Date.now(), builtAtMs: Date.now(), last4: LAST4 }),
  );
  render(<KioskApp />);
  await settle();
}

/** Types on the kiosk's own keyboard — pointer contact, on the key itself. */
async function type(text: string): Promise<void> {
  for (const key of text.toUpperCase()) {
    await act(async () => {
      fireEvent.pointerDown(screen.getByText(key, { selector: '[data-key]' }));
    });
  }
  await settle();
}

/** A row commits on lift, because the results list scrolls. */
async function pick(name: string): Promise<void> {
  const row = screen.getByText(name).closest('button')!;
  await act(async () => {
    fireEvent.pointerDown(row);
    fireEvent.pointerUp(row);
  });
  await settle();
}

/** A ticked sibling, which unticks the same way. */
async function untick(name: string): Promise<void> {
  const row = screen.getByText(name).closest('button')!;
  await act(async () => {
    fireEvent.pointerDown(row);
    fireEvent.pointerUp(row);
  });
  await settle();
}

async function tap(text: RegExp | string): Promise<void> {
  await act(async () => {
    fireEvent.pointerDown(screen.getByText(text).closest('button')!);
  });
  await settle();
}

async function hold(text: RegExp | string): Promise<void> {
  const button = screen.getByText(text).closest('button')!;
  await act(async () => {
    fireEvent.pointerDown(button);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(HOLD_MS);
  });
  await settle();
}

function checkedInIds(): string[] {
  return vi
    .mocked(services.performCheckIn)
    .mock.calls.map((call) => call[0].student.id)
    .sort();
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  localStorage.clear();
  present = new Set();
  checkedOut = new Set();
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('checking a family in together', () => {
  it('offers the sibling, ticked, and checks them both in on one tap', async () => {
    await mount();
    await type('0134');
    await pick('Marcus Osei');

    expect(screen.getByText(/checking in anyone else/i)).toBeTruthy();
    expect(screen.getByText('Amara Osei')).toBeTruthy();

    await tap(/check in all 2/i);

    expect(checkedInIds()).toEqual(['s-amara', 's-marcus']);
    // One tick, both names on it.
    expect(screen.getByText('Marcus and Amara')).toBeTruthy();
  });

  it('does not offer a family that merely shares four digits', async () => {
    // Maya turns up in the same phone search, and is nobody's sibling.
    await mount();
    await type('0134');
    await pick('Maya Chen');

    expect(screen.queryByText(/anyone else/i)).toBeNull();
    await tap('Check in');

    expect(checkedInIds()).toEqual(['s-maya']);
  });

  it('leaves an unticked sibling alone', async () => {
    await mount();
    await type('0134');
    await pick('Marcus Osei');

    await untick('Amara Osei');
    // The button says what it will now do, and it is the single-child wording.
    await tap('Check in');

    expect(checkedInIds()).toEqual(['s-marcus']);
  });

  it('only offers siblings the button would do the same thing to', async () => {
    // Amara is already here; Marcus is not. Checking Marcus in must not offer
    // to do anything at all to his sister.
    present = new Set([AMARA.id]);
    await mount();
    await type('0134');
    await pick('Marcus Osei');

    expect(screen.queryByText(/anyone else/i)).toBeNull();
    await tap('Check in');

    expect(checkedInIds()).toEqual(['s-marcus']);
    expect(services.performCheckOut).not.toHaveBeenCalled();
  });

  it('offers nothing beside a child who is already checked in', async () => {
    present = new Set([MARCUS.id]);
    await mount(binding({ requiresCheckOut: false }));
    await type('0134');
    await pick('Marcus Osei');

    expect(screen.getByText(/already checked in/i)).toBeTruthy();
    expect(screen.queryByText(/anyone else/i)).toBeNull();
  });
});

describe('collecting a family together', () => {
  it('collects both on one hold, and still asks for the hold', async () => {
    present = new Set([MARCUS.id, AMARA.id]);
    await mount();
    await type('0134');
    await pick('Marcus Osei');

    expect(screen.getByText(/collecting anyone else/i)).toBeTruthy();

    // A tap is not enough for a pickup, however many children it covers.
    const button = screen.getByText(/hold to collect all 2/i).closest('button')!;
    await act(async () => {
      fireEvent.pointerDown(button);
      fireEvent.pointerUp(button);
    });
    await settle();
    expect(services.performCheckOut).not.toHaveBeenCalled();

    await hold(/hold to collect all 2/i);

    expect(
      vi
        .mocked(services.performCheckOut)
        .mock.calls.map((call) => call[0].studentId)
        .sort(),
    ).toEqual(['s-amara', 's-marcus']);
    expect(services.performCheckIn).not.toHaveBeenCalled();
  });

  it('does not offer a sibling who has already been collected', async () => {
    present = new Set([MARCUS.id, AMARA.id]);
    checkedOut = new Set([AMARA.id]);
    await mount();
    await type('0134');
    await pick('Marcus Osei');

    expect(screen.queryByText(/anyone else/i)).toBeNull();
    await hold(/hold to collect/i);

    expect(vi.mocked(services.performCheckOut).mock.calls.map((call) => call[0].studentId)).toEqual([
      's-marcus',
    ]);
  });
});
