/**
 * The green tick. Painted optimistically — before the network — and returned
 * to the same search automatically, because a parent with three kids checks
 * them in off one phone number: the results they came from are still there,
 * with this student now marked present.
 *
 * A pickup gets its own wording and a neutral mark rather than the green tick.
 * "Welcome!" is precisely wrong for somebody leaving, and the two screens have
 * to be distinguishable at a glance by a parent who is not reading carefully.
 */
import { useEffect, useRef } from 'react';
import type { KioskIntent } from '../KioskApp';
import type { KioskStudent } from '../search';

const AUTO_RETURN_MS = 4000;

export function SuccessScreen({
  student,
  intent,
  onDone,
}: {
  student: KioskStudent;
  intent: KioskIntent;
  onDone: () => void;
}) {
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const timer = setTimeout(() => doneRef.current(), AUTO_RETURN_MS);
    return () => clearTimeout(timer);
  }, []);

  const collected = intent === 'check-out';

  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-8 p-8 text-center"
      onPointerDown={() => doneRef.current()}
    >
      <div
        className={`flex h-36 w-36 items-center justify-center rounded-full text-8xl text-white ${
          collected ? 'bg-brand-600' : 'bg-present-600'
        }`}
      >
        {collected ? '👋' : '✓'}
      </div>
      <div>
        <div className="text-5xl font-bold text-ink-50">{student.firstName}</div>
        <div className="pt-3 text-2xl text-ink-300">
          {collected
            ? 'is checked out. See you next time!'
            : intent === 'done'
              ? 'was already checked in.'
              : 'is checked in. Welcome!'}
        </div>
      </div>
      <div className="text-lg text-ink-500">Tap anywhere to carry on</div>
    </div>
  );
}
