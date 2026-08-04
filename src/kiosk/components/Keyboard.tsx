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
 */
import { memo, useCallback, useRef } from 'react';

export type KioskKey =
  | { kind: 'char'; value: string }
  | { kind: 'backspace' }
  | { kind: 'clear' };

const ROWS: string[][] = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
];

const KEY_CLASS =
  'flex h-14 min-w-0 flex-1 select-none items-center justify-center rounded-lg ' +
  'bg-ink-800 text-xl font-semibold text-ink-100 active:bg-ink-600';

export const Keyboard = memo(function Keyboard({ onKey }: { onKey: (key: KioskKey) => void }) {
  // The latest handler behind a stable identity, so this subtree's memo holds
  // even if a parent re-creates its callback.
  const handlerRef = useRef(onKey);
  handlerRef.current = onKey;

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-key]');
    const key = target?.dataset.key;
    if (!key) return;
    event.preventDefault();
    if (key === 'backspace') handlerRef.current({ kind: 'backspace' });
    else if (key === 'clear') handlerRef.current({ kind: 'clear' });
    else if (key === 'space') handlerRef.current({ kind: 'char', value: ' ' });
    else handlerRef.current({ kind: 'char', value: key });
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
          {i === 3 && <div className="flex-[1.5]" />}
          {row.map((key) => (
            <button key={key} type="button" tabIndex={-1} data-key={key} className={KEY_CLASS}>
              {key}
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
          className={`${KEY_CLASS} flex-[2] text-base font-medium text-ink-300`}
        >
          Clear
        </button>
        <button type="button" tabIndex={-1} data-key="space" aria-label="Space" className={`${KEY_CLASS} flex-[5]`}>
          &nbsp;
        </button>
      </div>
    </div>
  );
});
