/**
 * A pin fetches its words.
 *
 * Pinning a language is a promise the tablet may not be able to keep. The
 * catalogue is a lazy `import()` fired when the provider first sees the locale
 * (`KioskIntlProvider`), the kiosk's service worker precaches nothing and
 * learns assets on first fetch, and `loadCatalog` answers a chunk that will not
 * load with English and no error at all. Left alone, a language pinned on a
 * tablet that has never rendered it — or on the morning after a deploy, when
 * every chunk URL is new — paints a cell reading 简体中文 that changes nothing
 * when the family it was added for presses it, silently, in front of them.
 *
 * So `setPins` spends the network at the moment of pinning, which is the moment
 * a member of staff is standing at the device with nobody queueing behind the
 * request. Fire and forget: a warm that fails must never cost a volunteer their
 * tap, and the failure it guards against is the one `loadCatalog` already
 * answers for.
 *
 * Pinned here rather than in `KioskApp.language.test.tsx` because it needs the
 * catalogue module mocked, which that file's assertions on real Spanish and
 * Chinese words cannot survive.
 */
import { act, fireEvent, render, screen, within } from '@/test/rtl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskApp, type KioskServices } from '@/kiosk/KioskApp';
import { HOLD_DELAY_MS, HOLD_MS } from '@/kiosk/components/HoldButton';
import { KIOSK_KEYS, KIOSK_ROSTER_VERSION } from '@/kiosk/storage';
import type { KioskBinding } from '@/kiosk/binding';
import type { KioskStudent } from '@/kiosk/search';

const { loadCatalog } = vi.hoisted(() => ({ loadCatalog: vi.fn(async () => ({})) }));

/* Everything the real module exports, with the one fetch swapped out — the
   provider still needs `cachedCatalog` and the bundled English slice. */
vi.mock('@/kiosk/messages', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadCatalog,
}));

const ADA: KioskStudent = {
  id: 'student-ada',
  firstName: 'Ada',
  lastName: 'Lovelace',
  grade: 8,
  searchName: 'ada lovelace',
  hasAllergies: false,
};

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
  restoredSession: vi.fn(async () => ({ uid: 'kiosk_kiosk-test-device', reason: null })),
  reportStanding: vi.fn(async () => 'live' as const),
  unpair: vi.fn(async () => {}),
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

async function openLanguages(): Promise<void> {
  localStorage.setItem(KIOSK_KEYS.binding, JSON.stringify(binding()));
  localStorage.setItem(
    KIOSK_KEYS.roster,
    JSON.stringify({ version: KIOSK_ROSTER_VERSION, fetchedAtMs: Date.now(), students: [ADA] }),
  );
  render(<KioskApp />);
  await settle();
  await act(async () => {
    fireEvent.pointerDown(document.querySelector<HTMLButtonElement>('[data-key="clear"]')!);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(HOLD_DELAY_MS + HOLD_MS);
  });
  await settle();
  await tap('Languages');
}

/*
 * Scoped to the chip group, never to the screen. The preview underneath draws
 * the same language names as buttons — that is the whole point of it — so an
 * unscoped `getByText` finds two of everything the moment anything is pinned.
 */
async function tap(text: RegExp | string): Promise<void> {
  const group = screen.queryByTestId('language-pins');
  const button = (group ? within(group).getByText(text) : screen.getByText(text)).closest(
    'button',
  )!;
  await act(async () => {
    fireEvent.pointerDown(button);
    fireEvent.pointerUp(button);
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

describe('pinning a language fetches its words', () => {
  it('warms the catalogue for the language just added', async () => {
    await openLanguages();
    expect(loadCatalog).not.toHaveBeenCalled();

    await tap('Español');
    expect(loadCatalog).toHaveBeenCalledWith('es-MX');
  });

  it('warms only what is new, not the whole list again on every tap', async () => {
    localStorage.setItem(KIOSK_KEYS.pins, JSON.stringify(['es-MX']));
    await openLanguages();

    await tap('简体中文');
    expect(loadCatalog).toHaveBeenCalledWith('zh-Hans');
    expect(loadCatalog).not.toHaveBeenCalledWith('es-MX');
  });

  it('asks for nothing when a language is taken off', async () => {
    localStorage.setItem(KIOSK_KEYS.pins, JSON.stringify(['es-MX']));
    await openLanguages();

    await tap('Español');
    expect(JSON.parse(localStorage.getItem(KIOSK_KEYS.pins)!)).toEqual([]);
    expect(loadCatalog).not.toHaveBeenCalled();
  });

  it('does not cost the volunteer their tap when the fetch fails', async () => {
    loadCatalog.mockRejectedValueOnce(new Error('offline'));
    await openLanguages();

    await tap('Español');
    // Written anyway: the warm is an optimisation, and `loadCatalog` already
    // answers a chunk that will not load with English.
    expect(JSON.parse(localStorage.getItem(KIOSK_KEYS.pins)!)).toEqual(['es-MX']);
  });
});
