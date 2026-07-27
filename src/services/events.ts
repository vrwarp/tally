/**
 * Event, series and settings reads/writes.
 */
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { paths } from '@/lib/paths';
import { type OccurrenceDraft } from '@/lib/materialize';
import { normalizeRecurrence } from '@/lib/recurrence';
import { toEvent, toEventSeries, toSettings, toSmallGroup } from '@/services/converters';
import type {
  AppSettings,
  EventMode,
  EventSeries,
  EventStatus,
  RecurrenceRule,
  RosterGroupingMode,
  SmallGroup,
  TallyEvent,
} from '@/types';

export interface EventDraft {
  title: string;
  mode: EventMode;
  seriesId?: string | null;
  /** How it repeats. `startAt`/`endAt` are the next occurrence, not the first. */
  recurrence?: RecurrenceRule | null;
  /** Identity of the chain of repeats. Null on the event that started it. */
  recurrenceRootId?: string | null;
  startAt: Date;
  endAt: Date;
  checkInOpensAt: Date;
  checkInClosesAt: Date;
  location?: string | null;
  notes?: string | null;
  requiresRsvp?: boolean;
  defaultGroupingMode?: RosterGroupingMode;
  status?: EventStatus;
}

/**
 * Live event stream, newest first.
 *
 * The window is bounded rather than unbounded: the check-in screen needs only
 * enough history to run the predictive roster (a handful of past instances per
 * series) plus anything upcoming, so `sinceDaysAgo` keeps the payload small as
 * the ministry accumulates years of Fridays.
 */
export function subscribeEvents(
  onChange: (events: TallyEvent[]) => void,
  options: { sinceDaysAgo?: number } = {},
  onError?: (error: Error) => void,
): Unsubscribe {
  const since = new Date();
  since.setDate(since.getDate() - (options.sinceDaysAgo ?? 120));
  since.setHours(0, 0, 0, 0);

  const q = query(
    collection(db, paths.events()),
    where('startAt', '>=', since),
    orderBy('startAt', 'desc'),
  );

  return onSnapshot(
    q,
    (snapshot) => onChange(snapshot.docs.map(toEvent)),
    (error) => onError?.(error),
  );
}

export function subscribeEvent(
  eventId: string,
  onChange: (event: TallyEvent | null) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, paths.event(eventId)),
    (snapshot) => onChange(snapshot.exists() ? toEvent(snapshot) : null),
    (error) => onError?.(error),
  );
}

export function subscribeEventSeries(
  onChange: (series: EventSeries[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(db, paths.eventSeries()), orderBy('order')),
    (snapshot) => onChange(snapshot.docs.map(toEventSeries)),
    (error) => onError?.(error),
  );
}

export function subscribeSmallGroups(
  onChange: (groups: SmallGroup[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(db, paths.smallGroups()), orderBy('order')),
    (snapshot) => onChange(snapshot.docs.map(toSmallGroup)),
    (error) => onError?.(error),
  );
}

export function subscribeSettings(
  onChange: (settings: AppSettings) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, paths.settings()),
    (snapshot) => onChange(toSettings(snapshot)),
    (error) => onError?.(error),
  );
}

function buildEventPayload(draft: EventDraft, uid: string, isNew: boolean) {
  const payload: Record<string, unknown> = {
    title: draft.title.trim(),
    mode: draft.mode,
    seriesId: draft.mode === 'recurring' ? (draft.seriesId ?? null) : null,
    // A retreat happens once. Nulling it here rather than trusting the caller
    // keeps a mode switch in the editor from leaving a weekly rule behind on
    // something that will never run again.
    recurrence:
      draft.mode === 'recurring' && draft.recurrence
        ? normalizeRecurrence(draft.recurrence, draft.startAt)
        : null,
    recurrenceRootId: draft.mode === 'recurring' ? (draft.recurrenceRootId ?? null) : null,
    startAt: draft.startAt,
    endAt: draft.endAt,
    checkInOpensAt: draft.checkInOpensAt,
    checkInClosesAt: draft.checkInClosesAt,
    location: draft.location?.trim() || null,
    notes: draft.notes?.trim() || null,
    requiresRsvp: draft.requiresRsvp ?? draft.mode === 'oneoff',
    defaultGroupingMode: draft.defaultGroupingMode ?? 'all',
    status: draft.status ?? 'scheduled',
    updatedAt: serverTimestamp(),
  };

  if (isNew) {
    payload.createdAt = serverTimestamp();
    payload.createdBy = uid;
  } else {
    payload.updatedBy = uid;
  }

  return payload;
}

