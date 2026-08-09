/**
 * The one press that spends a label.
 *
 * `ConfirmScreen`'s shape, because it is the same act: a name read back at the
 * top of a flexible track, a committing button a constant distance up from the
 * bezel, and Back below it. A volunteer who taps the wrong Alvarez should meet
 * the same screen a parent does — the kiosk has no undo, and a sticker is
 * cheap but a sticker with the wrong child's name on it is not.
 *
 * The preview is here because a reprint is usually somebody checking a
 * suspicion: the first one came out blank, or came out with a line missing, or
 * came out at all. Showing what is about to be sent answers that before the tape
 * moves.
 */
import { gradeDescription, haptic } from '@/lib/utils';
import type { KioskStudent } from '@/kiosk/search';

export function ReprintConfirmScreen({
  student,
  lines,
  printedAt,
  onPrint,
  onBack,
}: {
  student: KioskStudent;
  /** What the gathering's template resolves to for this child. */
  lines: readonly string[];
  /** When their last name tag printed tonight, if one did. */
  printedAt: string | null;
  onPrint: () => void;
  onBack: () => void;
}) {
  return (
    <div
      className="grid h-full w-full grid-rows-[minmax(0,1fr)_auto_auto] justify-center justify-items-center p-8 pb-[max(2rem,18vh)] text-center"
      style={{ gridTemplateColumns: 'minmax(0, var(--confirm-measure, 28rem))' }}
    >
      <div className="flex min-h-0 w-full flex-col items-center justify-end pb-12">
        <div className="w-full shrink-0">
          <div className="text-5xl/[1.15] font-bold text-ink-50">
            {student.firstName} {student.lastName}
          </div>
          {student.grade !== null && (
            <div className="pt-3 text-2xl text-ink-400">{gradeDescription(student.grade)}</div>
          )}
          <div className="pt-2 text-lg text-ink-500">
            {printedAt ? `Name tag printed at ${printedAt}.` : 'No name tag printed tonight.'}
          </div>
        </div>

        {/* The sticker, drawn as a sticker: paper-coloured, because every other
            surface on this device is a distance from the reader and this one is
            an object in the room. */}
        <div className="mt-8 w-full shrink-0 rounded-xl bg-ink-50 px-6 py-5 text-ink-950">
          {lines.map((line, index) => (
            <div
              key={line}
              className={index === 0 ? 'text-2xl font-bold' : 'pt-1 text-base text-ink-800'}
            >
              {line}
            </div>
          ))}
        </div>
      </div>

      <button
        type="button"
        tabIndex={-1}
        onPointerDown={(event) => {
          event.preventDefault();
          haptic();
          onPrint();
        }}
        className="w-full shrink-0 rounded-2xl bg-brand-600 p-7 text-3xl font-bold text-white active:bg-brand-500"
        style={{ touchAction: 'manipulation' }}
      >
        Print this name tag
      </button>

      <button
        type="button"
        tabIndex={-1}
        onPointerDown={(event) => {
          event.preventDefault();
          onBack();
        }}
        className="mt-8 shrink-0 rounded-xl px-8 py-4 text-xl text-ink-400 active:bg-ink-800"
        style={{ touchAction: 'manipulation' }}
      >
        ← Back
      </button>
    </div>
  );
}
