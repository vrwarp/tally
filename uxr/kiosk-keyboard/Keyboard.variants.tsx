/**
 * The kiosk keyboard with its bottom row up for argument.
 *
 * A parent's friend put it plainly: the space bar is off to the right. As
 * shipped the last row is Clear · ’ · - · space, four keys sharing seven flex
 * units under four rows of ten, so every key on it is wider than a letter and
 * the bar itself starts at the midline and runs to the bezel — a shape no
 * other keyboard has, on the one row a hand finds without looking.
 *
 * This module is the prototype for that row. It is `Keyboard.tsx` with the
 * geometry lifted out into a table of layouts and chosen by `?kb=<id>`, and
 * the campaign's shooter (`shoot.ts` beside it) aliases every import of
 * `components/Keyboard` to this file — so `SearchScreen`, `RegistrationFlow`
 * and the rest render around each candidate exactly as they render around the
 * shipping board. Everything that is not geometry is the shipping code, kept
 * byte-for-byte where it could be: the delegated `pointerdown`, the CSS-only
 * pressed state, the haptic tick, the hold on Clear, the shift-aware labels,
 * the `data-key` names every test and every e2e addresses a key by.
 *
 * ## Round 2
 *
 * Round 1 measured the same nominal width four different ways on one board: a
 * "1.5-unit" key is 143.7, 146.4 or 150px on the wide kiosk depending on how
 * many gutters its row swallows, so no bottom row could land on the columns
 * above it by construction. Round 2 answers that with a **fixed track** rather
 * than a nudge to one row — `mode: 'grid'` lays every row of the board on
 * twenty half-columns with the board's own 6px gap, so a letter is two cells,
 * the home row's stagger one, the Z row's ⇧/⌫ flanks three, and the bottom row
 * is written in the same currency as the rows it closes. Sizes stay in
 * letter-units in the table below and are doubled into cells at render time,
 * which keeps one row table serving both measuring systems.
 *
 * Round 2's boards also carry the punctuation fix: `’` and `-` were 31 lit
 * pixels apiece against a letter's 180, on two different optical lines. They
 * are now set a size step up, inside a span, with a transform that puts both
 * marks on the letters' line. The glyph characters are untouched, because the
 * delegated handler types the button's `textContent` when it is one character
 * long — nothing else may go inside those two buttons.
 *
 * Widths are inline `flex` / `gridColumn` values rather than `flex-[n]` or
 * `col-span-n` utilities, because a class built from a number in a table is
 * invisible to Tailwind's scanner; the implementation of whichever layout wins
 * goes back to utilities (`col-span-12`, `grid-cols-[repeat(20,minmax(0,1fr))]`).
 * The container carries `data-kb-layout`, `data-kb-spec` and `data-kb-summary`
 * so the shooter can crop to the board, measure it and caption a contact sheet
 * without a second copy of this table.
 *
 * Working file: this is what the loop edits between rounds. What it settles
 * is ported into `src/kiosk/components/Keyboard.tsx`; this stays as the record
 * of what else was on the table.
 */
import { memo, useCallback, useEffect, useRef } from 'react';
import { haptic } from '@/lib/utils';
import { tallyRender } from '@/kiosk/renderTally';
import { HOLD_DELAY_MS, HOLD_MS } from '@/kiosk/components/HoldButton';

export type KioskKey =
  | { kind: 'char'; value: string }
  | { kind: 'backspace' }
  | { kind: 'clear' }
  | { kind: 'shift' };

export type ShiftState = 'off' | 'on' | 'lock';

/* ------------------------------------------------------------------------ */
/* The layouts                                                               */
/* ------------------------------------------------------------------------ */

/**
 * How a row measures itself.
 *
 * `flex` is the shipping board: each slot's size is a `flex-grow` share of
 * whatever is left after that row's own gutters, so the unit is a different
 * number of pixels in every row.
 *
 * `grid` is round 2's fixed track: twenty half-columns across the board with
 * the same 6px gap, every slot spanning whole cells. One unit in the table is
 * two cells, so a letter is 2, the home row's stagger 1, the Z row's flanks 3,
 * Clear 4 and a twelve-cell bar 12 — and every vertical edge in the bottom
 * row is a vertical edge in the four rows above it.
 */
type Mode = 'flex' | 'grid';

