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
 *
 * And a fourth thing that is deliberately not one of them. All three above
 * decide *identity*; none of them says **the details are wrong**, which is the
 * commonest thing about a form a stranger typed on a lobby touchscreen with a
 * queue behind them. A card reading "Micheal Okonkwo" used to leave a reviewer
 * choosing between a misspelling made permanent in a database with no delete
 * and discarding a real family along with the only phone number Tally holds for
 * them. **Correct** is the proportionate answer: one person at a time, in
 * place, with the rest of the card held while it is open — see
 * `functions/src/kiosk/amend.ts` for why it is a callable rather than a field
 * write, and docs/review-corrections.md for the journeys it serves.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PageFrame } from '@/components/PageFrame';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorBanner,
  PhoneField,
  SelectField,
  SkeletonRows,
  TextAreaField,
  TextField,
} from '@/components/ui';
import { useData } from '@/context/dataContext';
import { useToast } from '@/context/toastContext';
import { checkAllergyNote, checkName, checkPhone } from '@/lib/registrationFields';
import { formatRelative } from '@/lib/time';
import { cn, formatPhoneInput, gradeDescription, gradeSentence, initials } from '@/lib/utils';
import {
  amendRegistration,
  approveRegistration,
  discardRegistration,
  listPendingRegistrations,
  mergeStudents,
  type AmendRegistrationResult,
  type PendingRegistration,
  type PendingRegistrationChild,
  type ReviewStudentSummary,
} from '@/services/functions';
import { GRADES } from '@/types';

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

  /**
   * A correction, which is deliberately not one of the three decisions.
   *
   * It does not go through `act` and it does not take the card's busy lock,
   * because everything `act` guards against is a press that reaches the
   * church's database and this one cannot: it renames a row Tally owns and
   * re-asks a question Tally asked itself. What it *does* do is reload the
   * queue, because a corrected name is a fresh duplicate scan and a corrected
   * number regroups the whole screen — the card a reviewer is looking at is
   * genuinely a different card afterwards.
   *
   * A refusal is handed back rather than shown here. The callable answers in
   * the door's own words — "The child's first name cannot contain numbers." —
   * and that sentence belongs under the box that caused it, not in a toast at
   * the edge of the screen with the form still holding the value it refused.
   */
  const amend = useCallback(
    async (
      registrationId: string,
      payload: Omit<Parameters<typeof amendRegistration>[0], 'registrationId'>,
    ): Promise<AmendRegistrationResult> => {
      try {
        const { data } = await amendRegistration({ registrationId, ...payload });
        if (data.status === 'amended') {
          show(data.message, { tone: 'success' });
          await load();
        }
        return data;
      } catch (error) {
        return {
          status: 'refused',
          possibleDuplicates: null,
          last4Changed: false,
          message: refusalOf(error),
        };
      }
    },
    [load, show],
  );

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
          Two doors, one queue: families who put themselves on the roster at the lobby kiosk, and
          parent contacts a counselor was given beside a visitor they quick-added. Everybody named
          here is on the roster and was checked in — no adult has gone into the church&rsquo;s
          database yet. Soonest to be cleared first.
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
            description="A family who registers at the lobby kiosk, or a parent’s details a counselor takes at a door, waits here until somebody approves them."
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
                onApprove={(decision) =>
                  void act(row.registrationId, async () => {
                    const { data } = await approveRegistration({
                      registrationId: row.registrationId,
                      /*
                        Each of these is sent only when a person said it. An
                        absent field means "nobody was asked", which the backend
                        answers with its own careful guess — so an omission can
                        never read as a decision nobody made.
                      */
                      ...(decision?.withoutGuardian ? { withoutGuardian: true } : {}),
                      ...(decision?.withRegistrationIds?.length
                        ? { withRegistrationIds: decision.withRegistrationIds }
                        : {}),
                      ...(decision?.guardianPersonId
                        ? { guardianPersonId: decision.guardianPersonId }
                        : {}),
                      ...(decision?.createNewGuardian ? { createNewGuardian: true } : {}),
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
                onAmend={(payload) => amend(row.registrationId, payload)}
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

/** What a reviewer settled on this card before pressing the button. */
export interface ApproveDecision {
  /** Finish without the adult — the escape hatch for a refusal no retry fixes. */
  withoutGuardian?: boolean;
  /** Other cards that are the same family, approved with this one. */
  withRegistrationIds?: string[];
  /** The adult they picked out of the candidates. */
  guardianPersonId?: string;
  /** They saw the candidates and said none of them is the parent. */
  createNewGuardian?: boolean;
}

interface RegistrationCardProps {
  row: PendingRegistration;
  gatheringTitle: string | null;
  busy: boolean;
  disabled: boolean;
  onApprove: (decision?: ApproveDecision) => void;
  onDiscard: () => void;
  onMerge: (keeperId: string, foldId: string) => void;
  onUnmerge: (foldId: string) => void;
  /** One person corrected, answered with what the server made of it. */
  onAmend: (
    payload: Omit<Parameters<typeof amendRegistration>[0], 'registrationId'>,
  ) => Promise<AmendRegistrationResult>;
}

/**
 * The sentence a refused correction gets to show.
 *
 * A callable's `invalid-argument` carries the door's own wording, which is the
 * whole point of the form and the server sharing `lib/registrationFields.ts`.
 * Anything else — a network failure, an `internal` — has no sentence worth
 * repeating, and a reviewer reading "internal" under a name box learns nothing
 * except that the app is talking to itself.
 */
function refusalOf(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : '';
  return message.length > 0 && message !== 'internal' && !message.startsWith('INTERNAL')
    ? message
    : 'Could not save that correction. Try again in a moment.';
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

/* -------------------------------------------------------------------------- */
/* Correcting what the family typed                                            */
/* -------------------------------------------------------------------------- */

/**
 * The way into an editor, in the same material as Undo.
 *
 * Deliberately not a Button. Everything drawn as one on this card either writes
 * to the church's database or refuses to; this opens a form, and giving it the
 * same weight as "Approve and add" would put the least consequential control on
 * the screen in the most consequential clothes. It is still a 44px target,
 * because a reviewer holding a phone has to be able to hit it.
 *
 * `label` is the accessible name — "Correct Robin Fields's details" — because
 * six identical "Correct"s down a card is a screen reader's list of nothing.
 */
function CorrectButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      onClick={onClick}
      className="flex min-h-11 shrink-0 items-center rounded-lg px-3 text-sm text-brand-400 ring-1 ring-ink-800 transition-colors hover:bg-ink-900 disabled:opacity-60 pointer-fine:min-h-8"
    >
      Correct
    </button>
  );
}

/** One child as the editor holds them — every field, never a patch. */
export interface ChildFields {
  firstName: string;
  lastName: string;
  grade: number | null;
  allergies: string | null;
}

/**
 * The foot of an editor, in the card's own grammar.
 *
 * A sentence bound to each control, Cancel in the slot the "Correct" button
 * was, and the commit second. Saving is not one of this screen's three
 * decisions — nothing here reaches the church's database — and the caption's
 * job is to say so out loud, because a form on a card whose other buttons are
 * permanent is a form somebody will hesitate over.
 */
function EditorActions({
  caption,
  saving,
  onCancel,
}: {
  caption: ReactNode;
  saving: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="mt-1 flex flex-col gap-5 border-t border-ink-800 pt-4 lg:grid lg:grid-cols-2 lg:gap-6">
      <Decision caption="Leaves this family exactly as the kiosk recorded them.">
        <Button
          variant="secondary"
          className="mt-auto min-h-12 w-full lg:w-auto"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </Button>
      </Decision>
      <Decision caption={caption}>
        <Button
          type="submit"
          className="mt-auto min-h-12 w-full lg:w-auto"
          disabled={saving}
          aria-busy={saving || undefined}
        >
          Save the correction
        </Button>
      </Decision>
    </div>
  );
}

/**
 * One child, corrected.
 *
 * The three questions the kiosk asked, plus the allergy note, in the order it
 * asked them — a reviewer is reading a form somebody else filled in, and
 * reordering the fields would mean reading it twice.
 *
 * Validated here against `lib/registrationFields.ts`, which is the same module
 * the Cloud Function validates with. That is the point of the shared file: a
 * digit typed into a name is refused under the box that holds it rather than a
 * round trip later in a toast, and it is refused for the same reason and in the
 * same words either way.
 */
function ChildEditor({
  child,
  onCancel,
  onSave,
}: {
  child: PendingRegistrationChild;
  onCancel: () => void;
  onSave: (fields: ChildFields) => Promise<AmendRegistrationResult>;
}) {
  const [firstName, setFirstName] = useState(child.firstName);
  const [lastName, setLastName] = useState(child.lastName);
  const [grade, setGrade] = useState<number | null>(child.grade);
  const [allergies, setAllergies] = useState(child.allergies ?? '');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  /** What the server refused, which is never about one box in particular. */
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const renaming = firstName.trim() !== child.firstName || lastName.trim() !== child.lastName;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const first = checkName(firstName, "The child's first name");
    const last = checkName(lastName, "The child's last name");
    const note = checkAllergyNote(allergies);
    setErrors({
      firstName: first.ok ? undefined : first.error,
      lastName: last.ok ? undefined : last.error,
      allergies: note.ok ? undefined : note.error,
    });
    if (!first.ok || !last.ok || !note.ok) return;

    setRefusal(null);
    setSaving(true);
    try {
      const result = await onSave({
        firstName: first.value,
        lastName: last.value,
        grade,
        allergies: note.value,
      });
      if (result.status === 'refused' || result.status === 'not-found') {
        setRefusal(result.message);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <p className="text-sm font-semibold text-ink-200">Correcting {nameOf(child)}</p>
      {refusal ? <ErrorBanner message={refusal} /> : null}

      <div className="grid gap-3 lg:grid-cols-3">
        <TextField
          label="First name"
          autoFocus
          autoComplete="off"
          value={firstName}
          error={errors.firstName ?? null}
          onChange={(event) => setFirstName(event.target.value)}
        />
        <TextField
          label="Last name"
          autoComplete="off"
          value={lastName}
          error={errors.lastName ?? null}
          onChange={(event) => setLastName(event.target.value)}
        />
        <SelectField
          label="Grade"
          value={grade === null ? '' : String(grade)}
          onChange={(event) =>
            setGrade(event.target.value === '' ? null : Number(event.target.value))
          }
        >
          {/* First, and an answer rather than a blank: a child too young for a
              grade has none, and the roster stores that as no grade at all. */}
          <option value="">No grade</option>
          {GRADES.map((value) => (
            <option key={value} value={value}>
              {gradeDescription(value)}
            </option>
          ))}
        </SelectField>
      </div>

      <TextAreaField
        label="Allergies"
        rows={2}
        value={allergies}
        error={errors.allergies ?? null}
        hint="Goes into the church’s database with them when this family is approved."
        onChange={(event) => setAllergies(event.target.value)}
      />

      <EditorActions
        saving={saving}
        onCancel={onCancel}
        caption={
          renaming
            ? /* The half a reviewer does not expect. Correcting a spelling is
                 also *asking the roster again*, and the answer can hold the
                 approve button that was free a moment ago — which reads as the
                 app breaking unless the button that caused it said so first. */
              'Renames this row on Tally’s roster and asks the roster again whether anybody already has that name. Nothing is sent to the church’s database.'
            : 'Corrects this child on Tally’s roster. Nothing is sent to the church’s database.'
        }
      />
    </form>
  );
}

/**
 * The adult, corrected.
 *
 * The number is the interesting field and it is not a display string: its last
 * four are the key this family types at the lobby kiosk to find themselves, so
 * changing it moves them between buckets in an index the door reads. The
 * caption says which four, both ways round, because "their old digits stop
 * working" is a thing a reviewer may need to tell the family on the phone.
 */
function GuardianEditor({
  guardian,
  onCancel,
  onSave,
}: {
  guardian: { firstName: string; lastName: string; phone: string };
  onCancel: () => void;
  onSave: (fields: {
    firstName: string;
    lastName: string;
    phone: string;
  }) => Promise<AmendRegistrationResult>;
}) {
  const [firstName, setFirstName] = useState(guardian.firstName);
  const [lastName, setLastName] = useState(guardian.lastName);
  const [phone, setPhone] = useState(formatPhoneInput(guardian.phone));
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const digits = phone.replace(/\D/g, '');
  const oldLast4 = guardian.phone.slice(-4);
  const newLast4 = digits.length === 10 ? digits.slice(-4) : null;
  const movingDigits = newLast4 !== null && newLast4 !== oldLast4;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const first = checkName(firstName, "The parent's first name");
    const last = checkName(lastName, "The parent's last name");
    const number = checkPhone(phone);
    setErrors({
      firstName: first.ok ? undefined : first.error,
      lastName: last.ok ? undefined : last.error,
      phone: number.ok ? undefined : number.error,
    });
    if (!first.ok || !last.ok || !number.ok) return;

    setRefusal(null);
    setSaving(true);
    try {
      const result = await onSave({
        firstName: first.value,
        lastName: last.value,
        phone: number.value,
      });
      if (result.status === 'refused' || result.status === 'not-found') {
        setRefusal(result.message);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-xl bg-ink-950 px-3 py-3 ring-1 ring-brand-500/40">
      <div className="flex flex-col gap-3">
        <p className="text-sm font-semibold text-ink-200">Correcting the parent</p>
        {refusal ? <ErrorBanner message={refusal} /> : null}

        <div className="grid gap-3 lg:grid-cols-3">
          <TextField
            label="First name"
            autoFocus
            autoComplete="off"
            value={firstName}
            error={errors.firstName ?? null}
            onChange={(event) => setFirstName(event.target.value)}
          />
          <TextField
            label="Last name"
            autoComplete="off"
            value={lastName}
            error={errors.lastName ?? null}
            onChange={(event) => setLastName(event.target.value)}
          />
          <PhoneField
            label="Phone"
            value={phone}
            error={errors.phone ?? null}
            hint="The last four are what this family types at the kiosk."
            onValueChange={setPhone}
          />
        </div>

        <EditorActions
          saving={saving}
          onCancel={onCancel}
          caption={
            movingDigits
              ? /* The consequence that outlives the card. The record is deleted
                   at approval; the index entry is what the family meets at the
                   door next Friday, and a correction that only fixed the
                   spelling would leave them unfindable under the right number
                   and findable under somebody else's. */
                `Changes the digits this family types at the kiosk from ${oldLast4} to ${newLast4} — the old four stop finding them. Nothing is sent to the church’s database.`
              : 'Corrects the adult recorded on this registration. Nothing is sent to the church’s database.'
          }
        />
      </div>
    </form>
  );
}

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
  onAmend,
}: RegistrationCardProps) {
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [confirmingApprove, setConfirmingApprove] = useState(false);
  /**
   * Which person on this card is open for correction, if any.
   *
   * At most one, and everything else on the card is held while it is open. Two
   * open forms on a phone is a wall of boxes with two Saves in it, and — the
   * real reason — a card mid-correction is a card whose facts are in flux: the
   * duplicate candidates below belong to the name currently on the roster, and
   * the approve button's sentence names children by names somebody is in the
   * middle of changing. Nothing here should be pressable until the correction
   * has landed or been abandoned.
   */
  const [editing, setEditing] = useState<{ kind: 'child'; index: number } | { kind: 'guardian' } | null>(
    null,
  );
  /**
   * What a reviewer has said about each flagged child, this session.
   *
   * A candidate id means "this is that child" and has already been sent; the
   * literal `'new'` means "none of these is them", which is an assertion by a
   * person and not a fact about the world — so it stays local and reversible
   * until they approve, and never round-trips to the server.
   */
  const [resolution, setResolution] = useState<Record<string, string | 'new'>>({});
  /**
   * The other cards this reviewer has said are the same household.
   *
   * Local and unsent until they approve, like every other judgement here: it is
   * an assertion about two families, and the press that acts on it is the one
   * that cannot be taken back.
   */
  const [sameFamily, setSameFamily] = useState<string[]>([]);
  /**
   * Which adult the reviewer says the guardian already is.
   *
   * `null` is the meaningful default — nobody has been asked, so the backend
   * makes its own careful guess, exactly as it did before this control existed.
   * A person id and the literal `'new'` are both decisions, and the caption
   * under the approve button says which one is about to be acted on.
   */
  const [guardianChoice, setGuardianChoice] = useState<string | 'new' | null>(null);
  const when = row.registeredAt === null ? null : new Date(row.registeredAt);
  const expiringSoon = row.expiresInMs !== null && row.expiresInMs < EXPIRING_SOON_MS;
  // Rounded up, and floored at one: a record with six hours left has "1 day",
  // never "0 days", which reads as already gone.
  const daysLeft = Math.max(1, Math.ceil((row.expiresInMs ?? 0) / DAY_MS));

  const held = stillHeld(row);
  /**
   * Everything on this card that is a judgement, held while one is being typed.
   *
   * `disabled` already means "some card on the screen is mid-write". This adds
   * the local reason, and the two are the same thing from a control's point of
   * view: not now.
   */
  const locked = disabled || editing !== null;
  /**
   * A card whose only outstanding half is the adult.
   *
   * Two kinds of record arrive here, and they want the same sentences. A parent
   * contact a counselor took down beside a quick-added visitor was never about
   * the child — that child was on the roster and queued upstream before the
   * card existed. A kiosk family whose children landed and whose guardian did
   * not has ended up in the same place from the other direction.
   *
   * Every sentence in the foot was written for the first kind of card and reads
   * off `held`: "Adds Maya to the church's database", "Takes Maya off the
   * roster". With nobody held those become a promise about an empty list and a
   * threat against a child this press cannot touch — the discard callable
   * deliberately leaves an unheld student alone — so the foot says what will
   * actually happen instead.
   *
   * "Nobody is held" is not enough to say that, though, and the two cards it
   * gets wrong are the two worth naming:
   *
   *   - **The children were never written.** A registration that died between
   *     claiming its id and committing its batch names student documents that
   *     do not exist. Nothing is held because there is nothing at all, and
   *     "Émile stays on the roster" would be a sentence about a child who is
   *     not on it. Hence `studentId !== null`.
   *   - **The push failed and the hold came off.** Approving clears the hold
   *     *before* it pushes, deliberately, so a family whose backend was down is
   *     left unheld with their children still absent upstream. The retry is
   *     about the children, and the button has to keep saying so.
   */
  const parentOnly =
    row.guardian !== null &&
    row.children.length > 0 &&
    row.children.every((child) => child.studentId !== null && !child.pendingReview) &&
    row.lastErrorKind !== 'children' &&
    row.lastErrorKind !== 'both';
  /** The children this card is *about*, held or not — for a sentence to name. */
  const named = listNames(held.length > 0 ? held : row.children);
  /*
   * The adult is what the backend refused, which is usually refused for a
   * reason no retry can fix.
   *
   * An *unknown* kind — a record written before the field existed — is read
   * the safe way round, and the asymmetry is the argument. Offering the escape
   * hatch when the children were actually the problem costs a reviewer one
   * extra sentence to read. Withholding it when the adult was the problem
   * leaves a family whose only moves are a retry that reattempts the refusal
   * and a discard that cannot reach the children already upstream — which is
   * to say no move at all, on a record the sweep will eventually take along
   * with the only phone number Tally holds for them.
   */
  const guardianRefused = row.lastError !== null && row.lastErrorKind !== 'children';
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

  const kin = row.sameFamily ?? [];
  const adults = row.guardianCandidates ?? [];
  /*
   * The adult the backend would settle on if nobody said anything — the one
   * whose number matches, and only when they are the only one. It is the same
   * rule `createFamily` applies, restated here so the caption under the button
   * can say what is about to happen instead of leaving a reviewer to find out
   * from the church's database afterwards.
   */
  const corroborated = adults.filter((adult) => adult.corroborated);
  const wouldJoin = corroborated.length === 1 ? corroborated[0]! : null;
  const chosenAdult = adults.find((adult) => adult.personId === guardianChoice) ?? null;

  /**
   * What the approve press will actually do about the adult, in one clause.
   *
   * Null where the card cannot honestly say. An empty candidate list is not
   * "the church has nobody" — it is equally "write-back is not full" and "the
   * backend did not answer" — so promising a new person on the strength of it
   * would put an assertion in the one sentence a reviewer reads before an
   * irreversible press, and let the backend contradict it a second later by
   * joining a corroborated adult. Said only when somebody chose, or when
   * candidates came back and the guess can be read off them.
   */
  const guardianClause = !row.guardian
    ? null
    : chosenAdult
      ? `joins ${chosenAdult.name}, who the church already has`
      : guardianChoice === 'new'
        ? 'is added as a new person'
        : adults.length === 0
          ? null
          : wouldJoin
            ? `joins ${wouldJoin.name}, whose number matches`
            : 'is added as a new person';

  /**
   * What a press does to the adult, as a sentence rather than a clause.
   *
   * On a parent-only card the adult *is* the press, so the clause that hangs off
   * the end of a kiosk card's sentence has to become the subject of its own —
   * "Adds Rosa Delgado to the church's database, who is added as a new person"
   * says "added" twice and reads as two different additions.
   */
  const adultSentence = !row.guardian
    ? ''
    : guardianClause
      ? `${nameOf(row.guardian)} ${guardianClause}, attached to ${named}.`
      : `Adds ${nameOf(row.guardian)} to the church’s database, attached to ${named}.`;

  const approveDecision = (): ApproveDecision => ({
    ...(sameFamily.length > 0 ? { withRegistrationIds: sameFamily } : {}),
    ...(guardianChoice && guardianChoice !== 'new' ? { guardianPersonId: guardianChoice } : {}),
    ...(guardianChoice === 'new' ? { createNewGuardian: true } : {}),
  });

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
          /*
            How it arrived, because it changes what the card is asking. A
            counselor's card is a phone number somebody was given at a door
            beside a child who is already on the roster; a kiosk card is a whole
            family waiting to exist. Same queue, different question.
          */
          row.source === 'counselor'
            ? when
              ? `Taken at the door ${formatRelative(when)}`
              : 'Taken at the door'
            : when
              ? `Registered ${formatRelative(when)}`
              : null,
          gatheringTitle ? `at ${gatheringTitle}` : null,
          // Legacy: the phone form was retired, but its records live 30 days
          // and a reviewer deciding one still deserves to know how it arrived.
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
          ) : /* Above "joins a family on file" and below a child collision: a
                second card of the same household is a fact about which cards a
                reviewer should read together, and it is worth less than a name
                clash that could put a second child in for ever. */
          kin.length > 0 ? (
            <Badge tone="warn">Also registered separately</Badge>
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
            When it clears, the phone number goes with it — and{' '}
            {parentOnly && row.children.length === 1 ? `${named} stays` : 'the children stay'} on
            Tally&rsquo;s roster with nobody attached to them.
          </p>
        ) : null}

        {/*
          What this card is, when it is the narrow kind.

          A reviewer who reads "Rosa Delgado · 555-0134" and a child's name will
          reach for the same instrument they use on a kiosk family — approve the
          children, or take them off the roster — and neither is what this card
          holds. Saying where the child already is, first, is what stops "Not
          ours" being read as the way to reject a phone number.
        */}
        {row.source === 'counselor' ? (
          <p className={STRIP}>
            A counselor added {named} at the door and was given a parent&rsquo;s details.{' '}
            {held.length === 0
              ? `${named} is already on the roster and already queued for the church’s database`
              : `${named} is on the roster`}{' '}
            — the adult below is the only thing waiting on you.
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

        {row.guardian && editing?.kind === 'guardian' ? (
          <GuardianEditor
            guardian={row.guardian}
            /*
              Held children only. Correcting the adult on a family whose
              children are already upstream would change a copy that is about
              to be deleted and nothing the church can see, and the callable
              refuses it — so the card does not offer it either.
            */
            onCancel={() => setEditing(null)}
            onSave={async (guardian) => {
              const result = await onAmend({ guardian });
              if (result.status !== 'refused') {
                setEditing(null);
                /*
                  The two judgements this card holds that were *about* the old
                  details. Which adult upstream is "the same person" was
                  answered against a name and a number that have just changed,
                  and which other cards are this family was answered by the
                  server from the digits — so both go back to unanswered rather
                  than quietly staying selected under new evidence.
                */
                setGuardianChoice(null);
                if (result.last4Changed) setSameFamily([]);
              }
              return result;
            }}
          />
        ) : row.guardian ? (
          /*
            The number, and only the number. The guardian's name is the card's
            own title one line above, so a two-row grid was carrying one new
            fact and a label column whose width pushed the values onto a fourth
            left edge that lined up with nothing.
          */
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className="flex flex-wrap items-baseline gap-x-3 text-sm">
                <span className="text-ink-500">Phone</span>
                <span className="tabular-nums text-ink-200">{formatPhone(row.guardian.phone)}</span>
              </p>
              {/*
                Offered for as long as the adult has not been written, which is
                not the same question as whether the children are held — and
                `settled` alone got it backwards on the two cards that matter
                most. A counselor's parent contact is settled from the moment it
                is created (its child was quick-added at a door and never held)
                and the adult is the entire point of it. A kiosk family whose
                children landed but whose guardian was refused is settled too,
                and is kept precisely so somebody can try the adult again —
                where a mistyped number is the likeliest reason for the refusal.

                The one card that is genuinely too late is the mirror image:
                `lastErrorKind: 'children'` means the guardian went upstream and
                a child did not, so this record now outlives its own adult. The
                callable refuses that one for the same reason.
              */}
              {row.lastErrorKind === 'children' ? null : (
                <CorrectButton
                  label={`Correct ${nameOf(row.guardian)}’s details`}
                  disabled={locked}
                  onClick={() => setEditing({ kind: 'guardian' })}
                />
              )}
            </div>
            {/*
              What the family typed, once it is no longer what the card says.
              A second reviewer has to be able to tell a correction from the
              form — it is the difference between trusting this row and undoing
              it — and the number is described rather than repeated, because a
              mistyped one belongs to a stranger and Tally does not keep it.
            */}
            {row.typedGuardianName || row.phoneCorrected ? (
              <p className={CAPTION}>
                {row.typedGuardianName
                  ? `Typed at the kiosk as ${nameOf(row.typedGuardianName)}.`
                  : ''}
                {row.typedGuardianName && row.phoneCorrected ? ' ' : ''}
                {row.phoneCorrected ? 'The number was corrected here.' : ''}
              </p>
            ) : null}
          </div>
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

        {/*
          The other card that typed this number.

          Above the children, because it changes what the card *is* rather than
          what one row of it means: a reviewer who has not seen this reads two
          families and approves twice, which is how one parent ended up heading
          two households in a database that cannot merge them. The backends now
          survive that press either way — the second approval finds the parent's
          own household instead of founding a second — but survived is not the
          same as understood, and a reviewer deciding about the Nguyens should
          be told there are two cards of them.
        */}
        {kin.length > 0 ? (
          <div className={STRIP}>
            <p>
              {kin.length === 1 ? 'Another registration' : `${kin.length} other registrations`} in
              this queue typed {row.guardian ? formatPhone(row.guardian.phone) : 'this number'}.
              Approving together adds every child to one family and asks the church&rsquo;s database
              for one adult.
            </p>
            <ul className="mt-2 flex flex-col gap-2">
              {kin.map((other) => {
                const together = sameFamily.includes(other.registrationId);
                /*
                 * Held for the same reason this card's own approve button is
                 * held. Approving as a group pushes the other card's children
                 * too, which would reach straight around the gate on *their*
                 * card — a child greyed out there, made permanent by a press
                 * here, which is the exact duplicate that gate exists to stop.
                 */
                const waiting = (other.unsettledChildren ?? 0) > 0;
                return (
                  <li
                    key={other.registrationId}
                    className="flex flex-wrap items-center justify-between gap-2"
                  >
                    <span className="min-w-0 text-ink-200">
                      {other.guardianName || 'A family'}
                      {other.childNames.length > 0 ? (
                        <span className="text-ink-400"> — {other.childNames.join(', ')}</span>
                      ) : null}
                      {waiting ? (
                        <span className="block text-ink-400">
                          Settle their own card first — {other.unsettledChildren}{' '}
                          {other.unsettledChildren === 1 ? 'child' : 'children'} there already share
                          a name with somebody on the roster.
                        </span>
                      ) : null}
                    </span>
                    <Button
                      variant={together ? 'primary' : 'secondary'}
                      className="min-h-9 px-3 text-sm"
                      disabled={locked || waiting}
                      aria-pressed={together}
                      onClick={() =>
                        setSameFamily((chosen) =>
                          together
                            ? chosen.filter((id) => id !== other.registrationId)
                            : [...chosen, other.registrationId],
                        )
                      }
                    >
                      {together ? 'Approving together' : 'Same family'}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {/*
          Who the guardian already is, if the church has them.

          This decision was always being made — `createFamily` matches a name
          against a phone number and creates a fresh adult for anything less —
          but it was being made in a Cloud Function with nobody to ask. Here
          there is somebody, and they can answer the case no matching ever
          reaches: the mother who is on file under the number she had last year.

          Nothing is held on it. Not answering leaves the same guess that has
          always run, and the caption under the approve button says which way it
          will fall — a reviewer should not have to press a button to find out
          whether the church is about to get a second Rosa Salgado.
        */}
        {row.guardian && adults.length > 0 && (!row.settled || parentOnly) ? (
          <div className={STRIP}>
            <p>
              The church already has {adults.length === 1 ? 'somebody' : `${adults.length} people`}{' '}
              called {nameOf(row.guardian)}.
            </p>
            <ul className="mt-2 flex flex-col gap-2">
              {adults.map((adult) => {
                const picked = guardianChoice === adult.personId;
                return (
                  <li
                    key={adult.personId}
                    className="flex flex-wrap items-center justify-between gap-2"
                  >
                    <span className="min-w-0 text-ink-200">
                      {adult.name}
                      <span className="text-ink-400">
                        {' — '}
                        {adult.corroborated
                          ? 'their number matches'
                          : adult.reachable
                            ? 'a different number on file'
                            : 'no number on file'}
                      </span>
                    </span>
                    <Button
                      variant={picked ? 'primary' : 'secondary'}
                      className="min-h-9 px-3 text-sm"
                      disabled={locked}
                      aria-pressed={picked}
                      onClick={() => setGuardianChoice(picked ? null : adult.personId)}
                    >
                      {picked ? 'This is them' : 'Same person'}
                    </Button>
                  </li>
                );
              })}
              <li className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-ink-400">None of them is this parent.</span>
                <Button
                  variant={guardianChoice === 'new' ? 'primary' : 'secondary'}
                  className="min-h-9 px-3 text-sm"
                  disabled={locked}
                  aria-pressed={guardianChoice === 'new'}
                  onClick={() => setGuardianChoice(guardianChoice === 'new' ? null : 'new')}
                >
                  {guardianChoice === 'new' ? 'Adding as new' : 'Add as new'}
                </Button>
              </li>
            </ul>
          </div>
        ) : null}

        <ul className="flex flex-col gap-2">
          {row.children.map((child, index) => (
            <ChildRow
              key={child.studentId ?? `${child.firstName}:${index}`}
              child={child}
              disabled={locked}
              onUnmerge={onUnmerge}
              /*
                Correctable exactly while a correction can still matter. A child
                who has been pushed, or folded into another row, is one the
                callable refuses — see `kiosk/amend.ts` — and a button whose
                only outcome is a refusal is worse than no button.
              */
              correctable={child.pendingReview && !child.mergedIntoStudentId}
              editing={editing?.kind === 'child' && editing.index === index}
              onEdit={() => setEditing({ kind: 'child', index })}
              onCancelEdit={() => setEditing(null)}
              onSaveChild={async (fields) => {
                const result = await onAmend({ child: { index, ...fields } });
                if (result.status !== 'refused') {
                  setEditing(null);
                  /*
                    This reviewer's own answer about this child, dropped.
                    "None of them — Micheal is new" was an assertion about a
                    name that no longer exists, and leaving it standing would
                    walk a corrected spelling straight past the collision the
                    correction itself just created.
                  */
                  if (child.studentId) {
                    setResolution(({ [child.studentId!]: _dropped, ...rest }) => rest);
                  }
                }
                return result;
              }}
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
                  parentOnly ? (
                    <span className="text-warn-400">
                      {adultSentence} Nothing added to the church&rsquo;s database can be deleted or
                      taken back.
                    </span>
                  ) : (
                    <span className="text-warn-400">
                      {listNames(held)} {held.length === 1 ? 'goes' : 'go'} into the church&rsquo;s
                      database now
                      {sameFamily.length > 0
                        ? `, with the ${sameFamily.length === 1 ? 'other registration' : `${sameFamily.length} other registrations`} as one family`
                        : ''}
                      {/* The adult, named, in the sentence they are agreeing to —
                          it is the half of this press with no undo and the half
                          the card was silent about. */}
                      {guardianClause ? `, and ${row.guardian!.firstName} ${guardianClause}` : ''}.
                      Nothing added there can be deleted or taken back.
                    </span>
                  )
                }
              >
                <Button
                  className="mt-auto min-h-12 w-full lg:w-auto"
                  onClick={() => {
                    setConfirmingApprove(false);
                    onApprove(approveDecision());
                  }}
                  disabled={locked}
                  aria-busy={busy || undefined}
                >
                  {parentOnly
                    ? `Yes — add ${row.guardian!.firstName}`
                    : `Yes — add ${held.length === 1 ? listNames(held) : `${held.length} children`}`}
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
                      : parentOnly
                        ? /*
                            The narrow card's sentence. Nothing here is about the
                            child — they are on the roster either way — so the
                            promise is about the adult, and it still names the
                            household the press is about to build.
                          */
                          `${adultSentence} Nothing added to the church’s database can be taken back.`
                      : `Adds ${listNames(held)}${sameFamily.length > 0 ? ' and the family they were registered with' : ''} to the church’s database${guardianClause ? `, and ${row.guardian!.firstName} ${guardianClause}` : ''}. Nothing added there can be taken back.`
                }
              >
                <Button
                  variant={guardianRefused ? 'secondary' : 'primary'}
                  className="mt-auto min-h-12 w-full lg:w-auto"
                  onClick={() => setConfirmingApprove(true)}
                  disabled={locked || unsettled.length > 0}
                  aria-busy={busy || undefined}
                >
                  {guardianRefused
                    ? `Try ${row.guardian?.firstName ?? 'the parent'} again`
                    : parentOnly
                      ? `Add ${row.guardian!.firstName}`
                      : row.settled
                        ? 'Finish adding them'
                        : 'Approve and add'}
                </Button>
              </Decision>

              {confirmingDiscard ? (
                <Decision
                  caption={
                    parentOnly ? (
                      <span className="text-warn-400">
                        Forgets {formatPhone(row.guardian!.phone)} for good — it is the only copy.{' '}
                        {named} stays on the roster exactly as they are, and nobody is added to the
                        church&rsquo;s database.
                      </span>
                    ) : (
                      <span className="text-warn-400">
                        Takes {listNames(held)} off the roster
                        {row.guardian ? ` and forgets ${formatPhone(row.guardian.phone)}` : ''} for
                        good. Their check-in history is kept, and only a new registration at the
                        kiosk brings them back.
                      </span>
                    )
                  }
                >
                  <div className="mt-auto flex w-full flex-col gap-2 lg:w-auto lg:flex-row">
                    <Button
                      variant="danger"
                      className="min-h-12 w-full lg:w-auto"
                      onClick={onDiscard}
                      disabled={locked}
                    >
                      {parentOnly ? 'Yes, forget the number' : 'Yes, take them off'}
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
                    parentOnly
                      ? // The one card where "Not ours" cannot mean "take them
                        // off the roster": the discard leaves an unheld student
                        // alone, deliberately, and a leader who wants that child
                        // gone does it on the Students screen looking at them.
                        `Forgets ${formatPhone(row.guardian!.phone)} for good. ${named} stays on the roster.`
                      : row.guardian
                        ? `Takes ${listNames(held)} off the roster and forgets ${formatPhone(row.guardian.phone)} for good.`
                        : `Takes ${listNames(held)} off the roster. No number was given, so nothing else is lost.`
                  }
                >
                  <Button
                    variant="secondary"
                    className="mt-auto min-h-12 w-full lg:w-auto"
                    onClick={() => setConfirmingDiscard(true)}
                    disabled={locked}
                  >
                    {parentOnly ? 'Forget the number' : 'Not ours'}
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
                /*
                  The grouping is carried; the adult is not. Which children go
                  is still this reviewer's answer, and dropping it here would
                  leave the other card's children behind while its button still
                  read "Approving together". Who the adult is has no meaning on
                  a press whose whole content is "no adult".
                */
                onClick={() =>
                  onApprove({
                    withoutGuardian: true,
                    ...(sameFamily.length > 0 ? { withRegistrationIds: sameFamily } : {}),
                  })
                }
                disabled={locked}
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
  correctable,
  editing,
  onEdit,
  onCancelEdit,
  onSaveChild,
}: {
  child: PendingRegistrationChild;
  disabled: boolean;
  /** A candidate id, `'new'`, or nothing decided yet. */
  resolution: string | 'new' | undefined;
  onResolve: (choice: string | 'new') => void;
  onUnmerge: (foldId: string) => void;
  /** Whether this child is still Tally's alone to correct. */
  correctable: boolean;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveChild: (fields: ChildFields) => Promise<AmendRegistrationResult>;
}) {
  const candidates = candidatesFor(child);

  /*
    The editor takes the whole row rather than opening beside it.

    The candidates below are the roster's answer about the name *currently* on
    the row, and the name is what is being typed — so leaving them up would
    have a reviewer comparing a half-typed spelling against a list computed
    from the old one. They come back, recomputed by the server, the moment the
    correction lands.
  */
  if (editing) {
    return (
      <li className="rounded-xl bg-ink-950 px-3 py-3 ring-1 ring-brand-500/40">
        <ChildEditor child={child} onCancel={onCancelEdit} onSave={onSaveChild} />
      </li>
    );
  }

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
          {/*
            What the family typed, once the row stops being what they typed.
            Under the name it corrects, in the caption voice — it is provenance,
            not a fact about the child, and the row's brightest run must stay on
            the name a reviewer is about to approve.
          */}
          {child.typedAs ? (
            <span className={cn('mt-0.5 block', CAPTION)}>
              Typed at the kiosk as {nameOf(child.typedAs)}
              {child.typedAs.grade !== child.grade
                ? `, ${gradeSentence(child.typedAs) ?? 'no grade'}`
                : ''}
              .
            </span>
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
        {correctable ? (
          <CorrectButton
            label={`Correct ${nameOf(child)}\u2019s details`}
            disabled={disabled}
            onClick={onEdit}
          />
        ) : null}
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
          {/*
            The emphasis belongs to the name, not to the slot. Lifting "a row
            on the roster" a step up the ramp put the brightest run in the row
            on a phrase that names nobody — the treatment reserved for a person,
            applied to the absence of one.
          */}
          <span className={CAPTION}>
            {keeperLabel(child) ? (
              <>
                Merged into <span className="text-ink-300">{keeperLabel(child)}</span>. Their
                check-ins are kept together.
              </>
            ) : (
              'Merged into another row on the roster. Their check-ins are kept together.'
            )}
          </span>
          {/*
            A real target, not an inline link: this is the control that
            reverses the only reversible decision on the screen, and it was the
            one thing on a page of 48px buttons that a thumb had to aim at. A
            reviewer who cannot land it reliably is a reviewer likelier to
            approve the merge as it stands, which is the irreversible branch.
          */}
          <button
            type="button"
            disabled={disabled}
            onClick={() => onUnmerge(child.studentId!)}
            className="flex min-h-11 items-center rounded-lg px-3 text-sm text-brand-400 ring-1 ring-ink-800 transition-colors hover:bg-ink-900 disabled:opacity-60 pointer-fine:min-h-8"
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

/**
 * Who a merged child was folded into, named.
 *
 * The callable resolves this now, because inferring it from *this child's*
 * duplicate hints only worked when the merge had been made through this card's
 * own picker — a fold from the directory, or a "wrong person" correction, named
 * nobody, and the row printed "merged into a row on the roster" to a reviewer
 * whose next press bakes the association into a push with no delete. The hints
 * remain the fallback for a payload from an older callable.
 */
function keeperLabel(child: PendingRegistrationChild): string | null {
  const keeper =
    child.mergedInto ??
    child.possibleDuplicates.find(
      (candidate) => candidate.studentId === child.mergedIntoStudentId,
    );
  if (!keeper || !keeper.known) return null;
  return summaryLabel(keeper);
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
