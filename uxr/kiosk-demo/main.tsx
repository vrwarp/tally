/**
 * The kiosk's set-up screens, driveable.
 *
 * `uxr/kiosk-live` photographs one state per query string and never presses
 * anything. This mounts the same two components with a *stateful* stand-in for
 * the printing module, so a reader can walk the whole errand — tap the
 * gathering, press connect, pick the QL out of a device list, print a test
 * label, come back, set the kiosk — on the real screens, with the real props.
 *
 * The transport is the only fake. `EventChooser` and `PrinterScreen` are
 * imported from `src/` unmodified, and the shell around them holds exactly what
 * `KioskApp` holds for them: the config, the state, the picked row, and whether
 * the last device list came back empty.
 *
 * The browser's own chooser cannot be shown in a published page — it needs a
 * user gesture against real USB — so a stand-in sheet takes its place, with the
 * two ways out that matter: pick the QL, or dismiss it. Dismissing is the whole
 * reason the strip has an account to give.
 *
 * Driven from the page around it by `postMessage`, because the two documents
 * exist so the kiosk's Tailwind preflight stays inside this one.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './demo.css';
import { KioskIntlProvider } from '@/kiosk/KioskIntlProvider';
import { EventChooser } from '@/kiosk/screens/EventChooser';
import { PrinterScreen } from '@/kiosk/screens/PrinterScreen';
import type { KioskEventEntry, KioskPrinting, KioskServices } from '@/kiosk/KioskApp';
import type { PrinterConfig, PrinterDetection, PrinterState, PrintedLabel } from '@/kiosk/printing';
import { labelName, labelsForModel } from '@vrwarp/brother-ql-webusb/labels';
import { modelIdentifiers } from '@vrwarp/brother-ql-webusb/models';
import { describeAge, describeEntry } from '@/kiosk/printing/log';
import { DEFAULT_LABEL_TEMPLATE } from '@/lib/labelTemplate';

/* ---- The church ------------------------------------------------------- */

const NOW = Date.now();
const MIN = 60_000;

/**
 * Today, on a shelf tablet.
 *
 * Three gatherings, two of which print — which is the list this whole campaign
 * is about: the volunteer is here for one of them, and nothing on the screen
 * used to say which needed a printer. Sunday Kids has already ended and stays
 * on the list on purpose, so a kiosk rebooting mid-pickup can find it again.
 */
const ROWS: { title: string; icon: string; inMin: number; runs: number; room: string; prints: boolean }[] = [
  { title: 'Sunday Kids', icon: 'church', inMin: -330, runs: 90, room: 'Hall', prints: true },
  { title: 'Wednesday Night', icon: 'groups', inMin: -40, runs: 90, room: 'Youth room', prints: false },
  { title: 'Kids Club', icon: 'child_care', inMin: 50, runs: 120, room: 'Hall', prints: true },
];

function entries(printingDay: boolean): KioskEventEntry[] {
  return ROWS.map((row, index) => {
    const startAt = NOW + row.inMin * MIN;
    const endAt = startAt + row.runs * MIN;
    return {
      chain: `chain-${index}`,
      predictsFrom: `chain-${index}`,
      id: `event-${index}`,
      title: row.title,
      startAt,
      endAt,
      checkInOpensAt: startAt - 30 * MIN,
      checkInClosesAt: endAt + 90 * MIN,
      seriesId: null,
      location: row.room,
      requiresCheckOut: false,
      labelTemplate: printingDay && row.prints ? DEFAULT_LABEL_TEMPLATE : null,
      allergiesSupported: true,
      iconPath: findIcon(row.icon),
      yours: true,
    } as unknown as KioskEventEntry;
  });
}

/* The icon catalogue is handed to the kiosk as answers, not code — and a demo
   that could not draw the marks would be arguing about a row that is not the
   row. Resolved lazily so a missing glyph costs a mark, never the page. */
let icons: ((name: string) => string | null) | null = null;
function findIcon(name: string): string | null {
  try {
    return icons ? icons(name) : null;
  } catch {
    return null;
  }
}

const PRINTED_TONIGHT: PrintedLabel[] = [
  { id: 'p1', studentId: '1', name: 'Ramona Alvarez', atMs: NOW - 4 * MIN, failed: false },
  { id: 'p2', studentId: '2', name: 'Noah Alvarez', atMs: NOW - 4 * MIN, failed: true },
  { id: 'p3', studentId: '6', name: 'Alice Alberts', atMs: NOW - 11 * MIN, failed: false },
];

/* ---- The scenarios ---------------------------------------------------- */

/**
 * The mornings this campaign was judged on.
 *
 * Named for what the volunteer is doing rather than for the state they land in,
 * because that is how the panel read them: a screen is right or wrong inside
 * somebody's errand, not on its own.
 */
export type SceneId =
  | 'new-kiosk'
  | 'android-sunday'
  | 'unplugged'
  | 'wednesday'
  | 'quiet-day'
  | 'mid-evening';

