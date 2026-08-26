/**
 * Everything the kiosk does with a label printer, and the three rules it keeps.
 *
 * **It never blocks a tick.** `printLabel` returns immediately and cannot
 * throw. `onConfirm` paints the green tick before the check-in write lands, and
 * a sticker is even less of a reason to make a parent wait.
 *
 * **It never tells a parent.** Every printer problem goes into `PrinterState`,
 * which only staff surfaces read. A red line beside a green tick reads as "your
 * check-in failed", and a parent cannot fix a printer anyway.
 *
 * **It keeps the device open.** A paired printer is reopened silently at boot —
 * `getPairedDevices` needs no gesture — and held for the evening. `queryStatus`
 * is never on the way to a label: it costs a round trip and takes the printer's
 * busy lock.
 *
 * The library, the raster worker and the queue are mocked at their boundaries.
 * The queue's own ordering and staleness rules are `queue.test.ts`; what is
 * asserted here is the four callbacks this module hands it, and the sentences
 * it turns a library error code into — because "PrinterStatusError" is not
 * something to put in front of a volunteer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KioskBinding } from '@/kiosk/binding';
import type { KioskStudent } from '@/kiosk/search';
import type { LabelJob, QueueOptions, RasterResult } from '@/kiosk/printing/queue';
import { KIOSK_KEYS } from '@/kiosk/storage';

/* -------------------------------------------------------------------------- */
/* The library                                                                 */
/* -------------------------------------------------------------------------- */

/** Every printer the module has constructed, newest last. */
const cores = vi.hoisted(() => ({ made: [] as ReturnType<typeof Object.assign>[] }));

const usb = vi.hoisted(() => ({
  supported: true,
  /** Devices the origin has already been granted. */
  paired: [] as unknown[],
  /** What `requestPrinterDevice` does when the chooser opens. */
  request: null as null | (() => unknown),
  watchers: null as null | { connect: () => void; disconnect: () => void },
  stopWatching: 0,
}));

/** One printer, with the parts this module actually drives. */
function makeDevice(overrides: Record<string, unknown> = {}) {
  const handlers = new Map<string, () => void>();
  return {
    model: '',
    opened: false,
    on: vi.fn((event: string, handler: () => void) => handlers.set(event, handler)),
    open: vi.fn(async function (this: { opened: boolean }) {
      this.opened = true;
    }),
    close: vi.fn(async function (this: { opened: boolean }) {
      this.opened = false;
    }),
    sendRaw: vi.fn(async () => {}),
    queryStatus: vi.fn(async () => ({ media: '62x29' })),
    /** Fires whatever the module registered with `on`. */
    emit: (event: string) => handlers.get(event)?.(),
    ...overrides,
  };
}

vi.mock('@vrwarp/brother-ql-webusb/printer-core', () => ({
  BrotherQLPrinterCore: class {
    static getPairedDevices = vi.fn(async () => usb.paired);
    constructor(
      readonly device: unknown,
      readonly options: { model: string },
    ) {
      Object.assign(this, makeDevice(), { model: options.model });
      cores.made.push(this);
    }
  },
  isWebUsbSupported: () => usb.supported,
  requestPrinterDevice: async () => {
    if (!usb.request) throw Object.assign(new Error('cancelled'), { code: 'selection-cancelled' });
    return usb.request();
  },
  watchConnectionEvents: (handlers: { connect: () => void; disconnect: () => void }) => {
    usb.watchers = handlers;
    return () => {
      usb.stopWatching += 1;
    };
  },
  suggestLabels: () => [],
}));
vi.mock('@vrwarp/brother-ql-webusb/labels', () => ({
  labelName: (id: string) => id,
  labelsForModel: () => [],
}));
vi.mock('@vrwarp/brother-ql-webusb/models', () => ({ modelIdentifiers: () => [] }));

/* -------------------------------------------------------------------------- */
/* The worker, the queue, the allergy lookup                                   */
/* -------------------------------------------------------------------------- */

const worker = vi.hoisted(() => ({
  posted: [] as unknown[],
  reply: null as null | ((request: { id: number }) => unknown),
  onmessage: null as null | ((event: { data: unknown }) => void),
  started: 0,
}));

vi.mock('@/kiosk/printing/raster.worker?worker', () => ({
  default: class {
    set onmessage(handler: (event: { data: unknown }) => void) {
      worker.onmessage = handler;
    }
    constructor() {
      worker.started += 1;
    }
    postMessage(request: { id: number }) {
      worker.posted.push(request);
      const reply = worker.reply?.(request);
      if (reply) queueMicrotask(() => worker.onmessage?.({ data: reply }));
    }
  },
}));

