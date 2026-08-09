/**
 * The one press that spends a label.
 *
 * `ConfirmScreen`'s shape, because it is the same act: a fact read back at the
 * top of a flexible track, a committing button a constant distance up from the
 * bezel, and Back below it. A volunteer who taps the wrong Alvarez should meet
 * the same screen a parent does — the kiosk has no undo, and a sticker is
 * cheap but a sticker with the wrong child's name on it is not.
 *
 * Every door that spends a label comes through here, including the printer
 * screen's "Printed tonight" rows. Those were one unconfirmed press for a named
 * child, eight pixels apart, two Alvarezes with the same surname and the same
 * timestamp — the more dangerous of the two doors, with the weaker safety on it.
 *
 * The preview is here because a reprint is usually somebody checking a
 * suspicion: the first one came out blank, or came out with a line missing, or
 * came out at all. Showing what is about to be sent answers that before the tape
 * moves — and it is also what carries the identity, so the screen does not state
 * the child's name three times at three sizes with the loudest one redundant.
 * The heading says the act; the line under it says the thing the volunteer is
 * actually standing here to find out.
 */
import { useEffect, useRef } from 'react';
import { haptic } from '@/lib/utils';
import type { KioskStudent } from '@/kiosk/search';
import { StaffMark } from './StaffMark';

/** The same clock the reprint list runs on — see `ReprintScreen`. */
const RETURN_MS = 45_000;

export function ReprintConfirmScreen({
  student,
  lines,
  printedAt,
  printerNeedsAttention,
  onPrint,
  onBack,
}: {
  student: KioskStudent;
  /** What the gathering's template resolves to for this child. */
  lines: readonly string[];
  /** When their last name tag printed tonight, if one did. */
  printedAt: string | null;
  /** Trouble reaches this screen too — see `ReprintScreen`. */
  printerNeedsAttention: boolean;
  onPrint: () => void;
  onBack: () => void;
}) {
  const backRef = useRef(onBack);
  backRef.current = onBack;
  useEffect(() => {
    const timer = setTimeout(() => backRef.current(), RETURN_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className="grid h-full w-full grid-rows-[auto_minmax(0,1fr)_auto_auto] justify-center justify-items-center p-8 pb-[max(2rem,18vh)] text-center"
      style={{ gridTemplateColumns: 'minmax(0, var(--confirm-measure, 28rem))' }}
    >
      {/* This screen was the one in the flow with no staff marker on it, and it
          is the one a parent is likeliest to meet: a child's name in 48px type
          over a full-width blue button is the check-in screen as far as anybody
          walking up is concerned. */}
      <div className="w-full shrink-0">
        <StaffMark />
      </div>

      <div className="flex min-h-0 w-full flex-col items-center justify-end overflow-hidden pb-8">
        <div className="w-full shrink-0">
          <div className="text-2xl/[1.2] font-semibold text-ink-100 kiosk:text-4xl/[1.2]">
            Print this name tag again
          </div>
          {/* The only line here carrying new information — why the volunteer is
              standing at the kiosk — used to be the smallest and dimmest thing
              in the block, under a 48px repeat of a name the sticker below
              already says. It does not repeat the name either: the sticker is
              one line under it and says it in black on white. */}
          <div className="pt-3 text-xl text-ink-300 kiosk:text-2xl">
            {printedAt ? `Last printed at ${printedAt}.` : 'No name tag printed tonight.'}
          </div>
        </div>

        {/* The sticker, drawn as a sticker: paper-coloured, because every other
            surface on this device is a distance from the reader and this one is
            an object in the room. It carries the identity — this is the check
            that the right Alvarez was tapped, and it is the one place the name
            appears exactly as it will on the paper. */}
        <div className="mt-6 w-full shrink-0 rounded-xl bg-ink-50 px-6 py-5 text-ink-950">
          {lines.map((line, index) => (
            <div
              key={line}
              className={
                index === 0
                  ? 'text-3xl font-bold kiosk:text-4xl'
                  : 'pt-1 text-base text-ink-800 kiosk:text-lg'
              }
            >
              {line}
            </div>
          ))}
        </div>

      </div>

      {/* The caveat rides with the commit rather than with the block above it.
          Inside that block it was one more thing in a track already the exact
          height of its contents on a phone, and it pushed the heading up over
          the staff marker. */}
      <div className="w-full shrink-0">
        {printerNeedsAttention && (
          <div className="pb-3 text-base font-semibold text-balance text-warn-400 kiosk:text-lg">
            Printer needs attention — this may not print.
          </div>
        )}
        <button
          type="button"
          tabIndex={-1}
          /* The button's face says the act and the sticker beside it says the
             child, which is right for an eye and wrong for anything reading the
             control on its own — a test, or a volunteer using a screen reader.
             The name is on the button too, where it costs no pixels. */
          aria-label={`Print ${student.firstName} ${student.lastName}'s name tag`}
          onPointerDown={(event) => {
            event.preventDefault();
            haptic();
            onPrint();
          }}
          className="w-full rounded-2xl bg-brand-600 p-7 text-3xl font-bold text-white active:bg-brand-500"
          style={{ touchAction: 'manipulation' }}
        >
          Print this name tag
        </button>
      </div>

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
