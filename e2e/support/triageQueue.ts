/**
 * A queue of families to review, arranged to hold every state the screen has.
 *
 * One card is easy to design for. A *queue* is the job: five families where
 * three are routine and two are the ones a reviewer must not miss, and whether
 * the screen makes those two findable in a glance is the whole question. This
 * builds that queue against whatever roster the emulator was seeded with, so it
 * survives the seed changing under it: the duplicate hints point at students it
 * looks up by hand rather than at ids written down here.
 *
 * Used by the UXR capture (which photographs it) and by the triage specs (which
 * assert on it), because a state worth designing for is a state worth testing.
 */
import { readCollection } from './emulator';
import { removeRegistration, seedRegistration, type SeededRegistration } from './registrations';

const DAY = 24 * 60 * 60_000;

export interface SeededTriageQueue {
  /** The five registration ids, newest first — the order the screen shows. */
  registrationIds: string[];
  /** The roster row the "already on the roster" hint points at. */
  duplicateOfId: string;
  /** A row whose name lives in a backend, so the screen cannot print it. */
  unnamedId: string | null;
  remove: () => Promise<void>;
}

/**
 * A roster row that has a name here, and one that deliberately does not.
 *
 * A student linked to a backend keeps their name upstream, so `summarise`
 * answers `known: false` and the screen says "a student on the roster" instead
 * of an empty line. That case is worth photographing and worth testing, and it
 * only exists if the seed happens to hold one — hence the null.
 */
async function pickRosterRows(): Promise<{ named: { id: string; firstName: string; lastName: string }; unnamed: string | null }> {
  const students = await readCollection('students');
  const active = students.filter((doc) => doc.data.status === 'active');
  const named = active.find(
    (doc) => typeof doc.data.firstName === 'string' && (doc.data.firstName as string).length > 0,
  );
  if (!named) throw new Error('The seeded roster holds no named student to duplicate.');
  const unnamed = active.find(
    (doc) => typeof doc.data.firstName !== 'string' || (doc.data.firstName as string).length === 0,
  );
  return {
    named: {
      id: named.id,
      firstName: named.data.firstName as string,
      lastName: (named.data.lastName as string) ?? '',
    },
    unnamed: unnamed?.id ?? null,
  };
}

export async function seedTriageQueue(): Promise<SeededTriageQueue> {
  const { named, unnamed } = await pickRosterRows();
  const duplicateHint = unnamed ? [named.id, unnamed] : [named.id];

  const rows: SeededRegistration[] = [
    /*
     * The one that has to be caught. A child typed in with a name the roster
     * already holds — the commonest way a duplicate is born, and the case the
     * door records rather than refuses.
     */
    {
      registrationId: 'uxr-triage-duplicate',
      source: 'qr',
      agoMs: 40 * 60_000,
      guardian: { firstName: 'Priya', lastName: named.lastName || 'Raman', phone: '5550142299' },
      children: [
        {
          firstName: named.firstName,
          lastName: named.lastName,
          grade: 6,
          allergies: 'Peanuts — carries an EpiPen',
          possibleDuplicateOf: duplicateHint,
        },
        { firstName: 'Ishaan', lastName: named.lastName || 'Raman', grade: 4 },
      ],
    },
    /* The routine one: a family nobody has met, nothing to decide but yes. */
    {
      registrationId: 'uxr-triage-new-family',
      agoMs: 2 * 60 * 60_000,
      guardian: { firstName: 'Marta', lastName: 'Okonjo', phone: '5550188104' },
      children: [
        { firstName: 'Ade', lastName: 'Okonjo', grade: 7 },
        { firstName: 'Chidi', lastName: 'Okonjo', grade: 5 },
        { firstName: 'Ngozi', lastName: 'Okonjo', grade: null },
      ],
    },
    /*
     * A parent adding a second child to a family the church already has: no
     * guardian was asked for, because their adult is already on file upstream.
     */
    {
      registrationId: 'uxr-triage-sibling',
      agoMs: 26 * 60 * 60_000,
      guardian: null,
      last4: '0347',
      anchorStudentIds: [named.id],
      children: [{ firstName: 'Wren', lastName: named.lastName || 'Adeyemi', grade: 3 }],
    },
    /*
     * The push that half-finished. The record survives *because* pressing the
     * button again can still do something, and the reason is on it.
     */
    {
      registrationId: 'uxr-triage-partial',
      agoMs: 3 * DAY,
      guardian: { firstName: 'Dov', lastName: 'Halevy', phone: '5550117742' },
      lastError:
        'Planning Center refused the parent: a person with that phone number already exists and is not in this household.',
      children: [
        { firstName: 'Noa', lastName: 'Halevy', grade: 8, approved: true },
        { firstName: 'Yael', lastName: 'Halevy', grade: 6 },
      ],
    },
    /*
     * Twenty-six days old: four days from the sweep that takes the guardian's
     * number with it. Doing nothing is itself the decision here, which is the
     * one thing the screen has to say out loud. Its first child was already
     * folded into a roster row by whoever looked last.
     */
    {
      registrationId: 'uxr-triage-expiring',
      agoMs: 26 * DAY,
      guardian: { firstName: 'Beatriz', lastName: 'Salgado', phone: '5550193318' },
      children: [
        { firstName: 'Tomás', lastName: 'Salgado', grade: 9, mergedInto: named.id },
        { firstName: 'Elena', lastName: 'Salgado', grade: 7, possibleDuplicateOf: [named.id] },
      ],
    },
  ];

  for (const row of rows) await seedRegistration(row);

  return {
    registrationIds: rows.map((row) => row.registrationId),
    duplicateOfId: named.id,
    unnamedId: unnamed,
    remove: async () => {
      for (const row of rows) await removeRegistration(row.registrationId, row.children.length);
    },
  };
}
