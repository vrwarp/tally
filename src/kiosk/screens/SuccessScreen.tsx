/**
 * The green tick. Painted optimistically — before the network — and returned
 * to the same search automatically, because a parent with three kids checks
 * them in off one phone number: the results they came from are still there,
 * with this student now marked present.
 */
import { useEffect, useRef } from 'react';
import type { KioskStudent } from '../search';

const AUTO_RETURN_MS = 4000;

export function SuccessScreen({
  student,
  alreadyPresent,
  onDone,
}: {
  student: KioskStudent;
  alreadyPresent: boolean;
  onDone: () => void;
}) {
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const timer = setTimeout(() => doneRef.current(), AUTO_RETURN_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-8 p-8 text-center"
      onPointerDown={() => doneRef.current()}
    >
      <div className="flex h-36 w-36 items-center justify-center rounded-full bg-present-600 text-8xl text-white">
        ✓
      </div>
      <div>
        <div className="text-5xl font-bold text-ink-50">{student.firstName}</div>
        <div className="pt-3 text-2xl text-ink-300">
          {alreadyPresent ? 'was already checked in.' : 'is checked in. Welcome!'}
        </div>
      </div>
      <div className="text-lg text-ink-500">Tap anywhere for the next check-in</div>
    </div>
  );
}
