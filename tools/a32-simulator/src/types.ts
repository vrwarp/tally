/**
 * The wire shapes the simulator serves — the same JSON the Attendees
 * (attendees32) Django app's DRF serializers produce, trimmed to the fields
 * the integration actually reads. Row shapes here are the *serialized* form
 * (foreign keys as ids, nested folk on a membership row), not the models.
 */

export interface SimRequest {
  method: string;
  /** Path with the query string stripped, e.g. `/persons/api/datagrid_data_attendee/`. */
  path: string;
  /** Parsed query. Repeated keys (`meets[]=a&meets[]=b`) collect into arrays. */
  query: Record<string, string | string[]>;
  headers: Record<string, string>;
  body: unknown;
}

export interface SimResponse {
  status: number;
  body: unknown;
}

/** `{"totalCount": N, "data": [...]}` — CustomStorePagination's envelope. */
export interface Envelope<T> {
  totalCount: number;
  data: T[];
}

export interface AttendeeRow {
  id: string;
  created: string;
  modified: string;
  division: number;
  user: number | null;
  first_name: string | null;
  last_name: string | null;
  first_name2: string | null;
  last_name2: string | null;
  gender: 'MALE' | 'FEMALE' | 'UNSPECIFIED';
  actual_birthday: string | null;
  estimated_birthday: string | null;
  deathday: string | null;
  photo: string | null;
  infos: Record<string, unknown>;
  organization_slug: string;
  attendingmeets: Array<Record<string, unknown>>;
  folkattendee_set: FolkAttendeeRow[];
  folkcities: string;
  visitor_since: string | null;
  photo_path: string;
  places: unknown[];
}

export interface FolkRow {
  id: string;
  created: string;
  modified: string;
  is_removed: boolean;
  division: number;
  category: number;
  display_name: string;
  display_order: number;
  infos: Record<string, unknown>;
  places: unknown[];
}

export interface FolkAttendeeRow {
  id: number;
  created: string;
  modified: string;
  is_removed: boolean;
  folk: FolkRow;
  attendee: string;
  role: number;
  display_order: number;
  start: string | null;
  finish: string | null;
  infos: Record<string, unknown>;
  file: null;
  file_path: string;
}

export interface RelationRow {
  id: number;
  title: string;
  gender: string;
  emergency_contact: boolean;
  scheduler: boolean;
  relative: boolean;
  consanguinity: boolean;
  display_order: number;
  reciprocal_ids: number[];
}

export interface AttendingRow {
  id: number;
  created: string;
  modified: string;
  attendee: string;
  category: string;
  registration: number | null;
  price: number | null;
}

export interface MeetRow {
  id: number;
  slug: string;
  display_name: string;
  assembly: number;
  assembly_name: string;
  major_character: number | null;
  start: string;
  finish: string;
  shown_audience: boolean;
  audience_editable: boolean;
  infos: Record<string, unknown>;
  schedule_rules: unknown[];
}

export interface GatheringRow {
  id: number;
  meet: number;
  display_name: string;
  start: string;
  finish: string;
  infos: Record<string, unknown>;
  gathering_label: string;
  site: string;
}

export interface AttendanceRow {
  id: number;
  gathering: number;
  attending: number;
  character: number;
  team: number | null;
  category: number;
  start: string | null;
  finish: string | null;
  display_order: number;
  infos: Record<string, unknown>;
  file: null;
  file_path: string;
  attendee_id: string;
  registrant_attendee_id: string | null;
  attending__attendee__infos__names__original: string;
  attending__attendee__first_name: string | null;
  attending__attendee__last_name: string | null;
  attending__attendee__first_name2: string | null;
  attending__attendee__last_name2: string | null;
  attending__attendee__infos__fixed__grade: string | null;
  attending__attendee__infos__fixed__food_pref: string | null;
  gathering__display_name: string;
  gathering__meet: number;
  gathering__meet__assembly: number;
  photo: string;
}
