/**
 * The kiosk's own keyboard.
 *
 * The device's native on-screen keyboard is slow to raise and lower, so the
 * kiosk never focuses anything focusable: the "input" is a styled div and this
 * is the only way characters get in. One static layout — digits above QWERTY —
 * with the search mode inferred from what is typed, so there is no ABC/123
 * swap to animate.
 *
 * Latency posture, in order of importance:
 *  - One delegated `pointerdown` listener on the container, not one per key.
 *    `pointerdown` fires on glass contact; `click` waits for the finger to
 *    leave. This is now the kiosk's one exception — every button on every
 *    screen waits for the lift (see components/tapGuard.ts) — and it stays the
 *    exception because a key is not a decision. What the buttons buy with those
 *    few milliseconds is the chance to be wrong about what a press meant; a
 *    letter cannot be wrong in that way, and forty keys that each wait for a
 *    lift is a keyboard that feels like it is thinking about every character.
 *    A mistyped letter also has a key next to it that undoes the mistake.
 *  - Pressed-state feedback is CSS `:active` only — zero JavaScript, zero
 *    re-render, visible the same frame as the touch.
 *  - The whole subtree is memoized against a stable `onKey`, so typing
 *    re-renders the readout and the results, never these forty buttons.
 *
 * The one piece of JavaScript feedback is the tick of the vibrator, fired from
 * the same `pointerdown` before the handler runs. A phone keyboard buzzes on
 * every key and a finger expects it: on a tablet flat on a table, where a
 * parent is watching the readout rather than their thumb, it is the only
 * confirmation that the glass took the press at all.
 *
 * Geometry, in one measuring system. Every row is a grid of twenty half-column
 * cells with the board's one gap: a letter is two cells, the home row's stagger
 * one, the Z row's flanks three, Clear four, the bar twelve. It used to be
 * flex, each row dividing the width minus its own gap count, so a "1.5-unit"
 * key was three different widths on one glass and the bottom row — four keys
 * on seven units under rows of ten — put the space bar from the midline to the
 * bezel with the hyphen key sitting exactly on the row's midpoint. A parent's
 * friend called the keyboard weird; three rounds of critique measured what
 * they meant (`docs/refinements.md`). Now every edge of the bottom row is an
 * edge of the rows above it and the bar's centre is the board's, to the pixel.
 *
 * Two seams on this board carry unequal consequences, and both get more air
 * than the 6px between two letters. Clear wipes the buffer with no undo, so it
 * gives 8px back on its bar side — off Clear rather than off the bar, which
 * keeps the bar on its axis and its columns. And a correction is the commonest
 * gesture here: ⌫ sits over the hyphen and, on the wizard, ⇧ over Clear, so
 * every key is 2px shorter than it was and the ten freed pixels all sit under
 * the Z row. A low miss lands on nothing. The board's height is unchanged and
 * no row is a different height from any other.
 */
import { memo, useCallback, useEffect, useRef } from 'react';
import { haptic } from '@/lib/utils';
import { tallyRender } from '../renderTally';
import { HOLD_DELAY_MS, HOLD_MS } from './HoldButton';

export type KioskKey =
  | { kind: 'char'; value: string }
  | { kind: 'backspace' }
  | { kind: 'clear' }
  | { kind: 'shift' };

/**
 * Whether the next letter is a capital, and whether it stays that way.
 *
 * The three states every phone keyboard's shift key cycles through. Leaving the
 * prop off entirely is a fourth thing: no shift key at all, which is what the
 * search screen wants.
 */
export type ShiftState = 'off' | 'on' | 'lock';

const ROWS: string[][] = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
];

const KEY_CLASS =
  /* `tall:` steps the keys up on a screen stood on end — see the variant's
     note in index.css. A kiosk is read and reached at arm's length by
     somebody standing, so a key that is comfortable in a hand is small on
     a shelf. The two heights are 3.5rem and 4rem less 2px: the trim that pays
     for the deeper gutter above the bottom row (see the header), invisible on
     its own and the same on every row. */
  'flex h-[3.375rem] min-w-0 select-none items-center justify-center rounded-lg ' +
  /* Solid here, tinted by context: while the gathering's photograph is up,
     the search screen's `kiosk-has-backdrop` class turns these fills to 80%
     glass (see index.css) — the room glints in the gutters, the caps hold
     ~8:1 over a worst-case white image, and a pressed key goes opaque, which
     is the feedback. Every screen without that class, the wizard's and the
     reprint search's keyboards included, keeps this keyboard byte-identical
     to the one that shipped. */
  'bg-ink-800 text-xl font-semibold text-ink-100 active:bg-ink-600 tall:h-[3.875rem] kiosk:text-2xl';

/*
 * One row of the track. Twenty cells rather than ten so the home row's
 * half-key stagger and the Z row's key-and-a-half flanks are whole cells too;
 * `col-span-*` on each key is the whole of a key's geometry.
 */
const ROW_CLASS = 'grid grid-cols-[repeat(20,minmax(0,1fr))] gap-1.5';

