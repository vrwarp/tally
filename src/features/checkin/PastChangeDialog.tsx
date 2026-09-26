/**
 * "This gathering is over — change it anyway?"
 *
 * Every attendance write on a past gathering stops here first. The roster's
 * one-tap writes are cheap on the night because the night is the one somebody
 * is standing at; a register from last Friday is not, and checking forty
 * students into it by mistake is the worst failure this app has. The header's
 * warn capsule says so, but a capsule is easy to stop reading. This cannot be.
 *
 * The confirm button takes focus when the dialog opens, so the laptop back-fill
 * loop — three letters, down arrow, Enter — costs one more Enter per student
 * rather than a trip to the mouse.
 */
import { useEffect, useRef } from 'react';
import { Button, Modal } from '@/components/ui';
import { useTimeFormats } from '@/hooks/useTimeFormats';
import type { TallyEvent } from '@/types';
import { useTranslations } from 'use-intl';

/** Which write is waiting, and the names its sentence needs. */
export type PastChange =
  | { kind: 'checkIn' | 'undo' | 'checkOut' | 'undoCheckOut'; name: string }
  | { kind: 'swap'; wrong: string; right: string };

export interface PastChangeDialogProps {
  event: TallyEvent;
  change: PastChange;
  onConfirm: () => void;
  onCancel: () => void;
}

export function PastChangeDialog({ event, change, onConfirm, onCancel }: PastChangeDialogProps) {
  const t = useTranslations('PastChange');
  const tCommon = useTranslations('Common');
  const time = useTimeFormats();
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Passive, so it lands after `Modal`'s layout effect has shown the dialog —
  // `showModal()` moves focus itself, and would undo anything done earlier.
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  let title: string;
  let confirm: string;
  switch (change.kind) {
    case 'checkIn':
      title = t('titleCheckIn', { name: change.name });
      confirm = t('confirmCheckIn');
      break;
    case 'undo':
      title = t('titleUndo', { name: change.name });
      confirm = t('confirmUndo');
      break;
    case 'checkOut':
      title = t('titleCheckOut', { name: change.name });
      confirm = t('confirmCheckOut');
      break;
    case 'undoCheckOut':
      title = t('titleUndoCheckOut', { name: change.name });
      confirm = t('confirmUndoCheckOut');
      break;
    case 'swap':
      title = t('titleSwap', { wrong: change.wrong, right: change.right });
      confirm = t('confirmSwap');
      break;
  }

  return (
    <Modal
      open
      onClose={onCancel}
      size="sm"
      title={title}
      autoFocusField={false}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {tCommon('cancel')}
          </Button>
          <Button
            ref={confirmRef}
            variant={change.kind === 'undo' ? 'danger' : 'primary'}
            onClick={onConfirm}
          >
            {confirm}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-ink-300">
        {t('body', { title: event.title, date: time.weekdayDate(event.startAt) })}
      </p>
    </Modal>
  );
}
