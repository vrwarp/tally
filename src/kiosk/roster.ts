/**
 * Joining the backends' people to Tally's own student documents, for the kiosk.
 *
 * Pure, and in its own module for the reason `features/roster/mergeRoster.ts`
 * is: `services.ts` has to import Firebase to do the fetching, and this is the
 * part worth testing without one. The kiosk needs its own copy rather than the
 * app's because it works in `KioskStudent` — six fields, no dates, no notes —
 * and because `mergeRoster` reaches into `Student`, which would drag the app's
 * converters into a bundle that has a hard budget.
 *
 * **The join is by linkage, not by id.** That is the whole point of this file
 * existing, and it is what the kiosk used to get wrong: a visitor Tally created
 * keeps their generated document id for ever — attendance, RSVPs and the
 * prediction window all point at it, and the push deliberately never renames
 * the document — while the *person* the push created upstream comes back from
 * the roster read under `pco_123`. Keying a map on ids alone put both in it, so
 * every quick-added visitor split into two identical rows on the lobby screen
 * the moment their push landed. A parent then had a coin-flip between them, and
 * the wrong half of the flip wrote a check-in against an id no roster row in
 * the app answers to — so the child read as absent to the people looking.
 *
 * The four cases and the order of the checks are `mergeRoster`'s, deliberately:
 * the two joins must not disagree about which id names a row, or a child
 * checked in at the door stops being the child the app is looking at.
 *
 * One window this cannot close, and it is worth knowing about rather than
 * chasing: a push creates the person upstream, re-sends whatever the create
 * silently dropped, and only then stamps the document — so for the length of
 * those round trips the person is on the roster read and the document does not
 * yet name them. Nothing links the two in that gap, and a kiosk that refreshes
 * inside it holds both until its next read. That is sub-second, and it heals
 * itself; the bug this file exists to fix did neither.
 */
import { isBackendId, studentIdFor } from '@/lib/backendIds';
import { asGrade, type PcoRosterPerson } from '@/types';
import type { KioskStudent } from './search';

