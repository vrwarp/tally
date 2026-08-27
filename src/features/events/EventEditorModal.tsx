/**
 * Create or edit one event.
 *
 * Two things here are load-bearing. The check-in window, because an event whose
 * window does not cover it is invisible to temporal awareness — a counselor
 * would open Tally at the door and be told there is nothing on. And the RSVP
 * switch on a one-off, because it is what closes a retreat roster to the
 * students who actually signed up.
 *
 * Load-bearing is not the same as needing to be on screen, though: the window
 * is collapsed behind a row that states the two times it resolved to, because
 * it defaults correctly and follows the event unless somebody pins it. See
 * `CheckInWindowField`.
 *
 * The form keeps its own string state rather than editing dates in place:
 * `<input type="datetime-local">` speaks strings, and a half-typed date must not
 * be able to produce an `Invalid Date` mid-keystroke.
 *
 * ## Shape
 *
 * Two columns of sections on a desktop, one on a phone — the dialog it sits in
 * is a window above `sm` and a sheet below it (see `components/ui/Modal`), and
 * this form is what made that worth doing: stacked at thumb density it is
 * around a dozen controls, taller than a laptop viewport, and it was scrolling
 * inside a panel two thousand pixels wide.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Button,
  CheckboxField,
  Modal,
  SelectField,
  TextAreaField,
  TextField,
} from '@/components/ui';
import { useAuth } from '@/context/authContext';
import { useData } from '@/context/dataContext';
import { useToast } from '@/context/toastContext';
import { CheckInWindowField } from '@/features/events/CheckInWindowField';
import { IconPickerField } from '@/features/events/IconPickerField';
import { RecurrenceField } from '@/features/events/RecurrenceField';
import {
  KioskBackdropField,
  type KioskBackdropChoice,
} from '@/features/events/KioskBackdropField';
import { KioskThemeField } from '@/features/events/KioskThemeField';
import { LabelTemplateField } from '@/features/events/LabelTemplateField';
import { gatheringOptions } from '@/lib/gatherings';
import type { KioskTheme } from '@/lib/kioskTheme';
import type { LabelTemplate } from '@/lib/labelTemplate';
import { defaultRecurrence, retimeRecurrence, validateRecurrence } from '@/lib/recurrence';
import { cn } from '@/lib/utils';
import { addMinutes, fromDateTimeLocalValue, toDateTimeLocalValue } from '@/lib/time';
import { createEvent, ensureMaterialized, updateEvent, type EventDraft } from '@/services/events';
import { putKioskBackdrop } from '@/services/kioskBackdrops';
import type { EventMode, RecurrenceRule, TallyEvent } from '@/types';

/** House defaults for the check-in window, in minutes around the event. */
const OPENS_BEFORE_MIN = 60;
const CLOSES_AFTER_MIN = 60;

interface EditorForm {
  title: string;
  /** The invitation — what this gathering is. Shown on the check-in hero. */
  description: string;
  /** A Material Symbols name from `lib/eventIcons`, or `''` for none. */
  icon: string;
  mode: EventMode;
  /**
   * Carried, never chosen. Nothing on the form sets this any more — the picker
   * that did is gone, and the note standing where it was says why — but the
   * value still has to survive an edit, because `chainKey` reads it first and
   * dropping it would cut a seeded Friday out of its own chain.
   */
  seriesId: string;
  /** A `chainKey`, or `''`. The gathering a one-off borrows its regulars from. */
  predictFromChain: string;
  /**
  * Anchored on `start`, never on a date of its own. Always present — a
  * recurring gathering repeats by definition — and simply unused while the
  * event is a one-off.
  */
  recurrence: RecurrenceRule;
  start: string;
  end: string;
  checkInOpens: string;
  checkInCloses: string;
  location: string;
  notes: string;
  requiresRsvp: boolean;
  requiresCheckOut: boolean;
  /** What the kiosk prints at check-in, or null for nothing. */
  labelTemplate: LabelTemplate | null;
  /** What a kiosk bound here looks like, or null for Tally's own colours. */
  kioskTheme: KioskTheme | null;
  /**
   * The kiosk's photograph: none, the one the event already points at, or one
   * chosen this session and uploaded only if the save goes through — closing
   * the editor abandons it with the rest of the form.
   */
  kioskBackdrop: KioskBackdropChoice;
  /**
   * A window left at the standard hour follows the event when its times move;
   * one somebody hand-tuned is pinned and never rewritten underneath them.
   */
  opensPinned: boolean;
  closesPinned: boolean;
}

