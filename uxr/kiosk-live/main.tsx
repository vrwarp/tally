/**
 * The kiosk screens, mounted from `src/` with their props driven by the query
 * string, so the critique loop can look at states rather than at a prototype
 * of them.
 *
 * The rest of `uxr/` iterates on frozen HTML, and for the app that is the right
 * trade: the scenes exist behind a sign-in and an emulator suite, so freezing
 * them is cheaper than reaching them. The kiosk is the opposite. Its screens
 * are pure functions of their props — `SearchScreen` is handed a buffer, an
 * outcome and a binding, and it has no store, no router and no network — so the
 * real component renders in a dev server in milliseconds. `uxr/kiosk-confirm.ts`
 * had to hand-write a static copy of `ConfirmScreen`'s markup and keep its
 * measurements in step by discipline; this cannot drift from the app, because
 * it *is* the app.
 *
 * Every knob is a query parameter, because the shooter addresses states by URL:
 *
 *   ?screen=search|register   which screen                      (default search)
 *   ?buffer=Alva              what has been typed                    (default "")
 *   ?nomatch=1                the search finished and found nobody
 *   ?present=1,2              ids already checked in tonight
 *   ?longname=1               one child named to the register's forty-character limits
 *   ?pickup=1                 a gathering that also hands children back
 *   ?title=…                  the gathering's name
 *   ?icon=campfire            the gathering's icon, by Material name
 *   ?screen=chooser           the staff chooser, with a week of gatherings on it
 *   ?screen=staff             the staff menu, reached by holding Clear
 *   ?screen=success           the tick, as it paints after a confirm
 *   ?screen=unbind            "Change event?", the one question the kiosk asks
 *   ?icons=all|some|none      how many chooser rows wear an icon      (default all)
 *   ?twins=1                  two occurrences of one gathering, one day
 *   ?photo=1                  the gathering's photograph behind the idle screen
 *   ?backdrop=1               the staff menu's "Hide the photo" row
 *   ?ground=light             the light ground, as a light-themed gathering wears it
 *   ?screen=printer           the label printer screen, as setup reaches it from the chooser
 *   ?from=staff               …or as the staff menu reaches it, mid-evening, with tonight's tags
 *   ?printer=idle|ready|unpaired|looking|trouble
 *                             what the printer is doing, on the chooser, the printer screen
 *                             and the staff menu (`none` on the staff menu: nothing to print)
 *   ?labels=all|some|none     which chooser rows belong to a gathering that prints  (default none)
 *   ?events=none              no gatherings today at all — the printer door on an empty page
 *   ?rooms=long               the rooms named the way a church names them — "Fellowship Hall",
 *                             "Room 201, upstairs" — so the meta line's wrap is photographed
 *   ?detected=plain|guessed|unknown
 *                             what "Check the printer" comes back with on the printer screen —
 *                             a clean read-off, a roll the packet could not choose between, or a
 *                             model the table does not carry; the shooter presses the button
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';
import { findEventIcon } from '@/lib/eventIcons';
import { eventWindow, type KioskBinding } from '@/kiosk/binding';
import { Backdrop } from '@/kiosk/components/Backdrop';
import type { KioskKey } from '@/kiosk/components/Keyboard';
import { KioskIntlProvider } from '@/kiosk/KioskIntlProvider';
import { RegistrationFlow } from '@/kiosk/registration/RegistrationFlow';
import type { KioskSearchOutcome, KioskStudent } from '@/kiosk/search';
import { ChangeEventScreen } from '@/kiosk/screens/ChangeEventScreen';
import { EventChooser } from '@/kiosk/screens/EventChooser';
import { PrinterScreen } from '@/kiosk/screens/PrinterScreen';
import { SearchScreen } from '@/kiosk/screens/SearchScreen';
import { StaffScreen } from '@/kiosk/screens/StaffScreen';
import { SuccessScreen } from '@/kiosk/screens/SuccessScreen';
import type { KioskEventEntry, KioskPrinting, KioskServices } from '@/kiosk/KioskApp';
/*
 * The printer, without a printer.
 *
 * `PrinterScreen` reads everything through the `printing` handle so that the
 * transport stays out of the kiosk's first paint; here the handle is a table of
 * models, a table of media, a state and four calls that settle without doing
 * anything. The tables are the library's own — the model list and the roll
 * names on the frame are the ones a volunteer would read — and the log's two
 * describers are the module's, so the folded record reads as it does on the
 * device. Nothing here touches `navigator.usb`.
 */