type Slot =
  /** A letter, a digit, or one of the two punctuation marks names carry. */
  | { kind: 'char'; key: string; units: number }
  /** The bar. `label` sets a word on it; the shipping bar is blank. */
  | { kind: 'space'; units: number; label?: string }
  | { kind: 'clear'; units: number }
  | { kind: 'backspace'; units: number }
  /** The shift key where a screen passes `shift`; the same width of nothing where it does not. */
  | { kind: 'shift'; units: number }
  /** Empty width — the stagger of the home row, the flank of the bottom one. */
  | { kind: 'gap'; units: number };

export type Layout = {
  id: string;
  /** One sentence a critic reads on the contact sheet. */
  summary: string;
  /** Defaults to the shipping board's flex. */
  mode?: Mode;
  /** `’` and `-` set at a letter's optical weight, on one shared optical line. */
  legends?: boolean;
  /** `centered-moat`: the bar inset 8px on its Clear side, widening that one seam. */
  barInset?: boolean;
  /** `centered-deep`: bottom row 8px shorter and 8px lower, so the board's height holds. */
  deepBottom?: boolean;
  /**
   * Round 3's version of the same gutter, spread thin: every row's keys 2px
   * shorter and the ten freed pixels all under the Z row, so the gutter above
   * the bottom row is 16px, no row is a different height from any other, and
   * the board's height holds. The wide design critic read an 8px step on one
   * row as a squashed row; 2px on five is below sight.
   */
  deepEven?: boolean;
  /**
   * The moat expressed on Clear's side rather than the bar's: Clear gives back
   * 8px on its bar side (or its ’ side on the flanked row), so the bar keeps
   * its axis and its column edges and the exception lands on the worded key.
   */
  clearInset?: boolean;
  /**
   * The bar's word on the row's own baseline, with no optical lift: the tall
   * design critic measured every other legend at +11px from its key's centre
   * and the lifted word at +9, and a row stops reading as one setting there.
   */
  labelOnBaseline?: boolean;
  /**
   * The apostrophe left where an apostrophe sits in a word — high — rather
   * than pulled down onto the hyphen's line. Round 2 levelled the two marks
   * and three reviewers read the levelled ’ as a comma; the one cue that
   * tells the two marks apart is height, so the marks are allowed to disagree.
   */
  apostropheHigh?: boolean;
  /** The board as registration renders it — `shift` passed, so a screen that writes to the roster. */
  rows: Slot[][];
  /** The board as search renders it — `shift` omitted. Defaults to `rows`. */
  searchRows?: Slot[][];
};

const chars = (keys: string, units = 1): Slot[] => [...keys].map((key) => ({ kind: 'char', key, units }));
const P = (key: "'" | '-', units = 1): Slot => ({ kind: 'char', key, units });
const SPACE = (units: number, label?: string): Slot => ({ kind: 'space', units, label });
const CLEAR = (units: number): Slot => ({ kind: 'clear', units });
const BACKSPACE = (units: number): Slot => ({ kind: 'backspace', units });
const SHIFT = (units: number): Slot => ({ kind: 'shift', units });
const GAP = (units: number): Slot => ({ kind: 'gap', units });

const DIGITS = chars('1234567890');
const TOP = chars('QWERTYUIOP');
const HOME = [GAP(0.5), ...chars('ASDFGHJKL'), GAP(0.5)];
/** The Z row, with whatever closes it on the right — ⌫ as shipped. */
const LOW = (right: Slot): Slot[] => [SHIFT(1.5), ...chars('ZXCVBNM'), right];
/** The four rows above the bottom one, as shipped. */
const UPPER = [DIGITS, TOP, HOME, LOW(BACKSPACE(1.5))];

const board = (bottom: Slot[], upper: Slot[][] = UPPER): Slot[][] => [...upper, bottom];

/** Every round-2 board: the fixed track, and the punctuation set as legends. */
const R2 = { mode: 'grid', legends: true } as const;

/** `centered-*`'s shared bottom row — Clear 4 · space 12 · ’ 2 · - 2 of twenty. */
const CENTRED_BOTTOM = (label?: string): Slot[] => [CLEAR(2), SPACE(6, label), P("'"), P('-')];

