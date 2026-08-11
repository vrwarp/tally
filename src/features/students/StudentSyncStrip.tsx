/**
 * What a record says while an edit of it is somewhere between typed and saved.
 *
 * One component for nine states, because they are one object with one anatomy:
 * a mark, a heading, a sentence, and at most two moves. Four rounds of critique
 * settled the rules it holds, and each of them is here for a reason that cost
 * something to learn:
 *
 * **One state per render.** The first pass said "Saving to Planning Center" and
 * "queued by you" in the same breath — two rows of the state table with
 * different rules — and then offered a cancel that is only honest in one of
 * them. A leader who presses a cancel that cannot win walks away believing the
 * old surname survived while the new one lands.
 *
 * **The loudest thing on a record is whatever matters most, and there is only
 * ever one of them.** A healthy in-flight job gets a quiet action and the page
 * keeps its own brand button; a state that needs a human takes the brand button
 * and the page's steps down. `needsAHuman` is the single predicate.
 *
 * **A value that appears in a cell does not appear in the paragraph.** The
 * comparison is the thing built to be read at a glance, and a paragraph that
 * has already given both values away turns it into a recap.
 *
 * **A guard sentence beside a button stays short.** Past about forty characters
 * the actions column wraps and the strip grows a void down its right-hand side.
 * Anything longer belongs in the message.
 */
import { Button } from '@/components/ui';
import { syncStripCopy } from '@/features/students/syncStripCopy';
import { pcoPersonUrl } from '@/lib/planningCenter';
import { formatRelative } from '@/lib/time';
import { cn } from '@/lib/utils';
import {
  backendLabelOf,
  needsAHuman,
  personIdFromStudentId,
  type Student,
  type UpstreamEdit,
  type UpstreamEditPatch,
} from '@/types';

/** The short guard, shared so the two frames that show it cannot drift apart. */
export const ONE_NEW_PERSON = 'One new person, never a second copy.';

export interface StudentSyncStripProps {
  student: Student;
  edit: UpstreamEdit;
  now: Date;
  /** The signed-in person, for "by you" against "by Marcus". */
  uid: string;
  onCancel: () => void;
  onRetry: () => void;
  onDismiss: () => void;
  /** Opens the editor with the refused values still in it. */
  onFix: () => void;
  onRecreate: () => void;
}

interface Cell {
  label: string;
  value: string;
  meta: string;
  /** The one the backend is holding right now. */
  live?: boolean;
}

