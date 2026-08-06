/**
 * The other end of the lobby kiosk.
 *
 * A family who registered themselves at the door is on Tally's roster and was
 * checked in — but held, so nothing about them has reached Planning Center or
 * Attendees (`functions/src/backends/pendingReview.ts`). This is the screen
 * that decides. It is deliberately the *only* place three judgements are made,
 * all of which the door used to attempt with a queue behind it:
 *
 *   - is this child already on the roster under another row;
 *   - is this adult somebody the church already has;
 *   - and should any of it go into a system with no undo.
 *
 * What a reviewer needs to answer those is the form as the family typed it,
 * next to the roster rows that share a name — so that is what a row shows,
 * rather than a link to go and find out. The phone number is here because this
 * is the one screen in Tally that holds one: it lives on the registration
 * document, functions-only, with a TTL, and is deleted the moment a decision is
 * made. See docs/data-model.md.
 *
 * Three actions, and the two destructive ones say what they will do before they
 * do it. **Approve** pushes every child and then builds one household for the
 * family. **Merge** folds a child into the roster row they duplicate. **Not
 * ours** takes the whole registration off the roster and forgets the number.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageFrame } from '@/components/PageFrame';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorBanner,
  SkeletonRows,
} from '@/components/ui';
import { useData } from '@/context/dataContext';
import { useToast } from '@/context/toastContext';
import { formatRelative } from '@/lib/time';
import { gradeSentence, initials } from '@/lib/utils';
import {
  approveRegistration,
  discardRegistration,
  listPendingRegistrations,
  mergeStudents,
  type PendingRegistration,
  type PendingRegistrationChild,
  type ReviewStudentSummary,
} from '@/services/functions';

/** Under a week left before the sweep takes the record. */
const EXPIRING_SOON_MS = 7 * 24 * 60 * 60_000;

function formatPhone(digits: string): string {
  const clean = digits.replace(/\D/g, '');
  if (clean.length !== 10) return digits;
  return `(${clean.slice(0, 3)}) ${clean.slice(3, 6)}-${clean.slice(6)}`;
}

function nameOf(child: { firstName: string; lastName: string }): string {
  return `${child.firstName} ${child.lastName}`.trim();
}

/** A roster row a duplicate might be. Named enough to tell two children apart. */
function summaryLabel(summary: ReviewStudentSummary): string {
  if (!summary.known) return 'A student on the roster';
  const grade = gradeSentence(summary) ?? 'no grade on file';
  return `${nameOf(summary)} · ${grade}`;
}

