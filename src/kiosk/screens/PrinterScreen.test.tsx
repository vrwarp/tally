/**
 * Setting a kiosk up by connecting a printer rather than by answering a list.
 *
 * The screen used to open with two selects and a **Check the printer** button
 * that offered chips somebody could ignore. Both selects defaulted to the last
 * kiosk's answer, and getting either wrong is a badge that comes out at the
 * wrong size or does not come out at all — on a Sunday, in front of a queue,
 * for a volunteer who has no way to know which of the two was wrong.
 *
 * So connecting asks the printer. What these pin is the half that is not the
 * asking: that the screen adopts what came back rather than what it was
 * showing, and that it *says* when an answer was a guess — an ambiguous roll
 * silently chosen is exactly the wrong-roll Sunday the detection was supposed
 * to prevent.
 */
import { act, fireEvent, render, screen } from '@/test/rtl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrinterScreen } from '@/kiosk/screens/PrinterScreen';
import type { KioskPrinting } from '@/kiosk/KioskApp';
import type { Label, PrinterDetection, PrinterLogEntry, PrinterStatus } from '@/kiosk/printing';
import { describeAge, describeEntry } from '@/kiosk/printing/log';

/**
 * A label, as far as this screen reads one: something to identify and a name to
 * put on a chip. The tables themselves are `detect.test.ts`.
 */
function label(identifier: string, name: string): Label {
  return { identifier, name } as unknown as Label;
}

const PLAIN_NAME = '62mm endless';
const RED_NAME = '62mm endless (black/red/white)';
const BADGE_NAME = '62mm x 29mm die-cut';
const PLAIN_62 = label('62', PLAIN_NAME);
const RED_62 = label('62red', RED_NAME);
const BADGE = label('62x29', BADGE_NAME);

/** A status packet, as far as this screen reads one. */
function status(overrides: Record<string, unknown> = {}): PrinterStatus {
  return {
    mediaWidthMm: 62,
    mediaType: 'continuous',
    errors: [] as { byte: number; bit: number; message: string }[],
    ...overrides,
  } as unknown as PrinterStatus;
}

function detection(overrides: Partial<PrinterDetection> = {}): PrinterDetection {
  return {
    config: { model: 'QL-810W', label: '62x29' },
    modelFromPrinter: true,
    matched: [BADGE],
    status: status({ mediaType: 'die-cut' }),
    ...overrides,
  };
}

/**
 * The printing handle, with the two doors onto the printer scripted.
 *
 * The real one is a rasteriser, a worker and a WebUSB device; this screen wants
 * a list of models, a list of media, a state, and an answer from whichever
 * button was pressed.
 */
function handleWith(found: PrinterDetection | null, events: PrinterLogEntry[] = []) {
  const printing = {
    modelIdentifiers: () => ['QL-810W', 'QL-800'],
    labelsForModel: () => [PLAIN_62, RED_62, BADGE],
    labelName: (entry?: { name?: string }) => entry?.name ?? '',
    subscribe: () => () => {},
    currentState: () => ({ kind: 'ready' as const, config: { model: 'QL-810W', label: '62x29' } }),
    configure: vi.fn(async () => {}),
    pairPrinter: vi.fn(async () => found),
    checkPrinter: vi.fn(async () => found),
    testPrint: vi.fn(),
    printerLog: () => events,
    printerLogText: () => 'the whole record',
    describeAge,
    describeEntry,
  };
  return printing as unknown as KioskPrinting & typeof printing;
}

function mount(printing: KioskPrinting, config = { model: 'QL-800', label: '62' }) {
  render(
    <PrinterScreen
      printing={printing}
      config={config}
      printedTonight={[]}
      onReprint={vi.fn()}
      onDone={vi.fn()}
    />,
  );
}

/**
 * A real tap: down and up on the same control, as a finger makes it.
 *
 * At the origin because `useTap` asks whether the lift landed inside the
 * control's box, and jsdom lays nothing out — every `getBoundingClientRect` is
 * a zero-sized box at 0,0, so 0,0 is the only point inside one.
 */
