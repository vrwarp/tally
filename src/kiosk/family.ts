/**
 * Who else at this kiosk belongs to the family standing in front of it.
 *
 * A parent with three children used to type their four digits, tap a name,
 * watch the tick, land back on a cleared screen, and do the whole thing twice
 * more. The kiosk already knows the other two — they came back from the same
 * four digits — so it can offer them instead of making a queue wait through it.
 *
 * ## What counts as a family here
 *
 * The kiosk holds no households. What it holds is `kioskIndex/phones`: a map of
 * `last4 -> student ids`, and *that* is already a statement about families —
 * both collectors build it as "every distinct last-4 across this student's
 * family", aggregated over household (Planning Center) or family-folk
 * (Attendees) co-membership. See each backend's `phoneIndex.ts` under
 * `functions/src`.
 *
 * Inverting it gives each student the set of digits their family answers to,
 * and that construction leaves an invariant worth leaning on: two children of
 * the same household get the *same* set, because each one's set is the union of
 * every number in the households they belong to. A child who is also in a
 * second household — a split family, a grandparent's place — gets a strict
 * superset. So siblings are always equal-or-nested, never merely overlapping.
 *
 * Which is exactly the test used here, and it is not pedantry. Four digits are
 * four digits: in a ministry of a few hundred families, a handful of unrelated
 * pairs will share a tail by coincidence — the phone search already shows them
 * side by side, and a parent picks their own child out of the list. An *offer*
 * cannot be picked out of, so it has to be stricter than the search that fed
 * it. Requiring containment rather than overlap throws out the coincidences
 * where the two families each have a number the other does not, which is most
 * of them, at no cost to any real sibling.
 *
 * What survives is still a guess, so nothing here decides anything: it produces
 * a list of names for a parent to confirm or untick, which is the only party
 * that actually knows who they arrived with.
 */
import { sortByName } from '@/lib/utils';
import type { KioskStudent } from './search';

/**
 * How many others may be offered alongside the child who was tapped.
 *
 * Seven, for eight in all, which is the same number of labels the print queue
 * will hold (`printing/queue.ts`) — a screen that offered more could ask for
 * more stickers than the printer will keep. A group *larger* than that is
 * offered as nothing rather than trimmed: nine children answering to one
 * family's phone number is a digit collision wearing a family's clothes, and
 * picking seven of them alphabetically would only hide that. Those parents
 * check in the way everyone did before this file existed.
 */
export const MAX_FAMILY_OFFER = 7;

/** Student id -> the last-4s their family answers to. */
export type FamilyDigits = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * Inverts the phone index once, so a tap is a lookup rather than a scan.
 *
 * Memoised by the caller on `last4Index`, which changes about once a day.
 */
export function buildFamilyDigits(last4Index: Readonly<Record<string, string[]>>): FamilyDigits {
  const byStudent = new Map<string, Set<string>>();
  for (const [digits, ids] of Object.entries(last4Index)) {
    if (!Array.isArray(ids)) continue;
    for (const id of ids) {
      const held = byStudent.get(id);
      if (held) held.add(digits);
      else byStudent.set(id, new Set([digits]));
    }
  }
  return byStudent;
}

/** Whether every digit in `inner` is also in `outer`. */
function within(inner: ReadonlySet<string>, outer: ReadonlySet<string>): boolean {
  for (const digits of inner) if (!outer.has(digits)) return false;
  return true;
}

/**
 * The others on this kiosk's roster who answer to the same family's numbers.
 *
 * Empty — never a partial answer — when the student is not in the index at all
 * (a quick-added visitor with nothing on file yet), or when the group is
 * implausibly large. The tapped student is never in the result.
 */
export function familyOf(
  student: KioskStudent,
  students: readonly KioskStudent[],
  digits: FamilyDigits,
): KioskStudent[] {
  const own = digits.get(student.id);
  // Stryker disable next-line ConditionalExpression: `buildFamilyDigits` only
  // creates a set when it has a digit to put in it, so a student present in the
  // index always has one. The emptiness test is here because the *type* says a
  // set might be empty, and a family of nobody is not a family.
  if (!own || own.size === 0) return [];

  const kin: KioskStudent[] = [];
  for (const other of students) {
    if (other.id === student.id) continue;
    const theirs = digits.get(other.id);
    /* Stryker disable next-line ConditionalExpression: never empty, as above. */
    if (!theirs || theirs.size === 0) continue;
    if (!within(theirs, own) && !within(own, theirs)) continue;
    kin.push(other);
    if (kin.length > MAX_FAMILY_OFFER) return [];
  }

  return kin.sort(sortByName);
}
