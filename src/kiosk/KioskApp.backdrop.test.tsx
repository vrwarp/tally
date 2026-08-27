/**
 * The photograph behind the idle screen — and everything it is not behind.
 *
 * The rules under test are the ones the five-way consultation settled (see
 * components/Backdrop.tsx): the image shows only on a calm, bound search
 * screen; it is *gone*, not dimmed, the moment anything is typed; typing past
 * the first letter never re-renders the layer at all; the staff gate can take
 * it off one device with no network and write that through the reload; and a
 * kiosk without a photograph carries no layer whatsoever.
 *
 * jsdom quirks leaned on here: there is no Cache API, so the loader takes the
 * fetcher path (`fetchBackdrop` on the mocked services); `URL.createObjectURL`
 * does not exist, so it is stubbed; and `img.decode()` rejects, which the
 * component deliberately treats as "reveal anyway".
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskApp, type KioskServices } from '@/kiosk/KioskApp';
import { HOLD_DELAY_MS, HOLD_MS } from '@/kiosk/components/HoldButton';
import { KIOSK_KEYS } from '@/kiosk/storage';
import type { KioskBinding } from '@/kiosk/binding';
import type { KioskStudent } from '@/kiosk/search';

const BACKDROP_ID = 'b0123456789abcdef';

const ADA: KioskStudent = {
  id: 'student-ada',
  firstName: 'Ada',
  lastName: 'Lovelace',
  grade: 8,
  searchName: 'ada lovelace',
  hasAllergies: false,
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
    requiresCheckOut: false,
    labelTemplate: null,
    kioskBackdropId: BACKDROP_ID,
    boundAtMs: now,
    ...overrides,
  };
}

const services = {
  restoredUid: vi.fn(async () => 'staff-uid'),
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
  replayQueue: vi.fn(async () => 0),
  refreshDirectory: vi.fn(async () => {}),
  fetchBackdrop: vi.fn(async () => ({
    bytes: new Uint8Array([1, 2, 3]),
    contentType: 'image/webp',
  })),
  performCheckIn: vi.fn(async () => {}),
  warmStudentDates: vi.fn(),
  forgetStudentDates: vi.fn(),
  enqueueCheckIn: vi.fn(),
} as unknown as KioskServices;

vi.mock('@/kiosk/services', () => services);

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function mount(bound: KioskBinding = binding()): Promise<void> {
  localStorage.setItem(KIOSK_KEYS.binding, JSON.stringify(bound));
  render(<KioskApp />);
  await settle();
}

/** Types on the kiosk's own keyboard, which listens on glass contact. */
async function type(text: string): Promise<void> {
  for (const key of text.toUpperCase()) {
    await act(async () => {
      fireEvent.pointerDown(screen.getByText(key, { selector: '[data-key]' }));
    });
  }
  await settle();
}

function layer(): HTMLElement {
  return screen.getByTestId('kiosk-backdrop');
}

/*
 * Addressed by `data-key`, never by its label — the same reasoning as the
 * staff-gate suite, whose hold this file re-uses.
 */
const clearKey = () => document.querySelector<HTMLButtonElement>('[data-key="clear"]')!;

/**
 * Settles the reveal whichever path jsdom took: where `img.decode()` exists
 * it has already rejected into "reveal anyway"; where it does not, the load
 * listener is waiting for exactly this event. Firing it with no listener
 * attached is harmless.
 */
async function reveal(): Promise<void> {
  const img = layer().querySelector('img')!;
  await act(async () => {
    fireEvent.load(img);
  });
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:kiosk-backdrop-test'),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  localStorage.clear();
  delete (window as { __kioskPerf?: unknown }).__kioskPerf;
});

describe('the idle photograph', () => {
  it('shows on a calm bound screen, fetched exactly once', async () => {
    await mount();
    await reveal();
    expect(layer().className).not.toContain('kiosk-backdrop-hidden');
    expect(services.fetchBackdrop).toHaveBeenCalledTimes(1);
    expect(services.fetchBackdrop).toHaveBeenCalledWith(BACKDROP_ID);
    // Scenery, and marked as such.
    expect(layer().getAttribute('aria-hidden')).toBe('true');
  });

  it('is a kiosk with no layer at all when the gathering has no photograph', async () => {
    await mount(binding({ kioskBackdropId: undefined }));
    expect(screen.queryByTestId('kiosk-backdrop')).toBeNull();
    expect(services.fetchBackdrop).not.toHaveBeenCalled();
  });

  it('goes on the first letter — gone, not dimmed — and returns when the buffer empties', async () => {
    await mount();
    await reveal();
    await type('A');
    expect(layer().className).toContain('kiosk-backdrop-hidden');
    // Still mounted: the fade is an opacity transition on the one instance,
    // never an unmount that would cost a decode per family.
    expect(layer().querySelector('img')).not.toBeNull();

    // A tap on Clear, inside the hold's grace: contact, a beat, release.
    await act(async () => {
      fireEvent.pointerDown(clearKey());
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    await act(async () => {
      fireEvent.pointerUp(clearKey());
    });
    await settle();
    expect(layer().className).not.toContain('kiosk-backdrop-hidden');
  });

  it('adds zero renders to the typing path after the first letter', async () => {
    const probe: { renders: Record<string, number> } = { renders: {} };
    (window as { __kioskPerf?: typeof probe }).__kioskPerf = probe;
    await mount();
    await type('A');
    const afterFirst = probe.renders.Backdrop ?? 0;
    await type('DA');
    // The first letter flips `shown` and may re-render the layer once; the
    // letters after it must not touch it at all. This is the render-count
    // guarantee the perf suite reads through the same probe.
    expect(probe.renders.Backdrop).toBe(afterFirst);
    // And the keystrokes were real: the screen itself rendered per letter.
    expect(probe.renders.SearchScreen ?? 0).toBeGreaterThan(2);
  });

  it('is taken off this device by the staff gate, through the stored binding', async () => {
    await mount();
    // The staff gate: Clear, held through the grace and the hold.
    await act(async () => {
      fireEvent.pointerDown(clearKey());
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HOLD_DELAY_MS + HOLD_MS);
    });
    await settle();

    const hide = screen.getByText('Hide the photo').closest('button')!;
    await act(async () => {
      fireEvent.pointerDown(hide);
      fireEvent.pointerUp(hide);
    });
    await settle();

    // Off the glass now —
    expect(screen.queryByTestId('kiosk-backdrop')).toBeNull();
    // — and off the disk, so the ~4am reload keeps it off until a rebind.
    const stored = JSON.parse(localStorage.getItem(KIOSK_KEYS.binding)!) as KioskBinding;
    expect(stored.kioskBackdropId).toBeNull();
    // The row removes itself with the photo, which is the confirmation.
    expect(screen.queryByText('Hide the photo')).toBeNull();
  });
});
