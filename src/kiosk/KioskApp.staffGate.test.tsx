/**
 * The staff gate: how a kiosk is taken off one gathering and put on another.
 *
 * It used to be a transparent sixteen-pixel square over the top-left corner of
 * the header, held for three seconds. That gate needed no confirmation because
 * nobody could find it — which is the same sentence as "the people who need it
 * cannot find it either", and it was in the wrong corner besides.
 *
 * It is a hold on **Clear** now: a labelled key, in a fixed place, that can be
 * described to a volunteer over the phone. Everything worth pinning follows
 * from that trade. The key kept its first job, so a tap must still only clear.
 * The gesture became findable, so it must ask before it acts — and declining
 * has to land back on the search screen rather than on the event chooser.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskApp, type KioskServices } from '@/kiosk/KioskApp';
/*
 * Imported for its side effect on the module cache: the wizard arrives through
 * a dynamic import, and a chunk the runner has never seen resolves slower than
 * the last test here is willing to wait for.
 */
import '@/kiosk/registration';
import { HOLD_MS } from '@/kiosk/components/HoldButton';
import { KIOSK_KEYS, KIOSK_ROSTER_VERSION } from '@/kiosk/storage';
import type { KioskBinding } from '@/kiosk/binding';
import type { KioskStudent } from '@/kiosk/search';

const ADA: KioskStudent = {
  id: 'student-ada',
  firstName: 'Ada',
  lastName: 'Lovelace',
  grade: 8,
  searchName: 'ada lovelace',
  hasAllergies: false,
};

/* The empty search readout. Two lines since the prompt became a heading —
   the instruction is what identifies the screen, so match that half. */
const PLACEHOLDER = /^type a name$/i;

function binding(): KioskBinding {
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
  };
}