export function StudentSyncStrip({
  student,
  edit,
  now,
  uid,
  onCancel,
  onRetry,
  onDismiss,
  onFix,
  onRecreate,
}: StudentSyncStripProps) {
  const backend = backendLabelOf(student);
  const mine = edit.createdBy === uid;
  const copy = syncStripCopy({
    edit,
    now,
    backend,
    mine,
    authorFirstName: edit.createdByName.split(/\s+/)[0] ?? 'somebody',
    ago: formatRelative(edit.createdAt),
  });

  const loud = needsAHuman(edit);
  const tone = copy.tone === 'bad'
    ? 'bg-danger-500/10 ring-danger-500/30'
    : 'bg-warn-500/10 ring-warn-500/30';
  const ink = copy.tone === 'bad' ? 'text-danger-400' : 'text-warn-400';

  /*
   * The two-up, for the two states where something landed and what came back is
   * not what was sent. `merged` holds *people* rather than values — after a
   * merge the names can be identical and the ids are the only thing that says
   * a person moved, which is the case this whole state exists to catch.
   */
  const cells: Cell[] | null =
    edit.state === 'merged'
      ? [
          {
            label: 'Now points at',
            value: edit.survivorName ?? 'the surviving record',
            meta: edit.survivorPersonId ? `#${edit.survivorPersonId} · the survivor` : 'the survivor',
            live: true,
          },
          {
            label: 'You edited',
            value: `${student.firstName} ${student.lastName}`.trim(),
            /*
             * The id the edit named, beside the one it landed on. Both, because
             * after a merge the two names can be identical — that is the case
             * this state exists for — and the ids are then the only thing that
             * says a person moved.
             */
            meta: [
              personIdFromStudentId(student.id) ? `#${personIdFromStudentId(student.id)}` : null,
              `merged ${formatRelative(edit.settledAt ?? edit.updatedAt)}`,
            ]
              .filter(Boolean)
              .join(' · '),
          },
        ]
      : edit.state === 'differs' && edit.observed
        ? [
            {
              label: 'On the record now',
              value: describeValue(edit.observed),
              meta: `in ${backend}`,
              live: true,
            },
            {
              label: 'You typed',
              value: describeValue(edit.patch),
              meta: mine ? 'you' : edit.createdByName,
            },
          ]
        : null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex flex-col gap-3 rounded-2xl px-4 py-3 ring-1',
        'lg:flex-row lg:flex-wrap lg:items-start lg:gap-4 lg:py-2',
        tone,
      )}
    >
      <span aria-hidden="true" className={cn('mt-0.5 shrink-0 text-base leading-none', ink)}>
        {copy.glyph}
      </span>

      {/* A measure of its own, so the paragraph is never sized by whichever
          button happens to sit beside it. */}
      <div className="min-w-0 flex-1 lg:min-w-96 lg:max-w-[30rem]">
        <p className={cn('text-sm font-semibold', ink)}>{copy.heading}</p>
        <p className="mt-0.5 text-sm text-ink-300">{copy.body}</p>
        {copy.aside ? <p className="mt-1 text-xs text-ink-500">{copy.aside}</p> : null}
      </div>

      <div className="flex flex-col gap-4 lg:gap-2 lg:max-w-80 lg:shrink-0">
        {/* The primary and its consequence are one object, so no future change
            to the column's spacing can drift them apart. */}
        <div className="flex w-full flex-col gap-1 lg:w-auto">
          {edit.state === 'queued' ? (
            <Button variant="secondary" className="w-full lg:w-auto" onClick={onCancel}>
              Cancel this edit
            </Button>
          ) : null}
          {/*
            An unreachable backend and a rejected value need different buttons,
            because the work in front of the leader is different. "Fix" opens
            the editor with the refused values still in it, which is right when
            the backend read them and said no. When it never answered, there is
            nothing in the form to fix — the edit is exactly as good as it was
            — and a button that opens an editor makes a leader hunt for a
            mistake they did not make. That one sends the same patch again.
          */}
          {edit.state === 'failed' ? (
            edit.failure === 'exhausted' ? (
              <Button variant={loud ? 'primary' : 'secondary'} className="w-full lg:w-auto" onClick={onRetry}>
                Send it again
              </Button>
            ) : (
              <Button variant={loud ? 'primary' : 'secondary'} className="w-full lg:w-auto" onClick={onFix}>
                Fix and send again
              </Button>
            )
          ) : null}
          {edit.state === 'orphaned' ? (
            <>
              <Button variant="primary" className="w-full lg:w-auto" onClick={onRecreate}>
                Re-create them in {backend}
              </Button>
              <span className="text-xs text-ink-500">{ONE_NEW_PERSON}</span>
            </>
          ) : null}
          {edit.state === 'merged' && edit.survivorPersonId ? (
            <>
              <Button
                variant="secondary"
                className="w-full lg:w-auto"
                onClick={() => window.open(pcoPersonUrl(edit.survivorPersonId!), '_blank')}
              >
                Open {edit.survivorName ?? 'the survivor'}
              </Button>
              <span className="text-xs text-ink-500">Opens them in {backend}.</span>
            </>
          ) : null}
          {/*
           * Two matched secondaries, never a primary and a link. When neither
           * value is knowably right, neither should be the default — one of
           * these writes over a change a named human made on purpose.
           */}
          {edit.state === 'differs' ? (
            <>
              <Button variant="secondary" className="w-full lg:w-auto" onClick={onDismiss}>
                Keep theirs
              </Button>
              <Button variant="secondary" className="mt-3 w-full lg:mt-2 lg:w-auto" onClick={onRetry}>
                Send mine again
              </Button>
            </>
          ) : null}
        </div>

        {edit.state === 'failed' || edit.state === 'merged' || edit.state === 'orphaned' ? (
          <button
            type="button"
            onClick={onDismiss}
            className="min-h-11 text-sm font-semibold text-ink-400 underline underline-offset-4 lg:min-h-0"
          >
            {edit.state === 'failed' ? 'Discard the edit' : 'Got it'}
          </button>
        ) : null}
      </div>

      {cells ? (
        <dl className="grid w-full grid-cols-2 gap-2 lg:order-last">
          {cells.map((cell) => (
            <div
              key={cell.label}
              className={cn(
                'rounded-xl bg-ink-900/60 px-3 py-2 ring-1',
                cell.live ? 'ring-danger-500/30' : 'ring-ink-800',
              )}
            >
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                {cell.label}
              </dt>
              <dd className="mt-0.5 truncate text-base font-semibold text-ink-100">{cell.value}</dd>
              <dd className="mt-0.5 truncate text-xs tabular-nums text-ink-400">{cell.meta}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

/** The one field a two-up is about, rendered as a value rather than as prose. */
function describeValue(patch: UpstreamEditPatch): string {
  for (const [, value] of Object.entries(patch) as [string, unknown][]) {
    if (value === null) return 'nothing';
    if (typeof value === 'string' && value.length > 0) return value;
    if (typeof value === 'number') return String(value);
  }
  return '—';
}
