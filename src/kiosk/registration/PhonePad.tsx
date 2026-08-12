/**
 * A keypad for the one question on the kiosk that is a number.
 *
 * The QWERTY keyboard can type a phone number — its top row is the digits — but
 * asking somebody to pick ten targets out of forty-three, on a tablet, while a
 * queue watches, is asking them to make a mistake in the one field where a
 * mistake is expensive: four of these digits become the family's key for every
 * visit after this one. A dialer is the shape everybody already knows for this,
 * and it is the shape their hand knows too.
 *
 * Same posture as the keyboard beside it — one delegated `pointerdown`, CSS
 * `:active` for the pressed state, a haptic tick on contact — so the two feel
 * like one device rather than two components that happen to share a screen.
 * That includes committing on contact rather than on the lift, which the kiosk's
 * buttons no longer do: the reasoning is in components/Keyboard.tsx, and the
 * two boards have to answer a thumb identically or the exception becomes a
 * quirk of whichever one you are on.
 */
import { memo, useCallback, useRef } from 'react';
import { haptic } from '@/lib/utils';
import type { KioskKey } from '../components/Keyboard';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/** The letters under the digits. Nothing reads them; a hand recognises them. */
const LETTERS: Record<string, string> = {
  '2': 'ABC',
  '3': 'DEF',
  '4': 'GHI',
  '5': 'JKL',
  '6': 'MNO',
  '7': 'PQRS',
  '8': 'TUV',
  '9': 'WXYZ',
};

const KEY_CLASS =
  'flex h-16 select-none flex-col items-center justify-center rounded-xl ' +
  'bg-ink-800 text-2xl font-semibold text-ink-100 active:bg-ink-600';

export const PhonePad = memo(function PhonePad({
  onKey,
}: {
  onKey: (key: KioskKey) => void;
}) {
  const handlerRef = useRef(onKey);
  handlerRef.current = onKey;

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>(
        '[data-key]',
      );
      const key = target?.dataset.key;
      if (!key) return;
      event.preventDefault();
      haptic(8);
      if (key === 'backspace') handlerRef.current({ kind: 'backspace' });
      else if (key === 'clear') handlerRef.current({ kind: 'clear' });
      else handlerRef.current({ kind: 'char', value: key });
    },
    [],
  );

  return (
    <div
      className="mx-auto grid w-full max-w-sm grid-cols-3 gap-2 p-2 pb-[max(0.5rem,var(--spacing-safe-bottom))]"
      style={{ touchAction: 'manipulation' }}
      onPointerDown={onPointerDown}
    >
      {KEYS.map((key) => (
        <button
          key={key}
          type="button"
          tabIndex={-1}
          data-key={key}
          className={KEY_CLASS}
        >
          {key}
          {LETTERS[key] && (
            <span className="text-[0.6rem] font-medium tracking-[0.18em] text-ink-500">
              {LETTERS[key]}
            </span>
          )}
        </button>
      ))}
      <button
        type="button"
        tabIndex={-1}
        data-key="clear"
        className={`${KEY_CLASS} text-base font-medium text-ink-300`}
      >
        Clear
      </button>
      <button
        key="0"
        type="button"
        tabIndex={-1}
        data-key="0"
        className={KEY_CLASS}
      >
        0
      </button>
      <button
        type="button"
        tabIndex={-1}
        data-key="backspace"
        aria-label="Delete"
        className={`${KEY_CLASS} text-2xl`}
      >
        ⌫
      </button>
    </div>
  );
});
