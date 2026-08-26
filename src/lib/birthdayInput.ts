/**
 * A birthday as somebody types one into a `MM / DD / YYYY` box.
 *
 * Tally used to ask for this in three controls — a month dropdown, a day box, a
 * year box — which is the shape a form takes when the form is thinking about the
 * database. Nobody says a birthday that way. A leader standing in front of the
 * student who has just answered types `1214`, and the box should do the rest.
 *
 * So there is one box, it takes digits, and this module decides three things
 * from them at once: where the separators go, what is still owed (drawn faded
 * after what has been typed), and what date it all adds up to. One walk over the
 * digits answers all three, which is what keeps them from disagreeing — the
 * sentence under the box can never describe a date the box is not showing.
 *
 * The walk is greedy, and the greed is the whole design:
 *
 *   - **The month takes two digits when two digits are a month.** `12` is
 *     December; `13` is January the 3rd, because there is no thirteenth month;
 *     `4` is April and closes immediately, because no month starts with a 4.
 *   - **Then the day, the same way.** `112` is 2 November, `131` is 31 January.
 *   - **Then the year, up to four digits, and it is optional** — Planning Center
 *     holds a birthday with no year. See `birthdayField.ts`.
 *
 * A slot that could still take another digit is *open*, and an open slot is why
 * `1` shows as `1M / DD / YYYY` rather than guessing between January and
 * December. Nothing is refused while a slot is open: an error that appears on
 * the first keystroke and clears on the fourth teaches nothing and reads as a
 * fault.
 */
import { EARLIEST_BIRTH_YEAR, isRealBirthday } from '@/lib/birthday';

export type BirthdayInputReading =
  /** Nothing typed. */
  | { state: 'empty' }
  /** Could still become a date if they keep going. Say nothing sharp. */
  | { state: 'partial'; /** The year is what is unfinished, rather than the day. */ year: boolean }
  /** Understood, and refused. */
  | { state: 'impossible'; reason: ImpossibleReason }
  /** Understood. `year` is null when they did not give one. */
  | { state: 'read'; month: number; day: number; year: number | null };

export type ImpossibleReason =
  /** 31 February, 31 April — a day that month never has. */
  | 'no-such-day'
  /** 29 February against a year that does not have one. */
  | 'not-that-year'
  /** A year of birth that has not happened. */
  | 'future-year'
  /** Before `EARLIEST_BIRTH_YEAR`, which is nobody on a youth roster. */
  | 'early-year';

/** `MM / DD / YYYY`, one slot at a time. */
export interface BirthdaySlots {
  month: string;
  day: string;
  year: string;
  /** Where the next digit would land: 0 month, 1 day, 2 year, 3 nowhere left. */
  at: 0 | 1 | 2 | 3;
}

const SEPARATOR = ' / ';

/** What each slot holds: how many digits, and which values are legal in it. */
const SLOTS = [
  { size: 2, least: 1, most: 12 },
  { size: 2, least: 1, most: 31 },
  { size: 4, least: 0, most: 9999 },
] as const;

/**
 * The typing, dealt into the three slots.
 *
 * A slot takes a second digit only when a second digit would still leave a value
 * it can hold: `1` waits, because 10, 11 and 12 exist; `4` closes at once,
 * because no month starts with a 4; `13` closes as January and hands the 3 on to
 * the day. That is the greed, and doing it forwards — never re-reading the run
 * from the front — is what stops the month on screen changing its mind about
 * itself because of something typed after it.
 *
 * A separator somebody typed closes the slot it follows, and that is the escape
 * hatch the greed needs: `422013` is 22 April, and `4/2/2013` is the second,
 * because the slash after the 2 said so.
 */
export function birthdaySlots(raw: string): BirthdaySlots {
  const slots = ['', '', ''];
  let at = 0;

  for (const char of raw) {
    if (!/\d/.test(char)) {
      // Leading and doubled separators are noise; one after a digit is a person
      // saying "that slot is finished".
      if (slots[at] !== '') at += 1;
      continue;
    }

    // Down the slots until one can hold this digit, which is how a run with no
    // separators in it spills from month to day to year.
    while (at <= 2 && !accepts(slots[at], char, at)) at += 1;
    if (at > 2) break;

    slots[at] += char;
    if (finished(slots[at], at)) at += 1;
  }

  return { month: slots[0], day: slots[1], year: slots[2], at: slotIndex(at) };
}

/** The walk above counts past the last slot; the type says where it stopped. */
function slotIndex(value: number): 0 | 1 | 2 | 3 {
  if (value <= 0) return 0;
  if (value === 1) return 1;
  return value === 2 ? 2 : 3;
}

