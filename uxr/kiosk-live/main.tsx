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
 *   ?pickup=1                 a gathering that also hands children back
 *   ?title=…                  the gathering's name
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';
import type { KioskBinding } from '@/kiosk/binding';
import type { KioskKey } from '@/kiosk/components/Keyboard';
import { RegistrationFlow } from '@/kiosk/registration/RegistrationFlow';
import type { KioskSearchOutcome, KioskStudent } from '@/kiosk/search';
import { SearchScreen } from '@/kiosk/screens/SearchScreen';

const params = new URLSearchParams(location.search);

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

const binding: KioskBinding = {
  eventId: 'uxr-event',
  seriesId: null,
  title: params.get('title') ?? 'Wednesday Night',
  startAtMs: NOW - 22 * 60_000,
  endAtMs: NOW + 68 * 60_000,
  checkInClosesAtMs: NOW + 98 * 60_000,
  requiresCheckOut: params.get('pickup') === '1',
  allergiesSupported: true,
};

/*
 * One family and their near-misses. The surnames deliberately collide: four
 * letters of "Alva" reach five children across three households, which is the
 * state the standing "not your family?" door exists for.
 */
const STUDENTS: KioskStudent[] = [
  { id: '1', firstName: 'Ramona', lastName: 'Alvarez', grade: 7 },
  { id: '2', firstName: 'Noah', lastName: 'Alvarez', grade: 9 },
  { id: '3', firstName: 'Priya', lastName: 'Alvarez-Bell', grade: 11 },
  { id: '4', firstName: 'Sam', lastName: 'Alvarado', grade: 6 },
  { id: '5', firstName: 'Jonah', lastName: 'Alvarado', grade: 12 },
] as KioskStudent[];

function outcomeFor(buffer: string, nobody: boolean): KioskSearchOutcome {
  const digits = /^\d+$/.test(buffer);
  const mode = !buffer
    ? 'empty'
    : digits
      ? buffer.length === 4
        ? 'phone'
        : 'phone-partial'
      : 'name';
  return { mode, results: buffer && !nobody ? STUDENTS : [] } as KioskSearchOutcome;
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

  if (params.get('screen') === 'register') {
    return (
      <RegistrationFlow
        binding={binding}
        registrationId="uxr-registration"
        // Never settles: the frame under review is the step, not its result.
        submit={() => new Promise(() => {})}
        onRegistered={() => {}}
        onClose={() => {}}
      />
    );
  }

  return (
    <SearchScreen
      binding={binding}
      buffer={buffer}
      onKey={onKey}
      outcome={outcomeFor(buffer, params.get('nomatch') === '1')}
      presentIds={new Set(params.get('present')?.split(',').filter(Boolean) ?? [])}
      checkedOutIds={new Set()}
      tracksCheckOut={binding.requiresCheckOut ?? false}
      printerNeedsAttention={params.get('printer') === '1'}
      refresh="idle"
      widening={false}
      onWiden={() => {}}
      onPick={() => {}}
      onRegister={() => {}}
      onStaffGate={() => {}}
    />
  );
}

createRoot(document.getElementById('root')!).render(<Kiosk />);
