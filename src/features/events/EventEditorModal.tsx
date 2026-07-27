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
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
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
import { RecurrenceField } from '@/features/events/RecurrenceField';
import { defaultRecurrence, retimeRecurrence, validateRecurrence } from '@/lib/recurrence';
import { cn } from '@/lib/utils';
import {
  addMinutes,
  fromDateTimeLocalValue,
  nextSeriesOccurrence,
  toDateTimeLocalValue,
} from '@/lib/time';
import {
  createEvent,
  reconcileChainSchedule,
  updateEvent,
  type EventDraft,
} from '@/services/events';
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
  defaultGroupingMode: RosterGroupingMode;
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
      // A retreat is an RSVP list by default. Going back to recurring disarms it
      // rather than leaving a closed roster on a Friday night, where it would
      // hide every student who had not been added to a list nobody built.
      seriesId: mode === 'recurring' ? current.seriesId : '',
      requiresRsvp: mode === 'oneoff',
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
      defaultGroupingMode: form.defaultGroupingMode,
      // `buildEventPayload` writes `status` on every save, so an edit has to
      // carry the current one forward or it would quietly un-cancel the event.
      status: event?.status ?? 'scheduled',
    };

    setSaving(true);
    try {
      let eventId = event?.id ?? '';
      let dropped = 0;

      if (event) {
        await updateEvent(event.id, draft, user.uid);
        // The gatherings after this one were written down under the old
        // schedule. Saving the rule is only half of changing it.
        dropped = await reconcileChainSchedule({
          events,
          previous: event,
          draft,
          uid: user.uid,
        });
      } else {
        eventId = await createEvent(draft, user.uid);
      }

      show(
        event
          ? dropped > 0
            ? `Event updated · ${dropped} later ${dropped === 1 ? 'gathering' : 'gatherings'} rescheduled`
            : 'Event updated'
          : `${draft.title} scheduled`,
        { tone: 'success' },
      );
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
            ? 'Changing the schedule rewrites the gatherings after this one.'
            : 'Changes apply to this gathering only.'
          : 'Recurring gatherings predict their roster from past instances.'
      }
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} size="lg" loading={saving}>
            {isEditing ? 'Save changes' : 'Schedule event'}
          </Button>
        </>
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

          <SelectField
            label="Type"
            value={form.mode}
            onChange={(changed) => handleModeChange(changed.target.value as EventMode)}
            hint={
              form.mode === 'recurring'
                ? 'Everyone active is on the roster, with a predicted “Recent” block on top.'
                : 'Happens once, never predicts, and can limit its roster to the students who RSVP’d.'
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
            <CheckboxField
              label="Limit the roster to students who RSVP’d"
              hint="Nobody else appears at check-in, so the trip list stays closed."
              checked={form.requiresRsvp}
              onChange={(changed) => patch({ requiresRsvp: changed.target.checked })}
            />
          ) : null}

          <TextField
            label="Location"
            value={form.location}
            onChange={(changed) => patch({ location: changed.target.value })}
            placeholder="Youth room"
            autoComplete="off"
          />

          <TextAreaField
            label="Notes"
            value={form.notes}
            onChange={(changed) => patch({ notes: changed.target.value })}
            placeholder="Bring a jacket, meet at the church car park…"
          />
        </Section>
      </form>
    </Modal>
  );
}
