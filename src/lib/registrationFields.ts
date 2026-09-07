/**
 * What a registration field may contain, in one place.
 *
 * These rules were written for the lobby kiosk and enforced in the Cloud
 * Function behind it. The Review screen now edits the same fields — a reviewer
 * correcting the surname a parent fat-fingered on a touchscreen — and a second
 * copy of "a name may not contain digits" is exactly the kind of drift this
 * repo already refuses elsewhere: a form that accepts what the server will
 * refuse wastes a round trip and reports the refusal in a different voice, and
 * a form that refuses what the server accepts silently narrows the product.
 *
 * So: one module, shared verbatim with the functions package through
 * `scripts/sync-functions-shared.mjs`, imported by both the door's validator
 * and the reviewer's form.
 *
 * The shape is `{ ok }` rather than a throw, because the two callers want
 * opposite things from a failure. The server turns it into an
 * `invalid-argument`; the form paints it under the box that caused it, which
 * needs the sentence in hand rather than in a catch. The sentences themselves
 * are the ones the door has always used.
 *
 * Imports nothing, on purpose — that is the price of being shareable.
 */

/** Long enough for any real name, short enough that nothing is a paragraph. */
export const NAME_MAX_LENGTH = 40;

/** Held for the reviewer on the registration record, then sent upstream. */
export const ALLERGIES_MAX_LENGTH = 200;

/**
 * Pre-K through 12th grade: `-1` is Pre-K, `0` is kindergarten.
 *
 * Mirrors `Grade` in src/types/index.ts, which cannot be imported here — this
 * module imports nothing, so that the functions package can take it verbatim.
 */
export const MIN_GRADE = -1;
export const MAX_GRADE = 12;

/**
 * Whose name is being complained about.
 *
 * The subject of the sentence, as a token rather than as the sentence's first
 * four words. English can prefix it — "The child's first name is required." —
 * and Chinese cannot, so the pair is one whole message per subject rather than
 * a noun glued to a frame. See `FIELD_MESSAGES`.
 */
export type FieldSubject = 'childFirst' | 'childLast' | 'adultFirst' | 'adultLast';

/** What is wrong with a name. */
export type NameProblem = 'required' | 'tooLong' | 'hasNumbers' | 'needsLetter';

/**
 * Every refusal these rules can make, as a code.
 *
 * A code rather than a sentence because this module is copied verbatim into the
 * Cloud Functions (see the note at the top) and therefore cannot reach a
 * catalogue — while both of its callers can. The kiosk's door turns one into an
 * `invalid-argument`; the Review screen's form paints one under the box that
 * caused it. Each says it in the language its reader is using.
 */
export type FieldCode =
  | `field.${FieldSubject}.${NameProblem}`
  | 'field.gradeRange'
  | 'field.phoneRequired'
  | 'field.phoneDigits'
  | 'field.phoneShape'
  | 'field.allergyText'
  | 'field.allergyTooLong';

export type FieldCheck<T> = { ok: true; value: T } | { ok: false; code: FieldCode };

function bad<T>(code: FieldCode): FieldCheck<T> {
  return { ok: false, code };
}

/**
 * The English for every code, which is the wire's own copy.
 *
 * Here rather than in the catalogue because the server needs it: an
 * `HttpsError`'s `message` is what a log line records and what a client older
 * than the deploy falls back to. `tests/serverCodes.test.ts` holds this table
 * and `messages/en.json` to the same words, so there is one English rather than
 * two that drift.
 */
export const FIELD_MESSAGES: Record<FieldCode, string> = {
  'field.childFirst.required': "The child's first name is required.",
  'field.childFirst.tooLong': "The child's first name is too long.",
  'field.childFirst.hasNumbers': "The child's first name cannot contain numbers.",
  'field.childFirst.needsLetter': "The child's first name needs at least one letter.",
  'field.childLast.required': "The child's last name is required.",
  'field.childLast.tooLong': "The child's last name is too long.",
  'field.childLast.hasNumbers': "The child's last name cannot contain numbers.",
  'field.childLast.needsLetter': "The child's last name needs at least one letter.",
  'field.adultFirst.required': "The adult's first name is required.",
  'field.adultFirst.tooLong': "The adult's first name is too long.",
  'field.adultFirst.hasNumbers': "The adult's first name cannot contain numbers.",
  'field.adultFirst.needsLetter': "The adult's first name needs at least one letter.",
  'field.adultLast.required': "The adult's last name is required.",
  'field.adultLast.tooLong': "The adult's last name is too long.",
  'field.adultLast.hasNumbers': "The adult's last name cannot contain numbers.",
  'field.adultLast.needsLetter': "The adult's last name needs at least one letter.",
  'field.gradeRange': 'grade must be a whole number from -1 (Pre-K) to 12, or null.',
  'field.phoneRequired': 'A phone number is required.',
  'field.phoneDigits': 'Enter a 10-digit phone number.',
  'field.phoneShape': 'That does not look like a phone number.',
  'field.allergyText': 'allergies must be text.',
  'field.allergyTooLong': 'That allergy note is too long.',
};

