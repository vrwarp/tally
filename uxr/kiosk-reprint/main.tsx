/**
 * The reprint flow, mounted from `src/` so the critique loop and the
 * walkthrough look at states rather than at a prototype of them.
 *
 * It began as the prototype — five screens written against the real stylesheet
 * while the design was argued out over four rounds — and the moment those
 * screens landed in `src/kiosk/` the copies became the thing `uxr/README.md`
 * warns about: a hand-written double that drifts, and a critique worth only what
 * the frame is worth. So the harness now imports the shipped components. It
 * cannot drift, because it is the app.
 *
 * What is faked is the printing module's handle — a `KioskPrinting` is a WebUSB
 * transport and a rasteriser, and the printer screen only asks it about models
 * and media — and the fixture roster, which is `kiosk-live`'s.
 *
 * Every knob is a query parameter, because the shooter addresses states by URL:
 *
 *   ?screen=search|staff|reprint|confirm|printer|done  which screen (default reprint)
 *   ?buffer=Alva                            what has been typed      (default "")
 *   ?sentId=1                               whose tag just went to the printer
 *   ?present=1,2                            ids already checked in tonight
 *   ?printer=trouble|none                   what the staff screen says about it
 *   ?recent=0                               a printer screen with nothing on it
 *   ?checkedInAgo=3                         minutes since this kiosk checked them in
 *   ?reprinted=1                            a label has already gone again for them
 *
 * The parent-facing offer is addressed by the *facts* that produce it rather
 * than by name, and `reprintOffer` — the shipped policy — decides. A critique
 * cannot judge a cap it cannot see hold, and a frame that took `offer=spent`
 * from a query string was a claim rather than evidence.
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';
import type { KioskKey } from '@/kiosk/components/Keyboard';
import type { KioskPrinting } from '@/kiosk/KioskApp';
import type { PrintedLabel } from '@/kiosk/printing';
import type { KioskStudent } from '@/kiosk/search';
import { reprintOffer } from '@/kiosk/reprintOffer';
import { ConfirmScreen } from '@/kiosk/screens/ConfirmScreen';
import { PrinterScreen } from '@/kiosk/screens/PrinterScreen';
import { ReprintConfirmScreen } from '@/kiosk/screens/ReprintConfirmScreen';
import { MAX_REPRINT_RESULTS, ReprintScreen } from '@/kiosk/screens/ReprintScreen';
import { StaffScreen } from '@/kiosk/screens/StaffScreen';
import { SearchScreen } from '@/kiosk/screens/SearchScreen';
import type { KioskBinding } from '@/kiosk/binding';
import type { KioskSearchOutcome } from '@/kiosk/search';

const params = new URLSearchParams(location.search);

/** The same roster `kiosk-live` searches, for the same reasons — see its note. */
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

function outcomeFor(buffer: string) {
  const needle = buffer.toLowerCase();
  const matched = buffer
    ? STUDENTS.filter((student) =>
        `${student.firstName} ${student.lastName}`
          .toLowerCase()
          .split(/[\s-]+/)
          .some((word) => word.startsWith(needle)),
      )
    : [];
  return { results: matched.slice(0, MAX_REPRINT_RESULTS), total: matched.length };
}

const NOW = Date.now();

/**
 * Half past six this evening, whatever time the shutter actually opens.
 *
 * The kiosk-live fixture anchors its gathering to the real clock on purpose —
 * the header asks `windowHasClosed` what to say, and a hard-coded evening goes
 * stale. That is right for a critique frame and wrong for a walkthrough, which
 * is read months later: a build that happened to run at ten past midnight
 * produced a page whose first frame said the gathering ran from 11:55 PM to
 * 1:25 AM. The evening is fixed and the *date* is today's, so the window reads
 * like a Wednesday and nothing in it is stale.
 */
function evening(hour: number, minute: number): number {
  const when = new Date(NOW);
  when.setHours(hour, minute, 0, 0);
  return when.getTime();
}

/**
 * The gathering the kiosk is on, so the walkthrough can open where a parent
 * finds this device: a check-in screen, mid-service, with a queue behind it.
 */
const BINDING: KioskBinding = {
  eventId: 'uxr-event',
  seriesId: null,
  title: 'Wednesday Night',
  startAtMs: evening(18, 30),
  endAtMs: evening(20, 0),
  checkInClosesAtMs: evening(20, 30),
  boundAtMs: evening(17, 45),
};

/** An evening: two just now, one that jammed, two earlier. */
const RECENT: PrintedLabel[] = [
  { id: 'a', studentId: '1', name: 'Ramona Alvarez', atMs: evening(18, 41), failed: false },
  { id: 'b', studentId: '2', name: 'Noah Alvarez', atMs: evening(18, 41), failed: false },
  { id: 'c', studentId: '10', name: 'Alethea Alford', atMs: evening(18, 38), failed: true },
  { id: 'd', studentId: '4', name: 'Sam Alvarado', atMs: evening(18, 35), failed: false },
  { id: 'e', studentId: '11', name: 'Alonzo Allred', atMs: evening(18, 32), failed: false },
];

