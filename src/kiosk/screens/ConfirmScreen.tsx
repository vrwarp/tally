/**
 * "Is this you?" — one big name, one big button.
 *
 * The check-in itself is a single tap, not a hold: speed of confirmation is
 * the kiosk's whole point, and the worst a mis-tap can do is mark somebody
 * present who then walks in anyway. Undo lives with the staff in the main app,
 * deliberately not here.
 *
 * A pickup holds for three seconds instead, and that is not ceremony. Marking
 * a child collected is a claim that somebody took them out of the building,
 * made on an unattended screen in a lobby — and unlike a stray check-in it is
 * not self-correcting when the child walks in anyway. Undoing one needs a
 * volunteer and the main app, so the gesture is worth a deliberate second.
 */
import { gradeDescription } from '@/lib/utils';
import { HoldButton } from '../components/HoldButton';
import type { KioskIntent } from '../KioskApp';
import type { KioskStudent } from '../search';

export function ConfirmScreen({
  student,
  intent,
  onConfirm,
  onBack,
}: {
  student: KioskStudent;
  intent: KioskIntent;
  onConfirm: () => void;
  onBack: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-10 p-8 text-center">
      <div>
        <div className="text-5xl font-bold text-ink-50">
          {student.firstName} {student.lastName}
        </div>
        {student.grade !== null && (
          <div className="pt-3 text-2xl text-ink-400">{gradeDescription(student.grade)}</div>
        )}
      </div>

      {intent === 'done' ? (
        <div className="text-2xl font-semibold text-present-400">✓ Already checked in</div>
      ) : intent === 'check-out' ? (
        <HoldButton
          onHeld={onConfirm}
          className="w-full max-w-md rounded-2xl bg-brand-600 p-7 text-3xl font-bold text-white"
        >
          Hold to collect
        </HoldButton>
      ) : (
        <button
          type="button"
          tabIndex={-1}
          onPointerDown={(event) => {
            event.preventDefault();
            onConfirm();
          }}
          className="w-full max-w-md rounded-2xl bg-present-600 p-7 text-3xl font-bold text-white active:bg-present-500"
          style={{ touchAction: 'manipulation' }}
        >
          Check in
        </button>
      )}

      <button
        type="button"
        tabIndex={-1}
        onPointerDown={(event) => {
          event.preventDefault();
          onBack();
        }}
        className="rounded-xl px-8 py-4 text-xl text-ink-400 active:bg-ink-800"
        style={{ touchAction: 'manipulation' }}
      >
        ← Back
      </button>
    </div>
  );
}