interface Scene {
  /** What this kiosk has stored, if anything. */
  config: PrinterConfig | null;
  /** Where the printer starts, once the boot ladder has settled. */
  settles: PrinterState;
  /** Whether the kiosk spends its first seconds looking, as a real wake does. */
  wakes: boolean;
  /** Whether today's list holds a gathering that prints. */
  printingDay: boolean;
  /** Mid-evening: the printer screen over a bound, printing gathering. */
  midEvening?: boolean;
}

const QL: PrinterConfig = { model: 'QL-810W', label: '62x29' };

const SCENES: Record<SceneId, Scene> = {
  'new-kiosk': { config: null, settles: { kind: 'idle' }, wakes: false, printingDay: true },
  'android-sunday': {
    config: QL,
    settles: { kind: 'unpaired', searching: false },
    wakes: true,
    printingDay: true,
  },
  unplugged: {
    config: QL,
    settles: {
      kind: 'trouble',
      message: { key: 'troubleUnplugged' },
      advice: { key: 'advicePlugBackIn' },
    } as unknown as PrinterState,
    wakes: false,
    printingDay: true,
  },
  wednesday: { config: null, settles: { kind: 'idle' }, wakes: false, printingDay: true },
  'quiet-day': { config: null, settles: { kind: 'idle' }, wakes: false, printingDay: false },
  'mid-evening': {
    config: QL,
    settles: { kind: 'unpaired', searching: false },
    wakes: false,
    printingDay: true,
    midEvening: true,
  },
};

/** How long the boot retries look before they settle. The real ladder is 2+3+5s. */
const WAKE_MS = 4000;

/* ---- The transport, faked --------------------------------------------- */

/** What the QL says about itself when it is picked out of the device list. */
function detectionFor(config: PrinterConfig, guessRoll: boolean): PrinterDetection {
  const matched = guessRoll
    ? [
        { identifier: '62', name: '62mm endless' },
        { identifier: '62red', name: '62mm endless (black/red/white)' },
      ]
    : [{ identifier: '62x29', name: '62mm x 29mm die-cut' }];
  return {
    config: guessRoll ? { model: config.model, label: '62' } : config,
    modelFromPrinter: true,
    matched,
    status: { mediaType: guessRoll ? 'continuous' : 'die-cut', mediaWidthMm: 62, errors: [] },
  } as unknown as PrinterDetection;
}

