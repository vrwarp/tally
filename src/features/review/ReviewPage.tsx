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
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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
import { cn, gradeSentence, initials } from '@/lib/utils';
import {
  approveRegistration,
  discardRegistration,
  listPendingRegistrations,
  mergeStudents,
  type PendingRegistration,
  type PendingRegistrationChild,
  type ReviewStudentSummary,
} from '@/services/functions';

const DAY_MS = 24 * 60 * 60_000;
/** Under a week left before the sweep takes the record. */
const EXPIRING_SOON_MS = 7 * DAY_MS;

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

  /**
   * The order of the queue is the triage.
   *
   * The callable answers newest-first, which is the right default and the
   * wrong first screen: the one card where *doing nothing* is itself
   * irreversible — a record days from the sweep that deletes the only phone
   * number Tally holds for that family — was arriving last, under four
   * families that can wait a fortnight. On a phone, where one card fills the
   * screen, that is the difference between the deadline being seen and not.
   *
   * Only the expiring class is hoisted. Everything else keeps the recency the
   * server sorted by, so nothing about the rest of the queue moves.
   */
  const queue = useMemo(() => {
    const expiring = (row: PendingRegistration) =>
      row.expiresInMs !== null && row.expiresInMs < EXPIRING_SOON_MS;
    return [...(rows ?? [])].sort(
      (a, b) =>
        Number(expiring(b)) - Number(expiring(a)) ||
        // Soonest to go first within the class, so the deadline itself orders
        // the cards that have one.
        (expiring(a) ? (a.expiresInMs ?? 0) - (b.expiresInMs ?? 0) : 0) ||
        (b.registeredAt ?? 0) - (a.registeredAt ?? 0),
    );
  }, [rows]);

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
        <h1 className="flex items-center gap-2 text-xl font-bold text-ink-50">
          Families to review
          {/* The size of the job, before the first scroll. A reviewer with three
              minutes needs to know whether this is a two-minute Tuesday. */}
          {rows !== null && rows.length > 0 ? <Badge tone="neutral">{rows.length}</Badge> : null}
        </h1>
        <p className="mt-0.5 max-w-2xl text-sm text-ink-500">
          Registered at the kiosk by the family themselves. They are on the roster and were
          checked in — nothing has gone into the church&rsquo;s database yet. Soonest to be
          cleared first.
        </p>
      </header>

      {error ? <ErrorBanner message="Could not read the registrations waiting for review." /> : null}

      {rows === null ? (
        <Card>
          <SkeletonRows count={3} />
        </Card>
      ) : error ? (
        /*
          Nothing to say beyond the banner above.

          A failed read used to fall through to "Nothing waiting", which is the
          one sentence on this screen a reviewer acts on by closing the tab —
          and it was rendered *because* the read failed, since the catch empties
          the list. An empty queue and an unreadable one look identical from
          here and mean opposite things.
        */
        null
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing waiting."
            description="When a family puts themselves on the roster at the lobby kiosk, they appear here until somebody approves them."
          />
        </Card>
      ) : (
        <>
          {/*
            Columns rather than a grid, at pointer widths.

            A two-track *grid* aligns its rows to the tallest card in each, so a
            short family reserved the height of the tall one beside it and the
            hardest card in the queue — the one whose push half-failed — was
            pushed alone below the fold with half a screen of empty column next
            to it. Columns pack by height and keep the document order, so the
            deadline-first sort still reads straight down.
          */}
          <div className="flex flex-col gap-4 lg:block lg:columns-2 lg:gap-8">
            {queue.map((row) => (
              <RegistrationCard
                key={row.registrationId}
                row={row}
                gatheringTitle={titleOf(row.eventId)}
                busy={busy === row.registrationId}
                disabled={busy !== null}
                onApprove={(withoutGuardian) =>
                  void act(row.registrationId, async () => {
                    const { data } = await approveRegistration({
                      registrationId: row.registrationId,
                      ...(withoutGuardian ? { withoutGuardian: true } : {}),
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
                onUnmerge={(foldId) =>
                  void act(row.registrationId, async () => {
                    const { data } = await mergeStudents({ foldId, undo: true });
                    return data.message;
                  })
                }
              />
            ))}
          </div>
          {/* The one thing the queue never said: that this is all of it. */}
          <p className="text-center text-sm text-ink-500">
            That is all {rows.length}. Nothing else is waiting to be reviewed.
          </p>
        </>
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
  onApprove: (withoutGuardian?: boolean) => void;
  onDiscard: () => void;
  onMerge: (keeperId: string, foldId: string) => void;
  onUnmerge: (foldId: string) => void;
}

/**
 * A decision, which on this screen means a sentence and then the control.
 *
 * Above rather than below, and that is the whole point: a caption under a
 * full-width button on a phone sits in the patch a right thumb covers while
 * pressing it, and it is the half that falls off the bottom of the screen
 * behind the tab bar. The sentence is the mechanism — every control here
 * either writes somewhere with no undo or forgets a phone number — so the
 * sentence is what must survive.
 */
function Decision({ caption, children }: { caption: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-1.5">
      <p className={CAPTION}>{caption}</p>
      {children}
    </div>
  );
}

/**
 * One step up on a phone, unchanged on a laptop.
 *
 * These lines used to be the same size as the grade under a child's name, so
 * a standing reader got no rank cue between "9th grade" and the sentence
 * saying a push cannot be undone. A seated reader at a 568px column does not
 * need the extra size; a standing one at 390px does.
 */
const CAPTION = 'text-sm text-ink-400 lg:text-xs';

/**
 * The state's consequence, in one voice for every state.
 *
 * Deliberately not tinted. The header badge owns the card's one colour and
 * says *what* the state is; this says what it costs. When both were coloured a
 * card read as one alarm restated twice, and the eye took the pair as a single
 * amber region rather than as a chain.
 */
const STRIP = 'rounded-xl bg-ink-800/50 px-3 py-2 text-sm text-ink-300 ring-1 ring-ink-700';

/** The children a reviewer's decision would still act on. */
function stillHeld(row: PendingRegistration): PendingRegistrationChild[] {
  return row.children.filter((child) => child.pendingReview && !child.mergedIntoStudentId);
}

/** "Ade, Chidi and Ngozi" — names, because a count is not a person. */
function listNames(children: PendingRegistrationChild[]): string {
  const names = children.map((child) => child.firstName).filter(Boolean);
  if (names.length === 0) return 'these children';
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function RegistrationCard({
  row,
  gatheringTitle,
  busy,
  disabled,
  onApprove,
  onDiscard,
  onMerge,
  onUnmerge,
}: RegistrationCardProps) {
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [confirmingApprove, setConfirmingApprove] = useState(false);
  /**
   * What a reviewer has said about each flagged child, this session.
   *
   * A candidate id means "this is that child" and has already been sent; the
   * literal `'new'` means "none of these is them", which is an assertion by a
   * person and not a fact about the world — so it stays local and reversible
   * until they approve, and never round-trips to the server.
   */
  const [resolution, setResolution] = useState<Record<string, string | 'new'>>({});
  const when = row.registeredAt === null ? null : new Date(row.registeredAt);
  const expiringSoon = row.expiresInMs !== null && row.expiresInMs < EXPIRING_SOON_MS;
  // Rounded up, and floored at one: a record with six hours left has "1 day",
  // never "0 days", which reads as already gone.
  const daysLeft = Math.max(1, Math.ceil((row.expiresInMs ?? 0) / DAY_MS));

  const held = stillHeld(row);
  /*
   * The adult is what the backend refused, which is usually refused for a
   * reason no retry can fix. `lastErrorKind` is null on records written before
   * it existed, and those get the ordinary foot rather than a guess.
   */
  const guardianRefused =
    row.lastError !== null && (row.lastErrorKind === 'guardian' || row.lastErrorKind === 'both');
  /*
   * The children whose name collision nobody has decided yet.
   *
   * This is what holds the approve button. The card names the mistake —
   * "somebody with this name is already on the roster" — and used to offer, in
   * the same brand blue as a routine family, the button that makes a second
   * one permanently in a database with no delete. Choosing a candidate settles
   * it and so does saying the child is new; "Not ours" is never held, so
   * nobody is stuck on a card they cannot decide.
   */
  const unsettled = held.filter(
    (child) => child.studentId && candidatesFor(child).length > 0 && !resolution[child.studentId],
  );

  return (
    <Card className={cn('mb-4 lg:mb-8 lg:break-inside-avoid', confirmingApprove && 'ring-warn-500/50')}>
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
        /*
          The state, in two or three words, and the only coloured thing on the
          card. Absence is the signal for the routine family: no badge means
          nothing here needs a judgement, only a yes.
        */
        action={
          confirmingApprove ? (
            <Badge tone="warn">Confirm to add</Badge>
          ) : row.lastError ? (
            <Badge tone="danger">Push failed</Badge>
          ) : expiringSoon ? (
            <Badge tone="warn">
              {daysLeft} {daysLeft === 1 ? 'day' : 'days'} left
            </Badge>
          ) : unsettled.length > 0 ? (
            <Badge tone="warn">Possible duplicate</Badge>
          ) : row.anchors.length > 0 ? (
            <Badge tone="neutral">Joins a family on file</Badge>
          ) : undefined
        }
      />

      {/*
        `pt-4` rather than nothing: without it the header's rule sat one pixel
        above the body's first line and twelve below the header's last, so it
        read as opening the body rather than closing the header — and on the two
        cards that start with a coloured strip, the rule ran into the strip's
        rounded corner and survived as a stub poking out each side.
      */}
      <div className="flex flex-col gap-3 px-4 pt-4 pb-4">
        {/*
          The ageing signal. A record that is about to be swept is the one case
          where doing nothing is itself a decision — the guardian's number goes
          and the children stay held, invisible to the church for ever.

          The day count is the point of it. "About to be cleared" cannot be
          weighed against anything: four days is worth phoning the number
          before it goes, four hours is not, and every other age on this screen
          is stated precisely.
        */}
        {expiringSoon ? (
          <p className={STRIP}>
            When it clears, the phone number goes with it — and the children stay on
            Tally&rsquo;s roster with nobody attached to them.
          </p>
        ) : null}

        {/*
          The collision, stated as the rule rather than as a hypothetical,
          because the button below is held until it is settled.
        */}
        {unsettled.length > 0 ? (
          <p className={STRIP}>
            Nothing here can be added until {listNames(unsettled)}&rsquo;s row is settled below: a
            second {unsettled[0]!.firstName} in the church&rsquo;s database could not be removed.
          </p>
        ) : null}

        {/*
          `danger-400`, not `danger-300`, and that was a real bug rather than a
          preference: the ramp holds 400/500/600 only, so Tailwind emitted no
          rule for `-300` and this strip inherited the card's near-white ink.
          The one notice on the screen that reports an actual failure has been
          rendering as neutral text — quieter than the amber beside it, which
          inverts the severity the tokens exist to express. 400 is the rung
          `warn-400` already sits on, so hue is the only difference now.
        */}
        {row.lastError ? <p className={STRIP}>Last attempt did not finish: {row.lastError}</p> : null}

        {row.guardian ? (
          /*
            The number, and only the number. The guardian's name is the card's
            own title one line above, so a two-row grid was carrying one new
            fact and a label column whose width pushed the values onto a fourth
            left edge that lined up with nothing.
          */
          <p className="flex flex-wrap items-baseline gap-x-3 text-sm">
            <span className="text-ink-500">Phone</span>
            <span className="tabular-nums text-ink-200">{formatPhone(row.guardian.phone)}</span>
          </p>
        ) : row.anchors.length > 0 ? (
          /*
            No guardian, and nothing wrong with that: this is a parent adding a
            child to a family the church already has. Their adult is on file
            upstream already, which is why the wizard did not ask again — and
            saying "this registration did not finish" here, as an earlier
            version did, accuses a working flow of being broken.
          */
          <p className={STRIP}>
            {/* Not "a brother or sister": what the kiosk verified is that these
                children arrived with those roster members, and it inferred the
                family from four phone digits. A reviewer deciding on a Tuesday
                should be told what was established, not what was guessed. */}
            Another child, added alongside somebody the church already has:{' '}
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
              onUnmerge={onUnmerge}
              resolution={child.studentId ? resolution[child.studentId] : undefined}
              onResolve={(choice) => {
                if (!child.studentId) return;
                setResolution((held) => ({ ...held, [child.studentId!]: choice }));
                // A candidate is a real decision about the roster and goes to
                // the server; "new" is a reviewer's assertion and stays here.
                if (choice !== 'new') onMerge(choice, child.studentId);
              }}
            />
          ))}
        </ul>

        {/*
          The foot: two decisions, and the same two slots whether the card is
          resting or armed.

          Arming swaps what is *in* the slots rather than building a different
          object — Cancel takes the slot the approve button was in, which is the
          rectangle a finger or cursor has just left, and the commit takes the
          second slot with its sentence immediately above it. A repeat press on
          an apparently-unresponsive control therefore cancels, which is the
          correct failure for the only action in this app that cannot be undone.
        */}
        <div className="mt-1 flex flex-col gap-5 border-t border-ink-800 pt-4 lg:grid lg:grid-cols-2 lg:gap-6">
          {confirmingApprove ? (
            <>
              <Decision caption="Leaves this family in the queue. Nothing is sent to the church’s database and nothing is lost.">
                <Button
                  variant="secondary"
                  className="mt-auto min-h-12 w-full lg:w-auto"
                  onClick={() => setConfirmingApprove(false)}
                >
                  Cancel
                </Button>
              </Decision>
              <Decision
                caption={
                  <span className="text-warn-400">
                    {listNames(held)} {held.length === 1 ? 'goes' : 'go'} into the church&rsquo;s
                    database now. Nothing added there can be deleted or taken back.
                  </span>
                }
              >
                <Button
                  className="mt-auto min-h-12 w-full lg:w-auto"
                  onClick={() => {
                    setConfirmingApprove(false);
                    onApprove();
                  }}
                  disabled={disabled}
                  aria-busy={busy || undefined}
                >
                  Yes — add {held.length === 1 ? listNames(held) : `${held.length} children`}
                </Button>
              </Decision>
            </>
          ) : (
            <>
              <Decision
                caption={
                  unsettled.length > 0
                    ? `Waiting on ${listNames(unsettled)}’s row. Choose who they already are, or say they are new — then this adds ${listNames(held)} for good.`
                    : guardianRefused
                      ? /*
                          An honest caption on the one card where the blue
                          button is the wrong answer. Every other card's
                          primary is the right move; here it reattempts the
                          refusal that put the card in this state, so it says
                          so — and it stops being the primary, because the
                          instrument that ends the job is below it.
                        */
                        `Tries ${row.guardian?.firstName ?? 'the parent'} again. The last attempt was refused, and nothing about the refusal has changed on its own.`
                      : `Adds ${listNames(held)} to the church’s database. Nothing added there can be taken back.`
                }
              >
                <Button
                  variant={guardianRefused ? 'secondary' : 'primary'}
                  className="mt-auto min-h-12 w-full lg:w-auto"
                  onClick={() => setConfirmingApprove(true)}
                  disabled={disabled || unsettled.length > 0}
                  aria-busy={busy || undefined}
                >
                  {guardianRefused
                    ? `Try ${row.guardian?.firstName ?? 'the parent'} again`
                    : row.settled
                      ? 'Finish adding them'
                      : 'Approve and add'}
                </Button>
              </Decision>

              {confirmingDiscard ? (
                <Decision
                  caption={
                    <span className="text-warn-400">
                      Takes {listNames(held)} off the roster
                      {row.guardian ? ` and forgets ${formatPhone(row.guardian.phone)}` : ''} for
                      good. Their check-in history is kept, and only a new registration at the
                      kiosk brings them back.
                    </span>
                  }
                >
                  <div className="mt-auto flex w-full flex-col gap-2 lg:w-auto lg:flex-row">
                    <Button
                      variant="danger"
                      className="min-h-12 w-full lg:w-auto"
                      onClick={onDiscard}
                      disabled={disabled}
                    >
                      Yes, take them off
                    </Button>
                    <Button
                      variant="ghost"
                      className="min-h-12 w-full lg:w-auto"
                      onClick={() => setConfirmingDiscard(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </Decision>
              ) : (
                <Decision
                  caption={
                    row.guardian
                      ? `Takes ${listNames(held)} off the roster and forgets ${formatPhone(row.guardian.phone)} for good.`
                      : `Takes ${listNames(held)} off the roster. No number was given, so nothing else is lost.`
                  }
                >
                  <Button
                    variant="secondary"
                    className="mt-auto min-h-12 w-full lg:w-auto"
                    onClick={() => setConfirmingDiscard(true)}
                    disabled={disabled}
                  >
                    Not ours
                  </Button>
                </Decision>
              )}
            </>
          )}
        </div>

        {/*
          The instrument a half-failed push actually needs.

          Offered only when the *adult* is what the backend refused: that is
          usually refused for a reason no retry can fix — a number it already
          holds for somebody outside this household — so a reviewer whose only
          other moves are "try again for ever" or "discard a family whose
          children are already upstream" has no way to end the job. A child-side
          failure is left alone, because retrying that one usually works.
        */}
        {/*
          The move that ends the job, in the foot's own grammar rather than
          loose beneath it — its own rule, its own row, one caption bound to
          one control. It carries the primary's weight here because on this
          card it is the answer: the retry above cannot succeed on its own, and
          the two neutral buttons it used to sit between were the two furthest
          apart outcomes in the queue told apart by a word.
        */}
        {guardianRefused && row.guardian ? (
          <div className="flex flex-col gap-5 border-t border-ink-800 pt-4">
            <Decision
              caption={`Adds ${listNames(held)} with no adult attached, and forgets ${formatPhone(row.guardian.phone)}. Somebody has to join them to a household in the church’s database afterwards.`}
            >
              <Button
                className="min-h-12 w-full lg:w-auto"
                onClick={() => onApprove(true)}
                disabled={disabled}
              >
                Add the children without {row.guardian.firstName}
              </Button>
            </Decision>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* One child, and who they might already be                                    */
/* -------------------------------------------------------------------------- */

/**
 * The roster rows a child might already be, and the choice between them.
 *
 * Always open, never behind a link. The control that prevents a permanent
 * duplicate used to be twelve pixels of amber text with no chrome, sitting a
 * thumb's width above the button that makes one — and the facts that settle
 * the question were behind pressing it. They are the comparison; they belong
 * in front of the person making it.
 */
function ChildRow({
  child,
  disabled,
  resolution,
  onResolve,
  onUnmerge,
}: {
  child: PendingRegistrationChild;
  disabled: boolean;
  /** A candidate id, `'new'`, or nothing decided yet. */
  resolution: string | 'new' | undefined;
  onResolve: (choice: string | 'new') => void;
  onUnmerge: (foldId: string) => void;
}) {
  const candidates = candidatesFor(child);

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
          </span>
          {/*
            The allergy on its own line, a rung up the ramp. Joined to the grade
            by a middle dot it rendered exactly like "4th grade" — a fact of an
            entirely different kind in the card's quietest voice.
          */}
          {child.allergies ? (
            <span className="mt-0.5 block text-xs text-ink-300">{child.allergies}</span>
          ) : null}
        </span>
        {/*
          A plain label, not a pill: the filled ringed chip belongs to the card
          header, where it says what the whole family's state is. Two objects of
          identical form at two scopes made position the only thing carrying the
          difference.
        */}
        {child.mergedIntoStudentId ? null : child.pendingReview ? null : (
          <span className="shrink-0 text-xs text-ink-400">Added</span>
        )}
      </div>

      {/*
        A merge is the one decision on this screen that can be taken back, and
        the picker above says so in as many words — "merging can be undone, a
        duplicate in the church's database cannot" — while the result of one was
        a dead grey word that named nobody. A reviewer inheriting this queue on
        Tuesday could not see who the child had been folded into, could not
        correct it, and then approved, which bakes the association into a push
        that has no delete. Both halves are cheap: the keeper is already in the
        payload, and the callable already takes `undo`.
      */}
      {child.mergedIntoStudentId && child.studentId ? (
        <div className="mt-2 ml-12 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className={CAPTION}>
            Merged into{' '}
            <span className="text-ink-300">
              {keeperLabel(child) ?? 'a row on the roster'}
            </span>
            . Their check-ins are kept together.
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onUnmerge(child.studentId!)}
            className="text-sm text-brand-400 underline-offset-2 hover:underline disabled:opacity-60 lg:text-xs"
          >
            Undo
          </button>
        </div>
      ) : null}

      {candidates.length > 0 && child.studentId ? (
        /*
          `ml-12` is the avatar plus the gap after it — where this child's own
          name starts. The candidates are being compared *to that name*, so they
          hang under it rather than 12px to its left.
        */
        <div className="mt-3 ml-12 border-t border-ink-800 pt-3">
          <p className="text-sm font-semibold text-ink-200 lg:text-xs">
            {candidates.length === 1
              ? 'One student on the roster shares this name.'
              : `${candidates.length} students on the roster share this name.`}
          </p>
          <p className={cn('mt-0.5', CAPTION)}>
            Merging can be undone. A duplicate in the church&rsquo;s database cannot.
          </p>

          <ul
            /*
              `gap-3` rather than `gap-1.5`: these are adjacent targets with
              different consequences, and on a phone the boundary between two
              candidates is the boundary between folding a child into one row
              and folding them into another. Six pixels was the tightest gap on
              a page whose two primary decisions sit sixty-six apart.
            */
            className={cn(
              'mt-2 flex flex-col gap-3',
              candidates.length > 1 && 'lg:grid lg:grid-cols-2 lg:gap-x-6',
            )}
          >
            {candidates.map((candidate) => (
              <li key={candidate.studentId}>
                <CandidateButton
                  candidate={candidate}
                  child={child}
                  chosen={resolution === candidate.studentId}
                  disabled={disabled}
                  onChoose={() => onResolve(candidate.studentId)}
                />
              </li>
            ))}
          </ul>

          {/*
            Outside the list, because it is not a candidate — it was pixel-
            identical to one, in a set the reader is meant to compare. And it is
            a real answer now rather than a way to close a panel: saying the
            child is new is what releases the card's approve button.
          */}
          <button
            type="button"
            disabled={disabled}
            aria-pressed={resolution === 'new'}
            onClick={() => onResolve('new')}
            /*
              Further from the candidates than they are from each other, and
              narrower than the group: it is a different kind of answer, not a
              third candidate, and it was reading as the recommended one by
              being the widest object in the block while carrying the dimmest
              label.
            */
            className={cn(
              'mt-4 flex min-h-12 items-center rounded-lg px-3 py-2 text-left text-sm ring-1 transition-colors disabled:opacity-60 pointer-fine:min-h-9',
              resolution === 'new'
                ? 'bg-brand-500/15 text-brand-300 ring-brand-500/40'
                : 'text-ink-400 ring-ink-800 hover:bg-ink-900 active:bg-ink-900',
            )}
          >
            {resolution === 'new' ? '✓ ' : ''}
            None of them — {child.firstName} is new
          </button>
        </div>
      ) : null}
    </li>
  );
}

/**
 * One roster row a child might be, with the evidence for and against.
 *
 * Two independent discriminators, because a name and a grade often are not
 * enough: two children can share both, and a grade rolls over between terms.
 * The digits line is the strongest — if the church already finds that row
 * under the number this family typed, they are almost certainly one household
 * — and the weighted grade is the second. Neither sorts, recommends or
 * pre-selects: the negative is stated as plainly as the positive, so
 * "different on both" is a visible answer rather than a blank.
 */
function CandidateButton({
  candidate,
  child,
  chosen,
  disabled,
  onChoose,
}: {
  candidate: ReviewStudentSummary;
  child: PendingRegistrationChild;
  chosen: boolean;
  disabled: boolean;
  onChoose: () => void;
}) {
  const sameGrade = candidate.grade !== null && candidate.grade === child.grade;
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={chosen}
      onClick={onChoose}
      className={cn(
        'flex min-h-12 w-full flex-col justify-center rounded-lg px-3 py-2 text-left ring-1 transition-colors disabled:opacity-60 pointer-fine:min-h-9',
        /*
          Raised, not recessed. These wore the card's own background with the
          same ring the read-only consequence strip wears, so a paragraph, a
          candidate and a button were one material and pressability was
          invisible. `ink-800` is a step *up* from the row they sit in.
        */
        chosen
          ? 'bg-brand-500/15 text-brand-300 ring-brand-500/40'
          : 'bg-ink-800 text-ink-100 ring-ink-600 hover:bg-ink-700 active:bg-ink-700',
      )}
    >
      <span className="truncate text-sm">
        {chosen ? '✓ ' : ''}
        {candidate.known ? nameOf(candidate) : 'A student on the roster'}
        {' · '}
        <span className={sameGrade ? 'font-semibold text-ink-100' : 'text-ink-400'}>
          {gradeSentence(candidate) ?? 'no grade on file'}
        </span>
      </span>
      <span className={cn('mt-0.5', candidate.sharesFamilyDigits ? 'text-ink-300' : 'text-ink-500', 'text-sm lg:text-xs')}>
        {candidate.sharesFamilyDigits
          ? 'Same phone digits on file.'
          : 'Different phone digits on file.'}
      </span>
    </button>
  );
}

/** Who a merged child was folded into, when the payload can say. */
function keeperLabel(child: PendingRegistrationChild): string | null {
  const keeper = child.possibleDuplicates.find(
    (candidate) => candidate.studentId === child.mergedIntoStudentId,
  );
  if (!keeper) return null;
  return keeper.known ? `${nameOf(keeper)}${gradeSentence(keeper) ? ` · ${gradeSentence(keeper)}` : ''}` : null;
}

/**
 * The rows still worth offering as a duplicate of this child.
 *
 * Inactive rows are gone by the time a reviewer looks, a child cannot be a
 * duplicate of themselves, and a child already merged has nothing left to
 * decide — offering the picker again would invite folding them a second time.
 */
function candidatesFor(child: PendingRegistrationChild): ReviewStudentSummary[] {
  if (child.mergedIntoStudentId) return [];
  return child.possibleDuplicates.filter(
    (candidate) => candidate.status === 'active' && candidate.studentId !== child.studentId,
  );
}