const queue = vi.hoisted(() => ({
  options: null as unknown as QueueOptions,
  warm: vi.fn(),
  print: vi.fn(),
  forget: vi.fn(),
  printedTonight: vi.fn(() => [] as unknown[]),
  forgetPrinted: vi.fn(),
  depth: vi.fn(() => 0),
  idle: vi.fn(async () => {}),
}));

vi.mock('@/kiosk/printing/queue', () => ({
  createLabelQueue: (options: QueueOptions) => {
    queue.options = options;
    return queue;
  },
}));

const allergy = vi.hoisted(() => ({
  note: undefined as string | undefined,
  started: [] as string[],
  forgotten: [] as string[],
  forgotAll: 0,
}));

vi.mock('@/kiosk/printing/allergy', () => ({
  ALLERGY_UNREAD: 'Allergy',
  setAllergySource: vi.fn(),
  allergyFor: async (studentId: string) => {
    void studentId;
    return allergy.note;
  },
  startAllergyLookup: (student: { id: string }) => allergy.started.push(student.id),
  forgetAllergy: (studentId: string) => allergy.forgotten.push(studentId),
  forgetAllergies: () => {
    allergy.forgotAll += 1;
  },
}));

/* -------------------------------------------------------------------------- */

const TEMPLATE = {
  lines: [
    { text: '{{firstName}}', size: 'lg', bold: true, align: 'center', requiresValue: false },
    { text: '{{allergy}}', size: 'sm', bold: false, align: 'center', requiresValue: true },
  ],
  copies: 1,
} as unknown as NonNullable<KioskBinding['labelTemplate']>;

const ADA: KioskStudent = {
  id: 'pco_1',
  firstName: 'Ada',
  lastName: 'Nkemelu',
  grade: 8,
  searchName: 'ada nkemelu',
  hasAllergies: false,
};

function binding(template = TEMPLATE): KioskBinding {
  return {
    eventId: 'friday-2026-02-13',
    eventTitle: 'Friday Fellowship',
    startAt: new Date(2026, 1, 13, 19, 0).toISOString(),
    labelTemplate: template,
  } as unknown as KioskBinding;
}

/** A fresh module instance, since all of this is module-level state. */
async function load() {
  vi.resetModules();
  return import('@/kiosk/printing');
}

/**
 * The paired-device lookup the *currently loaded* module is holding.
 *
 * `vi.resetModules()` re-runs the mock factory, so the stub a test wants to
 * drive is the one belonging to the instance `load()` just handed back.
 */
async function pairedDevices() {
  const core = await import('@vrwarp/brother-ql-webusb/printer-core');
  return core.BrotherQLPrinterCore.getPairedDevices as unknown as {
    mockRejectedValueOnce: (cause: unknown) => void;
  };
}

async function pairedDevicesCalls(): Promise<unknown[][]> {
  const core = await import('@vrwarp/brother-ql-webusb/printer-core');
  return (core.BrotherQLPrinterCore.getPairedDevices as unknown as { mock: { calls: unknown[][] } })
    .mock.calls;
}

function configured(model = 'QL-810W', label = '62x29') {
  window.localStorage.setItem(KIOSK_KEYS.printer, JSON.stringify({ model, label }));
}

beforeEach(() => {
  window.localStorage.clear();
  usb.supported = true;
  usb.paired = [];
  usb.request = null;
  usb.watchers = null;
  usb.stopWatching = 0;
  cores.made = [];
  worker.posted = [];
  worker.reply = null;
  worker.started = 0;
  allergy.note = undefined;
  allergy.started = [];
  allergy.forgotten = [];
  allergy.forgotAll = 0;
  queue.warm.mockClear();
  queue.print.mockClear();
  queue.forget.mockClear();
  queue.forgetPrinted.mockClear();
  queue.printedTonight.mockReturnValue([]);
  queue.depth.mockReturnValue(0);
  vi.stubGlobal('__E2E_HOOKS__', false);
});

