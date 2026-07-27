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
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { paths } from '@/lib/paths';
import { chainKey } from '@/lib/materialize';
import { normalizeRecurrence } from '@/lib/recurrence';
import { toEvent, toEventSeries, toSettings } from '@/services/converters';
import { materializeOccurrence } from '@/services/functions';
import type {
  AppSettings,
  EventMode,
  EventSeries,
  EventStatus,
  RecurrenceRule,
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
 * Makes sure a gathering has a document behind it, and hands back its id.
 *
 * A no-op for anything that came out of Firestore, which is the overwhelmingly
 * common case and must not cost a round trip. For a projected gathering — one
 * the recurrence rules describe that nothing has been done about yet — this is
 * the moment it becomes real.
 *
 * The write is a callable rather than a Firestore write for a reason the
 * security rules cannot express: check-in belongs to counselors and `events` is
 * core-team-writable, and rules have no loops, so they cannot check that a date
 * is genuinely an occurrence of a rule. The server derives the id and every
 * field from the chain's own template and refuses anything its projection does
 * not recognise, which is what makes it safe for any active member to ask.
 *
 * The id never changes: it was derived from the chain and the date before the
 * document existed, so whatever the caller was already showing keeps working
 * and nothing has to be re-resolved afterwards.
 */
export async function ensureMaterialized(event: TallyEvent): Promise<string> {
  if (event.materialized) return event.id;

  const { data } = await materializeOccurrence({
    chain: chainKey(event),
    startAt: event.startAt.getTime(),
  });

  return data.id;
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
