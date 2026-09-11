/**
 * The language a family chose does not outlive them.
 *
 * A lobby kiosk is used by strangers in sequence. One family taps 中文, checks
 * a child in and walks away; the next family are not the same people, and a
 * screen still in somebody else's script is one more obstacle between them and
 * typing a name — the chip's own purpose, wearing the opposite face.
 *
 * So the glass goes back to English two ways, and both are pinned here because
 * neither is visible in the diff that would break it. Coming home from a
 * check-in is an edge nothing else watches, and the idle clock is a timer with
 * no UI at all.
 *
 * The third test is the one that matters most, though, because it is the case a
 * simpler rule gets wrong: pressing **Clear** empties the search buffer without
 * anybody having gone anywhere. Resetting on "the screen is quiet again" rather
 * than on "the family left and came back" would take a parent's language away
 * for fixing their own typo, mid-search, with the queue behind them.
 */
import { act, fireEvent, render, screen } from '@/test/rtl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskApp, type KioskServices } from '@/kiosk/KioskApp';
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

/*
 * The two readings of the search screen's own prompt. Asserting on what the
 * glass says, rather than on a storage key, is the whole point: the family sees
 * words, and a reset that moved a key without moving the words would be no
 * reset at all.
 */
const ENGLISH_PROMPT = /^type a name$/i;
/*
 * Not 請輸入姓名 — the prompt names the keys the lobby keyboard actually makes,
 * because a bare 姓名 sends a parent hunting for an IME that is not on the
 * glass. It deliberately promises nothing about *matching*: `withPinyin` can
 * only widen a name somebody entered in Chinese upstream, and nothing
 * standardises that, so the screen states a fact about the keyboard rather than
 * a claim about the roster.
 */
const CHINESE_PROMPT = '請用英文字母輸入姓名';

function binding(): KioskBinding {
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
    boundAtMs: now,
  };
}

const services = {
  restoredSession: vi.fn(async () => ({ uid: 'kiosk_kiosk-test-device', reason: null })),
  reportStanding: vi.fn(async () => 'live' as const),
  unpair: vi.fn(async () => {}),
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
  // The chooser asks for this the moment a kiosk boots unbound.
  listEvents: vi.fn(async () => []),
} as unknown as KioskServices;

vi.mock('@/kiosk/services', () => services);

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Boot straight into a bound, family-facing screen, already in Traditional. */
async function mountInChinese(bound: KioskBinding | null = binding()): Promise<void> {
  if (bound) localStorage.setItem(KIOSK_KEYS.binding, JSON.stringify(bound));
  localStorage.setItem(
    KIOSK_KEYS.roster,
    JSON.stringify({ version: KIOSK_ROSTER_VERSION, fetchedAtMs: Date.now(), students: [ADA] }),
  );
  render(<KioskApp />, { locale: 'zh-Hant' });
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

async function pickAda(): Promise<void> {
  const row = screen.getByText('Ada Lovelace').closest('button')!;
  await act(async () => {
    fireEvent.pointerDown(row);
    fireEvent.pointerUp(row);
  });
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

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('a family’s language does not outlive their visit', () => {
  it('goes back to English when the kiosk comes home from a check-in', async () => {
    await mountInChinese();
    expect(screen.getByText(CHINESE_PROMPT)).toBeTruthy();

    await type('ada');
    await pickAda();
    // The check-in itself, and the thank-you after it, stay in their language —
    // it is still their visit until the glass returns to the front door.
    await tap(/簽到|check in/i);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    // Home, and English, for whoever is next in the queue.
    expect(screen.getByText(ENGLISH_PROMPT)).toBeTruthy();
    expect(screen.queryByText(CHINESE_PROMPT)).toBeNull();
  });

  it('goes back to English when nobody touches the home screen', async () => {
    await mountInChinese();
    expect(screen.getByText(CHINESE_PROMPT)).toBeTruthy();

    // Somebody tapped 中文 and then wandered off without typing anything. No
    // transition marks that, so only the clock can catch it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });

    expect(screen.getByText(ENGLISH_PROMPT)).toBeTruthy();
  });

  it('keeps the language when a parent clears a mistyped name', async () => {
    await mountInChinese();
    await type('zz');

    /*
     * The case that rules out the simpler rule. Clear empties the buffer and
     * puts the prompt back, so a reset keyed on "the screen is quiet" would
     * fire here — and take the language off a parent who has not gone
     * anywhere and is about to type again.
     */
    await act(async () => {
      fireEvent.pointerDown(screen.getByText('清除', { selector: '[data-key]' }));
    });
    await settle();

    expect(screen.getByText(CHINESE_PROMPT)).toBeTruthy();
  });

  it('leaves a language chosen while the tablet is being set up alone', async () => {
    /*
     * No binding, so the kiosk is on the volunteer's chooser rather than the
     * family's door. A language picked while mounting the tablet is a decision,
     * not a leftover, and `e2e/i18n.spec.ts` asserts it survives pairing.
     */
    await mountInChinese(null);
    // The chooser's own question, so this asserts the screen is still Chinese
    // rather than merely that it is not the search screen.
    expect(screen.getByText('這台簽到台是給哪場聚會用的？')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });

    expect(screen.getByText('這台簽到台是給哪場聚會用的？')).toBeTruthy();
  });
});
