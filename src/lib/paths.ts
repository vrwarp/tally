/**
 * Every Firestore path in Tally, in one place.
 *
 * Collection layout:
 *
 *   users/{uid}                              counselor & core team profiles
 *   smallGroups/{groupId}                    Sunday School groupings
 *   eventSeries/{seriesId}                   recurring templates (friday, sunday)
 *   students/{studentId}                     what Tally owns about a person
 *   events/{eventId}                         a single dated gathering
 *   events/{eventId}/attendance/{studentId}  who showed up
 *   events/{eventId}/rsvps/{studentId}       who said they were coming (one-offs)
 *   config/settings                          tunable thresholds
 *   config/planningCenter                    the non-secret Planning Center settings
 *
 * Attendance and RSVP documents are keyed by student id on purpose: it makes
 * concurrent check-in from multiple counselor devices idempotent (PRD 4.1).
 *
 * Note what is *not* here. The youth roster is not a collection: it is read
 * from Planning Center on demand (see src/services/roster.ts), and `students`
 * holds only Tally's own annotations plus visitors it created. There is no
 * mirrored allowlist either — `provisionAccess` asks Planning Center at
 * sign-in.
 *
 * A student id is `pco_{planningCenterId}` for somebody Planning Center knows,
 * and a generated Firestore id for a visitor Tally created. That is what lets
 * an attendance record written at the door still resolve to a person on a
 * device that has never seen a `students` document for them.
 */

export const COLLECTIONS = {
  users: 'users',
  smallGroups: 'smallGroups',
  eventSeries: 'eventSeries',
  students: 'students',
  events: 'events',
  config: 'config',
  /** Subcollection names. */
  attendance: 'attendance',
  rsvps: 'rsvps',
} as const;

export const SETTINGS_DOC_ID = 'settings';

/**
 * Where the core team's Planning Center settings live.
 *
 * Mirrored in `functions/src/firestore.ts`, which reads it on every callable,
 * and in firestore.rules. The credentials are *not* here — they stay in Secret
 * Manager, which is why this document can be written from a browser at all.
 */
export const PCO_CONFIG_DOC_ID = 'planningCenter';

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
  planningCenter: () => `${COLLECTIONS.config}/${PCO_CONFIG_DOC_ID}`,
} as const;

/** Well-known recurring series ids, seeded by `scripts/seed.ts`. */
export const SERIES_IDS = {
  fridayFellowship: 'friday-fellowship',
  sundaySchool: 'sunday-school',
} as const;
