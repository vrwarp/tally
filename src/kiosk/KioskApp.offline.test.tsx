/**
 * The kiosk through an outage — the simulations behind
 * docs/kiosk-offline-recovery.md, kept as tests.
 *
 * Each case is one row of that proposal's table of what the old retry queue
 * did, run against the real `KioskApp` with only the services chunk faked: a
 * network that can be up, down, or hanging, and a Tally behind it whose
 * register hears whatever lands. What is pinned is the promise the journal
 * makes — a tap is on the tablet before its tick paints, and it leaves only
 * when Tally says it has it — through every way the old queue broke it.
 */
import { act, cleanup, fireEvent, render, screen } from '@/test/rtl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskApp, type KioskServices } from '@/kiosk/KioskApp';
import type { KioskBinding } from '@/kiosk/binding';
import {
  RECORD_PREFIX,
  heldInMemoryCount,
  records as journalRecords,
  resetJournalForTests,
  write as writeRecord,
  type KioskRecord,
} from '@/kiosk/journal';
import type { KioskStudent } from '@/kiosk/search';
import { KIOSK_KEYS, KIOSK_ROSTER_VERSION } from '@/kiosk/storage';
import { outOfTouchSince, resetTouchForTests, unreached } from '@/kiosk/touch';
import { HOLD_DELAY_MS, HOLD_MS } from '@/kiosk/components/HoldButton';
import { RETRY_EVERY_MS, UPLOAD_DEADLINE_MS, createUploader } from '@/kiosk/uploader';
import type { LandKioskRecordsRequest } from '@/lib/kioskLanding';
import { fakeRegister, sentRecords } from '@/test/kioskLanding';

function child(id: string, firstName: string, lastName: string): KioskStudent {
  return {
    id,
    firstName,
    lastName,
    grade: 3,
    searchName: `${firstName} ${lastName}`.toLowerCase(),
    hasAllergies: false,
  };
}

const ADA = child('student-ada', 'Ada', 'Lovelace');
const BYRON = child('student-byron', 'Byron', 'Park');
const CLEO = child('student-cleo', 'Cleo', 'Diaz');
const DEV = child('student-dev', 'Dev', 'Patel');
const EMI = child('student-emi', 'Emi', 'Sato');
const ROSTER = [ADA, BYRON, CLEO, DEV, EMI];

const CHOOSER = /which gathering is this kiosk for/i;

