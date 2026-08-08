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
import { HOLD_MS } from '@/kiosk/components/HoldButton';
import { TAP_SLOP_PX } from '@/kiosk/components/tapGuard';
import type { KioskEventEntry, KioskServices } from '@/kiosk/KioskApp';
import type { KioskBinding } from '@/kiosk/binding';

const HOUR = 60 * 60 * 1000;

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

const NURSERY = entry('Nursery', Date.now() + HOUR);
const YOUTH = entry('Youth group', Date.now() + 5 * HOUR);

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
});

afterEach(() => {
  vi.useRealTimers();
});

describe('holding a gathering', () => {
  it('sets the kiosk to that gathering, without it being picked first', async () => {
    const bindEntry = vi.fn(async () => bindingFor(YOUTH));
    const onBound = await renderChooser(servicesWith(bindEntry));

    down(row('Youth group'));
    await tick(HOLD_MS);

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
    await tick(HOLD_MS);

    expect(bindEntry).toHaveBeenCalledTimes(1);
    expect(bindEntry).toHaveBeenCalledWith(YOUTH);
  });

  it('binds nothing until the hold completes', async () => {
    const bindEntry = vi.fn(async () => bindingFor(NURSERY));
    await renderChooser(servicesWith(bindEntry));

    down(row('Nursery'));
    await tick(HOLD_MS - 100);
    up(row('Nursery'));
    await tick(HOLD_MS);

    expect(bindEntry).not.toHaveBeenCalled();
  });

  it('binds nothing when the finger was on its way to scrolling the list', async () => {
    const bindEntry = vi.fn(async () => bindingFor(NURSERY));
    await renderChooser(servicesWith(bindEntry));

    const nursery = row('Nursery');
    down(nursery);
    pointer('pointermove', nursery, 100, 100 + TAP_SLOP_PX * 4);
    await tick(HOLD_MS);
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
    await tick(HOLD_MS);

    expect(bindEntry).toHaveBeenCalledWith(NURSERY);
    expect(onBound).toHaveBeenCalledWith(bindingFor(NURSERY));
  });
});