export function ReviewPage() {
  const { show } = useToast();
  const { events } = useData();

  const [rows, setRows] = useState<PendingRegistration[] | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(false);
    try {
      const { data } = await listPendingRegistrations();
      setRows(data);
    } catch {
      setError(true);
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const titleOf = useMemo(() => {
    const byId = new Map(events.map((event) => [event.id, event.title]));
    return (eventId: string | null) => (eventId ? (byId.get(eventId) ?? null) : null);
  }, [events]);

  const act = async (registrationId: string, run: () => Promise<string>) => {
    if (busy) return;
    setBusy(registrationId);
    try {
      show(await run(), { tone: 'success' });
      await load();
    } catch {
      show('Could not reach the server. Try again in a moment.', { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <PageFrame width="lg">
      <header>
        <h1 className="text-xl font-bold text-ink-50">Families to review</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          Registered at the kiosk by the family themselves. They are on the roster and were
          checked in — nothing has gone into the church&rsquo;s database yet.
        </p>
      </header>

      {error ? <ErrorBanner message="Could not read the registrations waiting for review." /> : null}

      {rows === null ? (
        <Card>
          <SkeletonRows count={3} />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing waiting."
            description="When a family puts themselves on the roster at the lobby kiosk, they appear here until somebody approves them."
          />
        </Card>
      ) : (
        rows.map((row) => (
          <RegistrationCard
            key={row.registrationId}
            row={row}
            gatheringTitle={titleOf(row.eventId)}
            busy={busy === row.registrationId}
            disabled={busy !== null}
            onApprove={() =>
              void act(row.registrationId, async () => {
                const { data } = await approveRegistration({
                  registrationId: row.registrationId,
                });
                return data.message;
              })
            }
            onDiscard={() =>
              void act(row.registrationId, async () => {
                const { data } = await discardRegistration({
                  registrationId: row.registrationId,
                });
                return data.message;
              })
            }
            onMerge={(keeperId, foldId) =>
              void act(row.registrationId, async () => {
                const { data } = await mergeStudents({ keeperId, foldId });
                return data.message;
              })
            }
          />
        ))
      )}
    </PageFrame>
  );
}

/* -------------------------------------------------------------------------- */
/* One family                                                                  */
/* -------------------------------------------------------------------------- */

interface RegistrationCardProps {
  row: PendingRegistration;
  gatheringTitle: string | null;
  busy: boolean;
  disabled: boolean;
  onApprove: () => void;
  onDiscard: () => void;
  onMerge: (keeperId: string, foldId: string) => void;
}

function RegistrationCard({
  row,
  gatheringTitle,
  busy,
  disabled,
  onApprove,
  onDiscard,
  onMerge,
}: RegistrationCardProps) {
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const when = row.registeredAt === null ? null : new Date(row.registeredAt);
  const expiringSoon = row.expiresInMs !== null && row.expiresInMs < EXPIRING_SOON_MS;

  return (
    <Card>
      <CardHeader
        title={
          row.guardian
            ? nameOf(row.guardian)
            : row.anchors.length > 0
              ? `${row.anchors[0]!.lastName || 'A'} family`.trim()
              : 'A family'
        }
        description={[
          when ? `Registered ${formatRelative(when)}` : null,
          gatheringTitle ? `at ${gatheringTitle}` : null,
          row.source === 'qr' ? 'from their own phone' : null,
        ]
          .filter(Boolean)
          .join(' ')}
        count={row.children.length}
      />

      <div className="flex flex-col gap-3 px-4 pb-4">
        {/*
          The ageing signal. A record that is about to be swept is the one case
          where doing nothing is itself a decision — the guardian's number goes
          and the children stay held, invisible to the church for ever.
        */}
        {expiringSoon ? (
          <p className="rounded-lg bg-warn-500/10 px-3 py-2 text-xs text-warn-400 ring-1 ring-warn-500/30">
            This registration is about to be cleared. After that the children stay on Tally&rsquo;s
            roster but nobody will know who brought them.
          </p>
        ) : null}

        {row.lastError ? (
          <p className="rounded-lg bg-danger-500/10 px-3 py-2 text-xs text-danger-300 ring-1 ring-danger-500/30">
            Last attempt did not finish: {row.lastError}
          </p>
        ) : null}

        {row.guardian ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-ink-500">Brought by</dt>
            <dd className="text-ink-200">{nameOf(row.guardian)}</dd>
            <dt className="text-ink-500">Phone</dt>
            <dd className="tabular-nums text-ink-200">{formatPhone(row.guardian.phone)}</dd>
          </dl>
        ) : row.anchors.length > 0 ? (
          /*
            No guardian, and nothing wrong with that: this is a parent adding a
            sibling to a family the church already has. Their adult is on file
            upstream already, which is why the wizard did not ask again — and
            saying "this registration did not finish" here, as an earlier
            version did, accuses a working flow of being broken.
          */
          <p className="text-sm text-ink-400">
            A brother or sister added to a family the church already has:{' '}
            {row.anchors.map((anchor) => summaryLabel(anchor)).join(', ')}. Approving joins that
            household rather than making a second one, and asks for no new adult.
          </p>
        ) : (
          <p className="text-sm text-ink-500">
            Nobody was recorded as bringing them, and no family was named — this registration did
            not finish.
          </p>
        )}

        <ul className="flex flex-col gap-2">
          {row.children.map((child, index) => (
            <ChildRow
              key={child.studentId ?? `${child.firstName}:${index}`}
              child={child}
              disabled={disabled}
              onMerge={onMerge}
            />
          ))}
        </ul>

        <div className="flex flex-wrap gap-2">
          <Button onClick={onApprove} disabled={disabled} aria-busy={busy || undefined}>
            {row.settled ? 'Finish adding them' : 'Approve and add'}
          </Button>
          {confirmingDiscard ? (
            <>
              <Button variant="danger" onClick={onDiscard} disabled={disabled}>
                Yes, take them off
              </Button>
              <Button variant="ghost" onClick={() => setConfirmingDiscard(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button
              variant="secondary"
              onClick={() => setConfirmingDiscard(true)}
              disabled={disabled}
            >
              Not ours
            </Button>
          )}
        </div>
        {confirmingDiscard ? (
          <p className="text-xs text-ink-500">
            Takes {row.children.length === 1 ? 'this child' : 'these children'} off the roster and
            forgets the phone number. Their check-in history is kept.
          </p>
        ) : null}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* One child, and who they might already be                                    */
/* -------------------------------------------------------------------------- */

function ChildRow({
  child,
  disabled,
  onMerge,
}: {
  child: PendingRegistrationChild;
  disabled: boolean;
  onMerge: (keeperId: string, foldId: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  // Nothing left to decide once a reviewer has decided: a merged child is the
  // row it was folded into, and offering the picker again would invite folding
  // it a second time.
  const candidates = child.mergedIntoStudentId
    ? []
    : child.possibleDuplicates.filter(
        (candidate) => candidate.status === 'active' && candidate.studentId !== child.studentId,
      );

  return (
    <li className="rounded-xl bg-ink-950 px-3 py-2.5 ring-1 ring-ink-800">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink-800 text-xs font-bold text-ink-300"
        >
          {initials(child.firstName, child.lastName)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink-100">
            {child.studentId ? (
              <Link to={`/students/${child.studentId}`} className="hover:underline">
                {nameOf(child)}
              </Link>
            ) : (
              nameOf(child)
            )}
          </span>
          <span className="block truncate text-xs text-ink-500">
            {gradeSentence(child) ?? 'No grade given'}
            {child.allergies ? ` · ${child.allergies}` : ''}
          </span>
        </span>
        {child.mergedIntoStudentId ? (
          <Badge tone="neutral">Merged</Badge>
        ) : child.pendingReview ? null : (
          <Badge tone="success">Added</Badge>
        )}
      </div>

      {/*
        The suspicion, stated as one. The door recorded that this name already
        exists and did nothing about it, deliberately — a name is not an
        identity, and the grade beside it is what tells two Jacob Smiths apart.
      */}
      {candidates.length > 0 && child.studentId ? (
        <div className="mt-2 border-t border-ink-800 pt-2">
          {picking ? (
            <>
              <p className="text-xs font-semibold text-ink-200">
                Which of these is the same child? Their check-ins will be kept together.
              </p>
              <ul className="mt-1.5 flex flex-col gap-1">
                {candidates.map((candidate) => (
                  <li key={candidate.studentId}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        setPicking(false);
                        onMerge(candidate.studentId, child.studentId!);
                      }}
                      className="flex min-h-11 w-full items-center rounded-lg bg-ink-900 px-3 py-2 text-left text-sm text-ink-200 ring-1 ring-ink-800 transition-colors active:bg-ink-800 disabled:opacity-60"
                    >
                      {summaryLabel(candidate)}
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => setPicking(false)}
                className="mt-1.5 text-xs text-ink-500 hover:text-ink-300"
              >
                None of them — {child.firstName} is new
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setPicking(true)}
              disabled={disabled}
              className="text-xs text-warn-400 hover:underline disabled:opacity-60"
            >
              {candidates.length === 1
                ? 'Somebody with this name is already on the roster'
                : `${candidates.length} students with this name are already on the roster`}
            </button>
          )}
        </div>
      ) : null}
    </li>
  );
}
