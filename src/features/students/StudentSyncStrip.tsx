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
import { useSyncStripStrings } from '@/hooks/usePureStrings';

/** The short guard, shared so the two frames that show it cannot drift apart. */
/** The key for the promise the re-create button makes. */
export const ONE_NEW_PERSON = 'oneNewPerson';

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
  const syncStrings = useSyncStripStrings();
  const backend = backendLabelOf(student);
  const mine = edit.createdBy === uid;
  const copy = syncStripCopy(syncStrings, {
    edit,
    now,
    backend,
    mine,
    authorFirstName: edit.createdByName.split(/\s+/)[0] ?? syncStrings.t('somebody'),
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
            label: syncStrings.t('nowPointsAt'),
            value: edit.survivorName ?? syncStrings.t('theSurvivingRecord'),
            meta: edit.survivorPersonId
              ? syncStrings.t('survivorMeta', { id: edit.survivorPersonId })
              : syncStrings.t('theSurvivor'),
            live: true,
          },
          {
            label: syncStrings.t('youEdited'),
            value: `${student.firstName} ${student.lastName}`.trim(),
            /*
             * The id the edit named, beside the one it landed on. Both, because
             * after a merge the two names can be identical — that is the case
             * this state exists for — and the ids are then the only thing that
             * says a person moved.
             */
            meta: [
              personIdFromStudentId(student.id) ? `#${personIdFromStudentId(student.id)}` : null,
              syncStrings.t('mergedAt', { when: formatRelative(edit.settledAt ?? edit.updatedAt) }),
            ]
              .filter(Boolean)
              .join(' · '),
          },
        ]
      : edit.state === 'differs' && edit.observed
        ? [
            {
              label: syncStrings.t('onTheRecordNow'),
              value: describeValue(edit.observed),
              meta: syncStrings.t('inBackend', { backend }),
              live: true,
            },
            {
              label: syncStrings.t('youTyped'),
              value: describeValue(edit.patch),
              meta: mine ? syncStrings.t('you') : edit.createdByName,
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
              {syncStrings.t('cancelThisEdit')}
            </Button>
          ) : null}
          {/*
            Only a validation refusal is about what somebody typed.
            
            "Fix and send again" opens the editor with the refused values still
            in it, and that is the right move for exactly one class: the
            backend read the values and objected to them. For every other
            failure the patch is fine and the world was not — a backend that
            never answered, a rotated credential, write-back switched off — so
            the move is to send the same thing again once the world is fixed,
            and an editor is a wrong turn that makes a leader hunt for a
            mistake they did not make.

            This was the wrong way round for two of the three. A rotated
            credential printed "an admin has to reconnect it" directly beside a
            button offering to open the form, in the same strip, and a
            walkthrough photographed the pair before anybody noticed.
          */}
          {edit.state === 'failed' ? (
            edit.failure === 'validation' ? (
              <Button variant={loud ? 'primary' : 'secondary'} className="w-full lg:w-auto" onClick={onFix}>
                {syncStrings.t('fixAndSendAgain')}
              </Button>
            ) : (
              <Button variant={loud ? 'primary' : 'secondary'} className="w-full lg:w-auto" onClick={onRetry}>
                {syncStrings.t('sendItAgain')}
              </Button>
            )
          ) : null}
          {edit.state === 'orphaned' ? (
            <>
              <Button variant="primary" className="w-full lg:w-auto" onClick={onRecreate}>
                Re-create them in {backend}
              </Button>
              <span className="text-xs text-ink-500">{syncStrings.t(ONE_NEW_PERSON)}</span>
            </>
          ) : null}
          {edit.state === 'merged' && edit.survivorPersonId ? (
            <>
              <Button
                variant="secondary"
                className="w-full lg:w-auto"
                onClick={() => window.open(pcoPersonUrl(edit.survivorPersonId!), '_blank')}
              >
                {syncStrings.t('openSurvivor', {
                  name: edit.survivorName ?? syncStrings.t('theSurvivor'),
                })}
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
                {syncStrings.t('keepTheirs')}
              </Button>
              <Button variant="secondary" className="mt-3 w-full lg:mt-2 lg:w-auto" onClick={onRetry}>
                {syncStrings.t('sendMineAgain')}
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
            {edit.state === 'failed' ? syncStrings.t('discardTheEdit') : syncStrings.t('gotIt')}
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