/** Sunday Kids, open now and for the next three hours, handing children back. */
function binding(overrides: Partial<KioskBinding> = {}): KioskBinding {
  const now = Date.now();
  return {
    eventId: 'sunday-kids-2026-09-27',
    seriesId: null,
    title: 'Sunday Kids',
    startAtMs: now - 60_000,
    endAtMs: now + 3 * 3_600_000,
    checkInClosesAtMs: now + 3 * 3_600_000,
    requiresCheckOut: true,
    labelTemplate: null,
    boundAtMs: now - 60_000,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* The network, and Tally behind it                                            */
/* -------------------------------------------------------------------------- */

/**
 * `down` fails every request the way a dropped connection does — the Functions
 * SDK's `internal`. `hang` never answers at all, which is what a request into a
 * dead lobby connection does: Firestore Lite's `fetch` has no deadline.
 */
let net: 'up' | 'down' | 'hang' = 'up';
let standing: 'live' | 'retired' = 'live';
const tally = fakeRegister();

async function through(): Promise<void> {
  if (net === 'down') throw Object.assign(new Error('internal'), { code: 'functions/internal' });
  if (net === 'hang') await new Promise<never>(() => {});
}

const services = {
  restoredSession: vi.fn(async () => ({ uid: 'kiosk_kiosk-test-device', reason: null })),
  reportStanding: vi.fn(async () => (net === 'up' ? standing : 'unknown')),
  unpair: vi.fn(async () => {}),
  beginPairing: vi.fn(async () => ({ code: 'HJ4K2P', secret: 's3cret', expiresInSeconds: 600 })),
  pollPairing: vi.fn(async () => 'pending' as const),
  listEvents: vi.fn(async () => {
    await through();
    return [];
  }),
  loadRoster: vi.fn(async () => ROSTER),
  loadPhoneIndex: vi.fn(async () => ({})),
  loadParticipation: vi.fn(async () => ({
    participated: new Set<string>(),
    recent: new Set<string>(),
  })),
  fetchAttendance: vi.fn(async () => {
    await through();
    return tally.read();
  }),
  fetchPulse: vi.fn(async () => null),
  rememberPulse: vi.fn(),
  refetchRoster: vi.fn(async () => {}),
  refetchPhoneIndex: vi.fn(async () => {}),
  refetchParticipation: vi.fn(async () => {}),
  fetchAllergyNote: vi.fn(async () => null),
  landRecords: vi.fn(async (request: LandKioskRecordsRequest) => {
    await through();
    if (standing === 'retired') {
      throw Object.assign(new Error('retired'), { code: 'functions/permission-denied' });
    }
    return tally.land(request);
  }),
  reachTally: vi.fn(async () => {
    await through();
    return true;
  }),
  createUploader,
} as unknown as KioskServices;

vi.mock('@/kiosk/services', () => services);

/* -------------------------------------------------------------------------- */
/* The glass                                                                   */
/* -------------------------------------------------------------------------- */

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function wait(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await settle();
}

async function mount(bound: KioskBinding | null = binding()): Promise<void> {
  if (bound) localStorage.setItem(KIOSK_KEYS.binding, JSON.stringify(bound));
  localStorage.setItem(
    KIOSK_KEYS.roster,
    JSON.stringify({ version: KIOSK_ROSTER_VERSION, fetchedAtMs: Date.now(), students: ROSTER }),
  );
  render(<KioskApp />);
  await settle();
}

/** The page going away and coming back — a reload, a crash, a power cut. */
async function reload(): Promise<void> {
  cleanup();
  // What lives only in the page goes with it; the disk is what is left.
  resetJournalForTests();
  resetTouchForTests();
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

async function press(element: Element): Promise<void> {
  await act(async () => {
    fireEvent.pointerDown(element);
    fireEvent.pointerUp(element);
  });
  await settle();
}

/** Finds a child by name and opens their confirm screen. */
async function find(student: KioskStudent): Promise<void> {
  await type(student.firstName);
  await press(screen.getByText(`${student.firstName} ${student.lastName}`).closest('button')!);
}

/** One family at the glass: find the child, press the verb, and step away. */
async function tapThrough(student: KioskStudent, verb: RegExp): Promise<void> {
  await find(student);
  await press(screen.getByText(verb).closest('button')!);
  // The tick, and the four seconds it stands before the door comes back.
  await wait(5_000);
}

/** The staff gate: **Clear**, held. */
async function holdClear(): Promise<void> {
  const clear = document.querySelector<HTMLButtonElement>('[data-key="clear"]')!;
  await act(async () => {
    fireEvent.pointerDown(clear);
  });
  await wait(HOLD_DELAY_MS + HOLD_MS);
}

/** The kiosk finding it cannot reach Tally — what every failed request says. */
async function loseTouch(): Promise<void> {
  await act(async () => {
    unreached();
  });
}

function waitingIds(): string[] {
  return journalRecords().map((record) => `${record.kind}:${record.studentId}`);
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  localStorage.clear();
  resetJournalForTests();
  resetTouchForTests();
  tally.reset();
  net = 'up';
  standing = 'live';
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

/* -------------------------------------------------------------------------- */

describe('a tap, with the internet gone', () => {
  it('is on the tablet before the tick, and reaches Tally with the moment of the tap', async () => {
    net = 'down';
    await mount();
    await find(ADA);
    const tappedAt = Date.now();
    await press(screen.getByText(/^check in$/i).closest('button')!);

    // The tick, and the record under it.
    expect(screen.getByText(/checked in\. Welcome!/i)).toBeTruthy();
    expect(journalRecords()).toEqual([
      expect.objectContaining({
        kind: 'check-in',
        eventId: 'sunday-kids-2026-09-27',
        studentId: ADA.id,
        gathering: 'Sunday Kids',
      }),
    ]);
    expect(Math.abs(journalRecords()[0]!.tappedAtMs - tappedAt)).toBeLessThan(1_000);
    expect(outOfTouchSince()).not.toBeNull();

    // An hour of retries, every one of them failing, loses nothing.
    await wait(60 * 60_000);
    expect(waitingIds()).toEqual([`check-in:${ADA.id}`]);

    net = 'up';
    await wait(RETRY_EVERY_MS);

    expect(journalRecords()).toEqual([]);
    expect([...tally.present]).toEqual([ADA.id]);
    // The tap's own time, not the upload's — failure 3.
    const [sent] = sentRecords(services.landRecords, 'check-in').slice(-1);
    expect(Math.abs(sent!.tappedAtMs - tappedAt)).toBeLessThan(1_000);
    expect(outOfTouchSince()).toBeNull();
  });

  it('keeps sending after the gathering is over and the kiosk has moved on — failures 1 and 2', async () => {
    net = 'down';
    // Half an hour of Sunday Kids left.
    await mount(binding({ endAtMs: Date.now() + 30 * 60_000, checkInClosesAtMs: Date.now() + 30 * 60_000 }));
    await tapThrough(ADA, /^check in$/i);

    // The gathering ends with the internet still out; the kiosk hands itself
    // back to the chooser, which cannot load anything either.
    await wait(35 * 60_000);
    expect(screen.getByText(CHOOSER)).toBeTruthy();
    expect(waitingIds()).toEqual([`check-in:${ADA.id}`]);
    // Said where the kiosk will sit all week, beside the calendar that failed.
    expect(screen.getByText(/Couldn’t load the calendar/)).toBeTruthy();
    expect(
      screen.getByText(/^1 check-in from Sunday Kids not sent yet — keep it plugged in/),
    ).toBeTruthy();

    // Monday: the internet is back, and nobody has set the kiosk to anything.
    vi.setSystemTime(Date.now() + 20 * 3_600_000);
    net = 'up';
    await wait(RETRY_EVERY_MS);

    expect(journalRecords()).toEqual([]);
    const [sent] = sentRecords(services.landRecords, 'check-in').slice(-1);
    // To Sunday's gathering, which the callable judges it against — not to
    // whatever the kiosk is on now.
    expect(sent).toMatchObject({ eventId: 'sunday-kids-2026-09-27', studentId: ADA.id });
    expect(screen.getByText(CHOOSER)).toBeTruthy();
    expect(screen.queryByText(/not sent yet/)).toBeNull();
  });

  it('sends a pickup behind its own arrival, in the order they happened', async () => {
    net = 'down';
    await mount();
    await tapThrough(ADA, /^check in$/i);
    await tapThrough(ADA, /^check out$/i);
    expect(waitingIds()).toEqual([`check-in:${ADA.id}`, `check-out:${ADA.id}`]);

    net = 'up';
    await wait(RETRY_EVERY_MS);

    const landed = sentRecords(services.landRecords).slice(-2);
    expect(landed.map((record) => record.kind)).toEqual(['check-in', 'check-out']);
    expect([...tally.checkedOut]).toEqual([ADA.id]);
  });
});

describe('coming back', () => {
  it('says so at once, so Tally stops calling it quiet before the next five-minute report', async () => {
    net = 'down';
    await mount();
    await tapThrough(ADA, /^check in$/i);
    // Twenty minutes out: Tally has been calling this kiosk quiet since twelve.
    await wait(20 * 60_000);
    vi.mocked(services.reportStanding).mockClear();

    net = 'up';
    await wait(RETRY_EVERY_MS);

    expect(journalRecords()).toEqual([]);
    // The report that clears "quiet", well before the register poll's next tick.
    expect(services.reportStanding).toHaveBeenCalledWith(expect.objectContaining({ title: 'Sunday Kids' }));
  });
});

describe('a connection that hangs rather than fails — failure 5', () => {
  it('runs one pass at a time, loses nothing, and lands everything when it comes back', async () => {
    net = 'hang';
    const callTimes: number[] = [];
    vi.mocked(services.landRecords).mockImplementation(async (request) => {
      callTimes.push(Date.now());
      await through();
      return tally.land(request);
    });

    await mount();
    for (const student of [ADA, BYRON, CLEO, DEV, EMI]) {
      await tapThrough(student, /^check in$/i);
      await wait(40_000);
    }
    await wait(10 * 60_000);

    // Every tap still on the tablet: nothing wrote a stale copy over anything.
    expect(waitingIds()).toHaveLength(5);
    // And never two calls in flight: each pass waits out its deadline, and the
    // next begins only after it.
    for (let i = 1; i < callTimes.length; i += 1) {
      expect(callTimes[i]! - callTimes[i - 1]!).toBeGreaterThanOrEqual(UPLOAD_DEADLINE_MS);
    }

    net = 'up';
    await wait(2 * RETRY_EVERY_MS + 2 * UPLOAD_DEADLINE_MS);

    expect(journalRecords()).toEqual([]);
    expect([...tally.present].sort()).toEqual(
      [ADA, BYRON, CLEO, DEV, EMI].map((student) => student.id).sort(),
    );
  });
});

describe('a long outage — failure 4', () => {
  it('keeps every record, however many, and sends them twenty-five a call', async () => {
    const tapped = Date.now() - 3_600_000;
    for (let i = 0; i < 500; i += 1) {
      const id = `student-${String(i).padStart(4, '0')}`;
      writeRecord({
        v: 1,
        id: `record-${String(i).padStart(4, '0')}`,
        kind: 'check-in',
        eventId: 'sunday-kids-2026-09-27',
        studentId: id,
        tappedAtMs: tapped + i,
        student: { firstName: 'Kid', lastName: String(i), grade: 3, searchName: `kid ${i}` },
        gathering: 'Sunday Kids',
        attempts: 3,
      } satisfies KioskRecord);
    }

    await mount();
    await wait(5_000);

    const calls = vi.mocked(services.landRecords).mock.calls;
    expect(calls).toHaveLength(20);
    expect(calls.every(([request]) => request.records.length === 25)).toBe(true);
    // Oldest first, and each call tells Tally what is still on the tablet.
    expect(calls[0]![0].records[0]!.id).toBe('record-0000');
    expect(calls[0]![0].stillOnTablet).toEqual({ count: 475, oldestTappedAtMs: tapped + 25 });
    expect(calls[19]![0].stillOnTablet).toEqual({ count: 0, oldestTappedAtMs: null });
    expect(journalRecords()).toEqual([]);
    expect(tally.present.size).toBe(500);
  });
});

describe('a reload mid-outage — failure 8', () => {
  it('still offers a pickup as a pickup, for a child the register showed and one the tablet saw', async () => {
    // Ada was checked in before the internet went — the register shows her.
    tally.present.add(ADA.id);
    await mount();

    net = 'down';
    await tapThrough(BYRON, /^check in$/i);

    // The tablet restarts, with the internet still out: no register to read.
    await reload();
    expect(services.fetchAttendance).toHaveBeenCalled();

    await find(ADA);
    expect(screen.getByText(/^check out$/i)).toBeTruthy();
    await press(screen.getByText(/^check out$/i).closest('button')!);
    await wait(5_000);

    await find(BYRON);
    expect(screen.getByText(/^check out$/i)).toBeTruthy();

    expect(waitingIds()).toEqual([`check-in:${BYRON.id}`, `check-out:${ADA.id}`]);
  });

  it('keeps a tap made while a request hung — failure 6', async () => {
    net = 'hang';
    await mount();
    await tapThrough(ADA, /^check in$/i);

    // The page goes before the request ever answers.
    await reload();
    expect(waitingIds()).toEqual([`check-in:${ADA.id}`]);

    net = 'up';
    await wait(RETRY_EVERY_MS);
    expect(journalRecords()).toEqual([]);
    expect([...tally.present]).toEqual([ADA.id]);
  });
});

describe('the register and the room', () => {
  it('stops offering a pickup for a child a leader took off the register', async () => {
    tally.present.add(ADA.id);
    await mount();
    await find(ADA);
    expect(screen.getByText(/^check out$/i)).toBeTruthy();
    await press(screen.getByText(/back/i).closest('button')!);

    // A leader removes Ada — checked in by mistake — on their phone.
    tally.present.delete(ADA.id);
    await wait(5 * 60_000);

    // The query is still on the glass; the next read has spoken.
    await press(screen.getByText('Ada Lovelace').closest('button')!);
    expect(screen.getByText(/^check in$/i)).toBeTruthy();
  });

  it('keeps a child in the room whose check-in Tally parked, so their pickup is still a pickup', async () => {
    vi.mocked(services.landRecords).mockImplementation(async (request) => ({
      outcomes: request.records.map((record) => ({
        id: record.id,
        outcome: 'parked' as const,
        reason: 'frozen' as const,
      })),
    }));
    await mount();
    await tapThrough(ADA, /^check in$/i);

    // Parked is in Tally: off the tablet, and waiting for a person on Review.
    expect(journalRecords()).toEqual([]);
    await wait(5 * 60_000);

    await find(ADA);
    expect(screen.getByText(/^check out$/i)).toBeTruthy();
  });
});

describe('when storage is full — failure 7', () => {
  it('holds the record in the page, and the four o’clock reload waits for it to land', async () => {
    vi.setSystemTime(new Date(2026, 8, 27, 3, 30, 0));
    const reloadPage = vi.fn();
    const location = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...location, reload: reloadPage },
    });
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key.startsWith(RECORD_PREFIX)) throw new DOMException('full', 'QuotaExceededError');
      return setItem.call(this, key, value);
    });
    try {
      net = 'down';
      await mount(binding({ endAtMs: Date.now() + 10 * 60_000, checkInClosesAtMs: Date.now() + 10 * 60_000 }));
      await tapThrough(ADA, /^check in$/i);
      expect(heldInMemoryCount()).toBe(1);

      // The corner mark, and what it opens: the one record a reload would lose.
      await press(screen.getByLabelText('Check-ins need attention'));
      expect(screen.getByText('Not saved yet')).toBeTruthy();
      expect(screen.getByText(/1 isn’t saved yet — don’t reload or restart/)).toBeTruthy();
      await press(screen.getByText(/Done — back to check-in/).closest('button')!);

      // Past four, unbound and untouched: the moment the kiosk reloads itself.
      await wait(40 * 60_000);
      expect(screen.getByText(CHOOSER)).toBeTruthy();
      expect(reloadPage).not.toHaveBeenCalled();

      net = 'up';
      await wait(2 * 60_000);
      expect(heldInMemoryCount()).toBe(0);
      expect([...tally.present]).toEqual([ADA.id]);
      expect(reloadPage).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: location });
    }
  });
});

