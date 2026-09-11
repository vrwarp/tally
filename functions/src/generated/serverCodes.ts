/*
 * GENERATED FILE — DO NOT EDIT.
 *
 * Copied from src/lib/serverCodes.ts by scripts/sync-functions-shared.mjs, because the
 * functions package deploys on its own and cannot import from src/. Edit the
 * original; `npm run functions:build` regenerates this, and a unit test fails
 * if the two ever disagree.
 */

/**
 * What the server says, as a code rather than a sentence.
 *
 * A Cloud Function that answers "Only the core team can do that." has written
 * English onto a screen the reader may not read in English, and it has done it
 * from a place that cannot reach a catalogue: `functions/` deploys on its own,
 * with no `messages/` and no intl runtime. So the server names *which* sentence
 * and the client says it — the same split `PrinterNote` makes for the kiosk's
 * printing module, and the same one Numbers makes for its `HttpsError`s.
 *
 * Both halves of the wire carry it:
 *
 *   - A **thrown** `HttpsError` puts `{ code, args? }` in its `details`, beside
 *     the debug payload it may already carry. Its `message` stays the English
 *     sentence, which is what an unknown code falls back to and what a log
 *     line records.
 *   - A **returned** outcome — `{ status, message }`, the shape every callable
 *     here answers with — gains the same `code` and `args`. A callable that
 *     succeeds and reports "Created the person in Planning Center." is writing
 *     to a screen just as surely as one that throws.
 *
 * `args` are the parts that are not translatable: a backend's product name, a
 * person's name, a count. Never a clause — a verb phrase interpolated into a
 * sentence is a sentence in two halves, and a language that reorders them
 * cannot put it back together. Where a message varies by *what was being done*
 * (`backend.unreachable`), the operation is its own code and the sentence names
 * it whole.
 *
 * Imports nothing, on purpose: `scripts/sync-functions-shared.mjs` copies this
 * verbatim into the functions package, and `tests/functionsShared.test.ts`
 * fails if the copies drift.
 *
 * `tests/serverCodes.test.ts` is the build gate the plan asks for: every code
 * here must have an `Errors.*` entry in `messages/en.json`, and every entry
 * must be a code here. Neither half can rot quietly.
 */

/** Every sentence the server can ask the client to say. */
export const SERVER_CODES = [
  /* ---- Who is asking ---------------------------------------------------- */
  'auth.signIn',
  'auth.signInToRequest',
  'auth.notActive',
  'auth.googleOnly',
  'auth.coreOnly',
  'auth.adminOnly',
  'auth.notOnGathering',
  'auth.kioskOnly',
  'auth.linkNotYours',

  /* ---- Invitations ------------------------------------------------------ */
  'invite.labelRequired',
  'invite.tooManyLive',
  'invite.gatheringNotYours',
  'invite.gone',

  /* ---- What was asked for ----------------------------------------------- */
  'notFound.student',
  'notFound.studentUnlinked',
  'notFound.gathering',
  'notFound.gatheringGone',
  'notFound.personInBackend',
  'notFound.registration',

  /* ---- The backend, as a whole ------------------------------------------ */
  'backend.notConfigured',
  'backend.notConnected',
  'backend.rateLimited',
  'backend.credentialsRejected',
  'backend.noLists',
  'backend.noHistory',
  'backend.pairingBusy',

  /*
   * "Could not reach X to Y." — one code per Y, because Y is a verb phrase and
   * a verb phrase is not an argument. See the note at the top of this file.
   */
  'backend.unreachable.roster',
  'backend.unreachable.student',
  'backend.unreachable.allergies',
  'backend.unreachable.phoneIndex',
  'backend.unreachable.lists',
  'backend.unreachable.listMembers',
  'backend.unreachable.eventList',
  'backend.unreachable.eventImport',
  'backend.unreachable.search',
  'backend.unreachable.contactCheck',
  'backend.unreachable.personCheck',
  'backend.unreachable.parentContact',
  'backend.unreachable.profileSave',
  'backend.unreachable.parentAdd',
  'backend.unreachable.recreate',

  /*
   * The shared field rules' refusals, from `registrationFields.ts` — one whole
   * sentence per subject and problem rather than a noun glued to a frame, for
   * the reason `FieldSubject` gives.
   */
  'field.childFirst.required',
  'field.childFirst.tooLong',
  'field.childFirst.hasNumbers',
  'field.childFirst.needsLetter',
  'field.childLast.required',
  'field.childLast.tooLong',
  'field.childLast.hasNumbers',
  'field.childLast.needsLetter',
  'field.adultFirst.required',
  'field.adultFirst.tooLong',
  'field.adultFirst.hasNumbers',
  'field.adultFirst.needsLetter',
  'field.adultLast.required',
  'field.adultLast.tooLong',
  'field.adultLast.hasNumbers',
  'field.adultLast.needsLetter',
  'field.gradeRange',
  'field.phoneRequired',
  'field.phoneDigits',
  'field.phoneShape',
  'field.allergyText',
  'field.allergyTooLong',
] as const;

export type ServerCode = (typeof SERVER_CODES)[number];

/**
 * A sentence the client will say, named by the server.
 *
 * `args` fill the message's ICU slots. Keep them to nouns the catalogue cannot
 * hold: a product name, somebody's first name, a number.
 */
export interface ServerText {
  code: ServerCode;
  args?: Record<string, string | number>;
}

/** True for a `details` payload carrying a code this client understands. */
export function isServerText(value: unknown): value is ServerText {
  if (typeof value !== 'object' || value === null) return false;
  const code = (value as { code?: unknown }).code;
  return typeof code === 'string' && (SERVER_CODES as readonly string[]).includes(code);
}