describe('opening the printer at boot', () => {
  it('does nothing at all on a kiosk nobody set up', async () => {
    const printing = await load();

    await expect(printing.ready()).resolves.toEqual({ kind: 'idle' });
    expect(usb.watchers).toBeNull();
  });

  it('says so where the browser cannot talk to USB', async () => {
    // No advice: nobody in a lobby is going to change browser, and the person
    // who can is reading the setup docs rather than this screen.
    configured();
    usb.supported = false;
    const printing = await load();

    await expect(printing.ready()).resolves.toEqual({
      kind: 'unsupported',
      message: 'This browser cannot talk to a USB printer.',
    });
  });

  it('reports an unpaired kiosk without asking for a gesture', async () => {
    configured();
    const printing = await load();

    await expect(printing.ready()).resolves.toEqual({ kind: 'unpaired' });
  });

  it('reopens the printer this kiosk was set up with', async () => {
    const device = makeDevice();
    usb.paired = [device];
    configured('QL-800', '62');
    const printing = await load();

    const state = await printing.ready();

    expect(state).toEqual({ kind: 'ready', config: { model: 'QL-800', label: '62' } });
    expect(device.open).toHaveBeenCalled();
    expect(device.model).toBe('QL-800');
  });

  it('watches for the printer coming back, once', async () => {
    // The library reports connect and disconnect but never retries, and its
    // README lists replugging mid-job as unverified.
    configured();
    usb.paired = [makeDevice()];
    const printing = await load();

    await printing.ready();
    const first = usb.watchers;
    await printing.ready();

    expect(usb.watchers).toBe(first);
  });

  it('reopens on a connect event', async () => {
    configured();
    const printing = await load();
    await printing.ready();
    expect(printing.currentState()).toEqual({ kind: 'unpaired' });

    usb.paired = [makeDevice()];
    usb.watchers?.connect();
    await vi.waitFor(() => expect(printing.currentState().kind).toBe('ready'));
  });

  it('does not claim the interface twice when two connect events land', async () => {
    const device = makeDevice();
    configured();
    const printing = await load();
    await printing.ready();

    usb.paired = [device];
    usb.watchers?.connect();
    usb.watchers?.connect();
    await vi.waitFor(() => expect(printing.currentState().kind).toBe('ready'));

    expect(device.open).toHaveBeenCalledTimes(1);
  });

  it('lets go of the printer when the browser says it is gone', async () => {
    /*
     * The other half of the connect watcher. A handle to a device that is not
     * there answers nothing and takes the busy lock doing it, so the setup
     * screen has to stop asking until a connect event brings one back.
     */
    const device = makeDevice();
    usb.paired = [device];
    configured();
    const printing = await load();
    await printing.ready();
    await expect(printing.readStatus()).resolves.not.toBeNull();

    usb.watchers?.disconnect();

    await expect(printing.readStatus()).resolves.toBeNull();
  });

  it('says the printer was unplugged when the reader loop notices', async () => {
    const device = makeDevice();
    usb.paired = [device];
    configured();
    const printing = await load();
    await printing.ready();

    device.emit('disconnect');

    expect(printing.currentState()).toEqual({
      kind: 'trouble',
      message: 'The printer was unplugged.',
      advice: 'Plug it back in.',
    });
  });

  it('asks for the printer this kiosk was set up with, not for any printer', async () => {
    // The chooser is per-model: a lobby with a label printer and a receipt
    // printer both paired would otherwise reopen whichever the browser
    // happened to list first, and print a sticker to neither.
    usb.paired = [makeDevice()];
    configured('QL-800', '62');
    const printing = await load();

    await printing.ready();

    expect(await pairedDevicesCalls()).toContainEqual([{ model: 'QL-800' }]);
  });

  it('lets go of a transport that has already died before opening another', async () => {
    /*
     * A replug hands back a different device, and the old one is still holding
     * a USB interface this origin can only claim once. Reopening in place is
     * what leaves the kiosk unable to open the printer that is plugged in.
     */
    const first = makeDevice();
    usb.paired = [first];
    configured();
    const printing = await load();
    await printing.ready();

    // The reader loop notices the device go, which drops `opened` without
    // closing the transport.
    first.opened = false;
    const second = makeDevice();
    usb.paired = [second];
    usb.watchers?.connect();

    await vi.waitFor(() => expect(second.open).toHaveBeenCalled());
    expect(first.close).toHaveBeenCalled();
    expect(printing.currentState()).toMatchObject({ kind: 'ready' });
  });

  it('says what went wrong when the reopen itself fails', async () => {
    configured();
    const printing = await load();
    await printing.ready();

    (await pairedDevices()).mockRejectedValueOnce(
      Object.assign(new Error('nope'), { code: 'printer-error', errors: [{ message: 'Lid open' }] }),
    );
    usb.watchers?.connect();

    await vi.waitFor(() =>
      expect(printing.currentState()).toEqual({
        kind: 'trouble',
        message: 'Lid open',
        advice: 'Check the lid, the roll and the cutter.',
      }),
    );
  });

  it('has words of its own for a printer that complained without saying what', async () => {
    configured();
    const printing = await load();
    await printing.ready();

    (await pairedDevices()).mockRejectedValueOnce({ code: 'printer-error' });
    usb.watchers?.connect();

    await vi.waitFor(() =>
      expect(printing.currentState()).toMatchObject({
        kind: 'trouble',
        message: 'The printer reported a problem.',
      }),
    );
  });

  it('survives a failure with nothing on it at all', async () => {
    // `null` is what a transport layer throws often enough, and reading a code
    // off it must not take the lobby screen down with a TypeError.
    configured();
    const printing = await load();
    await printing.ready();

    (await pairedDevices()).mockRejectedValueOnce(null);
    usb.watchers?.connect();

    await vi.waitFor(() => expect(printing.currentState().kind).toBe('trouble'));
    expect(printing.currentState()).toMatchObject({ advice: null });
  });

  it('holds an already-open device rather than reopening it', async () => {
    const device = makeDevice();
    usb.paired = [device];
    configured();
    const printing = await load();
    await printing.ready();

    await printing.ready();

    expect(device.open).toHaveBeenCalledTimes(1);
  });
});

