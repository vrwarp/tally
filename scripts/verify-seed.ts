/**
 * End-to-end sanity check against the seeded emulator.
 *
 * `npm run test` proves the algorithms behave on synthetic fixtures. This
 * proves the *seeded ministry* exercises them: that the predictive roster
 * actually narrows the list, that Friday and Sunday histories stay independent,
 * and that the dashboard lists have something in them. Run it after `npm run
 * seed` when you want to see the product working rather than the units passing.
 */
import { deleteApp, initializeApp } from 'firebase/app';
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  terminate,
} from 'firebase/firestore';
import { toEvent, toRsvp, toSettings, toStudent } from '../src/services/converters';
import { buildRoster } from '../src/features/roster/predictiveRoster';
import { computeIncompleteProfiles, computeMia, computeNewVisitors } from '../src/features/dashboard/insights';
import type { EventAttendanceSnapshot, TallyEvent } from '../src/types';

const HOST = '127.0.0.1';
const PORT = 8080;

const app = initializeApp({ projectId: 'demo-tally', apiKey: 'demo-api-key' }, 'tally-verify');
const db = getFirestore(app);
connectFirestoreEmulator(db, HOST, PORT, { mockUserToken: 'owner' });

const students = (await getDocs(collection(db, 'students'))).docs.map(toStudent);
const events = (await getDocs(collection(db, 'events'))).docs.map(toEvent);
const settings = toSettings(await getDoc(doc(db, 'config/settings')));

if (students.length === 0) {
  // Thrown rather than `process.exit`: the app's tsconfig deliberately keeps
  // `types` browser-only, and an uncaught error exits non-zero all the same.
  throw new Error('No students found. Run `npm run seed` against a running emulator first.');
}

const snapshots: EventAttendanceSnapshot[] = [];
for (const event of events) {
  const attendance = await getDocs(collection(db, `events/${event.id}/attendance`));
  const present = new Set(attendance.docs.map((d) => d.id));
  // The whole register, so its emptiness is the gathering's.
  snapshots.push({ event, presentStudentIds: present, held: present.size > 0 });
}

const now = new Date();

function nextInSeries(seriesId: string): TallyEvent {
  const found = events
    .filter((event) => event.seriesId === seriesId && event.checkInClosesAt >= now)
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())[0];
  if (!found) throw new Error(`No upcoming event in series "${seriesId}".`);
  return found;
}

function rosterFor(event: TallyEvent, rsvps: Parameters<typeof buildRoster>[0]['rsvps'] = []) {
  return buildRoster({ event, students, attendance: [], rsvps, history: snapshots, settings });
}

const fridayEvent = nextInSeries('friday-fellowship');
const sundayEvent = nextInSeries('sunday-school');
const friday = rosterFor(fridayEvent);
const sunday = rosterFor(sundayEvent);

console.log(`\nPredictive roster — "at least ${settings.predictiveMinAttended} of the last ${settings.predictiveOfLastN}"\n`);
console.log(
  `  Friday  ${friday.counts.recent} predicted / ${friday.counts.eligible} eligible ` +
    `(${friday.counts.historyWindow} past Fridays)`,
);
console.log(
  `  Sunday  ${sunday.counts.recent} predicted / ${sunday.counts.eligible} eligible ` +
    `(${sunday.counts.historyWindow} past Sundays)`,
);

const regulars = (view: ReturnType<typeof rosterFor>) =>
  new Set(view.entries.filter((entry) => entry.isRecent).map((entry) => entry.student.id));
const fridayIds = regulars(friday);
const sundayIds = regulars(sunday);
const fridayOnly = [...fridayIds].filter((id) => !sundayIds.has(id)).length;
const sundayOnly = [...sundayIds].filter((id) => !fridayIds.has(id)).length;
console.log(
  `  Series stay independent: ${fridayOnly} Friday-only regulars, ${sundayOnly} Sunday-only`,
);

const mia = computeMia(students, snapshots, settings);
const visitors = computeNewVisitors(students, snapshots, settings, now);
const incomplete = computeIncompleteProfiles(students);

console.log('\nDashboard\n');
console.log(
  `  MIA                 ${mia.length}` +
    (mia[0] ? ` (longest: ${mia[0].student.lastName}, ${mia[0].consecutiveMisses} missed)` : ''),
);
console.log(`  New visitors        ${visitors.length}`);
console.log(`  Incomplete profiles ${incomplete.length}`);

const oneOff = events.find((event) => event.mode === 'oneoff');
if (oneOff) {
  const rsvpDocs = await getDocs(collection(db, `events/${oneOff.id}/rsvps`));
  const view = rosterFor(
    oneOff,
    rsvpDocs.docs.map((d) => toRsvp(d, oneOff.id)),
  );
  const declined = rsvpDocs.docs.filter((d) => d.data().status === 'no').length;
  console.log(`\nOne-off "${oneOff.title}"\n`);
  console.log(
    `  Roster restricted to ${view.counts.eligible} RSVPs (of ${students.length} students)`,
  );
  console.log(`  ${declined} declined, and so off the roster`);
}

console.log('');
await terminate(db);
await deleteApp(app);
