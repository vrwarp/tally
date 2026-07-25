/**
 * Every Firestore path in Tally, in one place.
 *
 * Collection layout:
 *
 *   users/{uid}                              counselor & core team profiles
 *   smallGroups/{groupId}                    Sunday School groupings
 *   eventSeries/{seriesId}                   recurring templates (friday, sunday)
 *   students/{studentId}                     the youth roster
 *   events/{eventId}                         a single dated gathering
 *   events/{eventId}/attendance/{studentId}  who showed up
 *   events/{eventId}/rsvps/{studentId}       who said they were coming (one-offs)
 *   config/settings                          tunable thresholds
 *   config/pcoSync                           Planning Center sync state
 *   accessRoster/{emailKey}                  Planning-Center-derived allowlist
 *
 * Attendance and RSVP documents are keyed by student id on purpose: it makes
 * concurrent check-in from multiple counselor devices idempotent (PRD 4.1).
 */

export const COLLECTIONS = {
  users: 'users',
  smallGroups: 'smallGroups',
  eventSeries: 'eventSeries',
  students: 'students',
  events: 'events',
  config: 'config',
  accessRoster: 'accessRoster',
  /** Subcollection names. */
  attendance: 'attendance',
  rsvps: 'rsvps',
} as const;

export const SETTINGS_DOC_ID = 'settings';
export const PCO_SYNC_DOC_ID = 'pcoSync';

export const paths = {
  users: () => COLLECTIONS.users,
  user: (uid: string) => `${COLLECTIONS.users}/${uid}`,

  smallGroups: () => COLLECTIONS.smallGroups,
  smallGroup: (groupId: string) => `${COLLECTIONS.smallGroups}/${groupId}`,

  eventSeries: () => COLLECTIONS.eventSeries,
  series: (seriesId: string) => `${COLLECTIONS.eventSeries}/${seriesId}`,

  students: () => COLLECTIONS.students,
  student: (studentId: string) => `${COLLECTIONS.students}/${studentId}`,

  events: () => COLLECTIONS.events,
  event: (eventId: string) => `${COLLECTIONS.events}/${eventId}`,

  attendanceCollection: (eventId: string) =>
    `${COLLECTIONS.events}/${eventId}/${COLLECTIONS.attendance}`,
  attendance: (eventId: string, studentId: string) =>
    `${COLLECTIONS.events}/${eventId}/${COLLECTIONS.attendance}/${studentId}`,

  rsvpCollection: (eventId: string) => `${COLLECTIONS.events}/${eventId}/${COLLECTIONS.rsvps}`,
  rsvp: (eventId: string, studentId: string) =>
    `${COLLECTIONS.events}/${eventId}/${COLLECTIONS.rsvps}/${studentId}`,

  settings: () => `${COLLECTIONS.config}/${SETTINGS_DOC_ID}`,
  pcoSync: () => `${COLLECTIONS.config}/${PCO_SYNC_DOC_ID}`,

  accessRoster: () => COLLECTIONS.accessRoster,
  accessRosterEntry: (emailKey: string) => `${COLLECTIONS.accessRoster}/${emailKey}`,
} as const;

/** Well-known recurring series ids, seeded by `scripts/seed.ts`. */
export const SERIES_IDS = {
  fridayFellowship: 'friday-fellowship',
  sundaySchool: 'sunday-school',
} as const;
