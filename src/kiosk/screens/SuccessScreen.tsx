/**
 * The green tick. Painted optimistically — before the network — and dismissed
 * automatically after a few seconds, back to an empty search screen: the next
 * family in the queue starts from the same blank glass every time, and nobody
 * is left looking at the previous family's name.
 *
 * A pickup gets its own wording and a neutral mark rather than the green tick.
 * "Welcome!" is precisely wrong for somebody leaving, and the two screens have
 * to be distinguishable at a glance by a parent who is not reading carefully.
 *
 * A family confirmed together is one tick with every first name on it, not a
 * tick each. The names are what the parent checks against the children beside
 * them, and a sequence of screens is a sequence nobody watches to the end.
 */
import { useEffect, useRef } from 'react';
import { useTap } from '../components/tapGuard';
import type { KioskIntent } from '../KioskApp';
import type { KioskStudent } from '../search';

const AUTO_RETURN_MS = 4000;

/** "Ada", "Ada and Marcus", "Ada, Marcus and Grace". */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function SuccessScreen({
  students,
  intent,
  onDone,
}: {
  /** Everyone the one confirm covered — never empty. */
  students: readonly KioskStudent[];
  intent: KioskIntent;
  onDone: () => void;
}) {
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const tap = useTap();

  useEffect(() => {
    const timer = setTimeout(() => doneRef.current(), AUTO_RETURN_MS);
    return () => clearTimeout(timer);
  }, []);

  const collected = intent === 'check-out';
  const many = students.length > 1;
  const names = joinNames(students.map((student) => student.firstName));

  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-8 p-8 text-center"
      /* The whole screen is the dismiss, so it is also the whole screen that a
         hand can brush on its way past — which is the one place on the kiosk
         where waiting for the lift is worth naming twice. */
      {...tap(() => doneRef.current())}
    >
      <div
        className={`flex h-36 w-36 shrink-0 items-center justify-center rounded-full text-8xl text-white ${
          collected ? 'bg-brand-600' : 'bg-present-600'
        }`}
      >
        {collected ? '👋' : '✓'}
      </div>
      <div>
        {/* Three names need to fit; one still gets the whole 5xl to itself. */}
        <div className={`font-bold text-ink-50 ${many ? 'text-4xl' : 'text-5xl'}`}>{names}</div>
        <div className="pt-3 text-2xl text-ink-300">
          {collected
            ? `${many ? 'are' : 'is'} checked out. See you next time!`
            : intent === 'done'
              ? `${many ? 'were' : 'was'} already checked in.`
              : `${many ? 'are' : 'is'} checked in. Welcome!`}
        </div>
      </div>
      <div className="text-lg text-ink-500">Tap anywhere to carry on</div>
    </div>
  );
}