import { labelName, labelsForModel } from '@vrwarp/brother-ql-webusb/labels';
import { modelIdentifiers } from '@vrwarp/brother-ql-webusb/models';
import { describeAge, describeEntry } from '@/kiosk/printing/log';
import type { PrintedLabel, PrinterDetection, PrinterState, PrinterStatus } from '@/kiosk/printing';
import { DEFAULT_LABEL_TEMPLATE } from '@/lib/labelTemplate';

const params = new URLSearchParams(location.search);

/*
 * The ground, worn the way `applyKioskTheme` wears it: `data-theme` on the
 * root. The harness stands in for the binding here exactly as it stands in
 * for the server on the icon below.
 */
if (params.get('ground') === 'light') document.documentElement.dataset.theme = 'light';

/*
 * The photograph, standing in for a `kioskBackdrops/{id}` fetch: the real
 * layer, handed a URL the way KioskApp hands it an object URL. The scene is
 * drawn rather than shot so the fixture follows the feature's own guidance —
 * a place, not a poster; no words, no faces.
 */
const photoUrl = params.get('photo') === '1' ? '/uxr/kiosk-live/backdrop-demo.svg' : null;

/*
 * `?nofade=1` takes the results ramp out of the paint entirely —
 * display:none, so it stops painting and compositing while the React tree
 * stays byte-identical. The A/B knob for `bench-fade.ts`, which asks what
 * the ramp actually costs a Pi-class device; a knob here rather than a code
 * branch in SearchScreen, because the screen must not carry benchmark
 * plumbing.
 */
if (params.get('nofade') === '1') {
  const style = document.createElement('style');
  style.textContent = '.kiosk-list-fade-overlay { display: none !important; }';
  document.head.appendChild(style);
}

/*
 * A gathering in progress: started 22 minutes ago, another 68 to run, check-in
 * closing half an hour after it ends.
 *
 * Anchored to the real clock rather than to a fixed date, because the header
 * asks `windowHasClosed` what to say and a hard-coded evening goes stale — the
 * first frames shot for this loop were of a gathering that had finished, so
 * every one of them carried the closed-window line and the critics were reading
 * an edge case as the normal screen.
 */
const NOW = Date.now();

/*
 * The icon, named the way a leader picked it in the app.
 *
 * Resolved here because the harness is allowed to: the catalogue is a client
 * module the main app already carries, and the kiosk's copy of this fact is one
 * path string the server puts on the chooser row. Shooting the screen means
 * standing in for that server, not for the picker.
 */
const iconPath = findEventIcon(params.get('icon'))?.path;

const binding: KioskBinding = {
  eventId: 'uxr-event',
  seriesId: null,
  title: params.get('title') ?? 'Wednesday Night',
  startAtMs: NOW - 22 * 60_000,
  endAtMs: NOW + 68 * 60_000,
  checkInClosesAtMs: NOW + 98 * 60_000,
  boundAtMs: NOW - 45 * 60_000,
  requiresCheckOut: params.get('pickup') === '1',
  allergiesSupported: true,
  iconPath,
};

/*
 * A week of gatherings, as `getKioskEvents` would answer it.
 *
 * The chooser is the other screen an icon lands on, and the one where getting
 * it wrong costs something: two Wednesdays with the same name is the misbinding
 * this list was narrowed to prevent, and a glyph is the first thing on a row
 * that tells two *different* gatherings apart at arm's length.
 *
 * `icons=` drives the state that matters more than any single row — a list
 * where some gatherings wear one and some do not, which is what a church
 * halfway through choosing them actually has.
 */
const CHOOSER = [
  /*
   * Finished an hour ago, still on the list because its check-in window has
   * not closed — the row a kiosk rebooting mid-pickup has to find again, and
   * the one row here that must *not* be bound for an ordinary evening. It is
   * on the fixture because a round changed how it is drawn and no frame in the
   * campaign could produce it: every seeded row started at or after `now`.
   */
  { title: 'Sunday Kids', icon: 'church', inHours: -2.5, runsMinutes: 90, location: 'Hall' },
  { title: 'Wednesday Night', icon: 'groups', inHours: 0, runsMinutes: 90, location: 'Youth room' },
  { title: 'Kids Club', icon: 'child_care', inHours: 3, runsMinutes: 120, location: 'Hall' },
  { title: 'Wednesday Night', icon: 'groups', inHours: 168, runsMinutes: 90, location: 'Youth room' },
  { title: 'Prayer & Praise', icon: 'music_note', inHours: 192, runsMinutes: 60, location: null },
];

