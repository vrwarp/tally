/**
 * The reprint proposal, mounted so the critique loop can look at states.
 *
 * Same argument as `uxr/kiosk-live/main.tsx`: the kiosk's screens are pure
 * functions of their props, so a dev server renders the real thing in
 * milliseconds and nothing has to be hand-drawn. The difference is that these
 * screens do not exist in `src/` yet — this is the proposal, written against
 * the real stylesheet, the real keyboard, the real tap guard and the real row
 * geometry, so what the critics judge is what the implementation would be.
 *
 * Every knob is a query parameter, because the shooter addresses states by URL:
 *
 *   ?screen=staff|reprint|confirm|printer|done   which screen    (default reprint)
 *   ?buffer=Alva                            what has been typed      (default "")
 *   ?sentId=1                               the line after a print lands
 *   ?present=1,2                            ids already checked in tonight
 *   ?printer=trouble|none                   what the staff screen says about it
 *   ?recent=0                               a printer screen with nothing on it
 *   ?checkedInAgo=3                         minutes since this kiosk checked them in
 *   ?reprinted=1                            children a label has already gone again for
 *
 * The last two are deliberately *not* an `?offer=offer|spent|none` switch, which
 * is what they were. A cap a reader cannot watch hold is a cap they have to take
 * on trust, and the first version of this offer was blocked precisely because
 * the thing asserted — one per child — was not the thing that mattered. So the
 * window and the counter are modelled, the three states are derived from them by
 * `reprintOffer`, and a scene is a clock reading and a print log rather than a
 * label.
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';
import type { KioskKey } from '@/kiosk/components/Keyboard';
import type { KioskStudent } from '@/kiosk/search';
import { StaffScreen } from './screens/StaffScreen';
import { StaffSession } from './screens/StaffSession';
import { ReprintScreen } from './screens/ReprintScreen';
import { ReprintConfirmScreen } from './screens/ReprintConfirmScreen';
import { PrinterScreenProto, type PrintedLabel } from './screens/PrinterScreenProto';
import { AlreadyCheckedInScreen } from './screens/AlreadyCheckedInScreen';
import { reprintOffer } from './screens/reprintOffer';

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

/**
 * Fewer than the parent screen's eight, and that is the reprint screen's own
 * number rather than a shared one.
 *
 * The landscape kiosk leaves this list a 250px track, which is three rows at
 * kiosk row height. Eight matches balance four-and-four across two columns, so
 * the fourth row of both columns was under the ramp with a 23px scroll nobody
 * would guess at; six balance three-and-three and the region shows all of them.
 * The cost is that "more names than fit" fires two letters earlier — which on
 * this screen is not a cost, because a volunteer standing here already knows
 * the child's name and typing is the cheapest thing they can do.
 */
const MAX_RESULTS = 6;

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
  return { results: matched.slice(0, MAX_RESULTS), total: matched.length };
}

const RECENT: PrintedLabel[] = [
  { id: 'a', name: 'Ramona Alvarez', at: '6:41 PM' },
  { id: 'b', name: 'Noah Alvarez', at: '6:41 PM' },
  { id: 'c', name: 'Alethea Alford', at: '6:38 PM', failed: true },
  { id: 'd', name: 'Sam Alvarado', at: '6:35 PM' },
  { id: 'e', name: 'Alonzo Allred', at: '6:32 PM' },
];

/**
 * What the kiosk knows about tonight, for the parent-facing offer.
 *
 * Two facts, held here rather than passed as a state name, because they are the
 * two facts the exception is made of and a reader has to be able to see them
 * bound it:
 *
 * `checkedInAtMs` is *this kiosk's own* arrival log — the children it printed a
 * name tag for as they walked in. A child checked in at the other kiosk, or in
 * the app by a leader, is not in it and never gets the control.
 *
 * `reprintedIds` is the shared counter. Every path that sends a label for a
 * child beyond the one their check-in printed writes to it: this parent's hold,
 * the by-name confirm behind the staff gate, and a row on the printer screen.
 * That is what makes "once per child" a cap rather than a suggestion — a parent
 * cannot get a second label by finding a volunteer first, or the other way
 * round.
 */
const NOW = Date.now();
const CHECKED_IN_AT_MS = new Map<string, number>(
  STUDENTS.map((student, index) => [
    student.id,
    // Everybody but the tapped child arrived well before the window; the child
    // this scene is about arrived `checkedInAgo` minutes ago.
    NOW - (index === 0 ? Number(params.get('checkedInAgo') ?? '3') : 40) * 60_000,
  ]),
);
const REPRINTED_IDS = new Set(params.get('reprinted')?.split(',').filter(Boolean) ?? []);

export function Prototype() {
  const [buffer, setBuffer] = useState(params.get('buffer') ?? '');
  const onKey = (key: KioskKey) => {
    if (key.kind === 'char') setBuffer((typed) => typed + key.value);
    else if (key.kind === 'backspace') setBuffer((typed) => typed.slice(0, -1));
    else if (key.kind === 'clear') setBuffer('');
  };

  const screen = params.get('screen') ?? 'reprint';
  const printer = (params.get('printer') as 'ready' | 'trouble' | 'none') ?? 'ready';

  /*
   * The parent's screen is the one thing here that is *not* behind the staff
   * gate, so it is the one screen with no session clock around it: it is a
   * check-in screen, and the kiosk is already where it should be.
   */
  if (screen === 'done') {
    const student = STUDENTS[0]!;
    return (
      <AlreadyCheckedInScreen
        student={student}
        offer={reprintOffer({
          studentId: student.id,
          now: Date.now(),
          checkedInAtMs: CHECKED_IN_AT_MS,
          reprintedIds: REPRINTED_IDS,
          // A gathering with a template and a printer that is not in trouble.
          // The parent is never told which of those it was.
          labelWouldPrint: printer === 'ready',
        })}
        onReprint={() => {}}
        onBack={() => {}}
      />
    );
  }

  /*
   * Everything else is behind the two-second hold on Clear, and the clock that
   * hands the kiosk back to the parents belongs to the gate rather than to any
   * of them — see `StaffSession`. Wrapping here is what makes that true of a
   * screen added tomorrow as well.
   */
  const staff = (() => {
    if (screen === 'staff') {
      return (
        <StaffScreen
          title="Wednesday Night"
          window="6:30 – 8:00 PM"
          printer={printer}
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
          lines={['Ramona Alvarez', '7th grade', 'Wednesday Night', '6:30 PM']}
          printedAt={params.get('printedAt') ?? '6:41 PM'}
          printerNeedsAttention={printer === 'trouble'}
          onPrint={() => {}}
          onBack={() => {}}
        />
      );
    }

    if (screen === 'printer') {
      return (
        <PrinterScreenProto
          recent={params.get('recent') === '0' ? [] : RECENT}
          onPick={() => {}}
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
        printerNeedsAttention={printer === 'trouble'}
        onKey={onKey}
        onPick={() => {}}
        onDone={() => {}}
      />
    );
  })();

  return <StaffSession onReturn={() => {}}>{staff}</StaffSession>;
}

createRoot(document.getElementById('root')!).render(<Prototype />);
