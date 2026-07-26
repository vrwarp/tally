/**
 * The slice of the Planning Center People API that Tally actually touches.
 *
 * Modelled from the published OpenAPI description (people/v2, spec version
 * 2026-06-04). Every attribute is optional and nullable on purpose: JSON:API
 * omits fields that were not requested, and a sparse `fields[Person]` query or a
 * future API version can drop anything at any time. The mapping layer is where
 * missing data turns into a defined Tally value — never here.
 */

export const PCO_BASE_URL = 'https://api.planningcenteronline.com/people/v2';

/** `per_page` is capped at 100 by the API; asking for more is a 400. */
export const PCO_MAX_PER_PAGE = 100;

/* -------------------------------------------------------------------------- */
/* JSON:API envelope                                                           */
/* -------------------------------------------------------------------------- */

export interface JsonApiIdentifier {
  type: string;
  id: string;
}

export interface JsonApiRelationship {
  data?: JsonApiIdentifier | JsonApiIdentifier[] | null;
  links?: { related?: string };
}

export interface JsonApiResource<TAttributes = Record<string, unknown>> {
  id: string;
  type: string;
  attributes?: TAttributes;
  relationships?: Record<string, JsonApiRelationship | undefined>;
  links?: Record<string, string | undefined>;
}

export interface JsonApiMeta {
  total_count?: number;
  count?: number;
  next?: { offset?: number };
  prev?: { offset?: number };
  [key: string]: unknown;
}

export interface JsonApiLinks {
  self?: string;
  next?: string;
  prev?: string;
}

/** Any Planning Center response body. `TData` is a resource or an array of them. */
export interface JsonApiBody<TData> {
  data: TData;
  included?: JsonApiResource[];
  meta?: JsonApiMeta;
  links?: JsonApiLinks;
}

/** One entry of the `errors` array Planning Center returns on a failure. */
export interface PcoErrorDetail {
  status?: string;
  code?: string;
  title?: string;
  detail?: string;
  meta?: Record<string, unknown>;
}

export interface PcoErrorBody {
  errors?: PcoErrorDetail[];
}

/* -------------------------------------------------------------------------- */
/* Resources                                                                   */
/* -------------------------------------------------------------------------- */

export type PcoPersonAttributes = {
  first_name?: string | null;
  last_name?: string | null;
  middle_name?: string | null;
  /** What the person is actually called. Preferred over `first_name`. */
  nickname?: string | null;
  /** Legal first name. Present when `first_name` has been overridden. */
  given_name?: string | null;
  name?: string | null;
  grade?: number | null;
  graduation_year?: number | null;
  /** Free text — the API does not constrain it to an enum. */
  gender?: string | null;
  birthdate?: string | null;
  child?: boolean | null;
  medical_notes?: string | null;
  membership?: string | null;
  /** "active" / "inactive". */
  status?: string | null;
  /** Set to an ISO timestamp when the profile was deactivated. */
  inactivated_at?: string | null;
  /** "" | "Viewer" | "Editor" | "Manager" | "Administrator". */
  people_permissions?: string | null;
  site_administrator?: boolean | null;
  accounting_administrator?: boolean | null;
  /** Only returned when asked for via `fields[Person]`. */
  primary_email_address?: string | null;
  avatar?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type PcoPerson = JsonApiResource<PcoPersonAttributes>;

export type PcoEmailAttributes = {
  address?: string | null;
  location?: string | null;
  primary?: boolean | null;
  blocked?: boolean | null;
};

export type PcoEmail = JsonApiResource<PcoEmailAttributes>;

export type PcoPhoneNumberAttributes = {
  number?: string | null;
  e164?: string | null;
  international?: string | null;
  national?: string | null;
  location?: string | null;
  primary?: boolean | null;
};

export type PcoPhoneNumber = JsonApiResource<PcoPhoneNumberAttributes>;

export type PcoHouseholdAttributes = {
  name?: string | null;
  member_count?: number | null;
  primary_contact_id?: string | null;
  primary_contact_name?: string | null;
};

export type PcoHousehold = JsonApiResource<PcoHouseholdAttributes>;

export type PcoHouseholdMembershipAttributes = {
  /** `adult` | `child_or_dependent` | `other_adult` | `parent_guardian`. */
  household_role?: string | null;
  pending?: boolean | null;
  person_name?: string | null;
};

export type PcoHouseholdMembership = JsonApiResource<PcoHouseholdMembershipAttributes>;

export type PcoFieldDatumAttributes = {
  value?: string | null;
};

export type PcoFieldDatum = JsonApiResource<PcoFieldDatumAttributes>;

export type PcoFieldDefinitionAttributes = {
  name?: string | null;
  slug?: string | null;
  data_type?: string | null;
  deleted_at?: string | null;
};

export type PcoFieldDefinition = JsonApiResource<PcoFieldDefinitionAttributes>;

/**
 * A Planning Center List, as `/lists` returns it.
 *
 * `total_people` arriving on the collection is what makes a usable picker
 * possible: the number of people a list would put on the roster is visible
 * before anybody selects it, without a second request per list.
 *
 * `invalid` and `refreshed_at` are the two fields that explain a missing
 * student, so they are read even though nothing else uses them.
 */
export type PcoListAttributes = {
  name?: string | null;
  description?: string | null;
  total_people?: number | null;
  refreshed_at?: string | null;
  auto_refresh?: boolean | null;
  /** True when the list's own rules stopped working upstream. */
  invalid?: boolean | null;
  starred?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type PcoList = JsonApiResource<PcoListAttributes>;

/* -------------------------------------------------------------------------- */
/* Resource type names, as they appear in `data.type` / `included[].type`      */
/* -------------------------------------------------------------------------- */

export const PCO_TYPES = {
  person: 'Person',
  email: 'Email',
  phoneNumber: 'PhoneNumber',
  household: 'Household',
  householdMembership: 'HouseholdMembership',
  fieldDatum: 'FieldDatum',
  fieldDefinition: 'FieldDefinition',
  list: 'List',
} as const;

/** Household roles, most-parental first — this order *is* the preference rule. */
export const HOUSEHOLD_ADULT_ROLES = ['parent_guardian', 'adult', 'other_adult'] as const;