const LAYOUTS: Layout[] = [
  {
    id: 'current',
    summary:
      'As shipped. Clear 1.5 · ’ 1 · - 1 · space 3.5 — seven units under rows of ten, so every key on the row is ~1.4 letters wide and the bar runs from the midline to the bezel.',
    rows: board([CLEAR(1.5), P("'"), P('-'), SPACE(3.5)]),
  },
  {
    id: 'centered',
    summary:
      'Clear 2 · space 6 · ’ 1 · - 1 — ten units. The bar is centred (20%–80%), the punctuation is letter-sized and sits under ⌫, Clear is alone at the far left.',
    rows: board([CLEAR(2), SPACE(6), P("'"), P('-')]),
  },
  {
    id: 'centered-flank',
    summary:
      'Clear 1.5 · space 7 · ’ 1 · - 1 — 10.5 units, so the row’s keys are ~5% narrower than a letter; Clear matches the ⇧/⌫ flanks and the bar’s left edge falls under Z.',
    rows: board([CLEAR(1.5), SPACE(7), P("'"), P('-')]),
  },
  {
    id: 'flanked',
    summary:
      'Clear 1.5 · ’ 1 · space 5 · - 1 · ⌫ 1.5 — punctuation either side of a centred bar, the way phones flank it; ⌫ comes down to the corner the phone pad keeps it in, and the Z row ends in a spacer.',
    rows: board([CLEAR(1.5), P("'"), SPACE(5), P('-'), BACKSPACE(1.5)], [DIGITS, TOP, HOME, LOW(GAP(1.5))]),
  },
  {
    id: 'flanked-gap',
    summary:
      'Clear 1.5 · ’ 1 · space 5 · - 1 · (empty 1.5) — the same symmetry with ⌫ left where every phone has it, at the price of a dead corner.',
    rows: board([CLEAR(1.5), P("'"), SPACE(5), P('-'), GAP(1.5)]),
  },
  {
    id: 'plain-search',
    summary:
      'Search never needed the punctuation (the matcher folds it): its board is Clear 2 · space 8. Registration, which writes names, keeps `centered`. Clear and the bar’s left edge are identical on both.',
    rows: board([CLEAR(2), SPACE(6), P("'"), P('-')]),
    searchRows: board([CLEAR(2), SPACE(8)]),
  },
  {
    id: 'labelled',
    summary: '`centered` with the word “space” set small and quiet on the bar, the way iOS names it — a blank plate says nothing about what it does.',
    rows: board([CLEAR(2), SPACE(6, 'space'), P("'"), P('-')]),
  },

  /* -------------------------------------------------------------------- */
  /* Round 2 — one fixed track, and the punctuation set at a letter's weight */
  /* -------------------------------------------------------------------- */

  {
    id: 'centered-grid',
    ...R2,
    summary:
      'Clear 4 · space 12 · ’ 2 · - 2 of twenty half-columns. `centered` with its arithmetic corrected: every edge in the row is an edge in the rows above, both flanks weigh exactly the same, and the bar’s centre is the board’s midline to 0px.',
    rows: board(CENTRED_BOTTOM()),
  },
  {
    id: 'centered-moat',
    ...R2,
    barInset: true,
    summary:
      '`centered-grid` with the bar inset 8px on its Clear side, so the one seam where a miss empties the whole buffer gets ~14px of air instead of the row’s 6px. The bar’s centre pays 4px for it.',
    rows: board(CENTRED_BOTTOM()),
  },
  {
    id: 'centered-deep',
    ...R2,
    deepBottom: true,
    summary:
      '`centered-grid` with the bottom row’s keys 8px shorter and its top margin 8px deeper: ~14px under ⇧ and ⌫, so a low miss during a correction lands on nothing. Board height, key count and the four rows above are unchanged.',
    rows: board(CENTRED_BOTTOM()),
  },
  {
    id: 'flanked-twin',
    ...R2,
    summary:
      'Clear 4 · ’ 2 · space 8 · - 2 · ⌫ 4, and ⌫ *also* stays at the Z row’s right end. The phone-pad rhyme with punctuation flanking the bar, a live bottom-right corner and a free miss under ⌫ — bought with a second delete key and a bar of four letters.',
    rows: board([CLEAR(2), P("'"), SPACE(4), P('-'), BACKSPACE(2)]),
  },
  {
    id: 'labelled-voice',
    ...R2,
    summary:
      '`centered-grid` with the word “space” on the bar in Clear’s exact voice — the board’s one worded-key treatment, same size, weight and ramp step, on the letters’ optical line.',
    rows: board(CENTRED_BOTTOM('space')),
  },

  /* -------------------------------------------------------------------- */
  /* Round 3 — the modifiers composed, each in the form both camps asked for  */
  /* -------------------------------------------------------------------- */

  {
    id: 'centered-safe',
    ...R2,
    clearInset: true,
    deepEven: true,
    apostropheHigh: true,
    summary:
      '`centered-grid` with its two seams of unequal consequence paid for: Clear gives back 8px on its bar side (the bar keeps its axis and its columns), and every key is 2px shorter so the gutter above the bottom row is 16px — no row a different height, board height unchanged.',
    rows: board(CENTRED_BOTTOM()),
  },
  {
    id: 'centered-safe-labelled',
    ...R2,
    clearInset: true,
    deepEven: true,
    apostropheHigh: true,
    labelOnBaseline: true,
    summary:
      '`centered-safe` with the bar named, in Clear’s voice and Clear’s case: “Space”. The two worded keys become one class the letters are not.',
    rows: board(CENTRED_BOTTOM('Space')),
  },
  {
    id: 'flanked-twin-safe',
    ...R2,
    clearInset: true,
    deepEven: true,
    apostropheHigh: true,
    summary:
      '`flanked-twin` with the design critics’ trade: the corner ⌫ takes the Z-row ⌫’s 3 cells so the two deletes are one plate repeated on one axis, and the hyphen takes the spare cell (1.5 letters — the one punctuation key wider than a letter). Clear gives back 8px so the ’ beside it has a 14px moat; the even trim puts 16px under the Z row. The bar stays on the axis: 6 cells either side of it.',
    rows: board([CLEAR(2), P("'"), SPACE(4), P('-', 1.5), BACKSPACE(1.5)]),
  },
];

