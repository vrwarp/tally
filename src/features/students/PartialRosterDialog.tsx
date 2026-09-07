/**
 * The one confirmation the export feature has, and why it earns a dialog.
 *
 * Tally does not like dialogs — undo is one tap and never a question. This is
 * the exception, for the same reason the review screen arms before it commits:
 * the thing being confirmed leaves the app and outlives the session it was
 * taken in.
 *
 * The failure it stands in front of has no on-screen equivalent. A roster read
 * can land *successfully* with one backend down: `fetchRoster` lifts that
 * backend's people out of this device's saved copy and keeps them on the roster,
 * so the screen is honest — `RosterErrorBanner` is right there saying so — and
 * the *file* is not. A CSV taken in that moment is stale or short for every
 * Attendees student and looks exactly like a complete one. Emailed to somebody
 * who was not sitting here, there is nothing left to say which it was.
 *
 * So the answer is not to block. The app's posture everywhere is to warn and
 * name what it left out rather than refuse — the banner warns, `DataProvider`
 * keeps the stale roster on screen, Insights names the gatherings it excluded.
 * This confirms, and then the file carries the fact itself: a `-partial` flag in
 * the filename and a `source_read_at` column on every row, both of which survive
 * being forwarded.
 *
 * `unresolved` gets its own sentence because it cannot be a column. Those are
 * membership documents whose upstream person the read could not name, so
 * `mergeRoster` drops them and Tally holds no name to put in a row. There is
 * nothing to annotate — only a count to say out loud.
 */
import { Button, Modal } from '@/components/ui';
import type { RosterBackendStatus } from '@/services/functions';
import { useTranslations } from 'use-intl';
import { useTimeFormats } from '@/hooks/useTimeFormats';

export interface PartialRosterDialogProps {
  open: boolean;
  /** Backends whose read failed. Never empty when `open`. */
  down: readonly RosterBackendStatus[];
  /** Roster entries no backend could name, across every backend. */
  unresolved: number;
  onConfirm: () => void;
  onCancel: () => void;
  onRetry: () => void;
  retrying?: boolean;
}

export function PartialRosterDialog({
  open,
  down,
  unresolved,
  onConfirm,
  onCancel,
  onRetry,
  retrying = false,
}: PartialRosterDialogProps) {
  const time = useTimeFormats();
  const t = useTranslations('PartialRoster');
  const tErrors = useTranslations('Errors');
  const names = down.map((backend) => backend.displayName).join(' and ');

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={t('title')}
      description={t('description', { names })}
      footer={
        <>
          <Button variant="secondary" onClick={onRetry} loading={retrying}>
            {tErrors('tryAgain')}
          </Button>
          <Button variant="primary" onClick={onConfirm}>
            {t('exportAnyway')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-ink-300">
        <ul className="flex flex-col gap-2">
          {down.map((backend) => (
            <li key={backend.backendId} className="rounded-xl bg-ink-800 px-3 py-2">
              <p className="font-semibold text-ink-100">{backend.displayName}</p>
              {backend.error ? <p className="mt-0.5 text-warn-400">{backend.error}</p> : null}
              <p className="mt-0.5 text-xs text-ink-500">
                {backend.fetchedAt
                  ? t('savedCopyWithDate', {
                      count: backend.people,
                      when: time.dateTime(new Date(backend.fetchedAt)),
                    })
                  : t('savedCopy', { count: backend.people })}
              </p>
            </li>
          ))}
        </ul>

        {unresolved > 0 ? (
          <p>
            {t('unresolved', { count: unresolved })}
          </p>
        ) : null}

        <p className="text-xs text-ink-500">
          {t.rich('partialNote', { code: (chunks) => <code>{chunks}</code> })}
        </p>
      </div>
    </Modal>
  );
}