describe('pairing', () => {
  it('remembers what was picked and opens it', async () => {
    usb.request = () => ({ raw: true });
    const printing = await load();

    const state = await printing.pairPrinter({ model: 'QL-810W', label: '62x29' });

    expect(state.kind).toBe('ready');
    expect(JSON.parse(window.localStorage.getItem(KIOSK_KEYS.printer) ?? 'null')).toEqual({
      model: 'QL-810W',
      label: '62x29',
    });
  });

  it('says nothing when the chooser is dismissed', async () => {
    // Not a failure worth colouring the screen for.
    const printing = await load();

    const state = await printing.pairPrinter({ model: 'QL-810W', label: '62x29' });

    expect(state).toEqual({ kind: 'idle' });
    expect(window.localStorage.getItem(KIOSK_KEYS.printer)).toBeNull();
  });

  it('reports anything else the chooser threw', async () => {
    usb.request = () => {
      throw Object.assign(new Error('nope'), { code: 'claim-failed', platformHint: 'Close it.' });
    };
    const printing = await load();

    const state = await printing.pairPrinter({ model: 'QL-810W', label: '62x29' });

    expect(state).toEqual({
      kind: 'trouble',
      message: 'Something else on this device is holding the printer.',
      advice: 'Close it.',
    });
  });
});

describe('changing the media without re-pairing', () => {
  it('stores the new answer and reopens', async () => {
    usb.paired = [makeDevice()];
    configured();
    const printing = await load();
    await printing.ready();

    const state = await printing.configure({ model: 'QL-810W', label: '62' });

    expect(state).toEqual({ kind: 'ready', config: { model: 'QL-810W', label: '62' } });
    expect(JSON.parse(window.localStorage.getItem(KIOSK_KEYS.printer) ?? 'null')).toEqual({
      model: 'QL-810W',
      label: '62',
    });
  });

  it('tells the open printer which model it now is', async () => {
    /*
     * The raster is built for a model — its head width and margins — and the
     * device the reopen finds is the same object it was already holding. A
     * model left at the old value prints the new roll's labels at the old
     * roll's width, which comes out of the printer looking almost right.
     */
    const device = makeDevice();
    usb.paired = [device];
    configured('QL-800', '62');
    const printing = await load();
    await printing.ready();
    expect(device.model).toBe('QL-800');

    await printing.configure({ model: 'QL-810W', label: '62' });

    expect(device.model).toBe('QL-810W');
  });

  it('changes nothing about a printer there is not one of', async () => {
    // Nothing paired: the config is stored for the next boot and the state
    // still says so, rather than throwing on the way to saying it.
    configured();
    const printing = await load();
    await printing.ready();

    const state = await printing.configure({ model: 'QL-810W', label: '62' });

    expect(state).toEqual({ kind: 'unpaired' });
  });
});

describe('reading the status', () => {
  it('has nothing to say with no printer open', async () => {
    const printing = await load();

    await expect(printing.readStatus()).resolves.toBeNull();
  });

  it('has nothing to say for a printer that is there but shut', async () => {
    // Open is the part that matters: a device the origin is paired with but
    // has not claimed answers nothing, and asking it would throw on the setup
    // screen rather than showing the media it is waiting to be told about.
    const device = makeDevice();
    usb.paired = [device];
    configured();
    const printing = await load();
    await printing.ready();
    device.opened = false;

    await expect(printing.readStatus()).resolves.toBeNull();
    expect(device.queryStatus).not.toHaveBeenCalled();
  });

  it('asks the printer what it has loaded', async () => {
    const device = makeDevice();
    usb.paired = [device];
    configured();
    const printing = await load();
    await printing.ready();

    await expect(printing.readStatus()).resolves.toEqual({ media: '62x29' });
  });

  it('turns a failed read into trouble rather than throwing', async () => {
    const device = makeDevice({
      queryStatus: vi.fn(async () => {
        throw Object.assign(new Error('timed out'), { code: 'status-timeout' });
      }),
    });
    usb.paired = [device];
    configured();
    const printing = await load();
    await printing.ready();

    await expect(printing.readStatus()).resolves.toBeNull();
    expect(printing.currentState()).toEqual({
      kind: 'trouble',
      message: 'The printer stopped responding.',
      advice: 'Turn it off and on again.',
    });
  });
});

