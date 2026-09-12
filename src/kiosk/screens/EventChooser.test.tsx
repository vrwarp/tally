/**
 * Setting a kiosk to a gathering, in one gesture or two.
 *
 * Holding a row does the whole thing, and these pin the three claims that
 * makes — that a hold on a row binds *that* row, that a tap on one still only
 * selects it, and that a finger that came down on a row on its way to scrolling
 * the list binds nothing. The other way in is still there for anybody who taps:
 * pick a row, then press the button at the foot of the screen, which is a plain
 * tap now and has its own describe below.
 *
 * The last is the reason the rows wait for the lift rather than committing on
 * contact like the rest of the kiosk (see `components/tapGuard.ts`): a list
 * that scrolls cannot also re-point the kiosk from the touch that scrolled it.
 */
import { act, fireEvent, render, screen } from '@/test/rtl';
import { useState, type ComponentProps } from 'react';
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

/**
 * A press on a button, start to finish.
 *
 * Without coordinates, unlike `down`/`up` above, and that is the difference
 * between the two guards rather than an oversight: a button asks whether the
 * finger came off *inside it* (`bounds` in components/tapGuard.ts) and jsdom
 * measures every element as a zero-sized box at the origin, so the only lift
 * that lands inside one is the one at 0,0. A row is measured by distance
 * travelled instead, which is why it can be pressed at 100,100 and dragged.
 */
async function tapButton(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.pointerDown(element, { pointerId: 2 });
    fireEvent.pointerUp(element, { pointerId: 2 });
  });
}

/** And coming off it, `offset` pixels further down the screen. */
function up(element: HTMLElement, offset = 0): void {
  pointer('pointerup', element, 100, 100 + offset);
}

/**
 * The printer strip at its quietest: no printer stored, no row on the list that
 * prints, the chunk in hand. The foot is then the door alone, which is what
 * every suite here that is not about the strip wants behind it.
 */
const QUIET_PRINTER = {
  printerState: null,
  printerConfigured: false,
  printingReady: true,
  onSetUpPrinter: vi.fn(),
  onConnectPrinter: vi.fn(),
  onLookAgain: vi.fn(),
  onPrintTestLabel: vi.fn(),
  onPrintingRows: vi.fn(),
};

/**
 * The chooser with its printer strip in its quietest state: no printer stored,
 * no gathering on the list that prints, so the foot is the door alone. The
 * suites that are about the strip pass their own `extra`.
 */