const params = new URLSearchParams(location.search);
const chosen = LAYOUTS.find((layout) => layout.id === params.get('kb')) ?? LAYOUTS[0]!;
const mode: Mode = chosen.mode ?? 'flex';

/**
 * `Clear 1.5 · ’ 1 · - 1 · space 3.5` — the row as a caption.
 *
 * In the currency the row is actually measured in, so a grid row reads in
 * cells of twenty and a flex row in units of ten and neither has to be
 * converted by the person holding the contact sheet.
 */
function describe(row: Slot[]): string {
  return row
    .map((slot) => {
      const n = mode === 'grid' ? slot.units * 2 : slot.units;
      const size = mode === 'grid' || n !== 1 ? ` ${n}` : '';
      switch (slot.kind) {
        case 'char':
          return `${slot.key === "'" ? '’' : slot.key}${size}`;
        case 'space':
          return `space${size}${slot.label ? ` “${slot.label}”` : ''}`;
        case 'clear':
          return `Clear${size}`;
        case 'backspace':
          return `⌫${size}`;
        case 'shift':
          return `⇧${size}`;
        case 'gap':
          return `(empty${size})`;
      }
    })
    .join(' · ');
}

/* ------------------------------------------------------------------------ */
/* The component — Keyboard.tsx with the rows read from the table           */
/* ------------------------------------------------------------------------ */

/** Everything a key is except its height, which `centered-deep` shortens. */
const KEY_BASE =
  'flex min-w-0 flex-1 select-none items-center justify-center rounded-lg ' +
  'bg-ink-800 text-xl font-semibold text-ink-100 active:bg-ink-600 kiosk:text-2xl';
const KEY_CLASS = `${KEY_BASE} h-14 tall:h-16`;
/** 8px off the bottom row, paid straight into the gutter above it. */
const KEY_CLASS_SHORT = `${KEY_BASE} h-12 tall:h-14`;

/**
 * The two punctuation legends.
 *
 * A size step up on the mark alone — the key, the plate and the glyph are
 * untouched — and a transform that lands both marks on the line the letters'
 * caps sit on. The apostrophe hangs near cap height and needs pushing down a
 * quarter of its own size; the hyphen sits a hair below the line and comes up
 * by a twentieth. Written in `em` so one pair of numbers holds at both type
 * steps.
 */
const MARK_CLASS = 'block text-3xl leading-none kiosk:text-4xl';
const MARK_APOSTROPHE: React.CSSProperties = { transform: 'translateY(0.25em)' };
const MARK_HYPHEN: React.CSSProperties = { transform: 'translateY(-0.04em)' };