export async function createEvent(draft: EventDraft, uid: string): Promise<string> {
  const ref = doc(collection(db, paths.events()));
  await setDoc(ref, buildEventPayload(draft, uid, true));
  return ref.id;
}

export async function updateEvent(
  eventId: string,
  draft: EventDraft,
  uid: string,
): Promise<void> {
  await updateDoc(doc(db, paths.event(eventId)), buildEventPayload(draft, uid, false));
}

/**
 * Writes down occurrences the recurrence rules say ought to exist.
 *
 * Two things make this safe to run on any app open.
 *
 * The id is derived from the chain and the date, so two leaders topping the
 * horizon up at the same moment address the same document rather than creating
 * two gatherings for one Friday.
 *
 * And each write is a transaction that gives up if the document already exists.
 * Deterministic ids alone would converge, but a plain `setDoc` would also
 * happily overwrite next Friday's 19:30 start — the one somebody moved on
 * purpose — with the 19:00 the template still says. Existing means finished,
 * whatever state it is in.
 *
 * Returns how many were actually created. A permission error is swallowed per
 * occurrence: a counselor's app calling this is not a failure worth surfacing,
 * it is simply not their job.
 */
export async function materializeOccurrences(
  drafts: readonly OccurrenceDraft[],
  uid: string,
): Promise<number> {
  let created = 0;

  for (const draft of drafts) {
    const { source } = draft;
    const ref = doc(db, paths.event(draft.id));

    try {
      const wrote = await runTransaction(db, async (transaction) => {
        if ((await transaction.get(ref)).exists()) return false;

        transaction.set(
          ref,
          buildEventPayload(
            {
              title: source.title,
              mode: 'recurring',
              seriesId: source.seriesId,
              recurrence: source.recurrence,
              // The chain's root, resolved once here so every instance after
              // the first carries the same one.
              recurrenceRootId: source.recurrenceRootId ?? source.id,
              startAt: draft.startAt,
              endAt: draft.endAt,
              checkInOpensAt: draft.checkInOpensAt,
              checkInClosesAt: draft.checkInClosesAt,
              location: source.location,
              notes: source.notes,
              defaultGroupingMode: source.defaultGroupingMode,
              status: 'scheduled',
            },
            uid,
            true,
          ),
        );
        return true;
      });

      if (wrote) created += 1;
    } catch {
      // Offline, or not authorised. Both are states the next top-up fixes.
    }
  }

  return created;
}

export async function setEventStatus(
  eventId: string,
  status: EventStatus,
  uid: string,
): Promise<void> {
  await updateDoc(doc(db, paths.event(eventId)), {
    status,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

/**
 * Hard delete. Only offered for events with no attendance yet — the UI checks
 * first, and cancelling is the reversible option everywhere else.
 */
export async function deleteEvent(eventId: string): Promise<void> {
  await deleteDoc(doc(db, paths.event(eventId)));
}

export async function saveSettings(
  settings: Pick<
    AppSettings,
    | 'predictiveMinAttended'
    | 'predictiveOfLastN'
    | 'miaConsecutiveMisses'
    | 'newVisitorWindowDays'
  >,
  uid: string,
): Promise<void> {
  await setDoc(
    doc(db, paths.settings()),
    { ...settings, updatedAt: serverTimestamp(), updatedBy: uid },
    { merge: true },
  );
}
