/*
 * GENERATED FILE — DO NOT EDIT.
 *
 * Copied from src/lib/labelTemplate.ts by scripts/sync-functions-shared.mjs, because the
 * functions package deploys on its own and cannot import from src/. Edit the
 * original; `npm run functions:build` regenerates this, and a unit test fails
 * if the two ever disagree.
 */

/**
 * What a check-in label says, and nothing about how it gets printed.
 *
 * A gathering that hands children back wants something physical: a name on the
 * child, so the volunteer who did not do the check-in still knows who they have.
 * This is the description of that sticker, stored on the event and edited in the
 * app, so a leader can change what the nursery's labels say without anybody
 * touching the kiosk on the shelf.
 *
 * SHARED WITH THE CLOUD FUNCTIONS, like `recurrenceCore.ts` and
 * `phoneDigits.ts` — `scripts/sync-functions-shared.mjs` copies it, because
 * `materialize.ts`'s `OccurrenceSource` carries a template and that module is
 * shared too. Imports nothing, on purpose: that is the price of being shareable.
 *
 * Two things are deliberately *not* here.
 *
 * **The media.** No label size, no printer model, no dots. Which roll is loaded
 * is a fact about the machine in the lobby this morning, not about the
 * gathering — a leader editing "Sunday Nursery" has no idea, and should not have
 * to. Swapping a 62×29mm die-cut roll for 62mm continuous tape is then a change
 * on one kiosk rather than an edit to every event. Sizes here are relative and
 * the renderer fits them to whatever it is given.
 *
 * **The values.** `fillLabelTokens` takes strings that somebody else resolved.
 * A grade reads as "8th grade" through `gradeDescription` in `lib/utils.ts`, and
 * a time through the locale — neither of which this module may import. Handing
 * it finished strings also means the admin preview can pass sample values
 * through exactly the same code the kiosk runs.
 */

export type LabelLineSize = 'sm' | 'md' | 'lg' | 'xl';
export type LabelLineAlign = 'left' | 'center' | 'right';

export interface LabelLine {
  /** Free text, which may contain `{{token}}` placeholders. */
  text: string;
  size: LabelLineSize;
  bold: boolean;
  align: LabelLineAlign;
  /**
   * Print this line only when at least one of its tokens has a value.
   *
   * A line whose text comes to nothing is always dropped — that is what makes
   * `{{grade}}` close the gap for a child too young to have one. The problem is
   * the line that comes to *almost* nothing: `Allergy: {{allergy}}` resolves to
   * a bare "Allergy:" for every child with no note on file, and a sticker
   * carrying that word for a child who has no allergy is worse than one that
   * simply omits the line. The same trap catches `Grade {{grade}}` and
   * `Room {{grade}}`.
   *
   * So a line may declare that its literal text is only worth printing when
   * something got filled in beside it. Off by default, and off is what every
   * template written before this existed reads as, because turning it on
   * silently would change what labels a church is already printing.
   *
   * A line with no tokens at all is unaffected — there is nothing for it to
   * wait on, and a leader who typed a fixed caption meant it.
   */
  requiresValue: boolean;
}

export interface LabelTemplate {
  lines: LabelLine[];
  /** How many stickers one check-in produces. */
  copies: number;
}

export const LABEL_LINE_SIZES: readonly LabelLineSize[] = ['sm', 'md', 'lg', 'xl'];
export const LABEL_LINE_ALIGNS: readonly LabelLineAlign[] = ['left', 'center', 'right'];

/**
 * Caps, which exist to bound the kiosk rather than to express taste.
 *
 * Six lines on a 29mm-tall die-cut label is already past legible; the renderer
 * will shrink and then start dropping, and the cap is what stops a template
 * from making that the normal case. Three copies covers the child, the parent
 * and a bag — beyond that somebody is using the wrong tool.
 */
export const MAX_LABEL_LINES = 6;
export const MAX_LABEL_COPIES = 3;
export const MAX_LABEL_LINE_LENGTH = 120;

/**
 * Every token a label may use.
 *
 * Bounded by what the kiosk actually holds. It knows the roster row
 * (`KioskStudent`: names, a grade, and *that* there is an allergy) and the
 * binding (the gathering's title and times) — and deliberately nothing else.
 * Parent contacts and photographs do not reach the lobby screen, which is a
 * decision the Firestore rules enforce rather than a gap; see the kiosk section
 * of `firestore.rules`. Adding either of those to a label is a change to what a
 * shelf in a public room is allowed to display, not a new entry in this list.
 *
 * `allergy` is the exception, and it is one that had to be argued for rather
 * than assumed.
 *
 * A label is not a screen. It leaves the kiosk, goes onto the child, and is read
 * by the volunteer holding them — who is exactly the person who needs to know
 * about the peanuts, and the least likely of anyone to be looking at a roster
 * while doing it. Withholding it made the same mistake the `⚠ Allergy` badge
 * made before `getAllergyNotes` existed: a warning nobody can act on where they
 * are standing.
 *
 * Three things keep it proportionate, and all three are load-bearing:
 *
 *   - **A leader opts in, per gathering.** The token prints nothing unless
 *     somebody put it on this event's template. A nursery can; youth group need
 *     not.
 *   - **The kiosk still does not hold the notes.** It knows the flag, and asks
 *     for one child's note at the moment that child is being checked in — never
 *     the roster's. See `kiosk/printing/index.ts`.
 *   - **Nothing is written down.** The note lives in memory for as long as it
 *     takes to draw a sticker, and never reaches localStorage.
 */
export const LABEL_TOKENS = [
  'firstName',
  'lastName',
  'lastInitial',
  'grade',
  'allergy',
  'eventTitle',
  'date',
  'time',
] as const;