/*
 * The misbinding, as a list: two occurrences of one gathering on one day.
 *
 * `?twins=1`. The chooser was narrowed to today because a thumb one row off on
 * a list of identically-titled Wednesdays pointed a lobby screen at the wrong
 * one — and two of them *can* share a day, a morning and an evening sitting of
 * the same thing. It is the row pair every change to this screen has to be
 * judged against, and no frame of it existed until an icon was put on the row
 * and a critic asked what the icon does about it. (Nothing: the mark belongs to
 * the gathering, so both wear it. What tells them apart is the time.)
 */
const TWINS = [
  { title: 'Wednesday Night', icon: 'groups', inHours: 0, runsMinutes: 90, location: 'Youth room' },
  { title: 'Wednesday Night', icon: 'groups', inHours: 6, runsMinutes: 90, location: 'Youth room' },
];

const chooserIcons = params.get('icons') ?? 'all';

/*
 * Which rows belong to a gathering that prints name tags.
 *
 * `?labels=`, defaulting to none so every frame the earlier campaigns shot is
 * the frame they shot. `some` is the church this campaign is about: a nursery
 * that prints and a youth night that does not, on one list, in front of one
 * volunteer with one printer on the shelf. The template is the app's default —
 * the chooser only asks whether there is one.
 */
const chooserLabels = params.get('labels') ?? 'none';

/*
 * The rooms, the length a church actually types them.
 *
 * `Hall` is the shortest room name there is, and a row mark that fits beside
 * it with twelve pixels to spare has not been tested. `?rooms=long` swaps the
 * fixture's rooms for the real thing so the meta line is photographed at the
 * width it wraps.
 */
const LONG_ROOMS: Record<string, string> = {
  Hall: 'Fellowship Hall',
  'Youth room': 'Room 201, upstairs',
};
const roomOf = (location: string | null) =>
  location && params.get('rooms') === 'long' ? (LONG_ROOMS[location] ?? location) : location;

function chooserEntries(): KioskEventEntry[] {
  // `?events=none`: the real Saturday — nothing on today at all, so the printer
  // door has to stand on an empty page.
  if (params.get('events') === 'none') return [];
  return (params.get('twins') === '1' ? TWINS : CHOOSER).map((row, index) => {
    const startAt = NOW - 22 * 60_000 + row.inHours * 3_600_000;
    const endAt = startAt + row.runsMinutes * 60_000;
    const wears = chooserIcons === 'all' || (chooserIcons === 'some' && index % 2 === 0);
    const prints = chooserLabels === 'all' || (chooserLabels === 'some' && index % 2 === 0);
    return {
      chain: `chain-${index}`,
      predictsFrom: `chain-${index}`,
      id: `event-${index}`,
      title: row.title,
      startAt,
      endAt,
      checkInOpensAt: startAt - 30 * 60_000,
      // Generous, so the gathering that has already ended is still offered —
      // which is the only reason a finished row is ever on this list.
      checkInClosesAt: endAt + 90 * 60_000,
      seriesId: null,
      location: roomOf(row.location),
      requiresCheckOut: false,
      labelTemplate: prints ? DEFAULT_LABEL_TEMPLATE : null,
      allergiesSupported: true,
      iconPath: wears ? findEventIcon(row.icon)?.path : undefined,
    };
  });
}

/** The printer this kiosk was set up with, when it was set up with one. */
const PRINTER_CONFIG = { model: 'QL-810W', label: '62x29' };

/**
 * What the printer is doing, by `?printer=`.
 *
 * Absent means the state `KioskApp` holds before anything has asked for the
 * printing module — `null` on the chooser, which is the frame every earlier
 * campaign shot, and `idle` on the printer screen, which is what the module
 * reports on a kiosk that has never been given a printer.
 */
