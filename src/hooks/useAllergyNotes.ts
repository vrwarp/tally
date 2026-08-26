/**
 * The allergy line for the students on screen who have one.
 *
 * The check-in roster carries `hasAllergies` and never the note — that split is
 * deliberate and still holds, because it is what keeps four hundred children's
 * medical notes off every device that opens the app. What it cost was the point
 * of the badge: `⚠ Allergy` on a row a counselor is about to tap tells them to
 * go and look somewhere else, and at a door with a queue nobody does. So the
 * note is fetched for the few rows already wearing the flag, and for nobody
 * else.
 *
 * One request for the lot of them, not one per row: `getAllergyNotes` takes a
 * list. Ids already asked about are never asked about again — the answer is
 * held for the session, in a module-level map, because the roster rebuilds on
 * every check-in and re-renders on every keystroke in the search box.
 *
 * Failure is silent on purpose. A row whose note could not be read shows the
 * badge it showed before any of this existed, which still says the true and
 * important half: check this student.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { getAllergyNotes } from '@/services/functions';
import { linkageOfStudent, type BackendId, type RosterEntry } from '@/types';

/** Backend person id -> the note, for as long as the tab is open. */
const held = new Map<string, string>();

/** Person ids already asked about, answered or not. */
const asked = new Set<string>();

/** Empty rather than absent, so a caller never has to branch on "not asked yet". */
const NOTHING: ReadonlyMap<string, string> = new Map();

/** Drops what the session holds. For a test, and for after an allergy is edited. */
export function invalidateAllergyNotes(): void {
  held.clear();
  asked.clear();
}

/**
 * The person whose upstream record a roster row's note would come from, named
 * with their backend — the mixed-roster request shape.
 *
 * Both halves out of one call. Naming the backend per person and then deriving
 * the id with `personIdFromStudentId` dropped every Attendees student on the
 * floor, because that helper answers for Planning Center alone — so the shape
 * built to carry a mixed roster could only ever carry half of one.
 */
function personKeyOf(entry: RosterEntry): { backendId: BackendId; personId: string } | null {
  return linkageOfStudent(entry.student);
}

/**
 * Student id -> allergy note, for the entries given. Students with no note, no
 * flag, or no answer yet are simply absent.
 */
export function useAllergyNotes(entries: readonly RosterEntry[]): ReadonlyMap<string, string> {
  /*
   * A snapshot of the module map rather than the map itself, so that an answer
   * landing re-renders the rows waiting for it. Seeded from what the session
   * already holds: coming back to check-in from another screen should not repaint
   * the badges a beat later than the names.
   */
  const [answers, setAnswers] = useState<ReadonlyMap<string, string>>(() =>
    held.size > 0 ? new Map(held) : NOTHING,
  );

  /*
   * Guards the state update, and is tied to the component's life rather than to
   * the effect's. That is the whole point: the effect re-runs on every roster
   * rebuild, and a read started by one run has to be allowed to land during the
   * next. Cancelling per run would mark those ids asked and then discard the
   * answer they came back with.
   */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    const wanted: Array<{ backendId: BackendId; personId: string }> = [];
    for (const entry of entries) {
      if (!entry.student.hasAllergies) continue;
      const key = personKeyOf(entry);
      // A visitor who exists only in Tally has nothing upstream to read — and
      // never carries the flag anyway, since it comes from the roster read.
      if (!key || asked.has(key.personId)) continue;
      asked.add(key.personId);
      wanted.push(key);
    }
    if (wanted.length === 0) return;

    /*
     * Two request shapes at once, split by backend rather than duplicated:
     * bare ids for the Planning Center people — the only field a server from
     * before the second backend reads — and backend-named keys for everybody
     * else. A new server folds both into one per-backend ask.
     */
    void getAllergyNotes({
      pcoPersonIds: wanted.filter((key) => key.backendId === 'pco').map((key) => key.personId),
      personKeys: wanted.filter((key) => key.backendId !== 'pco'),
    })
      .then((response) => {
        let added = false;
        for (const [personId, note] of Object.entries(response.data.notes)) {
          const text = note.trim();
          if (!text) continue;
          held.set(personId, text);
          added = true;
        }
        if (added && alive.current) setAnswers(new Map(held));
      })
      .catch(() => {
        /*
         * Deliberately not retried and deliberately not announced. The badge
         * degrades to the word on its own — the same warning this screen gave
         * before it could read notes at all — and an error banner about medical
         * notes is the last thing a counselor with a queue in front of them
         * needs. Forgetting the ids is what lets the next roster rebuild try
         * again, which on a flaky hallway connection is the recovery.
         */
        for (const key of wanted) asked.delete(key.personId);
      });
  }, [entries]);

  return useMemo(() => {
    if (answers.size === 0) return NOTHING;

    const byStudent = new Map<string, string>();
    for (const entry of entries) {
      if (!entry.student.hasAllergies) continue;
      const personId = personKeyOf(entry)?.personId;
      const note = personId ? answers.get(personId) : undefined;
      if (note) byStudent.set(entry.student.id, note);
    }
    return byStudent;
  }, [entries, answers]);
}