/**
 * `labelled-voice`'s word.
 *
 * Clear's classes go on the *button*, exactly as Clear carries them, so the
 * two worded keys resolve to one voice rather than to two that happen to be
 * spelled the same — `text-base` is inert on both, overridden by the letters'
 * `text-xl`/`kiosk:text-2xl`, and a word set from a span would not have been.
 * The span exists only to carry the transform: "space" has a descender and no
 * ascender, so left alone its ink box centres 3.4px below the line the
 * capitals sit on. A tenth of an em up puts the word's x-height band on that
 * line exactly (measured: −1.5px from the key's centre, the same as Z, M and
 * ⌫) while keeping its baseline within 2px of Clear's, which is as close as
 * a lowercase word and a title-case one get in one row.
 */
/*
 * The prototype's override block, as the frozen-HTML loop has one: the even
 * trim's two heights, which Tailwind cannot see because they are only used
 * here. The implementation is `h-[3.375rem] tall:h-[3.875rem]` on every key.
 */
const PROTO_CSS =
  '.kb-even{height:calc(3.5rem - 2px)}@media (min-height:1000px){.kb-even{height:calc(4rem - 2px)}}';
if (typeof document !== 'undefined' && !document.getElementById('kb-proto-css')) {
  const style = document.createElement('style');
  style.id = 'kb-proto-css';
  style.textContent = PROTO_CSS;
  document.head.appendChild(style);
}

const WORD_CLASS = 'text-base font-medium text-ink-300';
const WORD_LIFT: React.CSSProperties = { display: 'block', transform: 'translateY(-0.1em)' };

