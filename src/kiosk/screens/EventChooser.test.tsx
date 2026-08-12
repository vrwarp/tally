/**
 * Setting a kiosk to a gathering, in one gesture or two.
 *
 * The screen used to ask for both: tap the row, then travel to the bottom of a
 * tablet and hold a separate button. Holding the row itself now does the whole
 * thing, and these pin the three claims that makes — that a hold on a row
 * binds *that* row, that a tap on one still only selects it, and that a finger
 * that came down on a row on its way to scrolling the list binds nothing.
 *
 * The last is the reason the rows wait for the lift rather than committing on
 * contact like the rest of the kiosk (see `components/tapGuard.ts`): a list
 * that scrolls cannot also re-point the kiosk from the touch that scrolled it.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventChooser } from '@/kiosk/screens/EventChooser';
import { HOLD_DELAY_MS, HOLD_MS } from '@/kiosk/components/HoldButton';
import { TAP_SLOP_PX } from '@/kiosk/components/tapGuard';
import type { KioskEventEntry, KioskServices } from '@/kiosk/KioskApp';
import type { KioskBinding } from '@/kiosk/binding';

const HOUR = 60 * 60 * 1000;

/**
 * Ten in the morning, fixed.
 *
 * The list is narrowed to today now (see the note at the top of the screen),
 * so a suite that took its clock from the wall would drop the afternoon rows
 * out from under itself whenever it happened to run near midnight.
 */
const TEN_AM = new Date('2026-08-12T10:00:00').getTime();

function entry(title: string, startAt: number): KioskEventEntry {
  return {
    chain: `chain-${title}`,
    predictsFrom: null,
    id: null,
    title,
    startAt,
    endAt: startAt + 2 * HOUR,
    checkInOpensAt: startAt - HOUR,
    checkInClosesAt: startAt + 3 * HOUR,
    seriesId: null,
    location: null,
    requiresCheckOut: false,
    labelTemplate: null,
  };
}

function bindingFor(entry: KioskEventEntry): KioskBinding {
  return {
    eventId: 'event-1',
    seriesId: null,
    predictsFrom: null,
    title: entry.title,
    startAtMs: entry.startAt,
    endAtMs: entry.endAt,
    checkInClosesAtMs: entry.checkInClosesAt,
    boundAtMs: entry.startAt,
  };
}

const NURSERY = entry('Nursery', TEN_AM + HOUR);
const YOUTH = entry('Youth group', TEN_AM + 5 * HOUR);
/** Same gathering, same title, next week — the row a thumb lands on by mistake. */
const NEXT_WEEK = entry('Youth group', TEN_AM + 7 * 24 * HOUR);

function servicesWith(bindEntry: KioskServices['bindEntry']): KioskServices {
  return {
    listEvents: vi.fn(async () => [NURSERY, YOUTH]),
    bindEntry,
  } as unknown as KioskServices;
}

/** Let the event list arrive. */
async function tick(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** The row for a gathering — the button, not the text inside it. */
function row(title: string): HTMLElement {
  return screen.getByText(title).closest('button')!;
}

/**
 * A pointer event that carries where it happened.
 *
 * jsdom has no `PointerEvent` constructor, so `fireEvent.pointerDown` falls
 * back to a plain `Event` and every coordinate on it reads zero — which would
 * make a drag across the screen indistinguishable from a thumb held still, and
 * quietly pass the one test here that is about telling them apart. A
 * `MouseEvent` carries the coordinates for real; `pointerId` is the only thing
 * left to add, and React reads the rest off the native event as it is.
 */
function pointer(type: string, element: HTMLElement, x: number, y: number): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  fireEvent(element, event);
}

/** A finger landing on a row, always at the same spot. */
function down(element: HTMLElement): void {
  pointer('pointerdown', element, 100, 100);
}

/** And coming off it, `offset` pixels further down the screen. */
function up(element: HTMLElement, offset = 0): void {
  pointer('pointerup', element, 100, 100 + offset);
}