type EditorErrors = Partial<
  Record<'title' | 'start' | 'end' | 'checkInOpens' | 'checkInCloses' | 'recurrence', string>
>;

interface ParsedTimes {
  startAt: Date;
  endAt: Date;
  checkInOpensAt: Date;
  checkInClosesAt: Date;
}

function parseLocal(value: string): Date | null {
  try {
    return fromDateTimeLocalValue(value);
  } catch {
    return null;
  }
}


function buildForm(
  event: TallyEvent | null,
  defaults: Partial<EventDraft> | undefined,
  now: Date,
): EditorForm {
  const nextHour = new Date(now);
  nextHour.setMinutes(0, 0, 0);
  nextHour.setHours(nextHour.getHours() + 1);

  const mode: EventMode = event?.mode ?? defaults?.mode ?? 'recurring';
  const startAt = event?.startAt ?? defaults?.startAt ?? nextHour;
  const endAt = event?.endAt ?? defaults?.endAt ?? addMinutes(startAt, 120);
  const opensAt =
    event?.checkInOpensAt ?? defaults?.checkInOpensAt ?? addMinutes(startAt, -OPENS_BEFORE_MIN);
  const closesAt =
    event?.checkInClosesAt ?? defaults?.checkInClosesAt ?? addMinutes(endAt, CLOSES_AFTER_MIN);

  // Weekly on the day it starts, unless something more specific is known. That
  // is what almost every gathering here is, and it is the only honest default
  // now that "Recurring" means the event repeats: there is no rule to inherit
  // from an event scheduled before this field existed, and leaving the control
  // blank would just be a required field nobody was asked to fill in.
  const recurrence: RecurrenceRule =
    event?.recurrence ?? defaults?.recurrence ?? defaultRecurrence(startAt);

  return {
    title: event?.title ?? defaults?.title ?? '',
    description: event?.description ?? defaults?.description ?? '',
    icon: event?.icon ?? defaults?.icon ?? '',
    mode,
    seriesId: event?.seriesId ?? defaults?.seriesId ?? '',
    predictFromChain: event?.predictFromChain ?? defaults?.predictFromChain ?? '',
    recurrence,
    start: toDateTimeLocalValue(startAt),
    end: toDateTimeLocalValue(endAt),
    checkInOpens: toDateTimeLocalValue(opensAt),
    checkInCloses: toDateTimeLocalValue(closesAt),
    location: event?.location ?? defaults?.location ?? '',
    notes: event?.notes ?? defaults?.notes ?? '',
    requiresRsvp: event?.requiresRsvp ?? defaults?.requiresRsvp ?? mode === 'oneoff',
    requiresCheckOut: event?.requiresCheckOut ?? defaults?.requiresCheckOut ?? false,
    labelTemplate: event?.labelTemplate ?? defaults?.labelTemplate ?? null,
    kioskTheme: event?.kioskTheme ?? defaults?.kioskTheme ?? null,
    kioskBackdrop: ((id) => (id ? { kind: 'kept' as const, id } : { kind: 'none' as const }))(
      event?.kioskBackdropId ?? defaults?.kioskBackdropId ?? null,
    ),
    opensPinned:
      Math.round((startAt.getTime() - opensAt.getTime()) / 60_000) !== OPENS_BEFORE_MIN,
    closesPinned:
      Math.round((closesAt.getTime() - endAt.getTime()) / 60_000) !== CLOSES_AFTER_MIN,
  };
}

