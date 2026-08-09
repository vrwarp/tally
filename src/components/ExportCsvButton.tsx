/**
 * The one control every CSV export presses through.
 *
 * Shaped after `CopyContactsButton` (`features/dashboard/FollowUpActions.tsx`),
 * which solved the same problems first: disabled at zero, a toast carrying the
 * count, and a named failure rather than a button that quietly does nothing.
 *
 * Two things it adds, both because a download is not a clipboard write:
 *
 *   - **It says the number.** A download is the one interaction with no visible
 *     result — the file lands in a bar, or a folder nobody is looking at. The
 *     count in the toast is what makes it trustworthy, and it is also what
 *     catches the export that quietly shipped the whole roster instead of the
 *     filtered rows on screen.
 *
 *   - **It warns before the press, not after.** Several in-app browsers ignore
 *     the `download` attribute and open the CSV in a viewer, with nothing
 *     detectable happening afterwards. `downloadOpensInViewer()` is consulted up
 *     front so the button can say so while there is still a choice.
 *
 * Deliberately in `components/` rather than `components/ui/`: it reaches into
 * toast context, and the `ui/` primitives do not.
 */
import { useState } from 'react';
import { Button, type ButtonProps } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useToast } from '@/context/toastContext';
import { downloadCsv, downloadOpensInViewer } from '@/lib/download';

export interface ExportCsvButtonProps {
  /**
   * Built lazily, on press. Nothing is serialised until somebody asks — a
   * roster of four hundred should not be re-encoded on every keystroke in the
   * search box above it.
   */
  build: () => { filename: string; contents: string };
  /** Rows in the file. Drives the disable, the label and the toast. */
  count: number;
  /** The noun the toast uses: `students`, `check-ins`, `names`. */
  noun: string;
  /**
   * Blocks the press and explains why — a roster read that failed, so there is
   * nothing honest to export. A reason rather than a boolean, because a
   * disabled control with no sentence beside it reads as a broken one.
   */
  blockedReason?: string | null;
  /**
   * Runs before the file is built; returning false aborts silently.
   *
   * For the confirmation a partial roster needs. It has to happen *before* the
   * download rather than as a toast after it, because by then the file exists.
   */
  confirm?: () => Promise<boolean>;
  label?: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  className?: string;
}

export function ExportCsvButton({
  build,
  count,
  noun,
  blockedReason,
  confirm,
  label = 'Export CSV',
  // Ghost by default, and that is the scope showing.
  //
  // On Insights these sit in a card header, above a column of `Call`/`Text`
  // pills that act on one student. Drawn at the same secondary weight they were
  // indistinguishable from those — a header cluster reading as just the top row
  // of a long column of identical pills, with nothing but position to say that
  // `Export` acts on the whole list. A lighter register within the same ink
  // ramp is what lets the eye tell a list-level act from a student-level one
  // without reading the label.
  variant = 'ghost',
  // `md`, not `sm`. The lighter register the critics asked for is about *fill*,
  // not size — and `sm` is a flat 36px, under the 44px floor a thumb needs.
  // `md` is 44px where there is a thumb and steps down to 36px under
  // `pointer-fine:`, which is the same object on a laptop and a real target on
  // a phone.
  size = 'md',
  className,
}: ExportCsvButtonProps) {
  const { show } = useToast();
  const [busy, setBusy] = useState(false);

  const empty = count === 0;
  const disabled = empty || Boolean(blockedReason);

  const run = async () => {
    if (blockedReason) {
      show(blockedReason, { tone: 'error' });
      return;
    }

    setBusy(true);
    try {
      if (confirm && !(await confirm())) return;

      const { filename, contents } = build();
      downloadCsv(filename, contents);

      if (downloadOpensInViewer()) {
        // The file was handed over; whether this browser saved it is another
        // matter, and saying so beats a success message that may be a lie.
        show('Exported — this browser may show the file instead of saving it.', { tone: 'info' });
      } else {
        show(`Downloaded ${count} ${count === 1 ? singular(noun) : noun}`, { tone: 'success' });
      }
    } catch {
      show('Could not save the file on this device.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant={variant}
      size={size}
      onClick={() => void run()}
      disabled={disabled}
      loading={busy}
      /*
       * A boundary without a fill.
       *
       * `ghost` alone is bare text, and bare text is not a control on a phone:
       * `hover:bg-ink-800` never fires on a touch screen, and nothing else on
       * Insights is a bare-text action — the gathering chips, the stat tiles and
       * the rows all carry a box. A solitary "Export CSV" under a title and a
       * description read as a third line of caption, worst on the two cards
       * where it has no partner beside it to look like a toolbar.
       *
       * `ring-1 ring-ink-800` is the app's own "this is a surface you can touch"
       * token — what the stat tiles and chips wear — so it returns the only
       * affordance a touch screen has, makes the 44px hit box visible, and stays
       * clearly quieter than the filled `bg-ink-800 ring-ink-700` secondaries it
       * sits beside.
       */
      className={cn(variant === 'ghost' && 'ring-1 ring-ink-800', className)}
      title={blockedReason ?? undefined}
      aria-label={
        empty ? `${label} — nothing to export` : `${label} — ${count} ${noun}`
      }
    >
      {label}
    </Button>
  );
}

/** "1 student", not "1 students". Enough for the four nouns this takes. */
function singular(noun: string): string {
  if (noun.endsWith('ies')) return `${noun.slice(0, -3)}y`;
  return noun.endsWith('s') ? noun.slice(0, -1) : noun;
}