function printerStateFor(): PrinterState | null {
  switch (params.get('printer')) {
    case 'ready':
      return { kind: 'ready', config: PRINTER_CONFIG };
    case 'unpaired':
      return { kind: 'unpaired', searching: false };
    case 'looking':
      return { kind: 'unpaired', searching: true };
    case 'trouble':
      return {
        kind: 'trouble',
        message: { key: 'troubleUnplugged' },
        advice: { key: 'advicePlugBackIn' },
      };
    case 'idle':
      return { kind: 'idle' };
    default:
      return null;
  }
}

/**
 * What asking the printer about itself comes back with, by `?detected=`.
 *
 * The notice above the settings is the one sentence the printer screen most
 * owes a volunteer — it names a roll that had to be guessed — and it is drawn
 * only from a detection, which only a press produces. So the handle answers
 * **Check the printer** with one of the three shapes `detectionNotice` knows,
 * and the shooter presses the button. A status packet as far as the screen
 * reads one: width, type and no error flags.
 */
function detectionFor(): PrinterDetection | null {
  const status = { mediaWidthMm: 62, mediaType: 'die-cut', errors: [] } as unknown as PrinterStatus;
  const rolls = labelsForModel(PRINTER_CONFIG.model);
  const badge = rolls.filter((entry) => entry.identifier === '62x29');
  const endless = rolls.filter((entry) => entry.identifier === '62' || entry.identifier === '62red');
  switch (params.get('detected')) {
    case 'plain':
      return { config: PRINTER_CONFIG, modelFromPrinter: true, matched: badge, status };
    case 'guessed':
      return {
        config: { model: PRINTER_CONFIG.model, label: '62' },
        modelFromPrinter: true,
        matched: endless,
        status: { ...status, mediaType: 'continuous' } as unknown as PrinterStatus,
      };
    case 'unknown':
      return { config: PRINTER_CONFIG, modelFromPrinter: false, matched: badge, status };
    default:
      return null;
  }
}

/*
 * The printing handle the printer screen reads — see the import note above.
 * Every call settles at once and changes nothing, because the frame under
 * review is a state rather than a session.
 */
function printingHandle(state: PrinterState): KioskPrinting {
  const handle = {
    currentState: () => state,
    subscribe: () => () => {},
    modelIdentifiers,
    labelsForModel,
    labelName,
    printerLog: () => [],
    printerLogText: () => '',
    describeAge,
    describeEntry,
    configure: async () => state,
    pairPrinter: async () => detectionFor(),
    checkPrinter: async () => detectionFor(),
    ready: async () => state,
    testPrint: () => {},
  };
  return handle as unknown as KioskPrinting;
}

/*
 * Tonight's tags, for the printer screen as the staff menu reaches it. Three
 * rows, one of them the row a volunteer is there for. Setup has none: a kiosk
 * on no gathering has printed nothing.
 */
const PRINTED_TONIGHT: PrintedLabel[] = [
  { id: 'p1', studentId: '1', name: 'Ramona Alvarez', atMs: NOW - 4 * 60_000, failed: false },
  { id: 'p2', studentId: '2', name: 'Noah Alvarez', atMs: NOW - 4 * 60_000, failed: true },
  { id: 'p3', studentId: '6', name: 'Alice Alberts', atMs: NOW - 11 * 60_000, failed: false },
];

/* Two of the fourteen methods, which are the two this screen calls. */
const chooserServices = {
  listEvents: () => Promise.resolve(chooserEntries()),
  // Never settles: a held row has to photograph as a row being held.
  bindEntry: () => new Promise(() => {}),
} as unknown as KioskServices;

/*
 * One family and their near-misses, and then some.
 *
 * The surnames deliberately collide: four letters of "Alva" reach five children
 * across three households, which is the state the standing "not your family?"
 * door exists for. The five after them exist so the roster can exceed
 * `MAX_RESULTS` — a two-letter buffer matches eleven and the screen shows
 * eight. Without them the fixture could not produce a truncated list at all,
 * and the readout's "Keep typing" — the whole answer to a search that found
 * more than it can show — shipped through a round of critique with no frame of
 * it in the set.
 */
