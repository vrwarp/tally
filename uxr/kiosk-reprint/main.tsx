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
 *   ?sent=Ramona+Alvarez                    the line after a print lands
 *   ?present=1,2                            ids already checked in tonight
 *   ?printer=trouble|none                   what the staff screen says about it
 *   ?recent=0                               a printer screen with nothing on it
 *   ?offer=offer|spent|none                 the parent-facing offer's three states
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';
import type { KioskKey } from '@/kiosk/components/Keyboard';
import type { KioskStudent } from '@/kiosk/search';
import { StaffScreen } from './screens/StaffScreen';
import { ReprintScreen } from './screens/ReprintScreen';
import { ReprintConfirmScreen } from './screens/ReprintConfirmScreen';
import { PrinterScreenProto, type PrintedLabel } from './screens/PrinterScreenProto';
import { AlreadyCheckedInScreen, type ReprintOffer } from './screens/AlreadyCheckedInScreen';

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

const MAX_RESULTS = 8;

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

export function Prototype() {
  const [buffer, setBuffer] = useState(params.get('buffer') ?? '');
  const onKey = (key: KioskKey) => {
    if (key.kind === 'char') setBuffer((typed) => typed + key.value);
    else if (key.kind === 'backspace') setBuffer((typed) => typed.slice(0, -1));
    else if (key.kind === 'clear') setBuffer('');
  };

  const screen = params.get('screen') ?? 'reprint';

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
        lines={['Ramona Alvarez', '7th grade', 'Wednesday Night', '6:30 PM']}
        printedAt={params.get('printedAt') ?? '6:41 PM'}
        onPrint={() => {}}
        onBack={() => {}}
      />
    );
  }

  if (screen === 'done') {
    return (
      <AlreadyCheckedInScreen
        student={STUDENTS[0]!}
        offer={(params.get('offer') as ReprintOffer) ?? 'offer'}
        onReprint={() => {}}
        onBack={() => {}}
      />
    );
  }

  if (screen === 'printer') {
    return (
      <PrinterScreenProto
        recent={params.get('recent') === '0' ? [] : RECENT}
        onReprint={() => {}}
        onDone={() => {}}
      />
    );
  }

  return (
    <ReprintScreen
      buffer={buffer}
      outcome={outcomeFor(buffer)}
      presentIds={new Set(params.get('present')?.split(',').filter(Boolean) ?? [])}
      sent={params.get('sent')}
      onKey={onKey}
      onPick={() => {}}
      onDone={() => {}}
    />
  );
}

createRoot(document.getElementById('root')!).render(<Prototype />);