describe('what a screen is told when something is wrong', () => {
  async function troubleFrom(error: unknown) {
    usb.request = () => {
      throw error;
    };
    const printing = await load();
    await printing.pairPrinter({ model: 'QL-810W', label: '62x29' });
    return printing.currentState();
  }

  it('repeats the printer’s own first complaint', async () => {
    expect(
      await troubleFrom({ code: 'printer-error', errors: [{ message: 'The lid is open.' }] }),
    ).toEqual({
      kind: 'trouble',
      message: 'The lid is open.',
      advice: 'Check the lid, the roll and the cutter.',
    });
  });

  it('has words of its own when the printer complained without saying what', async () => {
    expect(await troubleFrom({ code: 'printer-error', errors: [] })).toMatchObject({
      message: 'The printer reported a problem.',
    });
  });

  it('names each failure a volunteer can act on', async () => {
    expect(await troubleFrom({ code: 'disconnected' })).toMatchObject({
      message: 'The printer was unplugged.',
      advice: 'Plug it back in.',
    });
    expect(await troubleFrom({ code: 'editor-lite' })).toMatchObject({
      message: 'The printer is in Editor Lite mode.',
      advice: 'Hold the Editor Lite button until its light goes out.',
    });
    expect(await troubleFrom({ code: 'transfer-timeout' })).toMatchObject({
      message: 'The printer stopped responding.',
    });
    expect(await troubleFrom({ code: 'raster' })).toMatchObject({
      message: 'This label does not fit the media the kiosk is set to.',
      advice: 'Check the label size on this screen.',
    });
  });

  it('says a kiosk is set up for a printer it cannot find', async () => {
    for (const code of ['unknown-model', 'unknown-label']) {
      expect(await troubleFrom({ code })).toEqual({
        kind: 'trouble',
        message: 'This kiosk is set up for a printer it cannot find.',
        advice: null,
      });
    }
  });

  it('falls through to what an unrecognised failure said', async () => {
    // An unknown failure that says nothing is worse than one that says too
    // much.
    expect(await troubleFrom(new Error('USB stall'))).toMatchObject({ message: 'USB stall' });
  });

  it('has a sentence for a failure with nothing to say at all', async () => {
    expect(await troubleFrom({ code: 'something-new' })).toMatchObject({
      message: 'The label did not print.',
      advice: null,
    });
  });
});

describe('who is listening', () => {
  it('hands a new subscriber the state as it stands', async () => {
    // The printer screen mounts long after boot, and a screen that had to wait
    // for the next change would open blank.
    const printing = await load();
    const seen: string[] = [];

    printing.subscribe((state) => seen.push(state.kind));

    expect(seen).toEqual(['idle']);
  });

  it('tells a subscriber about every change and stops when asked', async () => {
    const printing = await load();
    const seen: string[] = [];
    const stop = printing.subscribe((state) => seen.push(state.kind));

    configured();
    await printing.ready();
    stop();
    usb.supported = false;
    await printing.ready();

    // The state at subscribe, then the one change before it stopped listening.
    expect(seen).toEqual(['idle', 'unpaired']);
  });
});