const STUDENTS: KioskStudent[] = [
  { id: '1', firstName: 'Ramona', lastName: 'Alvarez', grade: 7 },
  { id: '2', firstName: 'Noah', lastName: 'Alvarez', grade: 9 },
  { id: '3', firstName: 'Priya', lastName: 'Alvarez-Bell', grade: 11 },
  { id: '4', firstName: 'Sam', lastName: 'Alvarado', grade: 6 },
  { id: '5', firstName: 'Jonah', lastName: 'Alvarado', grade: 12 },
  { id: '6', firstName: 'Alice', lastName: 'Alberts', grade: 6 },
  { id: '7', firstName: 'Aleksander', lastName: 'Albrecht', grade: 8 },
  { id: '8', firstName: 'Alma', lastName: 'Alcott', grade: 10 },
  { id: '9', firstName: 'Alden', lastName: 'Aldridge', grade: 7 },
  { id: '10', firstName: 'Alethea', lastName: 'Alford', grade: 11 },
  { id: '11', firstName: 'Alonzo', lastName: 'Allred', grade: 9 },
] as KioskStudent[];

/*
 * The name that took a lobby screen sideways.
 *
 * `?longname=1`. The register step accepts forty characters in each half of a
 * name (NAME_MAX_LENGTH), and a family used them: a whole sentence typed where
 * a first name goes. The row truncates it, as it should — but `truncate` clips
 * a box whose *minimum* width was still the whole sentence, and on the search
 * screen that minimum widened the one grid column past the glass and took the
 * header, the count and the keyboard's last keys with it. A row can be as long
 * as the register allows; what the frame has to prove is that nothing else on
 * the screen knows.
 *
 * Gated behind the flag rather than on the roster, so every list the existing
 * scenes photograph is the list they have always photographed.
 */
const LONG_NAME: KioskStudent = {
  id: '12',
  firstName: 'Alvara-Bartholomea Vandersteen-Okonkwo',
  lastName: 'Featherstonehaugh Fitzwilliam Alvarez',
  grade: 8,
} as KioskStudent;

const roster = params.get('longname') === '1' ? [...STUDENTS, LONG_NAME] : STUDENTS;

function outcomeFor(buffer: string, nobody: boolean): KioskSearchOutcome {
  const digits = /^\d+$/.test(buffer);
  const mode = !buffer
    ? 'idle'
    : digits
      ? buffer.length === 4
        ? 'phone'
        : 'phone-partial'
      : 'name';
  /* Any word, not the whole name: the app's matcher answers "al" with every
     Alvarez as well as every Alice, and a fixture that only matched from the
     first letter of the first name could not produce a list long enough to be
     truncated. Word by word, because a buffer can carry a space — "Ramona Al"
     is a parent typing a whole name — and the app answers it with the
     children every typed word prefixes some word of. A fixture that took the
     buffer as one needle could not photograph the space bar doing its job. */
  const needles = buffer.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matched =
    needles.length > 0 && !nobody
      ? roster.filter((student) => {
          const words = `${student.firstName} ${student.lastName}`.toLowerCase().split(/[\s-]+/);
          return needles.every((needle) => words.some((word) => word.startsWith(needle)));
        })
      : [];
  /* Sliced like `searchStudents` slices, and carrying the same pre-slice total,
     so a capped list renders exactly what the app would render. */
  return { mode, results: matched.slice(0, 8), total: matched.length } as KioskSearchOutcome;
}

/* Exported only so this file has an export: the component and the mount live
   together in an entry module, and the fast-refresh rule reads a file with a
   component and no exports as a mistake. */