/** A student document as the kiosk reads it — id and raw fields. */
export interface KioskRosterDocument {
  id: string;
  data: Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * The row id this document's person is also reachable under — `pco_123`,
 * `a32_{uuid}` — or null for a visitor no backend holds yet.
 *
 * The generic linkage names the backend when the server wrote it; a bare
 * `pcoPersonId` is the older linkage and has always meant Planning Center.
 */
function linkedStudentId(data: Record<string, unknown>): string | null {
  const personId = text(data.upstreamPersonId) || text(data.pcoPersonId);
  if (!personId) return null;
  const named = text(data.upstreamBackend);
  return studentIdFor(isBackendId(named) ? named : 'pco', personId);
}

function fromPerson(person: PcoRosterPerson): KioskStudent {
  return {
    id: person.id,
    firstName: person.firstName,
    lastName: person.lastName,
    // `asGrade`, because a roster row carries whatever the backend holds — and
    // what it holds is sometimes not a grade. See `KioskStudent.grade`.
    grade: asGrade(person.grade),
    searchName: person.searchName,
    // The flag, never the note — the roster read carries one and not the other
    // on purpose, and the kiosk is the last place to blur that. What it buys is
    // the label asking about one child instead of four hundred.
    hasAllergies: person.hasAllergies === true,
  };
}

/** Null for a document with no name of its own, which is not a row. */
function fromDocument(document: KioskRosterDocument): KioskStudent | null {
  const firstName = text(document.data.firstName);
  const lastName = text(document.data.lastName);
  if (!firstName && !lastName) return null;
  return {
    id: document.id,
    firstName,
    lastName,
    grade: asGrade(document.data.grade),
    searchName: text(document.data.searchName) || `${firstName} ${lastName}`.trim().toLowerCase(),
    // Always false, and not for want of looking: `noMirroredPersonalData` in
    // firestore.rules refuses an `allergies` key on a student document, so a
    // visitor no backend holds yet has nowhere for one to be. Once their push
    // lands they come back through the roster read with the real answer.
    hasAllergies: false,
  };
}

/**
 * The searchable roster: the backends' people, with Tally's own documents
 * folded in.
 *
 *  - A document whose id *is* a backend person id (`pco_123`) is an annotation.
 *    The backend keeps the name and the grade, and the kiosk wants nothing else
 *    off the document — so it folds in silently rather than standing up a row.
 *  - A document for a visitor Tally created and has since linked to a backend
 *    person takes the roster entry's *fields* while the row keeps the
 *    document's id, because that id is what every attendance record points at.
 *  - The same person reachable under a linked document *and* an explicit
 *    `pco_123` membership document is one row, under the backend's own id.
 *  - A document for a visitor who does not exist upstream stands on its own,
 *    with the name that was typed at the door.
 */
export function joinKioskRoster(
  documents: readonly KioskRosterDocument[],
  people: readonly PcoRosterPerson[],
): KioskStudent[] {
  const byId = new Map<string, KioskStudent>();
  for (const person of people) {
    if (person.status === 'active') byId.set(person.id, fromPerson(person));
  }

  const documentIds = new Set(documents.map((document) => document.id));
  // Where each grafted person's row went, so a second document linked to the
  // same person — two quick-adds the push matched to one child — folds into
  // that row instead of standing up a duplicate.
  const grafted = new Map<string, string>();

  for (const document of documents) {
    const linkedId = linkedStudentId(document.data);
    const direct = byId.get(document.id);
    const viaLink = direct
      ? undefined
      : linkedId
        ? // Stryker disable next-line StringLiteral: the fallback is only read
          // when this person has not been grafted, and then any string that is
          // not a row id does. Every key in `byId` is either a prefixed person
          // id or a Firestore document id, and neither can be empty — so no
          // string here is distinguishable from another by anything observable.
          (byId.get(linkedId) ?? byId.get(grafted.get(linkedId) ?? ''))
        : undefined;
    const target = direct ?? viaLink;

    if (!target) {
      /*
       * A document that names an upstream person the roster did not return is
       * not a row: somebody was removed, or their person was deleted or merged.
       * Either way the document holds no name — names are the backend's and are
       * never stored — so drawing it would put a blank line on the lobby glass.
       */
      const own = fromDocument(document);
      if (own) byId.set(document.id, own);
      continue;
    }

    /*
     * `!direct && linkedId` cannot be dropped, and cannot be weakened to `||`,
     * without both being equivalent — which is worth writing down rather than
     * rediscovering, because a reader's instinct is that a guard this long has
     * a redundant limb. Reaching here at all means `target` exists, which means
     * either `direct` did, or `viaLink` did and `linkedId` was truthy to find
     * it. In the `direct` case `target.id` is the document's own id, so
     * `target.id === linkedId` can only hold when `documentIds` contains it,
     * and the last limb is then false anyway. Both halves are load-bearing for
     * a reader and neither is for a machine.
     */
    // Stryker disable next-line ConditionalExpression,LogicalOperator: see above.
    if (!direct && linkedId && target.id === linkedId && !documentIds.has(linkedId)) {
      /*
       * A linked visitor whose person the roster answered for, with no
       * membership document of their own: the row keeps the document's id and
       * takes the backend's fields.
       *
       * The id is the part history hangs off, and the part the kiosk is about
       * to write a check-in against — so it must go on being the document's, or
       * a child ticked ten minutes ago stops looking ticked the moment a push
       * lands. A grade typed at quick-add still beats nothing upstream.
       */
      byId.delete(linkedId);
      grafted.set(linkedId, document.id);
      byId.set(document.id, {
        ...target,
        id: document.id,
        grade: target.grade ?? asGrade(document.data.grade),
      });
      continue;
    }

    /*
     * Already the same row. Every field the kiosk holds — name, grade, the
     * allergy flag — is the backend's, so there is nothing to fold in; what
     * matters is that the document is *not* inserted again under its own id.
     */
  }

  return [...byId.values()];
}
