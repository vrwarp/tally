/**
 * The seeded ministry — the world `setup_tally_integration` provisions, with a
 * term of history behind it.
 *
 * The cast is deliberately disjoint from the Planning Center simulator's so a
 * merged two-backend roster reads as two congregations, not as duplicates.
 * A few rows exist to exercise specific seams: a CJK second name (the
 * composite-name convention), a birthday with the app's own 1800 year-unknown
 * sentinel, an allergy, a family with contacts, a student with no family at
 * all, and one with no grade on file.
 */
import { ATTENDANCE_CATEGORIES, type A32SimulatorStore } from './store.js';

export function seedDefaultOrganization(store: A32SimulatorStore): void {
  const priya = store.seedStudent({
    firstName: 'Priya',
    lastName: 'Raghunathan',
    gender: 'FEMALE',
    grade: 9,
    actualBirthday: '2011-03-14',
    allergies: 'Tree nuts',
    parents: [
      {
        firstName: 'Meena',
        gender: 'FEMALE',
        contacts: { phone1: '555-0311', email1: 'meena.raghunathan@example.org' },
      },
    ],
  });

  const wei = store.seedStudent({
    firstName: 'Wei',
    lastName: 'Suzuki',
    firstName2: '偉',
    lastName2: '鈴木',
    gender: 'MALE',
    grade: 11,
    // The day is known, the year is not — the app's own 1800 sentinel.
    estimatedBirthday: '1800-09-02',
    parents: [
      {
        firstName: 'Hana',
        gender: 'FEMALE',
        contacts: { phone1: '555-0322' },
      },
    ],
  });

  const tomas = store.seedStudent({
    firstName: 'Tomás',
    lastName: 'Beltrán',
    gender: 'MALE',
    grade: 7,
    actualBirthday: '2013-11-30',
    parents: [{ firstName: 'Rodrigo', gender: 'MALE', contacts: { email1: 'rodrigo.beltran@example.org' } }],
  });

  // No family folk at all — the row the plural datagrid endpoint hides and
  // the bare sweep must still find.
  const nkechi = store.seedStudent({
    firstName: 'Nkechi',
    lastName: 'Obasanjo',
    gender: 'FEMALE',
    grade: 10,
    actualBirthday: '2010-06-21',
  });

  // No grade on file: lands on the band floor with gradeOnFile false.
  const salote = store.seedStudent({
    firstName: 'Salote',
    lastName: 'Fifita',
    gender: 'FEMALE',
    grade: null,
    parents: [{ firstName: 'Losana', gender: 'FEMALE', contacts: { phone1: '555-0344' } }],
  });

  const dmitri = store.seedStudent({
    firstName: 'Dmitri',
    lastName: 'Volkov',
    gender: 'MALE',
    grade: 12,
    actualBirthday: '2008-01-05',
    allergies: 'Shellfish',
    parents: [
      { firstName: 'Irina', gender: 'FEMALE', contacts: { phone1: '555-0355', email1: 'irina.volkov@example.org' } },
    ],
  });

  const aroha = store.seedStudent({
    firstName: 'Aroha',
    lastName: 'Ngata',
    gender: 'FEMALE',
    grade: 8,
    actualBirthday: '2012-08-17',
    parents: [{ firstName: 'Wiremu', gender: 'MALE', contacts: { phone1: '555-0366' } }],
  });

  const eight = [priya, wei, tomas, nkechi, salote, dmitri, aroha];

  // Eight weekly Friday gatherings, ending in the near past, with a settled
  // pattern: the regulars come most weeks, others drift.
  const fridayOf = (weeksAgo: number): { start: string; finish: string } => {
    const now = new Date();
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 2) % 7) - weeksAgo * 7);
    start.setUTCHours(19, 0, 0, 0);
    const finish = new Date(start);
    finish.setUTCHours(21, 0, 0, 0);
    return { start: start.toISOString(), finish: finish.toISOString() };
  };

  for (let weeksAgo = 8; weeksAgo >= 1; weeksAgo -= 1) {
    const { start, finish } = fridayOf(weeksAgo);
    const gathering = store.seedGathering(start, finish);
    eight.forEach((student, index) => {
      // A deterministic drift: everyone attends except when their index
      // collides with the week — and one scheduled-but-absent row per week,
      // which the importer must count as skipped, never as attendance.
      if ((index + weeksAgo) % 5 === 0) {
        store.seedAttendance(gathering, student.id, ATTENDANCE_CATEGORIES.scheduled);
      } else if ((index + weeksAgo) % 7 !== 3) {
        store.seedAttendance(gathering, student.id, ATTENDANCE_CATEGORIES.attended);
      }
    });
  }
}
