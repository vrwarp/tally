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
 * Widths are inline `flex` values rather than `flex-[n]` utilities, because a
 * class built from a number in a table is invisible to Tailwind's scanner; the
 * implementation of whichever layout wins goes back to utilities. The
 * container carries `data-kb-layout`, `data-kb-spec` and `data-kb-summary` so
 * the shooter can crop to the board, measure it and caption a contact sheet
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

type Slot =
  /** A letter, a digit, or one of the two punctuation marks names carry. */
  | { kind: 'char'; key: string; flex: number }
  /** The bar. `label` sets a word on it; the shipping bar is blank. */
  | { kind: 'space'; flex: number; label?: string }
  | { kind: 'clear'; flex: number }
  | { kind: 'backspace'; flex: number }
  /** The shift key where a screen passes `shift`; the same width of nothing where it does not. */
  | { kind: 'shift'; flex: number }
  /** Empty width — the stagger of the home row, the flank of the bottom one. */
  | { kind: 'gap'; flex: number };

export type Layout = {
  id: string;
  /** One sentence a critic reads on the contact sheet. */
  summary: string;
  /** The board as registration renders it — `shift` passed, so a screen that writes to the roster. */
  rows: Slot[][];
  /** The board as search renders it — `shift` omitted. Defaults to `rows`. */
  searchRows?: Slot[][];
};

const chars = (keys: string, flex = 1): Slot[] => [...keys].map((key) => ({ kind: 'char', key, flex }));
const P = (key: "'" | '-', flex = 1): Slot => ({ kind: 'char', key, flex });
const SPACE = (flex: number, label?: string): Slot => ({ kind: 'space', flex, label });
const CLEAR = (flex: number): Slot => ({ kind: 'clear', flex });
const BACKSPACE = (flex: number): Slot => ({ kind: 'backspace', flex });
const SHIFT = (flex: number): Slot => ({ kind: 'shift', flex });
const GAP = (flex: number): Slot => ({ kind: 'gap', flex });

const DIGITS = chars('1234567890');
const TOP = chars('QWERTYUIOP');
const HOME = [GAP(0.5), ...chars('ASDFGHJKL'), GAP(0.5)];
/** The Z row, with whatever closes it on the right — ⌫ as shipped. */
const LOW = (right: Slot): Slot[] => [SHIFT(1.5), ...chars('ZXCVBNM'), right];
/** The four rows above the bottom one, as shipped. */
const UPPER = [DIGITS, TOP, HOME, LOW(BACKSPACE(1.5))];

const board = (bottom: Slot[], upper: Slot[][] = UPPER): Slot[][] => [...upper, bottom];

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
];

const params = new URLSearchParams(location.search);
const chosen = LAYOUTS.find((layout) => layout.id === params.get('kb')) ?? LAYOUTS[0]!;

/** `Clear 1.5 · ’ 1 · - 1 · space 3.5` — the row as a caption. */
function describe(row: Slot[]): string {
  return row
    .map((slot) => {
      const flex = slot.flex === 1 ? '' : ` ${slot.flex}`;
      switch (slot.kind) {
        case 'char':
          return `${slot.key === "'" ? '’' : slot.key}${flex}`;
        case 'space':
          return `space${flex}${slot.label ? ` “${slot.label}”` : ''}`;
        case 'clear':
          return `Clear${flex}`;
        case 'backspace':
          return `⌫${flex}`;
        case 'shift':
          return `⇧${flex}`;
        case 'gap':
          return `(empty${flex})`;
      }
    })
    .join(' · ');
}

/* ------------------------------------------------------------------------ */
/* The component — Keyboard.tsx with the rows read from the table           */
/* ------------------------------------------------------------------------ */

const KEY_CLASS =
  'flex h-14 min-w-0 flex-1 select-none items-center justify-center rounded-lg ' +
  'bg-ink-800 text-xl font-semibold text-ink-100 active:bg-ink-600 tall:h-16 kiosk:text-2xl';

const flexStyle = (flex: number): React.CSSProperties => ({ flex: `${flex} 1 0%` });

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

  const renderSlot = (slot: Slot, index: number) => {
    const style = flexStyle(slot.flex);
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
            className={`${KEY_CLASS} text-2xl ${shift === 'off' ? '' : 'bg-ink-600 text-white'}`}
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
            className={`${KEY_CLASS} text-2xl`}
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
            className={`${KEY_CLASS} text-base font-medium text-ink-300 ${onClearHeld ? 'kiosk-hold-key' : ''}`}
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
            className={KEY_CLASS}
            style={style}
          >
            {slot.label ? (
              <span className="text-sm font-medium tracking-wide text-ink-400 kiosk:text-base">{slot.label}</span>
            ) : (
              <>&nbsp;</>
            )}
          </button>
        );
      case 'char':
        if (slot.key === "'") {
          return (
            <button key={index} type="button" tabIndex={-1} data-key="'" aria-label="Apostrophe" className={KEY_CLASS} style={style}>
              &rsquo;
            </button>
          );
        }
        if (slot.key === '-') {
          return (
            <button key={index} type="button" tabIndex={-1} data-key="-" aria-label="Hyphen" className={KEY_CLASS} style={style}>
              -
            </button>
          );
        }
        return (
          <button key={index} type="button" tabIndex={-1} data-key={slot.key} className={KEY_CLASS} style={style}>
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
      {rows.map((row, i) => (
        <div key={i} className="flex gap-1.5">
          {row.map(renderSlot)}
        </div>
      ))}
    </div>
  );
});