async function press(name: RegExp): Promise<void> {
  const button = screen.getByRole('button', { name });
  await act(async () => {
    fireEvent.pointerDown(button, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 0, clientY: 0 });
  });
}

/** The same, for a control found by its words rather than its role. */
async function pressText(text: string): Promise<void> {
  const button = screen.getByText(text, { selector: 'button' });
  await act(async () => {
    fireEvent.pointerDown(button, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 0, clientY: 0 });
  });
}

describe('connecting a printer', () => {
  it('asks the printer what it is, rather than taking what the screen showed', async () => {
    const printing = handleWith(detection());
    mount(printing);

    await press(/Connect a printer|Choose a different printer/);

    // The screen was set up as a QL-800 with 62mm tape, which is what the
    // selects would have sent. What the printer said is what the kiosk is now.
    expect(printing.pairPrinter).toHaveBeenCalledWith({ model: 'QL-800', label: '62' });
    expect(screen.getByLabelText('Printer model')).toHaveValue('QL-810W');
    expect(screen.getByLabelText('Loaded label')).toHaveValue('62x29');
  });

  it('says what it read, so somebody can see it is right', async () => {
    mount(handleWith(detection()));

    await press(/Connect a printer|Choose a different printer/);

    expect(
      screen.getByText(/Read off the printer: QL-810W, 62mm x 29mm die-cut/),
    ).toBeInTheDocument();
  });

  it('says so when the roll had to be guessed, and offers the other one', async () => {
    /*
     * 62mm tape is both `62` and `62red` and the packet cannot see the
     * difference. Choosing silently is how a church with the black/red roll
     * finds out on a Sunday; this is the sentence that stops that.
     */
    const printing = handleWith(
      detection({
        config: { model: 'QL-810W', label: '62' },
        matched: [PLAIN_62, RED_62],
        status: status(),
      }),
    );
    mount(printing);

    await press(/Connect a printer|Choose a different printer/);

    expect(
      screen.getByText(/62mm continuous is loaded, which is more than one roll/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Set to 62mm endless/)).toBeInTheDocument();

    // And the other one is one press away, not a select somebody has to open.
    await pressText(RED_NAME);
    expect(printing.configure).toHaveBeenCalledWith({ model: 'QL-810W', label: '62red' });
    expect(screen.getByText(/Set to 62mm endless \(black\/red\/white\)/)).toBeInTheDocument();
  });

  it('says so when the printer would not name itself', async () => {
    // The list is still somebody's to answer, and they have to be told that.
    mount(handleWith(detection({ modelFromPrinter: false })));

    await press(/Connect a printer|Choose a different printer/);

    expect(
      screen.getByText(/did not say which model it is — check that QL-810W is right/),
    ).toBeInTheDocument();
  });

  it('says so when the roll is one no printer here takes', async () => {
    mount(handleWith(detection({ matched: [], status: status({ mediaWidthMm: 38 }) })));

    await press(/Connect a printer|Choose a different printer/);

    expect(
      screen.getByText(/38mm continuous is loaded, and no roll this printer takes is that size/),
    ).toBeInTheDocument();
  });

  it('leaves the screen as it was when the chooser was dismissed', async () => {
    // Nothing was connected, so nothing is claimed about what is connected.
    mount(handleWith(null));

    await press(/Connect a printer|Choose a different printer/);

    expect(screen.getByLabelText('Printer model')).toHaveValue('QL-800');
    expect(screen.queryByText(/Read off the printer:/)).not.toBeInTheDocument();
  });
});

describe('checking a printer that is already connected', () => {
  it('goes down the same path, which is what a changed roll needs', async () => {
    const printing = handleWith(
      detection({
        config: { model: 'QL-810W', label: '62' },
        matched: [PLAIN_62],
        status: status(),
      }),
    );
    mount(printing);

    await press(/Check the printer/);

    expect(printing.checkPrinter).toHaveBeenCalled();
    expect(screen.getByLabelText('Loaded label')).toHaveValue('62');
  });

  it('repeats whatever the printer is complaining about', async () => {
    mount(
      handleWith(
        detection({
          status: status({
            mediaType: 'die-cut',
            errors: [{ byte: 1, bit: 0, message: 'The cover is open.' }],
          }),
        }),
      ),
    );

    await press(/Check the printer/);

    expect(screen.getByText('The cover is open.')).toBeInTheDocument();
  });
});

