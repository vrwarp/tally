/**
 * A roster with allergies on it, and the notes that arrive a beat later.
 *
 * The seeded ministry has the right shape for this — five of its students carry
 * a flag — but the notes behind them are one short phrase each, and the whole
 * subject of these frames is what a *long* one does to a list. Real ones are as
 * long as whoever typed them: a parent naming five nuts, where the EpiPen is,
 * and who to call first.
 *
 * So the cast is the seeded ministry's (`scripts/seed.ts`) and the notes are
 * written for the job, one of them at the length that broke the row. Everybody
 * here is fictional, deliberately: a walkthrough page is a document that gets
 * shared, and a real child's medical note is not something to commit to a
 * repository in order to photograph a badge.
 */
import { makeStudent } from '../../tests/factories';
import type { RosterEntry, RosterWarning, Student } from '@/types';

/** Checked in at 7:35, which is the time every green row in these frames wears. */
export const CHECKED_IN_AT = new Date('2026-02-13T19:35:00');

interface Seat {
  first: string;
  last: string;
  grade: number;
  /** How many of the last three gatherings they came to, for the "2 of 3" hint. */
  hits: number;
  warnings?: RosterWarning[];
  /** What Planning Center answers with, for the ones it is asked about. */
  note?: string;
}

/**
 * Nine students, in the order the roster prints them.
 *
 * Four flags among them and one of each kind of note — a phrase, a sentence,
 * and the paragraph that is the reason for the change — plus Naomi, who carries
 * a second flag after the allergy so the frames can show that the badge beside
 * it does not move either.
 */
const SEATS: readonly Seat[] = [
  { first: 'Amara', last: 'Osei', grade: 8, hits: 3 },
  { first: 'Isaiah', last: 'Brooks', grade: 6, hits: 3, warnings: ['allergy'], note: 'Bee stings' },
  {
    first: 'Layla',
    last: 'Farouk',
    grade: 10,
    hits: 2,
    warnings: ['allergy'],
    note: 'Lactose intolerant — no milk, and no cheese on the pizza night.',
  },
  { first: 'Maya', last: 'Adebayo', grade: 7, hits: 3 },
  {
    first: 'Naomi',
    last: 'Tanaka',
    grade: 12,
    hits: 2,
    warnings: ['allergy', 'record-missing'],
    note: 'Shellfish',
  },
  {
    first: 'Noah',
    last: 'Fitzgerald',
    grade: 6,
    hits: 3,
    warnings: ['allergy'],
    note:
      'Severe tree nut allergy — cashews, walnuts, pecans and pistachios. His EpiPen is in ' +
      'the front pocket of his bag, and his mother should be called before he is given ' +
      'anything to eat.',
  },
  { first: 'Priya', last: 'Patel', grade: 12, hits: 3 },
  {
    first: 'Sofia',
    last: 'Ramirez',
    grade: 8,
    hits: 3,
    warnings: ['allergy'],
    note: 'Peanuts — carries an EpiPen in her bag',
  },
  { first: 'Tyler', last: 'McAllister', grade: 8, hits: 2 },
];

function studentOf(seat: Seat): Student {
  return makeStudent({
    id: `${seat.first}-${seat.last}`.toLowerCase(),
    firstName: seat.first,
    lastName: seat.last,
    grade: seat.grade as Student['grade'],
    hasAllergies: (seat.warnings ?? []).includes('allergy'),
  });
}

/** The roster as it stands before anybody has arrived. */
export const ROSTER: readonly RosterEntry[] = SEATS.map((seat) => ({
  student: studentOf(seat),
  attendance: null,
  rsvp: null,
  isRecent: true,
  hasParticipated: false,
  warnings: seat.warnings ?? [],
  recentHits: seat.hits,
  recentWindow: 3,
}));

/**
 * What `useAllergyNotes` comes back with — the map that lands seconds after the
 * names, and the thing every frame in this walkthrough is timed against.
 */
export const NOTES: ReadonlyMap<string, string> = new Map(
  SEATS.filter((seat) => seat.note).map((seat) => [
    `${seat.first}-${seat.last}`.toLowerCase(),
    seat.note!,
  ]),
);

/** The row the walkthrough follows: the longest note on the list. */
export const NOAH = 'noah-fitzgerald';
