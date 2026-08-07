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
 *    leave.
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
 */
import { memo, useCallback, useEffect, useRef } from 'react';
import { haptic } from '@/lib/utils';
import { HOLD_MS } from './HoldButton';

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
  'flex h-14 min-w-0 flex-1 select-none items-center justify-center rounded-lg ' +
  'bg-ink-800 text-xl font-semibold text-ink-100 active:bg-ink-600';

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
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      // The one press on this keyboard that is not reporting contact but
      // completion, so it buzzes longer than the 8ms every key gets.
      haptic(24);
      heldRef.current?.();
    }, HOLD_MS);
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
      className="flex flex-col gap-1.5 p-2 pb-[max(0.5rem,var(--spacing-safe-bottom))]"
      style={{ touchAction: 'manipulation' }}
      onPointerDown={onPointerDown}
    >
      {ROWS.map((row, i) => (
        <div key={i} className="flex gap-1.5">
          {/* Stagger the letter rows the way every keyboard does. */}
          {i === 2 && <div className="flex-[0.5]" />}
          {/* The bottom row's leading slot: a spacer where there is no shift
              key, the shift key where there is. Same width either way, so the
              letters under a thumb sit in the same place on both screens. */}
          {i === 3 &&
            (shift === undefined ? (
              <div className="flex-[1.5]" />
            ) : (
              <button
                type="button"
                tabIndex={-1}
                data-key="shift"
                aria-label={shift === 'lock' ? 'Caps lock on' : shift === 'on' ? 'Shift on' : 'Shift'}
                aria-pressed={shift !== 'off'}
                className={`${KEY_CLASS} flex-[1.5] text-2xl ${shift === 'off' ? '' : 'bg-ink-600 text-white'}`}
              >
                {shift === 'lock' ? '⇪' : '⇧'}
              </button>
            ))}
          {row.map((key) => (
            <button key={key} type="button" tabIndex={-1} data-key={key} className={KEY_CLASS}>
              {/* Digits have no case; a letter wears the shift state, so every
                  key shows exactly what it will produce. */}
              {capitals ? key : key.toLowerCase()}
            </button>
          ))}
          {i === 2 && <div className="flex-[0.5]" />}
          {i === 3 && (
            <button
              type="button"
              tabIndex={-1}
              data-key="backspace"
              aria-label="Delete"
              className={`${KEY_CLASS} flex-[1.5] text-2xl`}
            >
              ⌫
            </button>
          )}
        </div>
      ))}
      <div className="flex gap-1.5">
        <button
          type="button"
          tabIndex={-1}
          data-key="clear"
          onPointerDown={onClearHeld ? startHold : undefined}
          onPointerUp={onClearHeld ? cancelHold : undefined}
          onPointerLeave={onClearHeld ? cancelHold : undefined}
          onPointerCancel={onClearHeld ? cancelHold : undefined}
          className={`${KEY_CLASS} flex-[1.5] text-base font-medium text-ink-300 ${
            onClearHeld ? 'kiosk-hold-key' : ''
          }`}
          style={onClearHeld ? ({ '--hold-ms': `${HOLD_MS}ms` } as React.CSSProperties) : undefined}
        >
          Clear
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
          */}
        <button type="button" tabIndex={-1} data-key="'" aria-label="Apostrophe" className={KEY_CLASS}>
          &rsquo;
        </button>
        <button type="button" tabIndex={-1} data-key="-" aria-label="Hyphen" className={KEY_CLASS}>
          -
        </button>
        <button type="button" tabIndex={-1} data-key="space" aria-label="Space" className={`${KEY_CLASS} flex-[3.5]`}>
          &nbsp;
        </button>
      </div>
    </div>
  );
});