function validateForm(form: EditorForm): { errors: EditorErrors; times: ParsedTimes | null } {
  const errors: EditorErrors = {};

  if (!form.title.trim()) errors.title = 'Give this event a name.';

  const startAt = parseLocal(form.start);
  const endAt = parseLocal(form.end);
  const checkInOpensAt = parseLocal(form.checkInOpens);
  const checkInClosesAt = parseLocal(form.checkInCloses);

  if (!startAt) errors.start = 'Pick a start date and time.';
  if (!endAt) errors.end = 'Pick an end date and time.';
  if (startAt && endAt && endAt <= startAt) errors.end = 'The event has to end after it starts.';

  if (!checkInOpensAt) errors.checkInOpens = 'Pick a time.';
  else if (startAt && checkInOpensAt > startAt) {
    errors.checkInOpens = 'Check-in has to be open by the time the event starts.';
  }

  if (!checkInClosesAt) errors.checkInCloses = 'Pick a time.';
  else if (endAt && checkInClosesAt < endAt) {
    errors.checkInCloses = 'Check-in has to stay open until the event ends.';
  }

  // Only checkable once there is a start to anchor against — the rule is
  // phrased relative to it, so an unparseable date has already failed above.
  if (form.mode === 'recurring' && startAt) {
    const problem = validateRecurrence(form.recurrence, startAt);
    if (problem) errors.recurrence = problem;
  }

  const times =
    startAt && endAt && checkInOpensAt && checkInClosesAt
      ? { startAt, endAt, checkInOpensAt, checkInClosesAt }
      : null;

  return { errors, times };
}

/*
 * What a refused submit says, and where it says it.
 *
 * The dialog body scrolls under a pinned footer, so "Schedule event" is under
 * the thumb the entire time while ~1500px of form moves behind it — about two
 * and a half screens on a phone. A submit that only wrote `errors` into the
 * fields therefore looked like a button that did nothing: "Give this event a
 * name." was rendered a screen and a half above the thumb that had just pressed
 * it, and the check-in window's errors are below everything else.
 *
 * Two answers, and the form does both. Focus moves to the first control that is
 * wrong, which scrolls the body to it for free and lets a screen reader read the
 * message out. And the summary below rides the footer, beside the button that
 * fired it, so the press has a visible consequence where the press happened.
 */
const ERROR_FIELDS: { key: keyof EditorErrors; label: (mode: EventMode) => string }[] = [
  { key: 'title', label: () => 'Title' },
  { key: 'start', label: (mode) => (mode === 'recurring' ? 'Next start' : 'Starts') },
  { key: 'end', label: (mode) => (mode === 'recurring' ? 'Next end' : 'Ends') },
  { key: 'recurrence', label: () => 'Repeats' },
  { key: 'checkInOpens', label: () => 'Check-in opens' },
  { key: 'checkInCloses', label: () => 'Check-in closes' },
];

/**
 * The first problem in reading order, named by the words on its own label, and
 * a count of whatever else is wrong.
 *
 * Named rather than quoted alone because two of the messages — "Pick a time." —
 * do not say which time, and the field they belong to is the collapsed check-in
 * window at the far end of the other column.
 */
function summariseErrors(errors: EditorErrors, mode: EventMode): string | null {
  const found: string[] = [];
  for (const { key, label } of ERROR_FIELDS) {
    const message = errors[key];
    if (message) found.push(`${label(mode)}: ${message}`);
  }

  const [first, ...rest] = found;
  if (!first) return null;
  return rest.length === 0 ? first : `${first} (+${rest.length} more)`;
}

/**
 * The action bar, restated.
 *
 * `Modal` lays out its footer's *direct children* — two buttons, split by the
 * thumb on a phone and right-aligned on a pointer — so a third child would take
 * a share of the same row and squeeze the buttons it is explaining. The dialog
 * gets one child instead, and the summary and the buttons are arranged inside
 * it. Kept in step with `ACTIONS` in `components/ui/Modal.tsx`.
 */
const ACTION_BAR =
  'flex items-center gap-2 [&>*]:flex-1 [&>*:last-child]:flex-[2] ' +
  'sm:justify-end sm:[&>*]:flex-none sm:[&>*:last-child]:flex-none sm:[&>*]:min-w-28';