describe('a kiosk retired with records on it', () => {
  it('keeps them, stops sending, and shows its pairing code', async () => {
    net = 'down';
    await mount();
    await tapThrough(ADA, /^check in$/i);

    // Somebody retires the kiosk in Tally while it is out of touch.
    standing = 'retired';
    net = 'up';
    await wait(RETRY_EVERY_MS);

    expect(services.reportStanding).toHaveBeenCalled();
    expect(waitingIds()).toEqual([`check-in:${ADA.id}`]);
    const sentSoFar = vi.mocked(services.landRecords).mock.calls.length;

    // On the pairing screen there is no session to send with.
    await wait(5 * RETRY_EVERY_MS);
    expect(vi.mocked(services.landRecords).mock.calls.length).toBe(sentSoFar);
    expect(waitingIds()).toEqual([`check-in:${ADA.id}`]);
    // And it says what pairing it again is for.
    expect(
      screen.getByText('1 check-in waiting. Pair this tablet to send it.'),
    ).toBeTruthy();
  });
});

describe('the old retry queue', () => {
  it('becomes records on the first boot, and goes to Tally', async () => {
    localStorage.setItem(
      KIOSK_KEYS.pending,
      JSON.stringify([
        {
          eventId: 'sunday-kids-2026-09-27',
          seriesId: null,
          startAtMs: Date.now() - 3_600_000,
          studentId: BYRON.id,
          student: { firstName: 'Byron', lastName: 'Park', grade: 3, searchName: 'byron park' },
          uid: 'kiosk_kiosk-test-device',
          arrivalId: 'arrival-9',
          queuedAtMs: Date.now() - 600_000,
        },
      ]),
    );
    await mount();
    await wait(1_000);

    expect(localStorage.getItem(KIOSK_KEYS.pending)).toBeNull();
    expect(sentRecords(services.landRecords, 'check-in')).toEqual([
      expect.objectContaining({
        studentId: BYRON.id,
        arrivalId: 'arrival-9',
        gathering: 'Sunday Kids',
      }),
    ]);
    expect([...tally.present]).toEqual([BYRON.id]);
  });
});