export function Demo() {
  const [scene, setScene] = useState<SceneId>('new-kiosk');
  const spec = SCENES[scene];

  /* Exactly what `KioskApp` holds for these two screens. */
  const [phase, setPhase] = useState<'choosing' | 'printer'>('choosing');
  const [config, setConfig] = useState<PrinterConfig | null>(spec.config);
  const [state, setState] = useState<PrinterState>(
    spec.wakes ? { kind: 'unpaired', searching: true } : spec.settles,
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [listCameBackEmpty, setListCameBackEmpty] = useState(false);
  /** The browser's device list, which a page cannot open for real. */
  const [sheet, setSheet] = useState(false);
  const listeners = useRef(new Set<(next: PrinterState) => void>());

  /** One place a state change happens, so the screens hear it as they would. */
  const emit = useCallback((next: PrinterState) => {
    setState(next);
    setListCameBackEmpty(false);
    for (const fn of listeners.current) fn(next);
  }, []);

  /* Starting a scene over, which is what picking one in the rail means. */
  useEffect(() => {
    setPhase(SCENES[scene].midEvening ? 'printer' : 'choosing');
    setConfig(SCENES[scene].config);
    setSelected(null);
    setListCameBackEmpty(false);
    setSheet(false);
    const opening: PrinterState = SCENES[scene].wakes
      ? { kind: 'unpaired', searching: true }
      : SCENES[scene].settles;
    setState(opening);
    for (const fn of listeners.current) fn(opening);
    if (!SCENES[scene].wakes) return;
    // The wake, at the length a volunteer actually stands through.
    const timer = setTimeout(() => emit(SCENES[scene].settles), WAKE_MS);
    return () => clearTimeout(timer);
  }, [scene, emit]);

  /** Told to the page around this one, so the rail can follow along. */
  useEffect(() => {
    window.parent?.postMessage(
      { type: 'kiosk:state', scene, phase, printer: state.kind, configured: config !== null },
      '*',
    );
  }, [scene, phase, state, config]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; scene?: SceneId } | null;
      if (data?.type === 'kiosk:scene' && data.scene && data.scene in SCENES) setScene(data.scene);
    };
    window.addEventListener('message', onMessage);
    window.parent?.postMessage({ type: 'kiosk:ready' }, '*');
    return () => window.removeEventListener('message', onMessage);
  }, []);

  /* The module handle, with a real state machine behind it. */
  const printing = useMemo<KioskPrinting>(() => {
    const handle = {
      currentState: () => state,
      subscribe: (fn: (next: PrinterState) => void) => {
        listeners.current.add(fn);
        return () => listeners.current.delete(fn);
      },
      modelIdentifiers,
      labelsForModel,
      labelName,
      printerLog: () => [],
      printerLogText: () => '',
      describeAge,
      describeEntry,
      configure: async (next: PrinterConfig) => {
        setConfig(next);
        return state;
      },
      /*
       * The one call that cannot be faked away: it opens the browser's own
       * device list, and everything about this flow turns on what happens when
       * that list comes back empty. The sheet below is the stand-in, and it
       * resolves this promise either way.
       */
      pairPrinter: () =>
        new Promise<PrinterDetection | null>((resolve) => {
          setSheet(true);
          pending.current = resolve;
        }),
      checkPrinter: async () => detectionFor(config ?? QL, false),
      ready: async () => {
        // A retry that finds nothing walks the module's own path: looking, then
        // settled. Plugging the printer back in is what changes the answer.
        emit({ kind: 'unpaired', searching: true });
        setTimeout(() => emit(SCENES[scene].settles), 1400);
        return state;
      },
      testPrint: () => {
        window.parent?.postMessage({ type: 'kiosk:printed' }, '*');
      },
    };
    return handle as unknown as KioskPrinting;
  }, [state, config, scene, emit]);

  const pending = useRef<((found: PrinterDetection | null) => void) | null>(null);

  /** The QL, picked out of the list. */
  const pick = (guessRoll: boolean) => {
    const found = detectionFor(QL, guessRoll);
    setSheet(false);
    setConfig(found.config);
    emit({ kind: 'ready', config: found.config } as PrinterState);
    pending.current?.(found);
    pending.current = null;
  };

  /** Dismissed — the press the strip used to answer with nothing at all. */
  const dismiss = () => {
    setSheet(false);
    pending.current?.(null);
    pending.current = null;
  };

  const services = useMemo(
    () =>
      ({
        listEvents: async () => entries(spec.printingDay),
        bindEntry: async () => {
          window.parent?.postMessage({ type: 'kiosk:bound' }, '*');
          return new Promise(() => {});
        },
      }) as unknown as KioskServices,
    [spec.printingDay],
  );

  const connect = () => {
    setListCameBackEmpty(false);
    void printing.pairPrinter(config ?? QL).then((found) => {
      if (!found) setListCameBackEmpty(true);
    });
  };

  return (
    <div className="relative h-full">
      {phase === 'printer' ? (
        <PrinterScreen
          printing={printing}
          config={config ?? QL}
          hasConfig={config !== null}
          gatheringPrints={spec.midEvening === true}
          printedTonight={spec.midEvening ? PRINTED_TONIGHT : []}
          onReprint={() => {}}
          onReprintByName={spec.midEvening ? () => {} : undefined}
          onDone={() => setPhase(spec.midEvening ? 'printer' : 'choosing')}
        />
      ) : (
        <EventChooser
          services={services}
          printerState={state}
          printerConfigured={config !== null}
          printerGuessed={config?.guessed === true}
          printerModel={config?.model}
          printingReady
          listCameBackEmpty={listCameBackEmpty}
          onSetUpPrinter={() => setPhase('printer')}
          onConnectPrinter={connect}
          onLookAgain={() => void printing.ready()}
          onPrintTestLabel={() => printing.testPrint('en')}
          onPrintingRows={() => {}}
          selectedKey={selected}
          onSelect={setSelected}
          onBound={() => {}}
        />
      )}

      {sheet && <DeviceSheet onPick={pick} onDismiss={dismiss} />}
    </div>
  );
}

/**
 * A stand-in for the browser's own USB device list.
 *
 * Deliberately not styled like the kiosk: it is Chrome's sheet, not Tally's,
 * and half of what makes the unpaired state expensive is that a volunteer has
 * to recognise somebody else's window and find the printer in it. The empty
 * button is the one this demo exists to let somebody press.
 */
function DeviceSheet({
  onPick,
  onDismiss,
}: {
  onPick: (guessRoll: boolean) => void;
  onDismiss: () => void;
}) {
  return (
    <div className="absolute inset-0 z-10 flex items-start justify-center bg-black/50 pt-16">
      <div
        style={{ fontFamily: 'system-ui, sans-serif' }}
        className="w-[560px] rounded-xl bg-[#292a2d] p-5 text-[#e8eaed] shadow-2xl"
      >
        <div className="text-[15px] font-medium">
          tally.church wants to connect to a USB device
        </div>
        <div className="mt-4 flex flex-col gap-1">
          <button
            type="button"
            onClick={() => onPick(false)}
            className="rounded-lg bg-[#3c4043] px-4 py-3 text-left text-[14px] active:bg-[#4a4e52]"
          >
            Brother QL-810W (62mm x 29mm die-cut loaded)
          </button>
          <button
            type="button"
            onClick={() => onPick(true)}
            className="rounded-lg px-4 py-3 text-left text-[14px] active:bg-[#3c4043]"
          >
            Brother QL-810W (62mm tape loaded — the roll it cannot name)
          </button>
        </div>
        <div className="mt-5 flex justify-end gap-3 text-[14px]">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded px-4 py-2 text-[#8ab4f8] active:bg-white/10"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

void import('@/lib/eventIcons').then((module) => {
  icons = (name: string) => module.findEventIcon(name)?.path ?? null;
});

createRoot(document.getElementById('root')!).render(
  <KioskIntlProvider>
    <Demo />
  </KioskIntlProvider>,
);
