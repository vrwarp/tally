/**
 * The foot of the event page: the things that cannot be undone.
 *
 * Tally leads with cancelling everywhere, and that is still right — it is
 * reversible, and it keeps the attendance the predictive roster and the
 * dashboard are built from. But a ministry accumulates two things cancelling
 * cannot fix. A night recorded by mistake: the wrong Friday, a duplicate, a
 * test event with eleven students checked into it, which stays in the trend
 * strip and in every average forever. And a gathering that has stopped
 * happening: its recurrence rule keeps projecting Fridays onto the calendar,
 * and there is no "off" — only cancelling each one as it arrives, one week at a
 * time, forever.
 *
 * So there are two deletes here, and they are different sizes.
 *
 *  - **This gathering.** One night and the check-ins filed under it. Offered
 *    whether or not anybody attended — which is the change; it used to be
 *    refused outright the moment one student was checked in, which is precisely
 *    the case the mistaken night is.
 *  - **Every gathering in this repeat.** The whole chain: the nights already
 *    recorded, and the ones ahead, which stop being projected the moment the
 *    last instance they were being projected from is gone.
 *
 * Both are typed confirmations rather than a second tap — see
 * `deleteConfirmation.ts` for why, and why the chain asks for a longer one. The
 * one thing that stays a two-tap is deleting a gathering nobody attended: there
 * is nothing to lose, and a leader who has just created next Friday twice
 * should not have to spell anything to fix it.
 */
import { useEffect, useState } from 'react';
import { Button, Card, CardHeader, ErrorBanner, Modal, TextField } from '@/components/ui';
import { useToast } from '@/context/toastContext';
import { confirmationPhrase, matchesConfirmation } from '@/features/events/deleteConfirmation';
import { chainKey } from '@/lib/materialize';
import { formatDateTime } from '@/lib/time';
import {
  deleteEvents,
  previewEventDeletion,
  type DeletionSummary,
} from '@/services/events';
import type { TallyEvent } from '@/types';

type Scope = 'event' | 'chain';

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/* -------------------------------------------------------------------------- */
/* The confirmation                                                            */
/* -------------------------------------------------------------------------- */

/**
 * What the delete would take, as a list rather than a sentence.
 *
 * A paragraph saying "this will delete 34 gatherings and 512 check-ins" is read
 * as reassurance — the shape of a warning, skimmed. The same facts as separate
 * lines are counted, and counting is the behaviour this box is trying to
 * provoke.
 */
function Consequences({ summary, scope }: { summary: DeletionSummary; scope: Scope }) {
  const lines = [
    // Only worth counting for a chain. On one night it would say "1 gathering"
    // above the title of the gathering it is asking about.
    scope === 'chain' ? `${plural(summary.events, 'gathering', 'gatherings')} already recorded` : null,
    plural(summary.checkIns, 'check-in', 'check-ins'),
    summary.rsvps > 0 ? plural(summary.rsvps, 'RSVP', 'RSVPs') : null,
    summary.unlinked > 0
      ? `${plural(summary.unlinked, 'one-off', 'one-offs')} that borrow these regulars will lose them`
      : null,
  ].filter((line): line is string => line !== null);

  return (
    <ul className="flex flex-col gap-1 rounded-xl bg-ink-950 p-3 text-sm text-ink-200 ring-1 ring-ink-800">
      {lines.map((line) => (
        <li key={line} className="flex gap-2">
          <span aria-hidden="true" className="text-ink-600">
            •
          </span>
          {line}
        </li>
      ))}
    </ul>
  );
}

interface ConfirmProps {
  open: boolean;
  scope: Scope;
  event: TallyEvent;
  /** Live attendance for this one gathering, which the page already holds. */
  checkedIn: number;
  onClose: () => void;
  onDeleted: () => void;
}