async function renderChooser(
  services: KioskServices,
  onBound = vi.fn(),
  extra: Partial<ComponentProps<typeof EventChooser>> = {},
) {
  function Harness() {
    // The pick lives in `KioskApp` now, so a test that taps a row has to hold
    // it the way the app does.
    const [selected, setSelected] = useState<string | null>(null);
    return (
      <EventChooser
        services={services}
        {...QUIET_PRINTER}
        selectedKey={selected}
        onSelect={setSelected}
        onBound={onBound}
        {...extra}
      />
    );
  }
  render(<Harness />);
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
  it('only picks it, and arms the button at the foot of the screen', async () => {
    const bindEntry = vi.fn(async () => bindingFor(NURSERY));
    await renderChooser(servicesWith(bindEntry));

    expect(screen.getByText('Pick a gathering')).toBeInTheDocument();

    down(row('Nursery'));
    up(row('Nursery'));

    expect(bindEntry).not.toHaveBeenCalled();
    expect(screen.getByText('Set kiosk')).toBeInTheDocument();
  });

  it('leaves the button one press from the picked gathering', async () => {
    const bindEntry = vi.fn(async () => bindingFor(NURSERY));
    const onBound = await renderChooser(servicesWith(bindEntry));

    down(row('Nursery'));
    up(row('Nursery'));

    await tapButton(screen.getByText('Set kiosk').closest('button')!);
    await tick();

    expect(bindEntry).toHaveBeenCalledWith(NURSERY);
    expect(onBound).toHaveBeenCalledWith(bindingFor(NURSERY));
  });

  /*
   * The button was a hold as well, and this is what a tap on it did then:
   * nothing. Two holds to set one kiosk was the screen asking twice, on the one
   * path where the person has already answered — they picked a row, on a screen
   * headed with the question. The row's hold is the guard that matters, and it
   * is untouched above.
   */
  it('and one press is all it asks for', async () => {
    const bindEntry = vi.fn(async () => bindingFor(NURSERY));
    await renderChooser(servicesWith(bindEntry));

    down(row('Nursery'));
    up(row('Nursery'));

    const button = screen.getByText('Set kiosk').closest('button')!;
    await act(async () => {
      fireEvent.pointerDown(button, { pointerId: 2 });
    });
    // The old gesture's whole length, spent on a button that has already
    // committed: the bind happened on the lift, and waiting adds no second one.
    await tick(HOLD_DELAY_MS + HOLD_MS);
    expect(bindEntry).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.pointerUp(button, { pointerId: 2 });
    });
    await tick();
    expect(bindEntry).toHaveBeenCalledTimes(1);
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
 * The gathering's mark, where a leader gave it one.
 *
 * The interesting half is the row *without* one: the icon began as a reserved
 * column with a spacer holding it open, and the spacer was billed to the meta
 * line — the only line that tells two sittings of one gathering apart. Inside
 * the title it costs a row with no icon exactly nothing.
 */
/**
 * What the button says it is about to do.
 *
 * The row a volunteer picked is at the top of a tablet and the button is at the
 * bottom — half a phone screen away, three quarters of a portrait kiosk — so a
 * button reading only "Set kiosk" names nothing. Where the list holds two
 * sittings of one gathering, that is the whole question.
 */
describe('the commit button', () => {
  it('names the gathering and the time it is about to bind', async () => {
    await renderChooser(servicesWith(vi.fn()));
    // Nothing picked: the button is a prompt and has nothing to name.
    expect(screen.getByText('Pick a gathering')).toBeInTheDocument();

    const picked = row('Youth group');
    down(picked);
    up(picked);
    await tick();

    const button = screen.getByText('Set kiosk').closest('button')!;
    expect(button).toHaveTextContent('Youth group');
    // The time, which is the fact two sittings of one gathering differ by.
    expect(button).toHaveTextContent(/\d{1,2}:\d{2}/);
  });
});

describe('the icon on a row', () => {
  it('draws the gathering’s mark inside its title', async () => {
    const services = {
      listEvents: vi.fn(async () => [{ ...NURSERY, iconPath: 'M480-480h120v-40H480v40Z' }]),
      bindEntry: vi.fn(),
    } as unknown as KioskServices;
    await renderChooser(services);

    // Matched by role rather than by `row()`: the mark and the name's first
    // word are one unbreakable span (see EventName), so the title's element no
    // longer holds the whole string as one text node.
    const marked = screen.getByRole('button', { name: /Nursery/ });
    const glyph = marked.querySelector('svg');
    expect(glyph?.getAttribute('aria-hidden')).toBe('true');
    expect(glyph?.querySelector('path')?.getAttribute('d')).toBe('M480-480h120v-40H480v40Z');
  });

  it('draws nothing at all for a gathering with no icon', async () => {
    await renderChooser(servicesWith(vi.fn()));
    expect(row('Nursery').querySelector('svg')).toBeNull();
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

describe('the gatherings the pairer does not work', () => {
  const services = (events: KioskEventEntry[]) =>
    ({
      listEvents: vi.fn(async () => events),
      bindEntry: vi.fn(async (entry: KioskEventEntry) => bindingFor(entry)),
    }) as unknown as KioskServices;

  it('draws them below a divider, still bindable', async () => {
    const onBound = await renderChooser(
      services([
        { ...NURSERY, yours: true },
        { ...YOUTH, yours: false },
      ]),
    );

    expect(screen.getByText('Not yours')).toBeInTheDocument();
    // The divider sits between the two, not above the first.
    const rows = screen.getAllByText(/Nursery|Youth group/);
    expect(rows.map((row) => row.textContent)).toEqual(['Nursery', 'Youth group']);

    // A kiosk stands in whichever room a leader points it at.
    down(row('Youth group'));
    up(row('Youth group'));
    await tapButton(screen.getByText('Set kiosk').closest('button')!);
    await tick();
    expect(onBound).toHaveBeenCalledWith(expect.objectContaining({ title: 'Youth group' }));
  });

  it('draws no divider on a list that is all one kind, or from a server that does not say', async () => {
    const { unmount } = render(
      <EventChooser
        services={services([
          { ...NURSERY, yours: false },
          { ...YOUTH, yours: false },
        ])}
        {...QUIET_PRINTER}
        onSelect={vi.fn()}
        onBound={vi.fn()}
      />,
    );
    await tick();
    expect(screen.queryByText('Not yours')).not.toBeInTheDocument();
    unmount();

    render(
      <EventChooser
        services={services([NURSERY, YOUTH])}
        {...QUIET_PRINTER}
        onSelect={vi.fn()}
        onBound={vi.fn()}
      />,
    );
    await tick();
    expect(screen.queryByText('Not yours')).not.toBeInTheDocument();
  });
});

/*
 * The printer, in the foot.
 *
 * The screen used to say nothing at all about which gatherings print, and the
 * only way to the printer was a hairline row in the style of the optional
 * install prompt above it — so a volunteer who did exactly what the screen asks
 * (hold a row, set the kiosk) bound a printing gathering with no printer and
 * found out at the first family. These are the facts the strip now puts on the
 * screen before anybody touches anything.
 */
describe('the printer strip', () => {
  /** A gathering that prints, which is what makes the strip appear at all. */
  const PRINTS: KioskEventEntry = {
    ...entry('Kids Club', TEN_AM + HOUR),
    labelTemplate: { lines: [] } as unknown as KioskEventEntry['labelTemplate'],
  };
  const listing = (events: KioskEventEntry[]) =>
    ({
      listEvents: vi.fn(async () => events),
      bindEntry: vi.fn(async (row: KioskEventEntry) => bindingFor(row)),
    }) as unknown as KioskServices;

  it('names the gathering that needs a printer, and offers the press, before any row is touched', async () => {
    /*
     * The hold path binds without ever selecting, so a control that waits for a
     * tap is a control that path never sees — which is how the relevance gate
     * written for the Wednesday volunteer emptied the campaign's own headline
     * frame.
     */
    await renderChooser(listing([PRINTS, YOUTH]));

    expect(screen.getByText('Kids Club prints name tags')).toBeInTheDocument();
    expect(
      screen.getByText('No printer on this kiosk — plug one in, switch it on, then connect it.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect the printer' })).toBeInTheDocument();
  });

  it('says so on the row too, whether or not that gathering is the one picked', async () => {
    await renderChooser(listing([PRINTS, YOUTH]));

    expect(screen.getByText('Prints name tags')).toBeInTheDocument();
  });

  it('drops the buttons for a volunteer whose gathering prints nothing', async () => {
    // A Wednesday on a kiosk in a building where the nursery prints: the
    // sentence is about the row they picked, and Set kiosk keeps its full
    // weight. Nobody here has a printer errand, so nobody is handed one.
    await renderChooser(listing([PRINTS, YOUTH]));

    down(row('Youth group'));
    up(row('Youth group'));

    expect(screen.getByText('Youth group does not print name tags')).toBeInTheDocument();
    expect(screen.getByText('No printer on this kiosk')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect the printer' })).not.toBeInTheDocument();
  });

  it('says what the commit will cost, without taking anything away from it', async () => {
    await renderChooser(listing([PRINTS, YOUTH]));

    down(row('Kids Club'));
    up(row('Kids Club'));

    expect(screen.getByText('name tags won’t print')).toBeInTheDocument();
    // The word, the fill and the place of the commit are untouched: a kiosk
    // with no printer is told, never blocked.
    expect(screen.getByText('Set kiosk')).toBeInTheDocument();
  });

  it('does not accuse a kiosk that has not finished looking for its printer', async () => {
    // The ten seconds of boot retries after a wake. The sentence, the slot and
    // the commit share one predicate — they used to disagree, so the panel said
    // it was still looking over a button asserting the printer needed
    // connecting, and the commit called the morning lost before anybody knew.
    await renderChooser(listing([PRINTS, YOUTH]), vi.fn(), {
      printerConfigured: true,
      printerState: { kind: 'unpaired', searching: true },
    });

    down(row('Kids Club'));
    up(row('Kids Club'));

    expect(screen.getByText(/Looking for the printer/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /One moment/ })).toBeInTheDocument();
    expect(screen.queryByText('name tags won’t print')).not.toBeInTheDocument();
  });

  it('answers a browser list that came back empty, naming the press that recovers it', async () => {
    // Every press changes the screen. This was the one that did not: the
    // browser reports a dismissal and an empty list the same way, so the strip
    // says only what is known and puts the retry before the cable.
    await renderChooser(listing([PRINTS, YOUTH]), vi.fn(), { listCameBackEmpty: true });

    expect(
      screen.getByText(
        /Nothing was picked from the browser’s list. Press Connect the printer and pick the QL/,
      ),
    ).toBeInTheDocument();
  });

  it('wears amber rather than a green tick when the roll had to be guessed', async () => {
    await renderChooser(listing([PRINTS, YOUTH]), vi.fn(), {
      printerConfigured: true,
      printerGuessed: true,
      printerModel: 'QL-810W',
      printerState: { kind: 'ready', config: { model: 'QL-810W', label: '62' } },
    });

    expect(screen.getByText(/the roll had to be guessed/)).toBeInTheDocument();
    expect(screen.queryByText(/Printer connected ·/)).not.toBeInTheDocument();
  });

  it('reports a printing row so the module is in memory before the press', async () => {
    /*
     * `requestDevice` needs transient activation and an `await import` spends
     * it, so the chunk has to be resident before the first press — which, now
     * that the connect is drawn before any tap, could be the first thing that
     * happens on this screen.
     */
    const onPrintingRows = vi.fn();
    await renderChooser(listing([PRINTS, YOUTH]), vi.fn(), { onPrintingRows });

    expect(onPrintingRows).toHaveBeenCalledWith(true);
  });

  it('keeps the door, and only the door, on a day when nothing prints', async () => {
    // The Saturday errand: a volunteer connecting the printer the day before a
    // printing Sunday is on a day whose own list has no printing row.
    await renderChooser(listing([NURSERY, YOUTH]));

    expect(screen.getByRole('button', { name: 'Printer settings' })).toBeInTheDocument();
    expect(screen.queryByText(/prints name tags/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect the printer' })).not.toBeInTheDocument();
  });

  it('holds the picked row across the door to the printer screen', async () => {
    /*
     * The pick lives in `KioskApp` and is named by the gathering rather than by
     * its place in the list, so the round trip through the printer screen — an
     * unmount, a refetch, a re-sort — comes back to the row still ringed. It
     * used to come back to *Pick a gathering*.
     */
    const services = listing([PRINTS, YOUTH]);
    const { unmount } = render(
      <EventChooser
        services={services}
        {...QUIET_PRINTER}
        selectedKey={`${PRINTS.chain}:${PRINTS.startAt}`}
        onSelect={vi.fn()}
        onBound={vi.fn()}
      />,
    );
    await tick();

    expect(screen.getByText('Set kiosk')).toBeInTheDocument();
    expect(screen.getByText('Kids Club prints name tags')).toBeInTheDocument();
    unmount();
  });
});
