/**
 * The act: one gathering stops expecting one student (docs/aging-out.md).
 *
 * One student at a time, deliberately — there is no multi-select. The reason
 * carries a real consequence and it varies *within* a cohort (six moved on,
 * three were lost), so a bulk act would stamp one answer onto nine children;
 * the per-row picker is the beat of thought. Nine presses once a year is the
 * cost, and the nursery drip is n=1 by nature.
 *
 * The picker pre-selects "Moved on within the ministry", and never the
 * silencing reason: the two errors are not symmetric. A wrong "moved on"
 * surfaces the student on the unseen list three weeks later — a phone call
 * probably worth making anyway. A wrong "no longer with us" is a year of
 * silence about a family nobody resolved. The default leans the recoverable
 * way, and the sentence above the buttons says which way each choice falls —
 * a reader should not have to press it to find out.
 */
import { useEffect, useState } from 'react';
import { Button, Modal, TextField } from '@/components/ui';
import { formatShortDate } from '@/lib/time';
import {
  TRANSITION_REASON_LABEL,
  studentFullName,
  type Student,
  type TransitionReason,
} from '@/types';

export interface ReleaseTarget {
  student: Student;
  chainKey: string;
  gatheringTitle: string;
  /**
   * Set when the loaded window has seen this student *nowhere* since their
   * last visit to the gathering — the case the strongest sentence is for.
   */
  notSeenAnywhereSince?: Date | null;
}

export interface ReleaseDialogProps {
  /** Null closes the dialog. */
  target: ReleaseTarget | null;
  /** `settings.miaConsecutiveMisses`, quoted so the sentence can say "about N". */
  threshold: number;
  busy: boolean;
  onClose: () => void;
  onConfirm: (target: ReleaseTarget, reason: TransitionReason, note: string) => void;
}

const REASON_HINT: Record<TransitionReason, string> = {
  'moved-on': 'We still expect to see them at another gathering.',
  departed: 'Graduated, moved away, or stopped coming — this is the resolution.',
};

/**
 * The sentence above the buttons, said for whichever way the press will fall.
 *
 * Symmetric on purpose: the silencing choice is the one that needs it most,
 * and a caption that only warned about the surfacing one would train the
 * reader that the sentence never matters.
 */
function consequence(target: ReleaseTarget, reason: TransitionReason, threshold: number): string {
  const name = target.student.firstName || studentFullName(target.student);
  const unseen = target.notSeenAnywhereSince
    ? `${name} has not been seen at any gathering since ${formatShortDate(target.notSeenAnywhereSince)}. `
    : '';

  if (reason === 'departed') {
    return (
      `${unseen}Marking ${name} “no longer with us” means Tally stops asking about them: they ` +
      `leave this list and will not appear on any other. Checking them in here again undoes it.`
    );
  }

  return (
    `${unseen}${name} leaves this list now and stays on the ministry's radar: if no gathering ` +
    `sees them, they will appear under “Not seen at any gathering” after about ${threshold} more ` +
    `gatherings. Checking them in here again undoes the release by itself.`
  );
}

export function ReleaseDialog({ target, threshold, busy, onClose, onConfirm }: ReleaseDialogProps) {
  const [reason, setReason] = useState<TransitionReason>('moved-on');
  const [note, setNote] = useState('');

  // A fresh target is a fresh act: the previous student's reason and note must
  // not leak onto the next row's release.
  useEffect(() => {
    setReason('moved-on');
    setNote('');
  }, [target?.student.id, target?.chainKey]);

  if (!target) return null;

  const name = studentFullName(target.student);

  return (
    <Modal
      open
      onClose={busy ? () => undefined : onClose}
      title="No longer expected here"
      description={`${name} · ${target.gatheringTitle}`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(target, reason, note)} loading={busy}>
            Release
          </Button>
        </>
      }
    >
      {/* The dialog body is a plain block — every form in the app supplies its
          own rhythm, and without one the picker, the note and the sentence
          below it ran together as a single wall. */}
      <div className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Why {name} is no longer expected</legend>
          {(['moved-on', 'departed'] as const).map((value) => (
            <label
              key={value}
              className={
                'flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 ring-1 ' +
                (reason === value ? 'bg-ink-800 ring-brand-500' : 'ring-ink-700 hover:bg-ink-800/50')
              }
            >
              <input
                type="radio"
                name="release-reason"
                value={value}
                checked={reason === value}
                onChange={() => setReason(value)}
                className="mt-1 size-4 accent-brand-500"
              />
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-semibold text-ink-50">
                  {TRANSITION_REASON_LABEL[value]}
                </span>
                <span className="text-xs text-ink-400">{REASON_HINT[value]}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <TextField
          label="Note (optional)"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={500}
          placeholder="“graduated”, “moved to Austin”"
          hint="Kept on the record under this list, for whoever reads it later."
        />

        <p
          className={
            'rounded-xl px-3 py-2.5 text-sm ring-1 ' +
            (reason === 'departed' && target.notSeenAnywhereSince
              ? 'bg-warn-500/10 text-warn-300 ring-warn-500/25'
              : 'bg-ink-800/60 text-ink-300 ring-ink-700')
          }
        >
          {consequence(target, reason, threshold)}
        </p>
      </div>
    </Modal>
  );
}