const services = {
  restoredUid: vi.fn(async () => 'staff-uid'),
  // Reached only once the gate has fired and the kiosk is back on the chooser.
  listEvents: vi.fn(async () => []),
  loadRoster: vi.fn(async () => [ADA]),
  loadPhoneIndex: vi.fn(async () => ({})),
  loadParticipation: vi.fn(async () => ({
    participated: new Set<string>(),
    recent: new Set<string>(),
  })),
  fetchAttendance: vi.fn(async () => ({
    present: new Set<string>(),
    checkedOut: new Set<string>(),
    arrivals: new Map<string, string>(),
  })),
  fetchPulse: vi.fn(async () => null),
  rememberPulse: vi.fn(),
  refetchRoster: vi.fn(async () => {}),
  refetchPhoneIndex: vi.fn(async () => {}),
  refetchParticipation: vi.fn(async () => {}),
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

async function mount(): Promise<void> {
  localStorage.setItem(KIOSK_KEYS.binding, JSON.stringify(binding()));
  localStorage.setItem(
    KIOSK_KEYS.roster,
    JSON.stringify({ version: KIOSK_ROSTER_VERSION, fetchedAtMs: Date.now(), students: [ADA] }),
  );
  render(<KioskApp />);
  await settle();
}

/*
 * Addressed by `data-key`, never by its label — `getByText('Clear')` is one
 * refactor away from ambiguity, and this helper has to find the key on both
 * keyboards: the search screen's, which carries the gate, and the wizard's,
 * which must not.
 */
const clearKey = () => document.querySelector<HTMLButtonElement>('[data-key="clear"]')!;

async function type(text: string): Promise<void> {
  for (const key of text.toUpperCase()) {
    await act(async () => {
      fireEvent.pointerDown(screen.getByText(key, { selector: '[data-key]' }));
    });
  }
  await settle();
}

/** A tap on Clear: contact and release, well inside the hold. */
async function tapClear(): Promise<void> {
  const key = clearKey();
  await act(async () => {
    fireEvent.pointerDown(key);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  await act(async () => {
    fireEvent.pointerUp(key);
  });
  await settle();
}

/** A hold on Clear: contact, and three seconds of it. */
async function holdClear(): Promise<void> {
  await act(async () => {
    fireEvent.pointerDown(clearKey());
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(HOLD_MS);
  });
  await settle();
}

async function tap(text: RegExp | string): Promise<void> {
  await act(async () => {
    fireEvent.pointerDown(screen.getByText(text).closest('button')!);
  });
  await settle();
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

describe('the staff gate', () => {
  it('still just clears the buffer on a tap', async () => {
    await mount();
    await type('ada');
    expect(screen.getByText('ADA')).toBeTruthy();

    await tapClear();

    // The key's first job, unchanged and unnegotiable: this is the press a
    // parent makes to fix a mistyped name, and it happens far more often than
    // the gesture layered on top of it.
    expect(screen.getByText(PLACEHOLDER)).toBeTruthy();
    expect(screen.queryByText(/Change event\?/i)).toBeNull();
  });

  it('asks before it acts when Clear is held', async () => {
    await mount();
    await holdClear();

    expect(screen.getByText(/Change event\?/i)).toBeTruthy();
    // Named, because a volunteer holding a lobby tablet needs to know which
    // gathering they are about to walk away from.
    expect(screen.getByText('Sunday Nursery')).toBeTruthy();
    // And the search screen is gone: a kiosk is one thing at a time.
    expect(screen.queryByText(PLACEHOLDER)).toBeNull();

    // The cost is named, and it is not "you will lose data" — it is that the
    // door shuts for whoever is standing at it.
    expect(screen.getByText(/Nobody can check in here/i)).toBeTruthy();
    expect(screen.getByText(/stay checked in/i)).toBeTruthy();

    // Asking is not doing: the binding is still on disk until somebody says so.
    expect(localStorage.getItem(KIOSK_KEYS.binding)).not.toBeNull();
  });

  it('does not fire when the hold is let go early', async () => {
    await mount();
    const key = clearKey();
    await act(async () => {
      fireEvent.pointerDown(key);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HOLD_MS - 200);
    });
    await act(async () => {
      fireEvent.pointerUp(key);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HOLD_MS);
    });
    await settle();

    expect(screen.queryByText(/Change event\?/i)).toBeNull();
  });

  it('does not fire when the thumb slides off Clear', async () => {
    await mount();
    const key = clearKey();
    await act(async () => {
      fireEvent.pointerDown(key);
    });
    /*
     * The gesture is armed on the key rather than on the keyboard's delegated
     * container listener precisely so this cancels. A hold that survived a
     * thumb wandering onto the apostrophe would be a gate that fired from the
     * key next door.
     */
    await act(async () => {
      fireEvent.pointerLeave(key);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HOLD_MS);
    });
    await settle();

    expect(screen.queryByText(/Change event\?/i)).toBeNull();
  });

  it('returns to the search screen when the question is declined', async () => {
    await mount();
    await type('ada');
    await holdClear();
    expect(screen.getByText(/Change event\?/i)).toBeTruthy();

    await tap(/Keep checking in/i);

    /*
     * Declining lands on the search screen, not on the event chooser. The kiosk
     * is still pointed at the gathering, and the queue standing at it has lost
     * nothing but the seconds.
     *
     * The typed buffer is gone, and correctly so — holding Clear *is* pressing
     * Clear, and every key on this glass acts on contact. What matters is that
     * the screen is the one the finger was on, not that a half-typed name
     * survived a deliberate wipe.
     */
    expect(screen.queryByText(/Change event\?/i)).toBeNull();
    expect(screen.getByText(PLACEHOLDER)).toBeTruthy();
    expect(screen.getByText(/Sunday Nursery/)).toBeTruthy();
    expect(localStorage.getItem(KIOSK_KEYS.binding)).not.toBeNull();
  });

  it('leaves the gathering when the question is answered', async () => {
    await mount();
    await type('ada');
    await holdClear();

    await tap(/Leave Sunday Nursery/i);

    // Off the gathering, off the disk, and back on the chooser — with the last
    // family's name gone from the glass on the way out.
    expect(localStorage.getItem(KIOSK_KEYS.binding)).toBeNull();
    expect(screen.queryByText('ADA')).toBeNull();
    expect(screen.queryByText(PLACEHOLDER)).toBeNull();
  });

  it('is not offered on the wizard, which shares the keyboard', async () => {
    await mount();
    await type('zzq');
    await tap(/Register your child/i);
    await holdClear();

    /*
     * The same forty keys, a different screen. A parent halfway through typing
     * their child's name holds Clear to wipe a misspelling — and must not be
     * asked whether they would like to take the kiosk off the gathering.
     */
    expect(screen.queryByText(/Change event\?/i)).toBeNull();
  });
});