function DeleteGatheringModal({
  open,
  scope,
  event,
  checkedIn,
  onClose,
  onDeleted,
}: ConfirmProps) {
  const { show } = useToast();
  const chain = chainKey(event);

  const [typed, setTyped] = useState('');
  const [summary, setSummary] = useState<DeletionSummary | null>(null);
  const [counting, setCounting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const phrase = confirmationPhrase({ scope, title: event.title });
  const ready = matchesConfirmation(typed, phrase);

  /*
   * Ask the server what a chain delete would take, every time the box opens.
   *
   * The app cannot answer this itself. It holds a few months of the calendar,
   * not the two years of Fridays behind it, and it never loads the attendance
   * under a night nobody opened — so a count assembled here would be a
   * confident understatement of what is about to be destroyed. One gathering is
   * different: its attendance is on the screen behind this dialog.
   */
  useEffect(() => {
    if (!open) return;

    setTyped('');
    setError(null);

    if (scope !== 'chain') {
      setSummary(null);
      return;
    }

    let cancelled = false;
    setCounting(true);
    previewEventDeletion({ scope: 'chain', chain })
      .then((result) => {
        if (!cancelled) setSummary(result);
      })
      .catch(() => {
        if (!cancelled) setError('Could not work out what this would delete. Try again.');
      })
      .finally(() => {
        if (!cancelled) setCounting(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, scope, chain]);

  const handleDelete = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);

    try {
      const result = await deleteEvents(
        scope === 'chain' ? { scope: 'chain', chain } : { scope: 'event', eventId: event.id },
      );

      show(
        scope === 'chain'
          ? `Deleted ${plural(result.events, 'gathering', 'gatherings')} and ${plural(result.checkIns, 'check-in', 'check-ins')}`
          : result.checkIns > 0
            ? `Deleted ${event.title} and ${plural(result.checkIns, 'check-in', 'check-ins')}`
            : `Deleted ${event.title}`,
        { tone: 'success' },
      );
      onDeleted();
    } catch {
      setError('Could not delete this. Nothing has been removed — try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={scope === 'chain' ? `Delete every ${event.title}?` : `Delete ${event.title}?`}
      description={
        scope === 'chain'
          ? 'Every gathering in this repeat, past and future.'
          : // The date in full, so a confirmation about one night out of a
            // column of near-identical Fridays says which one.
            formatDateTime(event.startAt)
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Keep it
          </Button>
          <Button
            variant="danger"
            onClick={() => void handleDelete()}
            disabled={!ready || counting}
            loading={busy}
          >
            Delete
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {scope === 'chain' ? (
          <>
            {counting ? (
              <p className="text-sm text-ink-400">Working out what this would remove…</p>
            ) : summary ? (
              <Consequences summary={summary} scope="chain" />
            ) : null}
            <p className="text-sm leading-relaxed text-ink-300">
              The dates ahead go too. They are not saved anywhere — the calendar works them out
              from this gathering's own nights — so once the last one is gone, nothing puts a{' '}
              {event.title} back on the calendar.
            </p>
          </>
        ) : (
          <Consequences
            scope="event"
            summary={{ events: 1, checkIns: checkedIn, rsvps: 0, unlinked: 0, title: event.title }}
          />
        )}

        <p className="text-sm leading-relaxed text-ink-300">
          This cannot be undone.{' '}
          {scope === 'chain'
            ? 'Cancelling one date keeps its history and can be reversed; this keeps nothing.'
            : 'Cancelling keeps the attendance and can be reversed; this does not.'}
        </p>

        {error ? <ErrorBanner message={error} /> : null}

        <TextField
          label={`Type ${phrase} to confirm`}
          hint="Capitals do not matter."
          value={typed}
          onChange={(changed) => setTyped(changed.target.value)}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          disabled={busy}
        />
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* The card                                                                    */
/* -------------------------------------------------------------------------- */

export interface EventDangerZoneProps {
  event: TallyEvent;
  /** How many students are checked in, from the page's live subscription. */
  checkedIn: number;
  /** Called once the gathering is gone, so the page can leave. */
  onDeleted: () => void;
}

export function EventDangerZone({ event, checkedIn, onDeleted }: EventDangerZoneProps) {
  const { show } = useToast();
  const [confirming, setConfirming] = useState<Scope | null>(null);
  const [confirmingEmpty, setConfirmingEmpty] = useState(false);
  const [busy, setBusy] = useState(false);

  /*
   * The cheap path, kept cheap.
   *
   * A gathering nobody attended holds nothing anybody can lose, and the usual
   * reason to remove one is that it was just created by mistake. Making that a
   * spelling test would put the friction on the harmless case and teach the
   * habit that carries into the harmful one.
   */
  const deleteEmpty = async () => {
    setBusy(true);
    try {
      const result = await deleteEvents({ scope: 'event', eventId: event.id });
      show(
        result.checkIns > 0
          ? `Deleted ${event.title} and ${plural(result.checkIns, 'check-in', 'check-ins')}`
          : `Deleted ${event.title}`,
        { tone: 'success' },
      );
      onDeleted();
    } catch {
      // The confirmation stays up: a failure here is almost always a hallway
      // connection, and asking again should be one tap rather than two.
      show('Could not delete this event. Try again.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader title="Danger zone" />
        <div className="flex flex-col gap-2 p-4">
          {!event.materialized ? (
            /*
             * Nothing to delete, and nothing that deleting would achieve: this
             * gathering is the recurrence rule speaking, so removing it would
             * hand back exactly the same night on the next read. Cancelling is
             * what records the decision — it writes the one document that says
             * this Friday is off, which the projection then defers to. Ending
             * the whole repeat is a different question, and it is below.
             */
            <p className="text-sm text-ink-400">
              This gathering comes from the repeat schedule, so there is nothing of its own to
              delete. Cancel it to call off this one date, or edit the event to change the schedule
              itself.
            </p>
          ) : checkedIn > 0 ? (
            <>
              <p className="text-sm text-ink-400">
                {plural(checkedIn, 'student', 'students')}{' '}
                {checkedIn === 1 ? 'was' : 'were'} checked in here. Deleting this gathering deletes
                that attendance too, and the dashboard and the predictive roster are built from it.
                Cancelling keeps it and can be reversed.
              </p>
              <Button variant="secondary" onClick={() => setConfirming('event')}>
                Delete this gathering and its check-ins
              </Button>
            </>
          ) : confirmingEmpty ? (
            <>
              <p className="text-sm text-ink-300">
                Delete “{event.title}” permanently? Cancelling keeps it on the calendar and can be
                undone.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => setConfirmingEmpty(false)}
                >
                  Keep it
                </Button>
                <Button
                  variant="danger"
                  className="flex-1"
                  loading={busy}
                  onClick={() => void deleteEmpty()}
                >
                  Delete
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-ink-400">
                Nobody has been checked in, so this event can still be removed entirely.
              </p>
              <Button variant="secondary" onClick={() => setConfirmingEmpty(true)}>
                Delete event
              </Button>
            </>
          )}

          {/*
            Ending the gathering itself.

            Offered on a projected occurrence as well as a materialised one,
            deliberately: the screen a leader is most likely to be on when they
            decide a weekly gathering is over is next Friday's, and next Friday
            is usually a night no document exists for yet.
          */}
          {event.mode === 'recurring' ? (
            <div className="mt-2 flex flex-col gap-2 border-t border-ink-800 pt-4">
              <p className="text-sm text-ink-400">
                This gathering repeats. Ending it removes every {event.title} — the nights already
                recorded, their check-ins, and the dates the schedule has not reached yet.
              </p>
              <Button variant="secondary" onClick={() => setConfirming('chain')}>
                Delete every gathering in this repeat
              </Button>
            </div>
          ) : null}
        </div>
      </Card>

      {/* Mounted only while it is open, unlike the editor. A dialog holding a
          confirmation phrase and a delete button should not be sitting in the
          page — reachable by a stray tab, and re-counting a chain — the rest of
          the time. */}
      {confirming !== null ? (
        <DeleteGatheringModal
          open
          scope={confirming}
          event={event}
          checkedIn={checkedIn}
          onClose={() => setConfirming(null)}
          onDeleted={() => {
            setConfirming(null);
            onDeleted();
          }}
        />
      ) : null}
    </>
  );
}
