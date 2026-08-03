/**
 * The Attendees wire shapes the integration reads — the DRF serializers'
 * output, typed down to the fields Tally actually consumes. Everything else a
 * response carries is ignored on purpose: the narrower this contract, the
 * less an attendees32 upgrade can break.
 */

export interface A32Attendee {
  id: string;
  created?: string;
  modified?: string;
  division?: number;
  first_name: string | null;
  last_name: string | null;
  first_name2: string | null;
  last_name2: string | null;
  gender?: string;
  /** `YYYY-MM-DD`. */
  actual_birthday: string | null;
  /** PartialDate text; a leading `1800` year means "day known, year unknown". */
  estimated_birthday: string | null;
  deathday: string | null;
  infos: A32AttendeeInfos | null;
  folkattendee_set?: A32FolkAttendee[];
}

export interface A32AttendeeInfos {
  names?: { original?: string; romanization?: string };
  fixed?: {
    grade?: number | string | null;
    allergies?: string | null;
    food_pref?: string | null;
    [key: string]: unknown;
  };
  contacts?: Record<string, string | null | undefined>;
  emergency_contacts?: Record<string, boolean>;
  [key: string]: unknown;
}

export interface A32Folk {
  id: string;
  category: number;
  display_name: string;
  is_removed?: boolean;
}

export interface A32FolkAttendee {
  id: number;
  folk: A32Folk;
  attendee: string;
  role: number;
  is_removed?: boolean;
}

export interface A32Relation {
  id: number;
  title: string;
  emergency_contact: boolean;
}

export interface A32Attending {
  id: number;
  attendee: string;
}

export interface A32Meet {
  id: number;
  slug: string;
  display_name: string;
  assembly: number;
  assembly_name?: string;
}

export interface A32Gathering {
  id: number;
  meet: number;
  display_name: string;
  start: string;
  finish: string;
}

export interface A32Attendance {
  id: number;
  gathering: number;
  attending: number;
  category: number;
  attendee_id: string;
  attending__attendee__first_name: string | null;
  attending__attendee__last_name: string | null;
  attending__attendee__first_name2: string | null;
  attending__attendee__last_name2: string | null;
  attending__attendee__infos__fixed__grade: string | null;
  gathering__display_name: string;
}

/**
 * The attendance categories the app seeds (`fixtures/db_seed.json`), by pk.
 * `attended` is the one history import keeps; the rest are RSVP-ish states
 * counted as skipped.
 */
export const A32_CATEGORY = {
  scheduled: 1,
  confirmed: 7,
  cancelled: 8,
  attended: 9,
  absent: 10,
  importer: -1,
} as const;

/** The family folk category (`Attendee.FAMILY_CATEGORY` upstream). */
export const A32_FAMILY_CATEGORY = 0;

/** Relation titles the integration resolves ids for, by their seeded names. */
export const A32_RELATION_TITLES = {
  child: 'child',
  parent: 'parent',
} as const;

export const API = {
  attendee: '/persons/api/datagrid_data_attendee/',
  attendeeById: (id: string) => `/persons/api/datagrid_data_attendee/${encodeURIComponent(id)}/`,
  families: '/persons/api/attendee_families/',
  folkAttendees: '/persons/api/datagrid_data_familyattendees/',
  relations: '/persons/api/all_relations/',
  attendings: '/persons/api/attendee_attendings/',
  defaultAttendingMeets: '/persons/api/default_attendingmeets/',
  meets: '/occasions/api/organization_meets/',
  gatherings: '/occasions/api/organization_team_gatherings/',
  attendances: '/occasions/api/organization_meet_character_attendances/',
} as const;