/** Whether this slot could hold what it has plus one more digit. */
function accepts(text: string, char: string, at: number): boolean {
  const slot = SLOTS[at];
  const grown = text + char;
  /*
   * Stryker disable next-line ConditionalExpression,BooleanLiteral: a slot that
   * has reached its size is always `finished`, and `finished` moves the walk on
   * before anything asks this — so no test can reach a full slot here. It is
   * kept because it is what makes the line below true in general: for the year,
   * `inRange` alone would accept a fifth zero.
   */
  if (grown.length > slot.size) return false;
  // A first digit is always a prefix of something the slot can hold; a second
  // has to make a real value, or `34` would be a day.
  return grown.length === 1 || inRange(grown, slot);
}

/** Full, or as full as it can usefully get — `9` is September, not the 90th. */
function finished(text: string, at: number): boolean {
  const slot = SLOTS[at];
  /*
   * Stryker disable next-line ConditionalExpression: the walk below answers a
   * full slot the same way — no digit appended to `12`, `31` or a four-digit
   * year lands back in range — so this is the short cut and not the rule. The
   * one apparent exception, a year of `0000`, is caught by the size guard in
   * `accepts` instead.
   */
  if (text.length === slot.size) return true;
  /*
   * Stryker disable next-line EqualityOperator: the slots' ranges are
   * contiguous, so a slot that can take a `9` can take a `0` too and this loop
   * has already returned. Stopping one digit early changes no answer.
   */
  for (let next = 0; next <= 9; next += 1) {
    if (inRange(`${text}${next}`, slot)) return false;
  }
  return true;
}

function inRange(digits: string, slot: { least: number; most: number }): boolean {
  const value = Number(digits);
  return value >= slot.least && value <= slot.most;
}

/**
 * What goes in the box: what has been typed, with the separators the shape calls
 * for — including a trailing one, once a slot is closed and the next is empty.
 *
 * The trailing separator is load-bearing rather than decoration: it is where a
 * typed `/` is *kept*. Without it, `4/` would come back out of the formatter as
 * `4`, be re-read as a month still waiting for a second digit, and quietly
 * un-decide the thing the person had just decided.
 */
export function formatBirthdayInput(raw: string): string {
  const { month, day, year, at } = birthdaySlots(raw);
  // No empty-in-empty-out branch: nothing can close a slot the month has not
  // opened, so an empty month means an empty everything and the template below
  // already comes out as `''`.
  const closed = (slot: number) => (at > slot ? SEPARATOR : '');
  return `${month}${closed(0)}${day}${closed(1)}${year}`;
}

/**
 * What is still owed, drawn faded after the value — the rest of `MM / DD / YYYY`
 * from wherever the typing has got to.
 *
 * `YYYY` stays in view to the last digit even though the year is optional. It is
 * a shape rather than a demand, and "with no year" is said in words underneath,
 * where a sentence can explain itself.
 */
export function birthdayMaskGhost(raw: string): string {
  const { month, day, year, at } = birthdaySlots(raw);

  if (month === '') return `MM${SEPARATOR}DD${SEPARATOR}YYYY`;
  // Whatever the value ends in, the ghost carries on from exactly there: a slot
  // still open is short by one, and a closed one has had its separator printed.
  if (at === 0) return `M${SEPARATOR}DD${SEPARATOR}YYYY`;
  if (at === 1) return day === '' ? `DD${SEPARATOR}YYYY` : `D${SEPARATOR}YYYY`;
  if (at === 2) return 'Y'.repeat(4 - year.length);
  return '';
}

/**
 * What has been typed so far, as a date or as the reason it is not one yet.
 *
 * `now` settles one thing only: which years are in the future.
 */
export function parseBirthdayInput(raw: string, now: Date = new Date()): BirthdayInputReading {
  const { month, day, year } = birthdaySlots(raw);
  if (month === '') return { state: 'empty' };
  // A slot holding `0` is the first digit of `01`, not a month or a day — and
  // `Number('')` is 0, so a day nobody has started yet is the same answer.
  if (Number(month) === 0 || Number(day) === 0) {
    return { state: 'partial', year: false };
  }
  if (year !== '' && year.length < 4) return { state: 'partial', year: true };

  const numbers = { month: Number(month), day: Number(day), year: year === '' ? null : Number(year) };
  if (numbers.year !== null) {
    if (numbers.year > now.getFullYear()) return { state: 'impossible', reason: 'future-year' };
    if (numbers.year < EARLIEST_BIRTH_YEAR) return { state: 'impossible', reason: 'early-year' };
  }

  // The day against the longest February first, so 29 February is refused for
  // the year it was given rather than for existing at all.
  if (!isRealBirthday(numbers.month, numbers.day)) {
    return { state: 'impossible', reason: 'no-such-day' };
  }
  if (numbers.year !== null && !isRealBirthday(numbers.month, numbers.day, numbers.year)) {
    return { state: 'impossible', reason: 'not-that-year' };
  }

  return { state: 'read', ...numbers };
}