export const Keyboard = memo(function Keyboard({
  onKey,
  shift,
  onClearHeld,
}: {
  onKey: (key: KioskKey) => void;
  shift?: ShiftState;
  onClearHeld?: () => void;
}) {
  tallyRender('Keyboard');
  const handlerRef = useRef(onKey);
  handlerRef.current = onKey;
  const heldRef = useRef(onClearHeld);
  heldRef.current = onClearHeld;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHold = useCallback(() => {
    if (timerRef.current === null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);
  const startHold = useCallback(() => {
    if (!heldRef.current) return;
    cancelHold();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      haptic(24);
      heldRef.current?.();
    }, HOLD_DELAY_MS + HOLD_MS);
  }, [cancelHold]);
  useEffect(() => cancelHold, [cancelHold]);

  const capitals = shift === undefined || shift !== 'off';

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-key]');
    const key = target?.dataset.key;
    if (!key) return;
    event.preventDefault();
    haptic(8);
    if (key === 'backspace') handlerRef.current({ kind: 'backspace' });
    else if (key === 'clear') handlerRef.current({ kind: 'clear' });
    else if (key === 'shift') handlerRef.current({ kind: 'shift' });
    else if (key === 'space') handlerRef.current({ kind: 'char', value: ' ' });
    else {
      const label = target?.textContent ?? key;
      handlerRef.current({ kind: 'char', value: label.length === 1 ? label : key });
    }
  }, []);

  const rows = shift === undefined && chosen.searchRows ? chosen.searchRows : chosen.rows;
  const last = rows.length - 1;

  /**
   * A slot's width, in the row's own measuring system: a share of the leftover
   * in flex, whole cells of the fixed track in grid. `span n / span n` is what
   * `col-span-n` emits, so the implementation is a class swap.
   */
  const slotStyle = (slot: Slot, bottom: boolean): React.CSSProperties => {
    if (mode !== 'grid') return { flex: `${slot.units} 1 0%` };
    const cells = slot.units * 2;
    const style: React.CSSProperties = { gridColumn: `span ${cells} / span ${cells}` };
    // The moat: the bar gives back 8px on the side Clear is on, and nowhere else.
    if (bottom && chosen.barInset && slot.kind === 'space') style.marginLeft = '0.5rem';
    // The moat, on Clear's side instead: Clear gives back the 8px.
    if (bottom && chosen.clearInset && slot.kind === 'clear') style.marginRight = '0.5rem';
    return style;
  };
  /* Round 3's even trim: 2px off every key, at both type steps (see PROTO_CSS). */
  const evenClass = chosen.deepEven ? ' kb-even' : '';

  const renderSlot = (slot: Slot, index: number, bottom: boolean) => {
    const style = slotStyle(slot, bottom);
    const keyClass = (bottom && chosen.deepBottom ? KEY_CLASS_SHORT : KEY_CLASS) + evenClass;
    switch (slot.kind) {
      case 'gap':
        return <div key={index} data-gap style={style} />;
      case 'shift':
        return shift === undefined ? (
          <div key={index} data-gap style={style} />
        ) : (
          <button
            key={index}
            type="button"
            tabIndex={-1}
            data-key="shift"
            aria-label={shift === 'lock' ? 'Caps lock on' : shift === 'on' ? 'Shift on' : 'Shift'}
            aria-pressed={shift !== 'off'}
            className={`${keyClass} text-2xl ${shift === 'off' ? '' : 'bg-ink-600 text-white'}`}
            style={style}
          >
            {shift === 'lock' ? '⇪' : '⇧'}
          </button>
        );
      case 'backspace':
        return (
          <button
            key={index}
            type="button"
            tabIndex={-1}
            data-key="backspace"
            aria-label="Delete"
            className={`${keyClass} text-2xl`}
            style={style}
          >
            ⌫
          </button>
        );
      case 'clear':
        return (
          <button
            key={index}
            type="button"
            tabIndex={-1}
            data-key="clear"
            onPointerDown={onClearHeld ? startHold : undefined}
            onPointerUp={onClearHeld ? cancelHold : undefined}
            onPointerLeave={onClearHeld ? cancelHold : undefined}
            onPointerCancel={onClearHeld ? cancelHold : undefined}
            className={`${keyClass} ${WORD_CLASS} ${onClearHeld ? 'kiosk-hold-key' : ''}`}
            style={
              onClearHeld
                ? ({
                    ...style,
                    '--hold-ms': `${HOLD_MS}ms`,
                    '--hold-delay-ms': `${HOLD_DELAY_MS}ms`,
                  } as React.CSSProperties)
                : style
            }
          >
            Clear
          </button>
        );
      case 'space':
        return (
          <button
            key={index}
            type="button"
            tabIndex={-1}
            data-key="space"
            aria-label="Space"
            className={slot.label && chosen.legends ? `${keyClass} ${WORD_CLASS}` : keyClass}
            style={style}
          >
            {slot.label ? (
              chosen.legends ? (
                <span style={chosen.labelOnBaseline ? undefined : WORD_LIFT}>{slot.label}</span>
              ) : (
                <span className="text-sm font-medium tracking-wide text-ink-400 kiosk:text-base">{slot.label}</span>
              )
            ) : (
              <>&nbsp;</>
            )}
          </button>
        );
      case 'char':
        if (slot.key === "'") {
          return (
            <button key={index} type="button" tabIndex={-1} data-key="'" aria-label="Apostrophe" className={keyClass} style={style}>
              {chosen.legends ? (
                <span className={MARK_CLASS} style={chosen.apostropheHigh ? undefined : MARK_APOSTROPHE}>
                  &rsquo;
                </span>
              ) : (
                <>&rsquo;</>
              )}
            </button>
          );
        }
        if (slot.key === '-') {
          return (
            <button key={index} type="button" tabIndex={-1} data-key="-" aria-label="Hyphen" className={keyClass} style={style}>
              {chosen.legends ? <span className={MARK_CLASS} style={MARK_HYPHEN}>-</span> : <>-</>}
            </button>
          );
        }
        return (
          <button key={index} type="button" tabIndex={-1} data-key={slot.key} className={keyClass} style={style}>
            {capitals ? slot.key : slot.key.toLowerCase()}
          </button>
        );
    }
  };

  return (
    <div
      data-kb-layout={chosen.id}
      data-kb-spec={describe(rows[rows.length - 1]!)}
      data-kb-summary={chosen.summary}
      className="mx-auto flex w-full flex-col gap-1.5 p-2 pb-[max(0.5rem,var(--spacing-safe-bottom))] lg:max-w-5xl lg:px-0"
      style={{ touchAction: 'manipulation' }}
      onPointerDown={onPointerDown}
    >
      {rows.map((row, i) => {
        const bottom = i === last;
        return mode === 'grid' ? (
          <div
            key={i}
            className={
              bottom && chosen.deepBottom
                ? 'grid gap-1.5 mt-2'
                : bottom && chosen.deepEven
                  ? 'grid gap-1.5 mt-[10px]'
                  : 'grid gap-1.5'
            }
            style={{ gridTemplateColumns: 'repeat(20, minmax(0, 1fr))' }}
          >
            {row.map((slot, j) => renderSlot(slot, j, bottom))}
          </div>
        ) : (
          <div key={i} className="flex gap-1.5">
            {row.map((slot, j) => renderSlot(slot, j, bottom))}
          </div>
        );
      })}
    </div>
  );
});
