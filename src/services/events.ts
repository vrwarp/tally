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
  startAt: Date;
  endAt: Date;
  checkInOpensAt: Date;
  checkInClosesAt: Date;
  location?: string | null;
  notes?: string | null;
  requiresRsvp?: boolean;
  requiresWaiver?: boolean;
  requiresPayment?: boolean;
  feeCents?: number | null;
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
    startAt: draft.startAt,
    endAt: draft.endAt,
    checkInOpensAt: draft.checkInOpensAt,
    checkInClosesAt: draft.checkInClosesAt,
    location: draft.location?.trim() || null,
    notes: draft.notes?.trim() || null,
    requiresRsvp: draft.requiresRsvp ?? draft.mode === 'oneoff',
    requiresWaiver: draft.requiresWaiver ?? false,
    requiresPayment: draft.requiresPayment ?? false,
    feeCents: draft.feeCents ?? null,
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