/**
 * A name as a person typed it on a lobby keyboard, or as a reviewer retyped it
 * on a laptop.
 *
 * Digits are refused rather than stripped: "Room 3" and "555-0123" in a name
 * field are somebody misreading the question, and silently keeping "Room"
 * would put that on a sticker. Apostrophes and hyphens are kept — O'Brien and
 * Anne-Marie are names, and the kiosk keyboard has both keys for this reason.
 *
 * `subject` says whose name it is, so the refusal reads as "The child's first
 * name is required." from either end — in whichever language the end is
 * reading. See `FieldSubject`.
 */
export function checkName(raw: unknown, subject: FieldSubject): FieldCheck<string> {
  const wrong = (problem: NameProblem): FieldCheck<string> =>
    bad(`field.${subject}.${problem}` as FieldCode);
  if (typeof raw !== 'string') return wrong('required');
  const value = raw.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (value.length === 0) return wrong('required');
  if (value.length > NAME_MAX_LENGTH) return wrong('tooLong');
  if (/\d/.test(value)) return wrong('hasNumbers');
  if (!/\p{L}/u.test(value)) return wrong('needsLetter');
  return { ok: true, value };
}

/**
 * A grade, or the absence of one.
 *
 * Null is an answer rather than a blank — a child too young for a grade has
 * none — which is why this takes it happily and why nothing downstream
 * substitutes a zero for it. The floor is `-1` and not zero: that is Pre-K,
 * and a door that refused it would refuse the children a nursery registers
 * most.
 */
export function checkGrade(raw: unknown): FieldCheck<number | null> {
  if (raw === null || raw === undefined) return { ok: true, value: null };

  /*
   * Its own guard, and not folded into the test below, because that is the
   * only arrangement in which the comment on it can be believed.
   *
   * The clause changes no answer at run time: `Number.isInteger` already
   * refuses everything that is not a number. It is here for the narrowing —
   * without it `raw` is still `unknown` at the comparisons and at `value: raw`.
   * Saying so to Stryker needs a `disable next-line`, and that directive
   * matches by line, against a node that *starts* on it. A comment sitting
   * inside a parenthesised condition is attached to the whole expression and
   * silently disables nothing, which is worse than no comment at all.
   */
  // Stryker disable next-line ConditionalExpression: see above — no input reaches
  // this guard that the integer check below would not refuse anyway.
  if (typeof raw !== 'number') return bad('field.gradeRange');
  if (!Number.isInteger(raw) || raw < MIN_GRADE || raw > MAX_GRADE) return bad('field.gradeRange');
  return { ok: true, value: raw };
}

/**
 * Ten digits, however they were punctuated.
 *
 * A repdigit — 0000000000, 5555555555 — is refused because it is what somebody
 * types to get past a field they do not want to answer, and the whole point of
 * the number is that four of its digits are a key their family will use next
 * week. A leading US country code is dropped rather than refused: 1 followed by
 * ten digits is the same number written longer.
 */
export function checkPhone(raw: unknown): FieldCheck<string> {
  if (typeof raw !== 'string') return bad('field.phoneRequired');
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) return bad('field.phoneDigits');
  // Every digit the same. Spelled out rather than as `/^(\d)\1{9}$/`, which
  // restates the ten the line above has just enforced — and would go on
  // meaning "ten" if that number ever changed.
  if ([...digits].every((digit) => digit === digits[0])) {
    return bad('field.phoneShape');
  }
  return { ok: true, value: digits };
}

/**
 * One allergy note, or nothing.
 *
 * Empty and whitespace both mean "nothing recorded" rather than an empty
 * string, so a note cleared on the Review screen is indistinguishable from one
 * the family never wrote — which is what it is.
 */
export function checkAllergyNote(raw: unknown): FieldCheck<string | null> {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== 'string') return bad('field.allergyText');
  const value = raw.trim();
  if (value.length === 0) return { ok: true, value: null };
  if (value.length > ALLERGIES_MAX_LENGTH) return bad('field.allergyTooLong');
  return { ok: true, value };
}