describe('the jobs this module hands the queue', () => {
  it('warms a label as the confirm screen opens', async () => {
    const printing = await load();

    printing.warmLabel(ADA, binding());

    expect(queue.warm).toHaveBeenCalledTimes(1);
    expect((queue.warm.mock.calls[0]?.[0] as LabelJob).studentId).toBe('pco_1');
    // The roster's display name, not the sticker's: a volunteer looking for the
    // label that did not come out is looking for the child they can see.
    expect((queue.warm.mock.calls[0]?.[0] as LabelJob).name).toBe('Ada Nkemelu');
  });

  it('keeps the sticker name as the roster spells it, without a trailing space', async () => {
    const printing = await load();

    printing.warmLabel({ ...ADA, lastName: '' }, binding());

    // A child with no surname on file. `Ada ` on the printer screen's log
    // reads as a name that lost something.
    expect((queue.warm.mock.calls[0]?.[0] as LabelJob).name).toBe('Ada');
  });

  it('starts the allergy lookup before the raster that waits on it', async () => {
    const printing = await load();

    printing.warmLabel(ADA, binding());

    expect(allergy.started).toEqual(['pco_1']);
  });

  it('warms nothing for a gathering with no template', async () => {
    const printing = await load();

    printing.warmLabel(ADA, binding(null as never));

    expect(queue.warm).not.toHaveBeenCalled();
    expect(allergy.started).toEqual([]);
  });

  it('prints, and starts the lookup again because the printer screen gets here too', async () => {
    const printing = await load();

    printing.printLabel(ADA, binding());

    expect(queue.print).toHaveBeenCalledTimes(1);
    expect(allergy.started).toEqual(['pco_1']);
  });

  it('prints nothing for a gathering with no template', async () => {
    const printing = await load();

    printing.printLabel(ADA, binding(null as never));

    expect(queue.print).not.toHaveBeenCalled();
  });

  it('is the same path for a reprint', async () => {
    // Deliberately not the old `reprintLast`, which re-sent whatever came out
    // most recently: re-rastering can be aimed, and prints what the label
    // should say *now*.
    const printing = await load();

    printing.reprintLabel(ADA, binding());

    expect(queue.print).toHaveBeenCalledTimes(1);
  });

  it('drops the note with the label when a confirm is backed out of', async () => {
    const printing = await load();

    printing.forgetLabel('pco_1');

    expect(queue.forget).toHaveBeenCalledWith('pco_1');
    expect(allergy.forgotten).toEqual(['pco_1']);
  });

  it('keeps nothing about a gathering it has left', async () => {
    // A list of children's names, held in memory on a device that sits in a
    // lobby for weeks.
    const printing = await load();

    printing.forgetGathering();

    expect(allergy.forgotAll).toBe(1);
    expect(queue.forgetPrinted).toHaveBeenCalled();
  });

  it('hands the printer screen the evening’s attempts and the depth', async () => {
    const printing = await load();
    queue.printedTonight.mockReturnValue([{ id: 'p1' }]);
    queue.depth.mockReturnValue(3);

    expect(printing.printedTonight()).toEqual([{ id: 'p1' }]);
    expect(printing.queueDepth()).toBe(3);
  });

  it('test-prints through the real path, with the media on the label', async () => {
    // A successful test print proves the whole chain rather than just that the
    // device answers.
    configured('QL-800', '62');
    usb.paired = [makeDevice()];
    const printing = await load();
    await printing.ready();

    printing.testPrint();

    const job = queue.print.mock.calls.at(-1)?.[0] as LabelJob;
    expect(job.values.eventTitle).toBe('QL-800 · 62');
    expect(job.studentId).toMatch(/^__test__/);

    // The label itself, whole: three centred lines, the first one large and
    // bold, and none of them required — a test print has to come out of a
    // printer whose media is wrong, which is when somebody presses it.
    expect(job.template).toEqual({
      lines: [
        { text: 'Tally', size: 'lg', bold: true, align: 'center', requiresValue: false },
        { text: '{{eventTitle}}', size: 'sm', bold: false, align: 'center', requiresValue: false },
        { text: '{{time}}', size: 'sm', bold: false, align: 'center', requiresValue: false },
      ],
      copies: 1,
    });
    // A wall-clock time a volunteer can read off the sticker and match against
    // the screen, rather than the seconds-and-timezone form `toLocaleTimeString`
    // gives when nobody says otherwise.
    expect(job.values.time).toMatch(/^\d{1,2}:\d{2}(\s|\u202f)?([AP]M)?$/i);
  });

  it('test-prints nothing on a kiosk with no printer configured', async () => {
    const printing = await load();

    printing.testPrint();

    expect(queue.print).not.toHaveBeenCalled();
  });
});

