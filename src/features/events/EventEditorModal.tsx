/**
 * Create or edit one event.
 *
 * Two things here are load-bearing. The check-in window, because an event whose
 * window does not cover it is invisible to temporal awareness — a counselor
 * would open Tally at the door and be told there is nothing on. And the one-off
 * accountability switches, because they are what turns a retreat roster into an
 * RSVP list with waiver and payment warnings (Journey 4).
 *
 * The form keeps its own string state rather than editing dates in place:
 * `<input type="datetime-local">` speaks strings, and a half-typed date must not
 * be able to produce an `Invalid Date` mid-keystroke.
 */
import { useEffect, useState, type FormEvent } from 'react';
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
import { RecurrenceField } from '@/features/events/RecurrenceField';
import { defaultRecurrence, retimeRecurrence, validateRecurrence } from '@/lib/recurrence';
import {
  addMinutes,
  fromDateTimeLocalValue,
  nextSeriesOccurrence,
  toDateTimeLocalValue,
} from '@/lib/time';
import { createEvent, updateEvent, type EventDraft } from '@/services/events';
import type { EventMode, RecurrenceRule, RosterGroupingMode, TallyEvent } from '@/types';

/** House defaults for the check-in window, in minutes around the event. */
const OPENS_BEFORE_MIN = 60;
const CLOSES_AFTER_MIN = 60;

interface EditorForm {
  title: string;
  mode: EventMode;
  seriesId: string;
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
  requiresWaiver: boolean;
  requiresPayment: boolean;
  /** Dollars, as typed. Converted to `feeCents` on submit. */
  fee: string;
  defaultGroupingMode: RosterGroupingMode;
  /**
   * A window left at the standard hour follows the event when its times move;
   * one somebody hand-tuned is pinned and never rewritten underneath them.
   */
  opensPinned: boolean;
  closesPinned: boolean;
}

type EditorErrors = Partial<
  Record<
    'title' | 'start' | 'end' | 'checkInOpens' | 'checkInCloses' | 'fee' | 'recurrence',
    string
  >
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