export function Kiosk() {
  const [buffer, setBuffer] = useState(params.get('buffer') ?? '');
  const onKey = (key: KioskKey) => {
    if (key.kind === 'char') setBuffer((typed) => typed + key.value);
    else if (key.kind === 'backspace') setBuffer((typed) => typed.slice(0, -1));
    else if (key.kind === 'clear') setBuffer('');
  };

  if (params.get('screen') === 'staff') {
    /*
     * `ready` unless asked, which is what every earlier frame of this menu
     * showed. `none` is the menu on a kiosk with nothing to print — the
     * statement in place of the reprint door — and `trouble` is the one with
     * the amber sentence under it.
     */
    const asked = params.get('printer');
    const printer = asked === 'none' ? 'none' : asked === 'trouble' ? 'trouble' : 'ready';
    return (
      <StaffScreen
        title={binding.title}
        iconPath={binding.iconPath}
        window={eventWindow('en', binding)}
        printer={printer}
        trouble={printer === 'trouble' ? { key: 'troubleUnplugged' } : null}
        backdrop={params.get('backdrop') === '1'}
        onReprint={() => {}}
        onPrinter={() => {}}
        onChangeEvent={() => {}}
        onHideBackdrop={() => {}}
        onStay={() => {}}
      />
    );
  }

  if (params.get('screen') === 'printer') {
    /*
     * Two ways in, and the frame has to say which. From the chooser, mid-setup,
     * the kiosk is on no gathering: nothing printed tonight and no reprint
     * door, which is `KioskApp`'s `phase === 'printer'` branch. From the staff
     * menu it carries the evening. `?from=staff` is the second; the first is
     * the default because setup is the journey this screen is photographed for.
     */
    const midEvening = params.get('from') === 'staff';
    const state = printerStateFor() ?? { kind: 'idle' as const };
    return (
      <PrinterScreen
        printing={printingHandle(state)}
        config={PRINTER_CONFIG}
        printedTonight={midEvening ? PRINTED_TONIGHT : []}
        onReprint={() => {}}
        onReprintByName={midEvening ? () => {} : undefined}
        onDone={() => {}}
      />
    );
  }

  if (params.get('screen') === 'success') {
    return (
      <SuccessScreen
        students={STUDENTS.slice(0, 2)}
        intent={params.get('pickup') === '1' ? 'check-out' : 'check-in'}
        onDone={() => {}}
      />
    );
  }

  if (params.get('screen') === 'unbind') {
    return (
      <ChangeEventScreen
        title={binding.title}
        iconPath={binding.iconPath}
        onStay={() => {}}
        onLeave={() => {}}
      />
    );
  }

  if (params.get('screen') === 'chooser') {
    return (
      <EventChooser
        services={chooserServices}
        // Null unless `?printer=` says otherwise: the chooser on a kiosk
        // nobody has given a printer, which is the frame every earlier
        // campaign shot.
        printerState={printerStateFor()}
        onSetUpPrinter={() => {}}
        onBound={() => {}}
      />
    );
  }

  if (params.get('screen') === 'register') {
    return (
      <RegistrationFlow
        binding={binding}
        registrationId="uxr-registration"
        // Never settles: the frame under review is the step, not its result.
        /*
         * How the callable behaves, because the saving screen is a function of
         * it and of nothing else.
         *
         * `hang` is the default and the frame most rounds are about: a call
         * still in the air, which is the only way to photograph either meter —
         * against anything real the response beats the shutter. `deadline` and
         * `refuse` are the two ways it ends badly, and they say different
         * things now that a sticker may already be in somebody's hand.
         */
        submit={() =>
          new Promise((_resolve, reject) => {
            const mode = params.get('submit');
            if (mode === 'deadline' || mode === 'refuse') {
              setTimeout(
                () =>
                  reject({
                    code: mode === 'deadline' ? 'functions/deadline-exceeded' : 'functions/invalid-argument',
                  }),
                Number(params.get('after') ?? 400),
              );
            }
          })
        }
        onRegistered={() => {}}
        onEarlyPrint={() => {}}
        onClose={() => {}}
      />
    );
  }

  return (
    <>
    {/* Behind the search screen exactly as KioskApp mounts it: the one
        instance, shown while the glass is calm and at zero the moment it is
        not — which is what `?photo=1&buffer=…` photographs. */}
    {photoUrl && <Backdrop url={photoUrl} shown={buffer === ''} />}
    <SearchScreen
      binding={binding}
      buffer={buffer}
      onKey={onKey}
      outcome={outcomeFor(buffer, params.get('nomatch') === '1')}
      presentIds={new Set(params.get('present')?.split(',').filter(Boolean) ?? [])}
      checkedOutIds={new Set()}
      tracksCheckOut={binding.requiresCheckOut ?? false}
      printerNeedsAttention={params.get('printer') === '1'}
      onPrinter={() => {}}
      backdrop={photoUrl !== null}
      refresh="idle"
      widening={false}
      onWiden={() => {}}
      onPick={() => {}}
      onRegister={() => {}}
      onStaffGate={() => {}}
    />
    </>
  );
}

/*
 * The same provider `src/kiosk/main.tsx` mounts, and for the same reason: every
 * screen here reads its words through `useTranslations`, so without it the
 * harness renders an exception instead of a kiosk — which is what it did, in
 * silence, from the day the kiosk was translated. A shooter that writes a frame
 * per scene whatever the page contains cannot notice; the frames are only
 * useless.
 */
createRoot(document.getElementById('root')!).render(
  <KioskIntlProvider>
    <Kiosk />
  </KioskIntlProvider>,
);
