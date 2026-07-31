/**
 * The simulator's internal record shapes.
 *
 * These are *not* JSON:API resources — they are a flat relational model that
 * `handler.ts` projects into JSON:API on the way out. Keeping the storage shape
 * flat is what makes `include=households.people` expressible without threading
 * nested objects through every fixture.
 */

export interface SimPerson {
  id: string;
  first_name: string;
  last_name: string;
  nickname: string | null;
  given_name: string | null;
  /** Planning Center stores this as an integer, or null for adults. */
  grade: number | null;
  graduation_year: number | null;
  /** Free text in the real API: "Male", "F", "female", "" have all been seen. */
  birthdate: string | null;
  child: boolean;
  medical_notes: string | null;
  status: 'active' | 'inactive';
  inactivated_at: string | null;
  /** "Manager" | "Editor" | "Viewer" | "No access" | null */
  people_permissions: string | null;
  site_administrator: boolean;
  created_at: string;
  updated_at: string;
}

export interface SimEmail {
  id: string;
  person_id: string;
  address: string;
  location: string;
  primary: boolean;
  blocked: boolean;
}

export interface SimPhoneNumber {
  id: string;
  person_id: string;
  number: string;
  e164: string;
  location: string;
  primary: boolean;
}

export interface SimHousehold {
  id: string;
  name: string;
  primary_contact_id: string;
  primary_contact_name: string;
}

/** The link record between a household and a person. */
export interface SimHouseholdMembership {
  id: string;
  household_id: string;
  person_id: string;
  /** adult | child_or_dependent | other_adult | parent_guardian */
  household_role: string;
  person_name: string;
  pending: boolean;
}

export interface SimFieldDefinition {
  id: string;
  name: string;
  slug: string;
  data_type: string;
}

export interface SimFieldDatum {
  id: string;
  person_id: string;
  field_definition_id: string;
  value: string;
}

export interface SimList {
  id: string;
  name: string;
  member_ids: string[];
  description?: string | null;
  /**
   * The health attributes `GET /lists` carries.
   *
   * They exist here because they are the ones that explain a missing student:
   * a list whose rules broke upstream (`invalid`), or one that has not been
   * refreshed since the spring. The roster picker shows them, so the simulator
   * has to be able to produce them.
   */
  refreshed_at?: string | null;
  auto_refresh?: boolean;
  invalid?: boolean;
  starred?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Check-Ins (the other product on the same host, `/check-ins/v2`)             */
/* -------------------------------------------------------------------------- */

/** One Check-Ins event — a gathering the kiosk has been counting for years. */
export interface SimCheckInsEvent {
  id: string;
  name: string;
  /** As the real API spells it: "Weekly" | "Daily" | "None". */
  frequency: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

/** One night of an event. `starts_at` can genuinely be null upstream. */
export interface SimCheckInsPeriod {
  id: string;
  event_id: string;
  starts_at: string | null;
  ends_at: string | null;
  note: string | null;
}

/** The kiosk window for one period — Tally's check-in window, ready-made. */
export interface SimCheckInsEventTime {
  id: string;
  event_period_id: string;
  starts_at: string | null;
  shows_at: string | null;
  hides_at: string | null;
  day_of_week: number | null;
  hour: number | null;
  minute: number | null;
}

/**
 * One check-in. `person_id` is an id in the *same* person store the People API
 * serves — that shared identity is the fact Tally's import leans on, so the
 * simulator must reproduce it rather than minting its own people.
 */
export interface SimCheckIn {
  id: string;
  event_id: string;
  event_period_id: string;
  /** Null for a one-time guest: a name typed at the kiosk, nobody behind it. */
  person_id: string | null;
  /** "Regular" | "Guest" | "Volunteer". */
  kind: string;
  first_name: string;
  last_name: string;
  created_at: string;
  one_time_guest: boolean;
}

export interface SimOrg {
  people: SimPerson[];
  emails: SimEmail[];
  phoneNumbers: SimPhoneNumber[];
  households: SimHousehold[];
  memberships: SimHouseholdMembership[];
  fieldDefinitions: SimFieldDefinition[];
  fieldData: SimFieldDatum[];
  lists: SimList[];
  checkInsEvents: SimCheckInsEvent[];
  checkInsPeriods: SimCheckInsPeriod[];
  checkInsEventTimes: SimCheckInsEventTime[];
  checkIns: SimCheckIn[];
}

/* -------------------------------------------------------------------------- */
/* Request / response plumbing                                                 */
/* -------------------------------------------------------------------------- */

export interface SimRequest {
  method: string;
  /** Path relative to the API root, e.g. `/people`. Query string excluded. */
  path: string;
  /** Raw query string without the leading `?`. */
  query: string;
  /** Parsed JSON body, when the request had one. */
  body: unknown;
  /** Raw `Authorization` header, if any. */
  authorization: string | null;
}

export interface SimResponse {
  status: number;
  headers: Record<string, string>;
  /** Already-serialised JSON, or null for an empty body. */
  body: string | null;
}

/** One entry in the simulator's request log, for assertions in tests. */
export interface SimRequestLogEntry {
  method: string;
  path: string;
  query: string;
  status: number;
}