async function renderChooser(services: KioskServices, onBound = vi.fn()) {
  render(
    <EventChooser
      services={services}
      printerState={null}
      onSetUpPrinter={vi.fn()}
      onBound={onBound}
    />,
  );
  await tick();
  return onBound;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(TEN_AM);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('holding a gathering', () => {
  it('sets the kiosk to that gathering, without it being picked first', async () => {
    const bindEntry = vi.fn(async () => bindingFor(YOUTH));
    const onBound = await renderChooser(servicesWith(bindEntry));

    down(row('Youth group'));
    await tick(HOLD_DELAY_MS + HOLD_MS);

    expect(bindEntry).toHaveBeenCalledWith(YOUTH);
    expect(onBound).toHaveBeenCalledWith(bindingFor(YOUTH));
  });

  it('binds the row under the thumb, not the one already picked', async () => {
    const bindEntry = vi.fn(async () => bindingFor(YOUTH));
    await renderChooser(servicesWith(bindEntry));

    // A staff member picks one, thinks again, and holds the other.
    down(row('Nursery'));
    up(row('Nursery'));
    down(row('Youth group'));
    await tick(HOLD_DELAY_MS + HOLD_MS);

    expect(bindEntry).toHaveBeenCalledTimes(1);
    expect(bindEntry).toHaveBeenCalledWith(YOUTH);
  });

  it('binds nothing until the hold completes', async () => {
    const bindEntry = vi.fn(async () => bindingFor(NURSERY));
    await renderChooser(servicesWith(bindEntry));

    down(row('Nursery'));
    await tick(HOLD_DELAY_MS + HOLD_MS - 100);
    up(row('Nursery'));
    await tick(HOLD_DELAY_MS + HOLD_MS);

    expect(bindEntry).not.toHaveBeenCalled();
  });

  it('binds nothing when the finger was on its way to scrolling the list', async () => {
    const bindEntry = vi.fn(async () => bindingFor(NURSERY));
    await renderChooser(servicesWith(bindEntry));

    const nursery = row('Nursery');
    down(nursery);
    pointer('pointermove', nursery, 100, 100 + TAP_SLOP_PX * 4);
    await tick(HOLD_DELAY_MS + HOLD_MS);
    up(nursery, TAP_SLOP_PX * 4);

    // Neither gesture: the hold was cancelled by the drag, and a lift that far
    // from where it landed is a scroll rather than a pick.
    expect(bindEntry).not.toHaveBeenCalled();
    expect(screen.getByText('Pick a gathering')).toBeInTheDocument();
  });
});

describe('tapping a gathering', () => {
  it('only picks it, and arms the button that says the word', async () => {
    const bindEntry = vi.fn(async () => bindingFor(NURSERY));
    await renderChooser(servicesWith(bindEntry));

    expect(screen.getByText('Pick a gathering')).toBeInTheDocument();

    down(row('Nursery'));
    up(row('Nursery'));

    expect(bindEntry).not.toHaveBeenCalled();
    expect(screen.getByText('Hold to set kiosk')).toBeInTheDocument();
  });

  it('leaves the button holding the kiosk to the picked gathering', async () => {
    const bindEntry = vi.fn(async () => bindingFor(NURSERY));
    const onBound = await renderChooser(servicesWith(bindEntry));

    down(row('Nursery'));
    up(row('Nursery'));

    const button = screen.getByText('Hold to set kiosk').closest('button')!;
    fireEvent.pointerDown(button, { pointerId: 2 });
    await tick(HOLD_DELAY_MS + HOLD_MS);

    expect(bindEntry).toHaveBeenCalledWith(NURSERY);
    expect(onBound).toHaveBeenCalledWith(bindingFor(NURSERY));
  });
});

/**
 * The three states a row can be in, and the one it spent longest without.
 *
 * The chooser offers the week on purpose, so most rows on it are ahead — and a
 * volunteer binding one is doing the ordinary thing, setting a tablet up before
 * doors. What was missing was the consequence: the kiosk will not take arrivals
 * there until the window opens (see `windowHasOpened`), and a row that said
 * nothing left that to be discovered by a family at the front of a queue.
 */
describe('what a row says about its window', () => {
  it('rings the one taking arrivals now, and does not tell it to wait', async () => {
    await renderChooser(servicesWith(vi.fn()));
    expect(row('Nursery')).toHaveTextContent(/Check-in open(?!s)/);
    expect(row('Nursery')).not.toHaveTextContent(/Check-in opens/);
  });

  it('says when the one that is not will start', async () => {
    await renderChooser(servicesWith(vi.fn()));
    // Youth group opens four hours out. The row carried its date already; what
    // it did not carry was that the date is a constraint and not a caption.
    expect(row('Youth group')).toHaveTextContent(/Check-in opens \d/);
  });

  it('still lets it be bound — setting up early is the point of the list', async () => {
    const bindEntry = vi.fn(async () => bindingFor(YOUTH));
    const onBound = await renderChooser(servicesWith(bindEntry));

    down(row('Youth group'));
    await tick(HOLD_DELAY_MS + HOLD_MS);
    up(row('Youth group'));
    await tick();

    expect(bindEntry).toHaveBeenCalledWith(YOUTH);
    expect(onBound).toHaveBeenCalled();
  });
});

/**
 * What a volunteer may point the tablet at.
 *
 * The server sends the week — it is also what materialises an occurrence
 * nobody has created yet, and a window that opened yesterday has to survive
 * the calendar boundary. What the screen offers is narrower, and matches the
 * app's own chooser: today, plus whatever is open.
 */
describe('the list the chooser narrows to', () => {
  /** Bound at ten in the morning; the whole list is on today. */
  const servicesListing = (events: KioskEventEntry[]): KioskServices =>
    ({ listEvents: vi.fn(async () => events), bindEntry: vi.fn() }) as unknown as KioskServices;

  it('offers what is on today', async () => {
    await renderChooser(servicesListing([NURSERY, YOUTH]));
    expect(screen.getByText('Nursery')).toBeInTheDocument();
    expect(screen.getByText('Youth group')).toBeInTheDocument();
  });

  it('does not offer next week, however the server was feeling', async () => {
    // The misbinding this exists to make impossible: two rows, same title, and
    // the wrong one takes an evening's register against a date in the future.
    await renderChooser(servicesListing([NURSERY, NEXT_WEEK]));
    expect(screen.getByText('Nursery')).toBeInTheDocument();
    expect(screen.queryByText('Youth group')).not.toBeInTheDocument();
  });

  it('keeps a gathering that began yesterday and has not finished', async () => {
    // The server only ever sends gatherings whose end and window are both
    // still ahead, so "starts before midnight tonight" already means "started
    // and is not over" — no lower bound needed, and none wanted: a lock-in
    // that began at eleven last night is on *yesterday* by the calendar and is
    // exactly the gathering somebody is standing at.
    const lockIn = entry('Lock-in', TEN_AM - 11 * HOUR);
    await renderChooser(servicesListing([lockIn]));
    expect(screen.getByText('Lock-in')).toBeInTheDocument();
  });

  it('keeps one whose doors open tonight for a gathering dated tomorrow', async () => {
    // The other side of the same midnight: doors at half eleven for a lock-in
    // that starts at half past twelve. It is on *tomorrow* by the calendar,
    // and a volunteer is standing at the door now. Open beats the boundary,
    // the same way it does on the app's chooser.
    const overnight = {
      ...entry('New Year lock-in', TEN_AM + 14.5 * HOUR),
      checkInOpensAt: TEN_AM - HOUR,
      checkInClosesAt: TEN_AM + 18 * HOUR,
    };
    await renderChooser(servicesListing([overnight]));
    expect(screen.getByText('New Year lock-in')).toBeInTheDocument();
  });

  it('says nothing is on today rather than nothing is on this week', async () => {
    await renderChooser(servicesListing([NEXT_WEEK]));
    expect(screen.getByText(/Nothing on today/)).toBeInTheDocument();
  });
});