/** `"25"` / `"$25.00"` -> `2500`. Null when the text is not an amount. */
function dollarsToCents(value: string): number | null {
  const trimmed = value.replace(/[$,\s]/g, '');
  if (!trimmed) return null;
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
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
  const feeCents = event?.feeCents ?? defaults?.feeCents ?? null;

  // Weekly on the day it starts, unless something more specific is known. That
  // is what almost every gathering here is, and it is the only honest default
  // now that "Recurring" means the event repeats: there is no rule to inherit
  // from an event scheduled before this field existed, and leaving the control
  // blank would just be a required field nobody was asked to fill in.
  const recurrence: RecurrenceRule =
    event?.recurrence ?? defaults?.recurrence ?? defaultRecurrence(startAt);

  return {
    title: event?.title ?? defaults?.title ?? '',
    mode,
    seriesId: event?.seriesId ?? defaults?.seriesId ?? '',
    recurrence,
    start: toDateTimeLocalValue(startAt),
    end: toDateTimeLocalValue(endAt),
    checkInOpens: toDateTimeLocalValue(opensAt),
    checkInCloses: toDateTimeLocalValue(closesAt),
    location: event?.location ?? defaults?.location ?? '',
    notes: event?.notes ?? defaults?.notes ?? '',
    requiresRsvp: event?.requiresRsvp ?? defaults?.requiresRsvp ?? mode === 'oneoff',
    requiresWaiver: event?.requiresWaiver ?? defaults?.requiresWaiver ?? false,
    requiresPayment: event?.requiresPayment ?? defaults?.requiresPayment ?? false,
    fee: feeCents === null ? '' : (feeCents / 100).toFixed(2),
    defaultGroupingMode: event?.defaultGroupingMode ?? defaults?.defaultGroupingMode ?? 'all',
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

  if (form.mode === 'oneoff' && form.requiresPayment && dollarsToCents(form.fee) === null) {
    errors.fee = 'Enter the amount, or turn payment tracking off.';
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
  const { series } = useData();
  const { user } = useAuth();
  const { show } = useToast();

  const isEditing = Boolean(event);
  const [form, setForm] = useState<EditorForm>(() => buildForm(event ?? null, defaults, new Date()));
  const [errors, setErrors] = useState<EditorErrors>({});
  const [saving, setSaving] = useState(false);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, seedKey]);

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
      // A retreat is an RSVP list by default. Going back to recurring disarms
      // the switches entirely rather than leaving a waiver requirement on a
      // Friday night, where it would flag every student at the door.
      seriesId: mode === 'recurring' ? current.seriesId : '',
      requiresRsvp: mode === 'oneoff',
      requiresWaiver: mode === 'oneoff' && current.requiresWaiver,
      requiresPayment: mode === 'oneoff' && current.requiresPayment,
      fee: mode === 'oneoff' ? current.fee : '',
    }));
  };

  const handleSeriesChange = (seriesId: string) => {
    const picked = series.find((candidate) => candidate.id === seriesId) ?? null;

    setForm((current) => {
      // Editing an existing Friday must not silently move it to next Friday.
      if (!picked || isEditing) return { ...current, seriesId };

      const occurrence = nextSeriesOccurrence(picked, new Date());
      return {
        ...current,
        seriesId,
        title: picked.title,
        // The series *is* a weekly pattern — that is what `dayOfWeek` means —
        // so picking one fills the rule in rather than making somebody restate
        // it directly underneath.
        recurrence: {
          frequency: 'weekly',
          interval: 1,
          weekdays: [picked.dayOfWeek],
          monthlyMode: 'dayOfMonth',
          until: null,
          count: null,
        },
        start: toDateTimeLocalValue(occurrence.startAt),
        end: toDateTimeLocalValue(occurrence.endAt),
        checkInOpens: toDateTimeLocalValue(occurrence.checkInOpensAt),
        checkInCloses: toDateTimeLocalValue(occurrence.checkInClosesAt),
        defaultGroupingMode: picked.defaultGroupingMode,
        opensPinned: picked.checkInOpensMinutesBefore !== OPENS_BEFORE_MIN,
        closesPinned: picked.checkInClosesMinutesAfter !== CLOSES_AFTER_MIN,
      };
    });
  };

  const save = async (times: ParsedTimes) => {
    if (!user) return;

    const draft: EventDraft = {
      title: form.title.trim(),
      mode: form.mode,
      seriesId: form.mode === 'recurring' ? form.seriesId || null : null,
      recurrence: form.mode === 'recurring' ? form.recurrence : null,
      startAt: times.startAt,
      endAt: times.endAt,
      checkInOpensAt: times.checkInOpensAt,
      checkInClosesAt: times.checkInClosesAt,
      location: form.location.trim() || null,
      notes: form.notes.trim() || null,
      requiresRsvp: form.mode === 'oneoff' && form.requiresRsvp,
      requiresWaiver: form.mode === 'oneoff' && form.requiresWaiver,
      requiresPayment: form.mode === 'oneoff' && form.requiresPayment,
      feeCents:
        form.mode === 'oneoff' && form.requiresPayment ? dollarsToCents(form.fee) : null,
      defaultGroupingMode: form.defaultGroupingMode,
      // `buildEventPayload` writes `status` on every save, so an edit has to
      // carry the current one forward or it would quietly un-cancel the event.
      status: event?.status ?? 'scheduled',
    };

    setSaving(true);
    try {
      let eventId = event?.id ?? '';
      if (event) await updateEvent(event.id, draft, user.uid);
      else eventId = await createEvent(draft, user.uid);
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
    if (Object.keys(found).length > 0 || !times) return;
    void save(times);
  };

  const formId = `event-editor-${event?.id ?? 'new'}`;

  // An inactive series stays selectable while it is the one already on the
  // event, otherwise editing would silently detach it from its history.
  const seriesOptions = series.filter(
    (candidate) => candidate.active || candidate.id === form.seriesId,
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEditing ? 'Edit event' : 'New event'}
      description={
        isEditing
          ? form.mode === 'recurring'
            ? 'Changes apply to the upcoming gathering and the ones after it.'
            : 'Changes apply to this gathering only.'
          : 'Recurring gatherings predict their roster from past instances.'
      }
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" size="lg" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} size="lg" className="flex-[2]" loading={saving}>
            {isEditing ? 'Save changes' : 'Schedule event'}
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <TextField
          label="Title"
          value={form.title}
          onChange={(changed) => patch({ title: changed.target.value })}
          error={errors.title ?? null}
          autoCapitalize="words"
          autoComplete="off"
          required
        />

        <SelectField
          label="Type"
          value={form.mode}
          onChange={(changed) => handleModeChange(changed.target.value as EventMode)}
          hint={
            form.mode === 'recurring'
              ? 'Everyone active is on the roster, with a predicted “Recent” block on top.'
              : 'Only students who RSVP’d are on the roster, with waiver and payment warnings.'
          }
        >
          <option value="recurring">Recurring</option>
          <option value="oneoff">One-off — retreat, outing</option>
        </SelectField>

        {form.mode === 'recurring' ? (
          <SelectField
            label="Series"
            value={form.seriesId}
            onChange={(changed) => handleSeriesChange(changed.target.value)}
            hint="The series decides which past gatherings predict this roster."
          >
            <option value="">No series — no predicted roster</option>
            {seriesOptions.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.title}
              </option>
            ))}
          </SelectField>
        ) : null}

        {/*
          * "Next start" rather than "Starts", for a recurring gathering.
          *
          * The dates on a repeating event are the *coming* one, not the one it
          * began at: every instance already held is its own document with the
          * times it actually ran. Saying "next" is what makes an edit legible —
          * moving a Friday night to 19:30 moves the Fridays still ahead, and
          * leaves the attendance history alone.
          */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        </div>

        {form.mode === 'recurring' ? (
          <>
            <p className="-mt-2 text-xs text-ink-500">
              The upcoming gathering. Instances already held keep the times they ran at.
            </p>

            {/* Below the date on purpose: every option here is phrased from it. */}
            <RecurrenceField
              anchor={parseLocal(form.start)}
              value={form.recurrence}
              onChange={(recurrence) => patch({ recurrence })}
              error={errors.recurrence ?? null}
            />
          </>
        ) : null}

        <fieldset className="flex flex-col gap-4 rounded-xl bg-ink-950/40 p-3 ring-1 ring-ink-800">
          <legend className="px-1 text-xs font-bold uppercase tracking-wider text-ink-400">
            Check-in window
          </legend>
          <p className="text-xs text-ink-500">
            Tally opens this event automatically while the window is open. It defaults to an hour
            either side.
          </p>
          <TextField
            label="Opens"
            type="datetime-local"
            value={form.checkInOpens}
            onChange={(changed) => patch({ checkInOpens: changed.target.value, opensPinned: true })}
            error={errors.checkInOpens ?? null}
          />
          <TextField
            label="Closes"
            type="datetime-local"
            value={form.checkInCloses}
            onChange={(changed) =>
              patch({ checkInCloses: changed.target.value, closesPinned: true })
            }
            error={errors.checkInCloses ?? null}
          />
        </fieldset>

        <TextField
          label="Location"
          value={form.location}
          onChange={(changed) => patch({ location: changed.target.value })}
          placeholder="Youth room"
          autoComplete="off"
        />

        <SelectField
          label="Roster opens on"
          value={form.defaultGroupingMode}
          onChange={(changed) =>
            patch({ defaultGroupingMode: changed.target.value as RosterGroupingMode })
          }
          hint="“Split by small group” is what makes Sunday School open on a counselor’s own group instead of the whole ministry."
        >
          <option value="all">One flat roster</option>
          <option value="smallGroup">Split by small group</option>
        </SelectField>

        {form.mode === 'oneoff' ? (
          <fieldset className="flex flex-col gap-3 rounded-xl bg-ink-950/40 p-3 ring-1 ring-ink-800">
            <legend className="px-1 text-xs font-bold uppercase tracking-wider text-ink-400">
              Accountability
            </legend>

            <CheckboxField
              label="Limit the roster to students who RSVP’d"
              hint="Nobody else appears at check-in, so the bus list stays closed."
              checked={form.requiresRsvp}
              onChange={(changed) => patch({ requiresRsvp: changed.target.checked })}
            />
            <CheckboxField
              label="Requires a signed waiver"
              hint="Students without one are flagged red at check-in."
              checked={form.requiresWaiver}
              onChange={(changed) => patch({ requiresWaiver: changed.target.checked })}
            />
            <CheckboxField
              label="Requires payment"
              checked={form.requiresPayment}
              onChange={(changed) => patch({ requiresPayment: changed.target.checked })}
            />

            {form.requiresPayment ? (
              <TextField
                label="Fee per student"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={form.fee}
                onChange={(changed) => patch({ fee: changed.target.value })}
                error={errors.fee ?? null}
                hint="Dollars. Used to total up what is still outstanding."
              />
            ) : null}
          </fieldset>
        ) : null}

        <TextAreaField
          label="Notes"
          value={form.notes}
          onChange={(changed) => patch({ notes: changed.target.value })}
          placeholder="Bring a jacket, meet at the church car park…"
        />
      </form>
    </Modal>
  );
}