describe('rastering', () => {
  it('refuses before a printer is configured', async () => {
    await load();

    await expect(
      queue.options.raster({ studentId: 'pco_1', name: 'Ada', template: TEMPLATE, values: {} }),
    ).rejects.toThrow('No printer is configured.');
  });

  it('sends the job to the worker with the configured media', async () => {
    configured('QL-800', '62');
    usb.paired = [makeDevice()];
    const printing = await load();
    await printing.ready();
    worker.reply = (request) => ({ id: request.id, ok: true, job: new Uint8Array(4), pageCount: 1 });

    const result = (await queue.options.raster({
      studentId: 'pco_1',
      name: 'Ada',
      template: TEMPLATE,
      values: { firstName: 'Ada' },
    })) as RasterResult;

    expect(result.pageCount).toBe(1);
    expect(worker.posted[0]).toMatchObject({ model: 'QL-800', label: '62' });
  });

  it('starts the worker once and keeps it', async () => {
    // Lazily, so a kiosk whose printer has been unplugged for a month is not
    // also running a thread for it — and then kept, so the startup cost lands
    // on the first label of the evening rather than every one.
    configured();
    usb.paired = [makeDevice()];
    const printing = await load();
    await printing.ready();
    worker.reply = (request) => ({ id: request.id, ok: true, job: new Uint8Array(1), pageCount: 1 });

    const job = { studentId: 'pco_1', name: 'Ada', template: TEMPLATE, values: {} };
    await queue.options.raster(job);
    await queue.options.raster(job);

    expect(worker.started).toBe(1);
    expect(worker.posted).toHaveLength(2);
  });

  it('folds the allergy note in when there is one', async () => {
    configured();
    usb.paired = [makeDevice()];
    const printing = await load();
    await printing.ready();
    allergy.note = 'Peanuts';
    worker.reply = (request) => ({ id: request.id, ok: true, job: new Uint8Array(1), pageCount: 1 });

    await queue.options.raster({
      studentId: 'pco_1',
      name: 'Ada',
      template: TEMPLATE,
      values: { firstName: 'Ada' },
    });

    expect((worker.posted[0] as { values: Record<string, string> }).values).toEqual({
      firstName: 'Ada',
      allergy: 'Peanuts',
    });
  });

  it('leaves the values alone when there is no note to fold in', async () => {
    configured();
    usb.paired = [makeDevice()];
    const printing = await load();
    await printing.ready();
    worker.reply = (request) => ({ id: request.id, ok: true, job: new Uint8Array(1), pageCount: 1 });

    await queue.options.raster({
      studentId: 'pco_1',
      name: 'Ada',
      template: TEMPLATE,
      values: { firstName: 'Ada' },
    });

    // `toStrictEqual`, because `toEqual` reads an `allergy: undefined` key as
    // no key at all — and the whole point is that the job is handed on
    // untouched when there is nothing to fold into it.
    expect((worker.posted[0] as { values: Record<string, string> }).values).toStrictEqual({
      firstName: 'Ada',
    });
  });

  it('rejects with what the worker said went wrong', async () => {
    configured();
    usb.paired = [makeDevice()];
    const printing = await load();
    await printing.ready();
    worker.reply = (request) => ({ id: request.id, ok: false, message: 'too wide for 62mm' });

    await expect(
      queue.options.raster({ studentId: 'pco_1', name: 'Ada', template: TEMPLATE, values: {} }),
    ).rejects.toThrow('too wide for 62mm');
  });

  it('ignores a reply for a request nobody is waiting on', async () => {
    configured();
    usb.paired = [makeDevice()];
    const printing = await load();
    await printing.ready();
    worker.reply = (request) => ({ id: request.id, ok: true, job: new Uint8Array(1), pageCount: 1 });
    await queue.options.raster({ studentId: 'pco_1', name: 'Ada', template: TEMPLATE, values: {} });

    expect(() => worker.onmessage?.({ data: { id: 9999, ok: true } })).not.toThrow();
  });
});

