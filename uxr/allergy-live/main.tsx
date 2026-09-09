/**
 * The check-in roster, mounted from `src/` for the allergy walkthrough.
 *
 * Same argument as `review-live/`: the screen this is about sits behind a
 * sign-in, an emulator suite and a seeded ministry, and a copy of it would
 * drift. So the real `RosterList` renders here against a fixture — the same
 * component `CheckInPage` renders, painted with the app's own stylesheet — and
 * what the shutter catches cannot disagree with what ships.
 *
 * Nothing is stubbed, because nothing needs to be: `RosterList` takes its
 * entries, its open row and its allergy notes as props. What `CheckInPage`
 * supplies from Firestore and Planning Center, this supplies from `fixture.ts`,
 * and the two transitions the walkthrough is about are the two prop changes
 * that carry them:
 *
 *   - the notes map going from empty to answered, which is `useAllergyNotes`
 *     landing;
 *   - a row gaining an `attendance`, which is a check-in.
 *
 * The tap handler is `CheckInPage`'s, copied deliberately rather than imported:
 * a press is a check-in on a row that is not here, and a toggle of the actions
 * strip on one that is. The controls below the roster drive the first
 * transition, which no tap can; they sit outside the shot.
 */
import { useCallback, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { IntlProvider } from 'use-intl';
import '@/index.css';
import { RosterList } from '@/features/checkin/RosterList';
import type { RosterEntry } from '@/types';
import { CHECKED_IN_AT, NOTES, ROSTER } from './fixture';
import { makeAttendance } from '../../tests/factories';
import messages from '../../messages/en.json';

const NO_NOTES: ReadonlyMap<string, string> = new Map();
const EMPTY: ReadonlySet<string> = new Set();

function App() {
  const [here, setHere] = useState<ReadonlySet<string>>(EMPTY);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [landed, setLanded] = useState(false);

  const entries = useMemo<RosterEntry[]>(
    () =>
      ROSTER.map((entry) =>
        here.has(entry.student.id)
          ? {
              ...entry,
              attendance: makeAttendance({
                studentId: entry.student.id,
                checkedInAt: CHECKED_IN_AT,
              }),
            }
          : entry,
      ),
    [here],
  );

  // `CheckInPage.onPress`, minus the swap branch this fixture never enters.
  const onPress = useCallback((entry: RosterEntry) => {
    if (entry.attendance) {
      setExpandedId((current) => (current === entry.student.id ? null : entry.student.id));
      return;
    }
    setHere((current) => new Set(current).add(entry.student.id));
  }, []);

  return (
    <IntlProvider locale="en" messages={messages} timeZone="America/Los_Angeles">
      {/* An open row offers `Profile`, which is a real `<Link>`. */}
      <MemoryRouter>
        <div className="min-h-dvh bg-ink-950 px-3 py-4">
          <RosterList
            title="Regulars"
            description="from the last 3 gatherings"
            entries={entries}
            showRecentHint
            canOpenProfile
            expandedId={expandedId}
            allergyNotes={landed ? NOTES : NO_NOTES}
            flashing={EMPTY}
            busy={EMPTY}
            onPress={onPress}
            onUndo={() => {}}
            onSwap={() => {}}
          />

          {/* Outside every frame — the shutter is pointed at the roster above.
              This is the one transition no tap can make: Planning Center
              answering, which in the app is `useAllergyNotes` resolving. */}
          <div data-controls="" className="pt-8">
            <button type="button" data-land-notes="" onClick={() => setLanded(true)}>
              Land the allergy notes
            </button>
          </div>
        </div>
      </MemoryRouter>
    </IntlProvider>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
