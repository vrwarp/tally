/**
 * Mapping helpers no backend owns.
 *
 * Every people-backend maps its person records into the same Tally shapes, and
 * these are the pieces of that mapping that must not drift between backends —
 * or between the functions package and the app. `searchName` built two ways is
 * a student who stops matching their own roster row; a name-grade key built two
 * ways is a duplicate person. The Planning Center-specific mapping stays in
 * ../pco/mapping.ts, the Attendees-specific mapping in ../attendees32/, and
 * both compose these.
 *
 * Pure functions, no I/O, same discipline as ../pco/mapping.ts: everything here
 * is a function of its arguments.
 */

/* -------------------------------------------------------------------------- */
/* Small string helpers                                                        */
/* -------------------------------------------------------------------------- */

export function trimmed(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const result = value.trim();
  return result.length > 0 ? result : null;
}

/** First non-empty string in the list, already trimmed. */
export function firstNonEmpty(...values: unknown[]): string | null {
  for (const value of values) {
    const result = trimmed(value);
    if (result !== null) return result;
  }
  return null;
}

/** Must stay identical to `buildSearchName` in src/types/index.ts. */
export function buildSearchName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim().toLowerCase().replace(/\s+/g, ' ');
}

/* -------------------------------------------------------------------------- */
/* Names                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Planning Center writes a person with both a first name and a nickname as
 * `Benson “蔡秉洲” Tsai` — the nickname is an *addition* to the first name, not a
 * replacement for it. Tally used to keep only the nickname, which meant a
 * profile the church office reads as "Benson" showed up here as "蔡秉洲" and the
 * two were impossible to line up by eye.
 *
 * The format is Tally's own display convention now, not just Planning Center's:
 * the Attendees backend uses the same composite for its separate CJK name
 * fields, so either spelling finds the student whichever backend they live in.
 */
const NICKNAME_OPEN = '“';
const NICKNAME_CLOSE = '”';

/**
 * The two halves, joined. A nickname equal to the first name is dropped rather
 * than repeated — `Ben “Ben”` is noise.
 *
 * Must stay identical to `composeFirstName` in src/types/index.ts.
 */
export function composeFirstName(firstName: unknown, nickname: unknown): string {
  const legal = trimmed(firstName);
  const nick = trimmed(nickname);

  if (nick === null) return legal ?? '';
  if (legal === null) return nick;
  // The first name is the canonical spelling of the two.
  if (legal.toLowerCase() === nick.toLowerCase()) return legal;
  return `${legal} ${NICKNAME_OPEN}${nick}${NICKNAME_CLOSE}`;
}

/**
 * The composite pulled apart again.
 *
 * Backends store the halves in separate fields, so pushing the whole string
 * into a first-name field would render as `Benson “蔡秉洲” “蔡秉洲” Tsai` on the
 * next read — and a moment later as a duplicate person, because the matcher
 * would stop recognising them. Anything without the quoted section comes back
 * unchanged, which covers every hand-typed visitor name.
 *
 * Must stay identical to `splitFirstName` in src/types/index.ts.
 */
export function splitFirstName(value: string): { firstName: string; nickname: string | null } {
  const match = /^(.*?)\s*[“"]([^”"]*)[”"]\s*$/.exec(value.trim());
  if (!match) return { firstName: value.trim(), nickname: null };

  const legal = match[1]?.trim() ?? '';
  const nickname = match[2]?.trim() ?? '';
  if (nickname.length === 0) return { firstName: legal, nickname: null };
  // `“Benji”` with nothing in front of it is just a name in quotes.
  if (legal.length === 0) return { firstName: nickname, nickname: null };
  return { firstName: legal, nickname };
}

/* -------------------------------------------------------------------------- */
/* Keys and identity                                                           */
/* -------------------------------------------------------------------------- */

/** Must stay identical to `emailKey` in src/types/index.ts. */
export function emailKey(email: string): string {
  return email.trim().toLowerCase().replace(/\./g, ',');
}

/** Must stay identical to `computeProfileComplete` in src/types/index.ts. */
export function computeProfileComplete(input: {
  parentPhone?: string | null;
  parentEmail?: string | null;
}): boolean {
  return Boolean(input.parentPhone?.trim() || input.parentEmail?.trim());
}

/**
 * Identity key for collapsing a quick-added visitor onto the backend person the
 * church office typed in later. Accents and punctuation are dropped because a
 * counselor thumb-typing "Jose" at the door and the office entering "José" are
 * the same child.
 */
export function nameGradeKey(
  firstName: string,
  lastName: string,
  grade: number | null,
): string {
  const normalise = (value: string): string => {
    const folded = value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    const latin = folded.replace(/[^a-z0-9]+/g, ' ').trim();
    // A name with no Latin letters at all — 蔡秉洲 — would otherwise normalise to
    // the empty string, and every such child in a grade would share one key and
    // be merged into whichever came first. Keep the characters instead.
    return latin.length > 0 ? latin : folded.replace(/\s+/g, ' ').trim();
  };
  // Two grade-less children of the same name are *not* assumed to be the same
  // person: a nursery is full of people with no grade, and collapsing them on
  // a name collision would merge two real children into one record.
  return `${normalise(firstName)}|${normalise(lastName)}|${grade ?? `none:${normalise(firstName)}${normalise(lastName)}`}`;
}

/**
 * Deterministic ordering for backend ids. Numeric where possible so "9" sorts
 * before "10", falling back to string order for anything else — a UUID-keyed
 * backend lands entirely in the fallback, which is fine. The point is only that
 * repeated reads pick the same record every time.
 */
export function compareIds(a: string, b: string): number {
  const left = Number(a);
  const right = Number(b);
  if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left - right;
  return a < b ? -1 : a > b ? 1 : 0;
}

/* -------------------------------------------------------------------------- */
/* Grades                                                                      */
/* -------------------------------------------------------------------------- */

export interface GradeRange {
  minGrade: number;
  maxGrade: number;
}

/**
 * The grade a student document carries, from whatever the backend holds.
 *
 * A passthrough now, and the name is kept only because the call sites read
 * well: nothing is clamped, and a blank stays blank.
 *
 * It used to round every value into the configured band and report
 * `gradeOnFile: raw !== null` beside it — which tracked whether the upstream
 * value was *blank*, not whether it had been clamped. So a real 3rd grader
 * arrived as `{ grade: 6, gradeOnFile: true }`: Tally asserting, as a fact,
 * that a child in 3rd grade was in 6th. The band's job is to decide who is on
 * the roster, not to rewrite a child's grade into it.
 */
export function clampGrade(raw: number | null): { grade: number | null } {
  return { grade: raw };
}
