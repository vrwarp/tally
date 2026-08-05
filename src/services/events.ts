/**
 * Event, series and settings reads/writes.
 */
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { paths } from '@/lib/paths';
import { findEventIcon } from '@/lib/eventIcons';
import { sanitizeLabelTemplate, type LabelTemplate } from '@/lib/labelTemplate';
import { chainKey } from '@/lib/materialize';
import { normalizeRecurrence } from '@/lib/recurrence';
import { toEvent, toEventSeries, toSettings } from '@/services/converters';
import {
  deleteEvents as deleteEventsCallable,
  materializeOccurrence,
  type DeletionSummary,
  type DeletionTarget,
} from '@/services/functions';
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
  /** What the gathering is, in a sentence. Shown on the hero card. */
  description?: string | null;
  /** A Material Symbols name from `lib/eventIcons`. */
  icon?: string | null;
  mode: EventMode;
  seriesId?: string | null;
  /** How it repeats. `startAt`/`endAt` are the next occurrence, not the first. */
  recurrence?: RecurrenceRule | null;
  /** Identity of the chain of repeats. Null on the event that started it. */
  recurrenceRootId?: string | null;
  /** A `chainKey` whose regulars seed a one-off's prediction. */
  predictFromChain?: string | null;
  startAt: Date;
  endAt: Date;
  checkInOpensAt: Date;
  checkInClosesAt: Date;
  location?: string | null;
  notes?: string | null;
  requiresRsvp?: boolean;
  requiresCheckOut?: boolean;
  labelTemplate?: LabelTemplate | null;
  status?: EventStatus;
}

/**
 * Live event stream, newest first.
 *
 * The window is bounded rather than unbounded: the check-in screen needs only
 * enough history to run the predictive roster (a handful of past instances per
 * series) plus anything upcoming, so `sinceDaysAgo` keeps the payload small as
 * the ministry accumulates years of Fridays.
 *
 * The default is the year the roster counts participation over, matching
 * `EVENT_WINDOW_DAYS` in `DataProvider` — the one caller that sets it — so a
 * caller that says nothing gets the same calendar every screen is reading.
 */
export function subscribeEvents(
  onChange: (events: TallyEvent[]) => void,
  options: { sinceDaysAgo?: number } = {},
  onError?: (error: Error) => void,
): Unsubscribe {
  const since = new Date();
  since.setDate(since.getDate() - (options.sinceDaysAgo ?? 365));
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

/**
 * How many past gatherings one page of the history list holds.
 *
 * Enough to fill a phone screen and a bit more, so the first scroll gesture
 * lands on real content rather than on a spinner. Small enough that each page
 * is a handful of reads: the screen that uses this also asks for the attendance
 * of everything it has loaded, and a page of fifty would be fifty collection
 * reads on a hallway connection.
 */
export const PAST_EVENTS_PAGE_SIZE = 12;

/**
 * The cursor a caller hands back to ask for the next page.
 *
 * The raw Firestore snapshot rather than a date, because two gatherings can
 * start at the same instant — a Friday and a Sunday-school class scheduled for
 * one holiday morning — and a date cursor would either repeat one of them or
 * skip it. Opaque on purpose: nothing outside this module should read it.
 */
export type PastEventsCursor = QueryDocumentSnapshot<DocumentData>;

export interface PastEventsPage {
  events: TallyEvent[];
  /** Null once the collection is exhausted. */
  cursor: PastEventsCursor | null;
  /** False when this page was the last one. */
  hasMore: boolean;
}

/**
 * One page of gatherings that have already happened, newest first.
 *
 * A one-shot read rather than a listener, and deliberately outside the window
 * `subscribeEvents` keeps live. History does not change while somebody scrolls
 * it, and the whole point of paging into the past is to reach further back than
 * the app is willing to hold open in memory.
 *
 * Everything here is a document by construction: the projection only ever
 * offers gatherings the rules describe that have *not* finished, so a night in
 * the past is on the calendar exactly when somebody did something about it.
 */
export async function fetchPastEvents(
  before: Date,
  cursor: PastEventsCursor | null = null,
  pageSize: number = PAST_EVENTS_PAGE_SIZE,
): Promise<PastEventsPage> {
  const constraints = [
    where('startAt', '<', before),
    orderBy('startAt', 'desc'),
    ...(cursor ? [startAfter(cursor)] : []),
    limit(pageSize),
  ];

  const snapshot = await getDocs(query(collection(db, paths.events()), ...constraints));
  const last = snapshot.docs.at(-1) ?? null;

  return {
    events: snapshot.docs.map(toEvent),
    // A short page means the end of the collection, so the cursor is dropped
    // with it — holding one would invite a request that can only come back empty.
    cursor: snapshot.docs.length === pageSize ? last : null,
    hasMore: snapshot.docs.length === pageSize,
  };
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
    description: draft.description?.trim() || null,
    // Only a name the app actually ships is written: a stale cached bundle
    // must not be able to put an icon on an event that nothing can draw.
    icon: findEventIcon(draft.icon)?.name ?? null,
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
    // The mirror image: a borrowed prediction belongs to a gathering that has
    // no history of its own, so switching a trip back to recurring drops it.
    predictFromChain: draft.mode === 'oneoff' ? (draft.predictFromChain ?? null) : null,
    startAt: draft.startAt,
    endAt: draft.endAt,
    checkInOpensAt: draft.checkInOpensAt,
    checkInClosesAt: draft.checkInClosesAt,
    location: draft.location?.trim() || null,
    notes: draft.notes?.trim() || null,
    requiresRsvp: draft.requiresRsvp ?? draft.mode === 'oneoff',
    // Not defaulted from `mode`: recurring and one-off alike, this is on only
    // when somebody said so.
    requiresCheckOut: draft.requiresCheckOut ?? false,
    /*
     * Sanitised on the way out as well as on the way back in.
     *
     * The kiosk is the only thing that renders one and it may be running a
     * deploy older than whatever wrote this, so what lands in Firestore should
     * be a shape this version already agrees is valid. Round-tripping through
     * the sanitizer also drops any stray key the editor's form state picked up.
     */
    labelTemplate: draft.labelTemplate ? sanitizeLabelTemplate(draft.labelTemplate) : null,
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

/* -------------------------------------------------------------------------- */
/* Deleting                                                                    */
/* -------------------------------------------------------------------------- */

// Re-exported so a screen doing this reads one module, the way every other
// event write here does.
export type { DeletionSummary, DeletionTarget } from '@/services/functions';

/**
 * What deleting would remove, without removing any of it.
 *
 * The confirmation dialog's whole job is to say what is about to be lost, and
 * for a chain of repeats the app cannot work that out: it holds a window of the
 * calendar, not two years of Fridays, and it never loads the attendance under a
 * night nobody opened. So the server counts, through the same code that would
 * do the deleting.
 */
export async function previewEventDeletion(target: DeletionTarget): Promise<DeletionSummary> {
  const { data } = await deleteEventsCallable({ ...target, preview: true });
  return data;
}

/**
 * Hard delete, with everything filed under it.
 *
 * `scope: 'event'` is one gathering and its check-ins. `scope: 'chain'` is every
 * gathering in one chain of repeats — the past nights and, because the calendar
 * ahead is projected from the chain's own instances rather than written down,
 * the future ones with them.
 *
 * Cancelling remains the reversible option and is still what the event page
 * leads with. This is the one that cannot be undone, which is why both callers
 * put a typed confirmation in front of it — see `deleteConfirmation.ts`.
 */
export async function deleteEvents(target: DeletionTarget): Promise<DeletionSummary> {
  const { data } = await deleteEventsCallable(target);
  return data;
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