describe('a press this screen never received', () => {
  /*
   * The staff screen's rows act on `pointerup`, so the *click* that finishes
   * the same tap is dispatched after this screen has already mounted under the
   * finger — and both screens centre their column, which put the unbind within
   * a few pixels of the `Label printer` row at every viewport the kiosk runs
   * at. On a bare `onClick` that opened the browser's device chooser every
   * single time somebody looked at a printer that was already connected.
   *
   * jsdom cannot stage the swap — it does not hit-test a click against the DOM
   * that replaced the one the press landed on — so what is pinned here is the
   * property that makes the swap harmless: a click with no press of its own on
   * the control is not an act. Every control on this screen has to hold it,
   * which is why they are all guarded rather than only the one that was caught.
   */
  it('does not open the chooser for a click with no press behind it', async () => {
    const printing = handleWith(detection());
    mount(printing);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Choose a different printer/ }));
    });

    expect(printing.pairPrinter).not.toHaveBeenCalled();
  });

  it('does not read the printer, print, or change the roll for one either', async () => {
    const printing = handleWith(
      detection({ config: { model: 'QL-810W', label: '62' }, matched: [PLAIN_62, RED_62] }),
    );
    mount(printing);
    // Open the fold so the chips are reachable, then click without pressing.
    await press(/Connect a printer|Choose a different printer/);
    printing.pairPrinter.mockClear();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Check the printer/ }));
      fireEvent.click(screen.getByRole('button', { name: /Print a test label/ }));
      fireEvent.click(screen.getByText(RED_NAME, { selector: 'button' }));
    });

    expect(printing.checkPrinter).not.toHaveBeenCalled();
    expect(printing.testPrint).not.toHaveBeenCalled();
    expect(printing.configure).not.toHaveBeenCalled();
  });
});

describe('what has happened to the printer', () => {
  /*
   * The record is the module's; this screen is the one place it is read. What
   * is pinned is that it reads newest first in words a volunteer can take in,
   * and that the whole of it can leave the tablet — on the clipboard where
   * there is one, and as selectable text where there is not.
   */
  const now = Date.now();
  const events: PrinterLogEntry[] = [
    { t: now - 120_000, category: 'usb', name: 'disconnect', data: { ours: true } },
    {
      t: now - 5_000,
      category: 'transport',
      name: 'open',
      data: { interfaceNumber: 0 },
    },
  ];

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('lists recent events, newest first, with how long ago', () => {
    mount(handleWith(detection(), events));

    const rows = screen.getAllByText(/ago|just now/).map((node) => node.textContent);
    expect(rows).toEqual(['just now', '2 min ago']);
    expect(screen.getByText('transport open interfaceNumber=0')).toBeInTheDocument();
    expect(screen.getByText('usb disconnect ours=true')).toBeInTheDocument();
  });

  it('says so when nothing has been written down yet', () => {
    mount(handleWith(detection()));

    expect(screen.getByText('Nothing has been written down yet.')).toBeInTheDocument();
  });

  it('puts the whole record on the clipboard with one press', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mount(handleWith(detection(), events));

    await press(/^Copy$/);

    expect(writeText).toHaveBeenCalledWith('the whole record');
    expect(screen.getByRole('button', { name: /^Copied$/ })).toBeInTheDocument();
  });

  it('shows the text to select by hand where copying is blocked', async () => {
    mount(handleWith(detection(), events));

    await press(/^Copy$/);

    expect(screen.getByText(/Copying is blocked on this device/)).toBeInTheDocument();
    expect(screen.getByLabelText('Printer events')).toHaveValue('the whole record');
  });
});