describe('what the kiosk says, while it cannot reach Tally', () => {
  it('says on the staff menu that everything is in Tally, and when it is not, why', async () => {
    await mount();
    await holdClear();
    expect(screen.getByText('All check-ins are in Tally')).toBeTruthy();
    await press(screen.getByText(/Keep checking in/).closest('button')!);

    net = 'down';
    await tapThrough(ADA, /^check in$/i);
    await holdClear();
    expect(screen.getByText('1 waiting')).toBeTruthy();
    expect(screen.getByText(/^No internet since /)).toBeTruthy();

    // The list behind the row: who, and what the last attempt ran into.
    await press(screen.getByText('Check-ins').closest('button')!);
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('No internet')).toBeTruthy();

    // Try now, with the internet back: the list empties while it is open.
    net = 'up';
    await press(screen.getByText(/Try now/).closest('button')!);
    await wait(1_000);
    expect(screen.getByText('All check-ins are in Tally')).toBeTruthy();
    expect([...tally.present]).toEqual([ADA.id]);
  });

  it('tells staff on untouched glass after ten minutes, and the first touch takes it away', async () => {
    await mount();
    await loseTouch();
    await wait(9 * 60_000);
    expect(screen.queryByText(/can’t reach Tally\. Check-ins are saved here/)).toBeNull();

    // The ten minutes, and then the few seconds of stillness the front door's
    // staff notices wait for.
    await wait(60_000);
    await wait(5_000);
    const notice = screen.getByText(/can’t reach Tally\. Check-ins are saved here/);
    expect(notice.textContent).toMatch(/Check-ins are saved here and will send; don’t reset it/);

    await type('a');
    expect(screen.queryByText(/can’t reach Tally\. Check-ins are saved here/)).toBeNull();
  });

  it('opens the list from the notice, and comes back to the door', async () => {
    await mount();
    await loseTouch();
    await wait(10 * 60_000);
    await wait(5_000);

    await press(screen.getByText(/can’t reach Tally\. Check-ins are saved here/).closest('button')!);
    expect(screen.getByText('All check-ins are in Tally')).toBeTruthy();
    await press(screen.getByText(/Done — back to check-in/).closest('button')!);
    // Back at the door, and — once the glass is still again — so is the notice.
    expect(screen.queryByText(/can’t reach Tally\. Check-ins are saved here/)).toBeNull();
    await wait(5_000);
    expect(screen.getByText(/can’t reach Tally\. Check-ins are saved here/)).toBeTruthy();
  });

  it('sends a new family to a leader before the first question, not after the last', async () => {
    await mount();
    await loseTouch();

    await press(screen.getByText(/Register your child/).closest('button')!);
    expect(screen.getByText('A leader will get you started')).toBeTruthy();
    expect(screen.getByText(/so it can’t add new families/)).toBeTruthy();

    // And the wizard as usual once Tally answers again.
    await wait(10_000);
    await act(async () => {
      const { reached } = await import('@/kiosk/touch');
      reached();
    });
    await press(screen.getByText(/Register your child/).closest('button')!);
    expect(screen.queryByText('A leader will get you started')).toBeNull();
  });

  it('says what Leave costs', async () => {
    await mount();
    await loseTouch();
    await holdClear();
    await press(screen.getByText('Change gathering').closest('button')!);
    expect(screen.getByText(/can’t pick another gathering until it’s back online/)).toBeTruthy();
  });
});