describe('sending', () => {
  const result = { job: new Uint8Array(8), pageCount: 1 };

  it('writes the bytes to the printer', async () => {
    const device = makeDevice();
    usb.paired = [device];
    configured();
    const printing = await load();
    await printing.ready();

    await queue.options.send(result);

    expect(device.sendRaw).toHaveBeenCalledWith(result.job, { pageCount: 1 });
  });

  describe('when the end-to-end suite is watching', () => {
    /*
     * There is no way to give Playwright a USB printer, so the transport is
     * the one thing the end-to-end suite cannot exercise — and a label written
     * to a device that is not there is the failure it most wants to catch. The
     * seam is opt-in from the spec side and inside `__E2E_HOOKS__`, so it is
     * eliminated from anything a church deploys.
     */
    afterEach(() => {
      delete (window as unknown as Record<string, unknown>).__tallyKioskLabels;
    });

    it('records the label instead of writing it to the wire', async () => {
      vi.stubGlobal('__E2E_HOOKS__', true);
      (window as unknown as Record<string, unknown>).__tallyKioskLabels = [];
      const device = makeDevice();
      usb.paired = [device];
      configured();
      const printing = await load();
      await printing.ready();

      await queue.options.send(result);

      expect((window as unknown as Record<string, unknown>).__tallyKioskLabels).toEqual([
        { bytes: 8, pageCount: 1 },
      ]);
      expect(device.sendRaw).not.toHaveBeenCalled();
    });

    it('writes to the wire when no spec asked for the labels', async () => {
      // Opt-in: the array only exists if a spec created it. A build with the
      // hooks compiled in but nobody watching still prints.
      vi.stubGlobal('__E2E_HOOKS__', true);
      const device = makeDevice();
      usb.paired = [device];
      configured();
      const printing = await load();
      await printing.ready();

      await queue.options.send(result);

      expect(device.sendRaw).toHaveBeenCalled();
    });

    it('writes to the wire in a build that shipped, whatever is on the window', async () => {
      (window as unknown as Record<string, unknown>).__tallyKioskLabels = [];
      const device = makeDevice();
      usb.paired = [device];
      configured();
      const printing = await load();
      await printing.ready();

      await queue.options.send(result);

      expect((window as unknown as Record<string, unknown>).__tallyKioskLabels).toEqual([]);
      expect(device.sendRaw).toHaveBeenCalled();
    });
  });

  it('reopens a printer that went down rather than failing the label', async () => {
    // The device may have been replugged without a connect event landing.
    configured();
    const printing = await load();
    await printing.ready();
    expect(printing.currentState().kind).toBe('unpaired');

    const device = makeDevice();
    usb.paired = [device];
    await queue.options.send(result);

    expect(device.sendRaw).toHaveBeenCalled();
  });

  it('refuses when there is still no printer after reopening', async () => {
    configured();
    const printing = await load();
    await printing.ready();

    await expect(queue.options.send(result)).rejects.toThrow('No printer is connected.');
  });

  it('does not reopen a printer that is already open', async () => {
    const device = makeDevice();
    usb.paired = [device];
    configured();
    const printing = await load();
    await printing.ready();
    const { BrotherQLPrinterCore } = (await import(
      '@vrwarp/brother-ql-webusb/printer-core'
    )) as unknown as { BrotherQLPrinterCore: { getPairedDevices: { mock: { calls: unknown[] } } } };
    const asked = BrotherQLPrinterCore.getPairedDevices.mock.calls.length;

    await queue.options.send(result);

    // Reopening is the recovery for a device replugged without a connect
    // event. Doing it per label is a USB round trip on every sticker.
    expect(BrotherQLPrinterCore.getPairedDevices.mock.calls.length).toBe(asked);
  });

  it('does not republish "ready" for a label that went out of a working printer', async () => {
    const device = makeDevice();
    usb.paired = [device];
    configured();
    const printing = await load();
    await printing.ready();
    const seen: string[] = [];
    printing.subscribe((state) => seen.push(state.kind));

    await queue.options.send(result);
    await queue.options.send(result);

    // The printer screen redraws on every one of these, and an evening is
    // hundreds of labels.
    expect(seen).toEqual(['ready']);
  });

  it('takes the trouble state down once a label goes out', async () => {
    const device = makeDevice();
    usb.paired = [device];
    configured();
    const printing = await load();
    await printing.ready();
    device.emit('disconnect');
    expect(printing.currentState().kind).toBe('trouble');

    await queue.options.send(result);

    expect(printing.currentState()).toEqual({
      kind: 'ready',
      config: { model: 'QL-810W', label: '62x29' },
    });
  });
});

describe('the queue’s two ways of not printing', () => {
  it('turns a failure into a sentence for the staff screen', async () => {
    const printing = await load();

    queue.options.onFailure?.(
      { code: 'printer-error', errors: [{ message: 'Out of labels.' }] },
      { studentId: 'pco_1', name: 'Ada', template: TEMPLATE, values: {} },
    );

    expect(printing.currentState()).toMatchObject({
      kind: 'trouble',
      message: 'Out of labels.',
    });
  });

  it('says when a label was skipped for being too late', async () => {
    const printing = await load();

    queue.options.onDropped?.('stale', {
      studentId: 'pco_1',
      name: 'Ada',
      template: TEMPLATE,
      values: {},
    });

    expect(printing.currentState()).toEqual({
      kind: 'trouble',
      message: 'A label was skipped because it would have printed too late.',
      advice: 'Check the printer.',
    });
  });

  it('says nothing about a label dropped for queue overflow', async () => {
    // Overflow is the queue working: eight labels deep means the printer is
    // behind, which the depth on the printer screen already says.
    const printing = await load();

    queue.options.onDropped?.('overflow', {
      studentId: 'pco_1',
      name: 'Ada',
      template: TEMPLATE,
      values: {},
    });

    expect(printing.currentState()).toEqual({ kind: 'idle' });
  });
});

describe('labelPreview', () => {
  it('shows the words the sticker will carry', async () => {
    const printing = await load();

    expect(printing.labelPreview(ADA, binding())).toEqual(['Ada']);
  });

  it('drops the lines that come to nothing, exactly as the renderer does', async () => {
    // The preview cannot promise a line the label will not have.
    const printing = await load();

    const lines = printing.labelPreview({ ...ADA, hasAllergies: false }, binding());

    expect(lines).not.toContain('');
  });

  it('has nothing to show for a gathering with no template', async () => {
    const printing = await load();

    expect(printing.labelPreview(ADA, binding(null as never))).toEqual([]);
  });
});