export type LabelToken = (typeof LABEL_TOKENS)[number];

export type LabelTokenValues = Partial<Record<LabelToken, string>>;

/**
 * What a leader gets when they first switch labels on for a gathering.
 *
 * A first name big enough to read at arm's length across a room, a surname
 * initial to tell two Noahs apart, then the details a volunteer wants and a
 * parent does not: which gathering, and when they arrived.
 */
export const DEFAULT_LABEL_TEMPLATE: LabelTemplate = {
  lines: [
    // Every line here is a token on its own, so none of them needs
    // `requiresValue`: a child with no grade already drops the grade line.
    { text: '{{firstName}} {{lastInitial}}', size: 'xl', bold: true, align: 'center', requiresValue: false },
    { text: '{{grade}}', size: 'md', bold: false, align: 'center', requiresValue: false },
    { text: '{{eventTitle}}', size: 'sm', bold: false, align: 'center', requiresValue: false },
    { text: '{{time}}', size: 'sm', bold: false, align: 'center', requiresValue: false },
  ],
  copies: 1,
};

const TOKEN_PATTERN = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

/**
 * One line's text with its tokens replaced.
 *
 * An unknown token, or a known one with nothing behind it, becomes empty rather
 * than being left as `{{grade}}` on a sticker. Whitespace is then collapsed and
 * trimmed, which is what makes `"{{firstName}} {{lastInitial}}"` degrade to just
 * the first name instead of a name with a trailing gap — and what lets the
 * renderer drop a line that came to nothing at all, so a child with no grade
 * gets a tidy three-line label rather than one with a hole in it.
 */
export function fillLabelTokens(text: string, values: LabelTokenValues): string {
  return text
    .replace(TOKEN_PATTERN, (_match, name: string) => {
      const value = values[name as LabelToken];
      return typeof value === 'string' ? value : '';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** The tokens this text refers to, in first-seen order, unknown ones included. */
export function tokensIn(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const name = match[1];
    if (name && !found.includes(name)) found.push(name);
  }
  return found;
}

/** Whether every token in this text is one the kiosk can answer. */
export function unknownTokensIn(text: string): string[] {
  return tokensIn(text).filter((name) => !LABEL_TOKENS.includes(name as LabelToken));
}

/**
 * Whether anything actually got filled in — the question `requiresValue` asks.
 *
 * "Any", not "all", because a line usually has more than one token and only one
 * of them needs to have arrived for the line to be worth printing:
 * `{{firstName}} {{lastInitial}}` on a child with no surname is still their
 * name, and dropping it would be absurd. What the flag is for is the other
 * shape, where every token came to nothing and all that is left is the caption
 * the leader typed around them.
 *
 * A text with no tokens answers true. There is nothing for it to wait on, and a
 * fixed caption was meant literally.
 */
export function anyTokenFilled(text: string, values: LabelTokenValues): boolean {
  const names = tokensIn(text);
  if (names.length === 0) return true;
  return names.some((name) => {
    const value = values[name as LabelToken];
    return typeof value === 'string' && value.trim() !== '';
  });
}

function isSize(value: unknown): value is LabelLineSize {
  return LABEL_LINE_SIZES.includes(value as LabelLineSize);
}

function isAlign(value: unknown): value is LabelLineAlign {
  return LABEL_LINE_ALIGNS.includes(value as LabelLineAlign);
}

/**
 * A stored value read back as a template, or null for "this gathering prints
 * nothing".
 *
 * Null is the ordinary answer: printing is opt-in per gathering, because a
 * printer plugged in for the nursery must not start producing stickers at youth
 * group. It is also what a malformed value reads as, and that is the safer
 * direction — a kiosk that throws on a bad template is a kiosk somebody has to
 * drive out and reboot, which is the same argument `kiosk/storage.ts` makes
 * about its own cached JSON.
 *
 * Unknown keys on a line are dropped rather than preserved, and a line with no
 * usable text is left out, so a template written by a newer deploy degrades to
 * the part this one understands instead of failing whole.
 */
export function sanitizeLabelTemplate(value: unknown): LabelTemplate | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { lines?: unknown; copies?: unknown };
  if (!Array.isArray(raw.lines)) return null;

  const lines: LabelLine[] = [];
  for (const entry of raw.lines) {
    if (lines.length >= MAX_LABEL_LINES) break;
    if (!entry || typeof entry !== 'object') continue;
    const line = entry as Partial<LabelLine>;
    if (typeof line.text !== 'string') continue;
    const text = line.text.slice(0, MAX_LABEL_LINE_LENGTH);
    if (text.trim() === '') continue;
    lines.push({
      text,
      size: isSize(line.size) ? line.size : 'md',
      bold: line.bold === true,
      align: isAlign(line.align) ? line.align : 'center',
      // Absent reads as off, which is what every template written before this
      // flag existed means and what keeps their labels printing unchanged.
      requiresValue: line.requiresValue === true,
    });
  }

  if (lines.length === 0) return null;

  const copies =
    typeof raw.copies === 'number' && Number.isFinite(raw.copies)
      ? Math.max(1, Math.min(MAX_LABEL_COPIES, Math.floor(raw.copies)))
      : 1;

  return { lines, copies };
}

/** Whether two templates would print the same sticker. */
export function sameLabelTemplate(
  a: LabelTemplate | null,
  b: LabelTemplate | null,
): boolean {
  if (a === null || b === null) return a === b;
  if (a.copies !== b.copies || a.lines.length !== b.lines.length) return false;
  return a.lines.every((line, index) => {
    const other = b.lines[index];
    return (
      !!other &&
      line.text === other.text &&
      line.size === other.size &&
      line.bold === other.bold &&
      line.align === other.align &&
      line.requiresValue === other.requiresValue
    );
  });
}
