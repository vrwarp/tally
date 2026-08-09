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
 * What *is* here, and was not at first, is the shape of the sticker on
 * whatever roll that turns out to be: the margins, the quarter turn and a fixed
 * length. Those looked like media at first glance and are not. A badge holder
 * that hides the top of a label, a name that reads better along the tape, a
 * room that wants every sticker the same length — each is a decision about this
 * gathering's label, made by the person designing it, and each is invisible on
 * the kiosk screen where nobody is looking at the labels. They name no roll and
 * no model: they say how the text should sit on whatever is loaded, in
 * millimetres the renderer converts, and a die-cut roll ignores the ones it has
 * no room for.
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
   *
   * For part of a line rather than all of it, bracket it: `[...]` is the same
   * question asked of a group, and the two compose. See `fillLabelTokens`.
   */
  requiresValue: boolean;
}

export interface LabelTemplate {
  lines: LabelLine[];
  /** How many stickers one check-in produces. */
  copies: number;
  /**
   * Blank millimetres above the first line, as the sticker is read.
   *
   * Only continuous tape can honour it, because only continuous tape has a
   * length to give: a die-cut label is as long as it is, and there these decide
   * what the block is centred in rather than how much paper is used. Absent
   * means {@link DEFAULT_LABEL_MARGIN_MM}, which is what every template written
   * before these existed prints.
   *
   * "Above" is in reading order, not in the direction the roll feeds. On a
   * rotated label that is across the tape rather than along it — the same edge
   * of the same sticker either way, which is the point: a leader arranging a
   * label should not have to think about which way the paper came out.
   */
  marginTopMm?: number;
  /** Blank millimetres below the last line, as the sticker is read. */
  marginBottomMm?: number;
  /**
   * Print the text along the tape rather than across it.
   *
   * A quarter turn swaps which dimension is free. Upright, the roll's width is
   * the line length and the label grows downwards as lines are added; rotated,
   * the roll's width is the height the lines have to share and the label grows
   * *longer* as a name gets longer. That is the whole reason to want it: a long
   * name on 29mm tape has almost no width to work with upright and as much as it
   * likes on its side.
   *
   * Ignored on die-cut media, whose two dimensions are both fixed — turning the
   * text on a 62×29mm label would print it off the sides.
   */
  rotated?: boolean;
  /**
   * Pin the free dimension to this many millimetres, instead of following the
   * text.
   *
   * Continuous tape decides where to cut from the content, so two children with
   * different length names get different length stickers. Somewhere that puts
   * them in a holder, or lines them up on a board, wants them all the same
   * instead — so this fixes the length and the text is centred in it, exactly
   * the way a die-cut label behaves.
   *
   * Absent means the length follows the text, which is the default and the one
   * that spends the least tape. Ignored on die-cut media, which has a length
   * already.
   */
  fixedLengthMm?: number;
  /**
   * Scale every line's size by this, keeping their proportions.
   *
   * The sizes on a line are relative — `sm` through `xl` — and what they are
   * relative *to* was a fixed guess: an `xl` is 96 dots, chosen so a first name
   * fills a 62×29mm badge. On a roll with more room than that, or a label given
   * a fixed length longer than its text needs, "Biggest" is not big and there is
   * nothing to say so with. A label that leaves half the sticker empty is not a
   * layout the renderer can fix on its own either, because filling the space
   * automatically would silently resize every label already in use.
   *
   * So this scales the anchor rather than the sizes. The relationship a leader
   * chose between their lines survives it, and the fitting that comes afterwards
   * — shrink, wrap, scale the block, drop trailing lines — still has the last
   * word: asking for text three times too big gets a full label, not one that
   * overflows.
   *
   * Absent means 1, which is what every template written before this prints.
   */
  fontScale?: number;
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
 * The margin a label has had since before it could be asked for.
 *
 * 0.7mm — the renderer's own 8-dot padding at 300 dpi, in the units the editor
 * asks for. Naming it means "leave it alone" and "set it to what it always was"
 * are the same template rather than two that print differently.
 */
export const DEFAULT_LABEL_MARGIN_MM = 0.7;

/**
 * As much blank tape as either end may be given.
 *
 * 25mm is an inch of nothing, past any sensible badge holder and well short of
 * what a mistyped number could otherwise spend on a roll.
 */
export const MAX_LABEL_MARGIN_MM = 25;

/**
 * The range a fixed length may be set to.
 *
 * The floor is roughly the shortest a QL will cut without the label being more
 * cutter than sticker; the ceiling matches the renderer's own limit on how much
 * tape one child may take, so a fixed length cannot ask for a label the
 * rasteriser would then cut short.
 */
export const MIN_LABEL_FIXED_LENGTH_MM = 10;
export const MAX_LABEL_FIXED_LENGTH_MM = 150;

/**
 * The length offered first when somebody asks for a fixed one.
 *
 * 50mm is a little longer than the 29mm die-cut name badge most of these rooms
 * already use, which makes it a length somebody can picture — and it is a
 * starting point to be typed over, not a recommendation.
 */
export const DEFAULT_FIXED_LENGTH_MM = 50;

/**
 * How far the text may be scaled, either way.
 *
 * Down to a half because below that the renderer's own legibility floor takes
 * over anyway; up to four because four times an `xl` is about 32mm of cap
 * height, which is taller than the widest roll a QL takes and so past the point
 * where more would do anything but overflow.
 */
export const MIN_LABEL_FONT_SCALE = 0.5;
export const MAX_LABEL_FONT_SCALE = 4;
export const DEFAULT_LABEL_FONT_SCALE = 1;

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
 * `firstName` and `nickname` are two tokens because the roster row holds them as
 * one field. Tally stores a child with a second name as `Benson “蔡秉洲”` — a
 * composite of its own making, and not, as this was once documented, Planning
 * Center's: that API keeps `first_name` and `nickname` apart and composes neither
 * into its own `name`. The composite earns its place on a roster row, where it is
 * what makes both spellings findable. It does not earn it on a sticker. The name
 * line is there to be read across a room at `xl`, and quotes with a second script
 * inside them are what push that line — and then, once `labelRender.ts` gives up
 * on shrinking one line, the whole label — down toward the legibility floor. So
 * `firstName` is the first name, `nickname` is the other half, and a gathering
 * that wants both puts them on two lines at two sizes.
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
  'nickname',
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
 * A bracketed group, and the escape that lets a leader type a real bracket.
 *
 * `[[` and `]]` stand for a literal `[` and `]`. Doubling is the escape because
 * it needs no backslash — a backslash on a phone keyboard is two taps into a
 * symbol page, and a leader typing `Room [[3]]` is rare enough that it should be
 * possible rather than convenient.
 *
 * The group pattern skips doubled brackets on both sides, so `[[` inside a
 * group does not close it.
 */
const OPTIONAL_GROUP_PATTERN = /\[((?:[^[\]]|\[\[|\]\])*)\]/g;
const ESCAPED_BRACKET_PATTERN = /\[\[|\]\]/g;

/** `[[` and `]]` read back as the brackets they stand for. */
function unescapeBrackets(text: string): string {
  return text.replace(ESCAPED_BRACKET_PATTERN, (match) => match[0]!);
}

/**
 * Replace every `[...]` group with its contents, or with nothing.
 *
 * The rule is the one `requiresValue` already applies to a whole line, scoped
 * down to a piece of one: a group survives when at least one token inside it got
 * a value, and disappears whole — punctuation, spaces and all — when none did.
 * That is what makes `{{lastName}}[ ({{grade}})]` print "Lovelace (8th grade)"
 * for a child with a grade and "Lovelace" for one without, instead of the
 * "Lovelace ()" that the same line without brackets would leave behind.
 *
 * A group with no tokens in it is kept. There is nothing for it to wait on, and
 * a leader who bracketed fixed text meant to see it — the same answer
 * `anyTokenFilled` gives for a line of fixed text.
 */
function resolveOptionalGroups(text: string, values: LabelTokenValues): string {
  return text.replace(OPTIONAL_GROUP_PATTERN, (_match, inner: string) =>
    anyTokenFilled(inner, values) ? inner : '',
  );
}

/**
 * One line's text with its tokens replaced.
 *
 * An unknown token, or a known one with nothing behind it, becomes empty rather
 * than being left as `{{grade}}` on a sticker. Whitespace is then collapsed and
 * trimmed, which is what makes `"{{firstName}} {{lastInitial}}"` degrade to just
 * the first name instead of a name with a trailing gap — and what lets the
 * renderer drop a line that came to nothing at all, so a child with no grade
 * gets a tidy three-line label rather than one with a hole in it.
 *
 * Collapsing whitespace is not enough for punctuation, though, which is what
 * `[...]` is for: `{{lastName}} ({{grade}})` leaves an empty pair of brackets on
 * every child without a grade, and no amount of tidying spaces fixes that.
 * See `resolveOptionalGroups`.
 */
export function fillLabelTokens(text: string, values: LabelTokenValues): string {
  // Groups first, so a group that is going to disappear takes its punctuation
  // with it rather than leaving the collapse below to tidy up after it.
  return unescapeBrackets(resolveOptionalGroups(text, values))
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

/** A number in range, or undefined for "this template does not say". */
function clampNumber(value: unknown, low: number, high: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(high, Math.max(low, value));
}

function clampMargin(value: unknown): number | undefined {
  return clampNumber(value, 0, MAX_LABEL_MARGIN_MM);
}

function clampFixedLength(value: unknown): number | undefined {
  return clampNumber(value, MIN_LABEL_FIXED_LENGTH_MM, MAX_LABEL_FIXED_LENGTH_MM);
}

function clampFontScale(value: unknown): number | undefined {
  return clampNumber(value, MIN_LABEL_FONT_SCALE, MAX_LABEL_FONT_SCALE);
}

/**
 * `{ key: value }`, or nothing at all when the value is undefined.
 *
 * Spread into the result so an absent setting is an absent *key*. Firestore
 * stores `undefined` badly and reads it back worse, and "the key is not there"
 * is exactly what a template written before these settings existed looks like.
 */
function optional<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
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
  const raw = value as {
    lines?: unknown;
    copies?: unknown;
    marginTopMm?: unknown;
    marginBottomMm?: unknown;
    rotated?: unknown;
    fixedLengthMm?: unknown;
    fontScale?: unknown;
  };
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

  return {
    lines,
    copies,
    /*
     * The shape settings are all optional, and absent is load-bearing rather
     * than lazy: it means "whatever the renderer did before this template could
     * say", so every gathering set up before they existed keeps printing the
     * label it printed. Out-of-range numbers are clamped rather than rejected —
     * a silly margin should cost a sticker, not take a gathering's printing
     * away — and anything that is not a number at all is dropped back to that
     * same absent default.
     */
    ...optional('marginTopMm', clampMargin(raw.marginTopMm)),
    ...optional('marginBottomMm', clampMargin(raw.marginBottomMm)),
    ...optional('rotated', raw.rotated === true ? true : undefined),
    ...optional('fixedLengthMm', clampFixedLength(raw.fixedLengthMm)),
    ...optional('fontScale', clampFontScale(raw.fontScale)),
  };
}

/** Whether two templates would print the same sticker. */
export function sameLabelTemplate(
  a: LabelTemplate | null,
  b: LabelTemplate | null,
): boolean {
  if (a === null || b === null) return a === b;
  if (a.copies !== b.copies || a.lines.length !== b.lines.length) return false;
  if (
    a.marginTopMm !== b.marginTopMm ||
    a.marginBottomMm !== b.marginBottomMm ||
    // `!== true` on both sides, so an absent flag and an explicit false are the
    // same template rather than an edit somebody has to save.
    (a.rotated === true) !== (b.rotated === true) ||
    a.fixedLengthMm !== b.fixedLengthMm ||
    a.fontScale !== b.fontScale
  ) {
    return false;
  }
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