/*
 * The two marks a name can carry, set as key labels rather than as raw glyphs.
 * At the letters' size an apostrophe is 5×8px of ink on a 73px key and a
 * hyphen 7×4 — both critics and both consultants read them as blank plates —
 * so each is one type step up. The apostrophe is left where an apostrophe
 * sits in a word, high; levelled with the hyphen it read as a comma. Nothing
 * else may go inside these two buttons: `onPointerDown` reads the button's
 * text, and a second child would silently fall it back to `data-key`.
 */
const MARK_CLASS = 'block text-3xl leading-none kiosk:text-4xl';

export const Keyboard = memo(function Keyboard({
  onKey,
  shift,
  onClearHeld,
}: {
  onKey: (key: KioskKey) => void;
  /**
   * Omitted by the search screen, which has typed in capitals since the kiosk
   * existed and has no reason to stop: search folds case, and a mode is one
   * more thing to get wrong at a door.
   *
   * Registration passes it, because what is typed there is written to the
   * roster, pushed into the church's database and printed on a child's sticker
   * — and no rule short of a dictionary gets McDonald, O'Brien and van der Berg
   * all right. A parent can see the case as they type and fix it themselves.
   */
  shift?: ShiftState;
  /**
   * The staff gate: **Clear**, held.
   *
   * Passed only by the search screen. A tap still clears the buffer and always
   * will — that is the key's job and the reason it is the right host for a
   * second meaning. It is a labelled key in a fixed place that staff can be
   * told about over the phone, which the gate this replaced was not: an
   * invisible sixteen-pixel square in a corner is findable by the person who
   * wrote it and nobody else.
   *
   * Held on the key rather than delegated at the container, unlike every other
   * press here, so that sliding a thumb off Clear cancels the hold the way it
   * cancels the `:active` fill. Two handlers on one button is cheaper than a
   * gesture that fires from the key next door.
   */
  onClearHeld?: () => void;
}) {
  tallyRender('Keyboard');
  // The latest handler behind a stable identity, so this subtree's memo holds
  // even if a parent re-creates its callback.
  const handlerRef = useRef(onKey);
  handlerRef.current = onKey;
  const heldRef = useRef(onClearHeld);
  heldRef.current = onClearHeld;

  /*
   * The hold, in a ref rather than in state.
   *
   * State here would repaint forty buttons on every press of Clear, which is
   * exactly what this file's memo exists to prevent. The progress the finger
   * needs is a CSS animation bound to `:active` (see `kiosk-hold-key` in
   * index.css) — no JavaScript, no re-render, and it stops the instant the
   * press does.
   */
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHold = useCallback(() => {
    if (timerRef.current === null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);
  const startHold = useCallback(() => {
    if (!heldRef.current) return;
    cancelHold();
    // `HOLD_DELAY_MS` on top, the same grace `HoldButton` gives every other hold
    // on the kiosk. Nothing here can be mistaken for a scroll, so the delay buys
    // this key nothing on its own — it is here so that a volunteer told "hold
    // Clear" is holding it for exactly as long as they hold anything else.
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      // The one press on this keyboard that is not reporting contact but
      // completion, so it buzzes longer than the 8ms every key gets.
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
    // Every key, including the ones the buffer will refuse (a 25th character, a
    // fifth digit): this reports contact, not success. A key that took the press
    // and buzzed nothing would read as a dead patch of glass.
    haptic(8);
    if (key === 'backspace') handlerRef.current({ kind: 'backspace' });
    else if (key === 'clear') handlerRef.current({ kind: 'clear' });
    else if (key === 'shift') handlerRef.current({ kind: 'shift' });
    else if (key === 'space') handlerRef.current({ kind: 'char', value: ' ' });
    /*
     * The apostrophe types the straight mark (U+0027) whatever glyph the key
     * shows. The label is a typographer's ’, and for as long as this branch
     * read the label the key emitted U+2019 — which `NAME_CHARACTER` and
     * `ALLERGY_CHARACTER` in registration/steps.ts do not accept, so on the
     * wizard the press buzzed and nothing appeared, and O'Brien went onto the
     * sticker and into the church's database as Obrien. One character can now
     * reach a buffer as an apostrophe, and the auto-shift after it, the
     * exports and the office's own typing all agree on which one.
     */
    else if (key === "'") handlerRef.current({ kind: 'char', value: "'" });
    else {
      /*
       * The character in the case the key is *showing*. Read off the label
       * rather than decided downstream, so what a parent sees on the glass is
       * exactly what lands in the readout with no second opinion applied on the
       * way. `data-key` stays the canonical capital, so everything that drives
       * this keyboard keeps addressing one stable name per key.
       */
      const label = target?.textContent ?? key;
      handlerRef.current({ kind: 'char', value: label.length === 1 ? label : key });
    }
  }, []);

  return (
    <div
      /* One measure for the screen. Given a landscape kiosk the board used to
         spend the extra width on the keys rather than on itself: 32px wide on a
         phone, 121 here, so a key stopped being a key shape and the space bar
         became the largest empty rectangle in the frame. Capped to the measure
         the results and the readout sit on, the keys stay a family across the
         three shapes and the screen has one left edge instead of two. */
      className="mx-auto flex w-full flex-col gap-1.5 p-2 pb-[max(0.5rem,var(--spacing-safe-bottom))] lg:max-w-5xl lg:px-0"
      style={{ touchAction: 'manipulation' }}
      onPointerDown={onPointerDown}
    >
      {ROWS.map((row, i) => (
        <div key={i} className={ROW_CLASS}>
          {/* Stagger the letter rows the way every keyboard does. `data-gap`
              names the glass a finger can land on that does nothing, so the
              tests can find it without knowing how wide it is. */}
          {i === 2 && <div data-gap className="col-span-1" />}
          {/* The Z row's leading slot: a spacer where there is no shift key,
              the shift key where there is. Same width either way, so the
              letters under a thumb sit in the same place on both screens. */}
          {i === 3 &&
            (shift === undefined ? (
              <div data-gap className="col-span-3" />
            ) : (
              <button
                type="button"
                tabIndex={-1}
                data-key="shift"
                aria-label={shift === 'lock' ? 'Caps lock on' : shift === 'on' ? 'Shift on' : 'Shift'}
                aria-pressed={shift !== 'off'}
                className={`${KEY_CLASS} col-span-3 text-2xl ${shift === 'off' ? '' : 'bg-ink-600 text-white'}`}
              >
                {shift === 'lock' ? '⇪' : '⇧'}
              </button>
            ))}
          {row.map((key) => (
            <button key={key} type="button" tabIndex={-1} data-key={key} className={`${KEY_CLASS} col-span-2`}>
              {/* Digits have no case; a letter wears the shift state, so every
                  key shows exactly what it will produce. */}
              {capitals ? key : key.toLowerCase()}
            </button>
          ))}
          {i === 2 && <div data-gap className="col-span-1" />}
          {i === 3 && (
            <button
              type="button"
              tabIndex={-1}
              data-key="backspace"
              aria-label="Delete"
              className={`${KEY_CLASS} col-span-3 text-2xl`}
            >
              ⌫
            </button>
          )}
        </div>
      ))}
      {/*
        * The bottom row: Clear · space · ’ · -, on the same twenty cells as
        * the rows above — 4 · 12 · 2 · 2. Both flanks weigh the same, so the
        * bar's centre is the board's midline, and the two marks continue the
        * O/P and M/⌫ columns rather than sitting between Clear and the bar,
        * where the one key a parent must aim at on the wizard shared a seam
        * with the one key that wipes what they typed.
        *
        * `mt-[10px]` on top of the container's gap is the 16px gutter the
        * trimmed keys paid for: what sits under ⌫ here is a mark that goes on
        * a sticker, and what sits under ⇧ on the wizard is Clear.
        */}
      <div className={`${ROW_CLASS} mt-[10px]`}>
        <button
          type="button"
          tabIndex={-1}
          data-key="clear"
          onPointerDown={onClearHeld ? startHold : undefined}
          onPointerUp={onClearHeld ? cancelHold : undefined}
          onPointerLeave={onClearHeld ? cancelHold : undefined}
          onPointerCancel={onClearHeld ? cancelHold : undefined}
          /* `mr-2`: Clear gives 8px back on its bar side, so the seam between
             the most-tapped key on the row and the only one with no undo is
             14px where every other seam is 6. Off Clear rather than off the
             bar, which keeps the bar on its axis and both its column edges. */
          className={`${KEY_CLASS} col-span-4 mr-2 text-base font-medium text-ink-300 ${
            onClearHeld ? 'kiosk-hold-key' : ''
          }`}
          style={
            onClearHeld
              ? ({
                  '--hold-ms': `${HOLD_MS}ms`,
                  '--hold-delay-ms': `${HOLD_DELAY_MS}ms`,
                } as React.CSSProperties)
              : undefined
          }
        >
          Clear
        </button>
        <button type="button" tabIndex={-1} data-key="space" aria-label="Space" className={`${KEY_CLASS} col-span-12`}>
          &nbsp;
        </button>
        {/*
          * The two punctuation marks that appear in names.
          *
          * Search never needed them — the matcher folds punctuation, so
          * "obrien" finds O'Brien — but registration does: what a parent types
          * here is written to the roster and printed on a sticker, and a child
          * called Anne-Marie should not become Annemarie because the lobby
          * keyboard had no hyphen. Two keys rather than a punctuation layer,
          * on the one static layout: a keystroke still never changes geometry.
          * A letter wide each, in the far corner under ⌫, where a miss costs a
          * mark a parent can see in the readout rather than the whole field.
          */}
        <button type="button" tabIndex={-1} data-key="'" aria-label="Apostrophe" className={`${KEY_CLASS} col-span-2`}>
          <span className={MARK_CLASS}>&rsquo;</span>
        </button>
        <button type="button" tabIndex={-1} data-key="-" aria-label="Hyphen" className={`${KEY_CLASS} col-span-2`}>
          <span className={`${MARK_CLASS} -translate-y-[0.04em]`}>-</span>
        </button>
      </div>
    </div>
  );
});