/**
 * A column of the form, named.
 *
 * On a phone these are section breaks in one long column. On a desktop they are
 * what lets the form sit in two columns without turning into a maze: a reader
 * scanning across finds a heading, not the middle of a sentence they started on
 * the left. Two columns of *sections* is legible; two columns of wrapped fields
 * is the layout every form study warns about.
 */
function Section({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    // `@container` so the fields inside can ask how wide *this column* is
    // rather than how wide the window is — the two are unrelated once the form
    // splits in half, and a pair of date pickers that fits the viewport can
    // still be 40px too wide for the pane it landed in.
    <section className={cn('@container flex min-w-0 flex-col gap-4 pointer-fine:gap-3', className)}>
      <h3 className="text-xs font-bold uppercase tracking-wider text-ink-500">{title}</h3>
      {children}
    </section>
  );
}

export interface EventEditorModalProps {
  open: boolean;
  onClose: () => void;
  /** Omitted or null to create. */
  event?: TallyEvent | null;
  /** Prefill for a new event — the "Schedule next Friday" quick action. */
  defaults?: Partial<EventDraft>;
  /** Fired with the event id after a successful save. */
  onSaved?: (eventId: string) => void;
}

export function EventEditorModal({
  open,
  onClose,
  event,
  defaults,
  onSaved,
}: EventEditorModalProps) {
  const { events, series } = useData();
  const { user } = useAuth();
  const { show } = useToast();

  const isEditing = Boolean(event);
  const [form, setForm] = useState<EditorForm>(() => buildForm(event ?? null, defaults, new Date()));
  const [errors, setErrors] = useState<EditorErrors>({});
  const [saving, setSaving] = useState(false);
  /*
   * How many times the button has been pressed and refused.
   *
   * A counter rather than a boolean, because the second press on an unchanged
   * form has to move the focus again: the errors are identical, so nothing else
   * about the render differs and an effect keyed on them would not run. It is
   * also what makes this an effect rather than work in the handler — the
   * control to focus does not exist until the render carrying `errors` has
   * landed, and the check-in window only opens itself once one is inside it.
   */
  const [refusals, setRefusals] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  // Identity of what is being edited. `defaults` itself is a fresh object on
  // every render of the parent, so it cannot be a dependency directly.
  const seedKey = event
    ? `edit:${event.id}:${event.updatedAt.getTime()}`
    : [
        'new',
        defaults?.mode ?? '',
        defaults?.seriesId ?? '',
        defaults?.title ?? '',
        defaults?.startAt?.getTime() ?? '',
      ].join(':');

  useEffect(() => {
    if (!open) return;
    setForm(buildForm(event ?? null, defaults, new Date()));
    setErrors({});
    setRefusals(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, seedKey]);

  /*
   * The one field to look at, in reading order.
   *
   * `aria-invalid` is already on every control the errors reach — `Field`
   * writes it, and `RecurrenceField` and `CheckInWindowField` both pass their
   * message down to one — so the DOM knows which controls are wrong and in
   * which order without this file keeping a ref per field. Moving the caret
   * there scrolls the dialog body to it, which is the half of the fix a thumb
   * notices.
   */
  useEffect(() => {
    if (refusals === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [refusals]);

  const patch = (next: Partial<EditorForm>) => setForm((current) => ({ ...current, ...next }));

  const handleStartChange = (value: string) => {
    setForm((current) => {
      const startAt = parseLocal(value);
      return {
        ...current,
        start: value,
        checkInOpens:
          startAt && !current.opensPinned
            ? toDateTimeLocalValue(addMinutes(startAt, -OPENS_BEFORE_MIN))
            : current.checkInOpens,
        // Dragging a plain weekly gathering from Friday to Saturday means it is
        // now a Saturday gathering. A rule that names several days is left
        // alone — see `retimeRecurrence`.
        recurrence: startAt
          ? retimeRecurrence(current.recurrence, parseLocal(current.start), startAt)
          : current.recurrence,
      };
    });
  };

  const handleEndChange = (value: string) => {
    setForm((current) => {
      const endAt = parseLocal(value);
      return {
        ...current,
        end: value,
        checkInCloses:
          endAt && !current.closesPinned
            ? toDateTimeLocalValue(addMinutes(endAt, CLOSES_AFTER_MIN))
            : current.checkInCloses,
      };
    });
  };

  const handleModeChange = (mode: EventMode) => {
    setForm((current) => ({
      ...current,
      mode,
      // A retreat is an RSVP list by default. Going back to recurring disarms it
      // rather than leaving a closed roster on a Friday night, where it would
      // hide every student who had not been added to a list nobody built.
      seriesId: mode === 'recurring' ? current.seriesId : '',
      // The other direction of the same idea: a gathering that repeats reads its
      // own past, so a borrowed one would be a second answer to a settled
      // question — and one nothing on screen would still be showing.
      predictFromChain: mode === 'oneoff' ? current.predictFromChain : '',
      requiresRsvp: mode === 'oneoff',
    }));
  };

  const save = async (times: ParsedTimes) => {
    if (!user) return;

    const draft: EventDraft = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      icon: form.icon || null,
      mode: form.mode,
      // No control sets this any more, which makes it easy to mistake for dead
      // weight. It is not: it arrives from `defaults` or from the event being
      // edited, and the paragraph below applies to it word for word — `chainKey`
      // reads `seriesId` before it reads the root.
      seriesId: form.mode === 'recurring' ? form.seriesId || null : null,
      /*
       * Carried forward, like `status` below, and for a sharper reason.
       *
       * `buildEventPayload` writes this on every save, so leaving it off the
       * draft nulled it — and `chainKey` falls through to the event's own id
       * when it is null. An edit therefore cut the instance out of its own
       * chain: the calendar started projecting it as a second gathering
       * alongside the first, its past nights stopped predicting its roster, and
       * `eventAccess/{chainKey}` no longer named it, which quietly opened a
       * restricted register to the whole team.
       *
       * A projected occurrence already carries the resolved root — see `asEvent`
       * in `lib/eventProjection.ts` — so this is right on both halves of the
       * calendar. Null on a chain's own root, which is what it should be: the
       * root is keyed on its own id.
       */
      recurrenceRootId: form.mode === 'recurring' ? (event?.recurrenceRootId ?? null) : null,
      predictFromChain: form.mode === 'oneoff' ? form.predictFromChain || null : null,
      recurrence: form.mode === 'recurring' ? form.recurrence : null,
      startAt: times.startAt,
      endAt: times.endAt,
      checkInOpensAt: times.checkInOpensAt,
      checkInClosesAt: times.checkInClosesAt,
      location: form.location.trim() || null,
      notes: form.notes.trim() || null,
      requiresRsvp: form.mode === 'oneoff' && form.requiresRsvp,
      requiresCheckOut: form.requiresCheckOut,
      // Recurring only for now: a one-off's labels are the next piece of work,
      // and writing a template a kiosk would honour on a trip nobody set up for
      // it is the wrong half to ship first.
      labelTemplate: form.mode === 'recurring' ? form.labelTemplate : null,
      // Not narrowed to recurring the way labels are: the kiosk's chooser lists
      // one-offs too, and a week of holiday club is exactly the thing somebody
      // wants their lobby screen to look like.
      kioskTheme: form.kioskTheme,
      // The photograph the event already points at, or nothing. A photo chosen
      // this session is uploaded inside `save` below and lands here then — the
      // bytes must not go to Firestore for a form that never gets saved.
      kioskBackdropId: form.kioskBackdrop.kind === 'kept' ? form.kioskBackdrop.id : null,
      // `buildEventPayload` writes `status` on every save, so an edit has to
      // carry the current one forward or it would quietly un-cancel the event.
      status: event?.status ?? 'scheduled',
    };

    setSaving(true);
    try {
      /*
       * The photograph first, so the event never points at pixels that are
       * not there: an upload that fails fails the whole save, loudly, rather
       * than saving an event whose kiosk would show nothing. Content-addressed
       * — a re-save of the same photo is a read, not a second copy.
       */
      if (form.kioskBackdrop.kind === 'new') {
        draft.kioskBackdropId = await putKioskBackdrop(form.kioskBackdrop.prepared, user.uid);
      }

      let eventId = event?.id ?? '';

      if (event) {
        // Editing a gathering the rules describe but nothing has been done
        // about yet: there is no document to update until this returns. The id
        // does not change, so nothing below has to know which it was.
        eventId = await ensureMaterialized(event);
        await updateEvent(eventId, draft, user.uid);
      } else {
        eventId = await createEvent(draft, user.uid);
      }

      show(event ? 'Event updated' : `${draft.title} scheduled`, { tone: 'success' });
      onSaved?.(eventId);
      onClose();
    } catch {
      show('Could not save this event. Try again.', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = (submitted: FormEvent<HTMLFormElement>) => {
    submitted.preventDefault();
    const { errors: found, times } = validateForm(form);
    setErrors(found);
    if (Object.keys(found).length > 0 || !times) {
      // The press has to land somewhere. See `ERROR_FIELDS` above.
      setRefusals((count) => count + 1);
      return;
    }
    void save(times);
  };

  const formId = `event-editor-${event?.id ?? 'new'}`;
  const summary = summariseErrors(errors, form.mode);

  // The gatherings a trip can borrow its regulars from. Only offered on a
  // one-off, so it costs nothing to compute for the other half of the form.
  const chains = gatheringOptions(events, series);
  // A chain whose last night is older than the loaded window is not in this
  // list, and dropping it on open would quietly unset the field on the next
  // save — so what was already chosen stays choosable.
  const chainOptions =
    form.predictFromChain && !chains.some((chain) => chain.key === form.predictFromChain)
      ? [...chains, { key: form.predictFromChain, title: 'The gathering already chosen' }]
      : chains;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEditing ? 'Edit event' : 'New event'}
      description={
        isEditing
          ? form.mode === 'recurring'
            ? 'The dates ahead follow the schedule; this changes them from here on.'
            : 'Changes apply to this gathering only.'
          : form.mode === 'recurring'
            ? 'Recurring gatherings predict their roster from their own past gatherings.'
            : 'A trip borrows its predicted roster from a gathering that repeats.'
      }
      size="lg"
      footer={
        // One child, so the summary can sit beside the buttons rather than
        // taking a share of their row. See `ACTION_BAR`. `sm:justify-end`
        // because the footer's own right alignment now lands on this wrapper
        // rather than on the buttons inside it.
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-4">
          {/*
            * Mounted whether or not there is anything to say, so that the
            * message *arriving* is a change inside a live region a screen
            * reader is already watching — a region that appears with its text
            * already in it is announced by roughly nobody. `sr-only` takes it
            * out of flow while it is empty, so it costs the footer no height
            * and the buttons sit exactly where they always did.
            */}
          <p
            role="status"
            className={cn(
              'min-w-0 text-xs font-medium leading-snug text-danger-400 sm:flex-1',
              !summary && 'sr-only',
            )}
          >
            {summary}
          </p>

          <div className={ACTION_BAR}>
            <Button variant="secondary" size="lg" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form={formId} size="lg" loading={saving}>
              {isEditing ? 'Save changes' : 'Schedule event'}
            </Button>
          </div>
        </div>
      }
    >
      {/*
        * Two columns of sections above `lg`, one below it.
        *
        * Stacked, this form is around a dozen controls — taller than a laptop
        * window, so scheduling a Friday night meant scrolling a form that had
        * room to spare on either side of it. Split, the whole thing lands on
        * one screen: what the gathering is on the left, how the roster behaves
        * on the right, and the save button in view the entire time.
        */}
      <form
        id={formId}
        ref={formRef}
        onSubmit={handleSubmit}
        className="grid gap-6 lg:grid-cols-2 lg:gap-x-0"
        noValidate
      >
        <Section title="The gathering" className="lg:pr-7">
          <TextField
            label="Title"
            value={form.title}
            onChange={(changed) => patch({ title: changed.target.value })}
            error={errors.title ?? null}
            autoCapitalize="words"
            autoComplete="off"
            required
          />

          {/*
            * The two fields that decide how this gathering reads on the screen
            * a counselor opens first, kept next to the title they belong with.
            *
            * Both optional, and deliberately not defaulted to something clever:
            * an icon guessed from the word "retreat" is right often enough to
            * be trusted and wrong often enough to be embarrassing.
            */}
          <IconPickerField
            value={form.icon || null}
            onChange={(icon) => patch({ icon: icon ?? '' })}
            hint="Shown wherever this gathering is listed."
          />

          <TextAreaField
            label="Description"
            value={form.description}
            onChange={(changed) => patch({ description: changed.target.value })}
            placeholder="Games, a talk and pizza. Bring a friend."
            rows={2}
            hint="A sentence for the people turning up. Shown on the check-in screen when this is today’s gathering."
          />

          <SelectField
            label="Type"
            value={form.mode}
            onChange={(changed) => handleModeChange(changed.target.value as EventMode)}
            hint={
              form.mode === 'recurring'
                ? 'Everyone active is on the roster, and its own past gatherings mark the regulars “Recent”.'
                : 'Happens once. Can borrow another gathering’s regulars, and limit its roster to the students who RSVP’d.'
            }
          >
            <option value="recurring">Recurring</option>
            <option value="oneoff">One-off — retreat, outing</option>
          </SelectField>

          {/*
            * There was a "Series" picker here, and it is gone.
            *
            * It listed the `eventSeries` documents, and nothing in the app has
            * ever created one — `scripts/seed.ts` is the only writer in the
            * repository. So in any real deployment it offered exactly one
            * choice, "Not part of one", forever: a control that could not be
            * used, sat between Type and the dates, on the form a leader fills in
            * most often.
            *
            * Nothing was lost with it, because the thing it looked like it
            * governed was already governed elsewhere. Prediction groups history
            * by the repeat chain, and `chainKey` falls through to
            * `recurrenceRootId` — so a weekly gathering scheduled here predicts
            * from its own past nights with no series document anywhere near it.
            * See the note on `gatheringOptions` in `lib/gatherings.ts`, which was
            * rewritten to read events rather than series for the same reason.
            *
            * What a series still did was join two separately-created gatherings
            * into one shared history. That is a real capability and this gives it
            * up knowingly: it was unreachable without a database console, and an
            * empty picker is not a feature.
            *
            * `form.seriesId` outlives the control on purpose. `EventsPage`'s
            * quick actions still open this form with one in `defaults`, and an
            * event that already carries one — every seeded Friday — must keep it
            * through an edit, for the reason spelled out over `recurrenceRootId`
            * in `save` above.
            */}

          {/*
            * "Next start" rather than "Starts", for a recurring gathering.
            *
            * The dates on a repeating event are the *coming* one, not the one it
            * began at: every instance already held is its own document with the
            * times it actually ran. Saying "next" is what makes an edit legible —
            * moving a Friday night to 19:30 moves the Fridays still ahead, and
            * leaves the attendance history alone.
            */}
          <div className="grid grid-cols-1 gap-4 @min-[26rem]:grid-cols-2 pointer-fine:gap-3">
            <TextField
              label={form.mode === 'recurring' ? 'Next start' : 'Starts'}
              type="datetime-local"
              value={form.start}
              onChange={(changed) => handleStartChange(changed.target.value)}
              error={errors.start ?? null}
              required
            />
            <TextField
              label={form.mode === 'recurring' ? 'Next end' : 'Ends'}
              type="datetime-local"
              value={form.end}
              onChange={(changed) => handleEndChange(changed.target.value)}
              error={errors.end ?? null}
              required
            />
            {form.mode === 'recurring' ? (
              // Spanning both dates rather than hanging off one of them: it is
              // a fact about the pair, and hung off "Next start" alone it wraps
              // to two lines and leaves the column ragged.
              <p className="text-xs leading-snug text-ink-500 @min-[26rem]:col-span-2">
                The upcoming gathering. Instances already held keep the times they ran at.
              </p>
            ) : null}
          </div>

          {/* Below the date on purpose: every option here is phrased from it. */}
          {form.mode === 'recurring' ? (
            <RecurrenceField
              anchor={parseLocal(form.start)}
              value={form.recurrence}
              onChange={(recurrence) => patch({ recurrence })}
              error={errors.recurrence ?? null}
            />
          ) : null}
        </Section>

        <Section title="Roster & details" className="lg:border-l lg:border-ink-800 lg:pl-7">
          <CheckInWindowField
            opens={form.checkInOpens}
            closes={form.checkInCloses}
            start={form.start}
            pinned={form.opensPinned || form.closesPinned}
            errors={errors}
            onOpensChange={(value) => patch({ checkInOpens: value, opensPinned: true })}
            onClosesChange={(value) => patch({ checkInCloses: value, closesPinned: true })}
          />

          {/*
            * Where a trip gets a predicted roster, and the reason the series
            * picker on the left is *not* about prediction.
            *
            * A one-off has no past of its own — it happens once — so on its own
            * it opens on the whole ministry and the "Recent" filter has nothing
            * to say. But a retreat is largely the Friday night crowd, and a
            * leader knows which crowd. Naming that gathering here is what makes
            * the filter mean something at the door of a coach.
            */}
          {form.mode === 'oneoff' ? (
            <>
              <SelectField
                label="Predicted roster"
                value={form.predictFromChain}
                onChange={(changed) => patch({ predictFromChain: changed.target.value })}
                hint={
                  form.predictFromChain
                    ? 'Its regulars are marked “Recent” here. Everybody else is still on the roster.'
                    : 'A trip has no past of its own. Borrow a gathering’s regulars and “Recent” still means something.'
                }
              >
                <option value="">No prediction — the whole roster</option>
                {chainOptions.map((chain) => (
                  <option key={chain.key} value={chain.key}>
                    {chain.title}
                  </option>
                ))}
              </SelectField>

              {/* Who may be on the coach at all, which the prediction above
                  never decides — see `isEligible`. */}
              <CheckboxField
                label="Limit the roster to students who RSVP’d"
                hint="Nobody else appears at check-in, so the trip list stays closed."
                checked={form.requiresRsvp}
                onChange={(changed) => patch({ requiresRsvp: changed.target.checked })}
              />
            </>
          ) : null}

          {/* Outside the one-off block, and deliberately not reset by a mode
              change: a room children are collected from is most often the one
              that repeats every Sunday. */}
          <CheckboxField
            label="Track check-out"
            hint="Volunteers record when each child is collected, and the roster shows a live room count."
            checked={form.requiresCheckOut}
            onChange={(changed) => patch({ requiresCheckOut: changed.target.checked })}
          />

          {/* Beside "Track check-out" and for the same reason: the gathering that
              wants a name on the child is the gathering that hands them back, and
              that is the one that repeats every Sunday.

              Recurring only for now. A one-off's labels are the next piece of
              work — the field is hidden rather than disabled because a trip has
              no use for one yet and an explanation nobody needs is clutter. */}
          {form.mode === 'recurring' ? (
            <LabelTemplateField
              value={form.labelTemplate}
              onChange={(labelTemplate) => patch({ labelTemplate })}
            />
          ) : null}

          {/* Beside the label template because both are about the screen in the
              lobby rather than about the phone at the door, and unlike the
              template this one is offered on a one-off too. */}
          <KioskThemeField
            value={form.kioskTheme}
            onChange={(kioskTheme) => patch({ kioskTheme })}
          />

          {/* Beside the colours because they are one decision about one
              screen — and so the photo's preview can wear the theme being
              picked above it, live. */}
          <KioskBackdropField
            value={form.kioskBackdrop}
            theme={form.kioskTheme}
            onChange={(kioskBackdrop) => patch({ kioskBackdrop })}
          />

          <TextField
            label="Location"
            value={form.location}
            onChange={(changed) => patch({ location: changed.target.value })}
            placeholder="Youth room"
            autoComplete="off"
          />

          {/* Notes are for the other leaders; the description above is for the
              people turning up. Saying so is cheaper than watching the two
              fields slowly become copies of each other. */}
          <TextAreaField
            label="Notes"
            value={form.notes}
            onChange={(changed) => patch({ notes: changed.target.value })}
            placeholder="Meet at the church car park at 5:45…"
            hint="For the core team. Only shown on the event page."
          />
        </Section>
      </form>
    </Modal>
  );
}
