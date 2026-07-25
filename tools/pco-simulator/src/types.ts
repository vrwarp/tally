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
  gender: string | null;
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