/**
 * What the printer screen asks the printing module, and nothing else.
 *
 * The real handle is a rasteriser, a worker and a WebUSB device; this screen
 * wants a list of models, a list of media and a state to render.
 */
const printing = {
  modelIdentifiers: () => ['QL-810W', 'QL-800', 'QL-820NWB'],
  labelsForModel: () => [{ identifier: '62' }, { identifier: '62x29' }],
  labelName: (entry?: { identifier: string }) =>
    entry?.identifier === '62x29' ? '62 × 29mm name badge' : '62mm continuous',
  subscribe: () => () => {},
  currentState: () =>
    params.get('printer') === 'trouble'
      ? { kind: 'trouble' as const, message: 'The cover is open.', advice: 'Close it and try again.' }
      : { kind: 'ready' as const, config: { model: 'QL-810W', label: '62' } },
  configure: async () => {},
  pairPrinter: async () => {},
  readStatus: async () => null,
  suggestLabels: () => [],
  testPrint: () => {},
} as unknown as KioskPrinting;

export function Prototype() {
  const [buffer, setBuffer] = useState(params.get('buffer') ?? '');
  const onKey = (key: KioskKey) => {
    if (key.kind === 'char') setBuffer((typed) => typed + key.value);
    else if (key.kind === 'backspace') setBuffer((typed) => typed.slice(0, -1));
    else if (key.kind === 'clear') setBuffer('');
  };

  const screen = params.get('screen') ?? 'reprint';
  const trouble = params.get('printer') === 'trouble';

  if (screen === 'search') {
    const matched = outcomeFor(buffer);
    return (
      <SearchScreen
        binding={BINDING}
        buffer={buffer}
        onKey={onKey}
        outcome={
          {
            mode: buffer ? 'name' : 'idle',
            results: matched.results,
            total: matched.total,
          } as KioskSearchOutcome
        }
        presentIds={new Set(params.get('present')?.split(',').filter(Boolean) ?? [])}
        checkedOutIds={new Set()}
        tracksCheckOut={false}
        printerNeedsAttention={trouble}
        refresh="idle"
        widening={false}
        onWiden={() => {}}
        onPick={() => {}}
        onRegister={() => {}}
        onStaffGate={() => {}}
      />
    );
  }

  if (screen === 'staff') {
    return (
      <StaffScreen
        title="Wednesday Night"
        window="6:30 – 8:00 PM"
        printer={(params.get('printer') as 'ready' | 'trouble' | 'none') ?? 'ready'}
        onReprint={() => {}}
        onPrinter={() => {}}
        onChangeEvent={() => {}}
        onStay={() => {}}
      />
    );
  }

  if (screen === 'confirm') {
    return (
      <ReprintConfirmScreen
        student={STUDENTS[0]!}
        lines={['Ramona A', '7th grade', 'Wednesday Night', '6:30 PM']}
        printedAt={params.get('printedAt') ?? '6:41 PM'}
        printerNeedsAttention={trouble}
        onPrint={() => {}}
        onBack={() => {}}
      />
    );
  }

  if (screen === 'done') {
    return (
      <ConfirmScreen
        student={STUDENTS[0]!}
        intent="done"
        family={[]}
        skipped={new Set()}
        reprintOffer={reprintOffer({
          studentId: '1',
          now: NOW,
          checkedInAtMs: new Map([['1', NOW - Number(params.get('checkedInAgo') ?? 3) * 60_000]]),
          reprintedIds: new Set(params.get('reprinted') === '1' ? ['1'] : []),
          labelWouldPrint: params.get('printer') !== 'none' && !trouble,
        })}
        onReprint={() => {}}
        onToggle={() => {}}
        onConfirm={() => {}}
        onBack={() => {}}
      />
    );
  }

  if (screen === 'printer') {
    return (
      <PrinterScreen
        printing={printing}
        config={{ model: 'QL-810W', label: '62' }}
        printedTonight={params.get('recent') === '0' ? [] : RECENT}
        onReprint={() => {}}
        onReprintByName={() => {}}
        onDone={() => {}}
      />
    );
  }

  return (
    <ReprintScreen
      buffer={buffer}
      outcome={outcomeFor(buffer)}
      presentIds={new Set(params.get('present')?.split(',').filter(Boolean) ?? [])}
      sentId={params.get('sentId')}
      printerNeedsAttention={trouble}
      onKey={onKey}
      onPick={() => {}}
      onDone={() => {}}
    />
  );
}

createRoot(document.getElementById('root')!).render(<Prototype />);
