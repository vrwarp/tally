/**
 * The simulated Attendees organization, held in memory.
 *
 * Mirrors the world attendees32's `setup_tally_integration` command
 * provisions — one organization, one division, one assembly, one meet, one
 * student character, the relation vocabulary — plus a seeded cast of
 * attendees with families and a couple of months of gatherings and
 * attendance. The store owns the *data and its invariants* (the same side
 * effects the Django app's signals perform on create); the handler owns the
 * wire.
 */
import { randomUUID } from 'node:crypto';

export interface SimAttendee {
  id: string;
  created: string;
  modified: string;
  firstName: string | null;
  lastName: string | null;
  firstName2: string | null;
  lastName2: string | null;
  gender: 'MALE' | 'FEMALE' | 'UNSPECIFIED';
  actualBirthday: string | null;
  /** PartialDate as text; `1800-…` is the app's own "year unknown" sentinel. */
  estimatedBirthday: string | null;
  deathday: string | null;
  infos: Record<string, unknown>;
  isRemoved: boolean;
  /**
   * The survivor this attendee was merged into, if any.
   *
   * A tombstone rather than a deletion, exactly as attendees32 keeps one: an
   * id that has been handed out stays followable. Null for the ordinary case
   * and for a plain soft-delete, which is a different answer — gone with
   * nowhere to point.
   */
  mergedInto: string | null;
}

export interface SimFolk {
  id: string;
  category: number;
  displayName: string;
  createdAt: string;
  isRemoved: boolean;
}

export interface SimFolkAttendee {
  id: number;
  folkId: string;
  attendeeId: string;
  roleId: number;
  isRemoved: boolean;
}

export interface SimRelation {
  id: number;
  title: string;
  gender: string;
  emergencyContact: boolean;
  scheduler: boolean;
}

export interface SimAttending {
  id: number;
  attendeeId: string;
  category: string;
}

export interface SimAttendingMeet {
  id: number;
  attendingId: number;
  meetId: number;
  characterId: number;
  isRemoved: boolean;
}

export interface SimGathering {
  id: number;
  meetId: number;
  displayName: string;
  start: string;
  finish: string;
}

export interface SimAttendance {
  id: number;
  gatheringId: number;
  attendingId: number;
  characterId: number;
  /** Category id: 1 scheduled, 7 confirmed, 8 cancelled, 9 attended, 10 absent. */
  categoryId: number;
}

export const ATTENDANCE_CATEGORIES = {
  scheduled: 1,
  confirmed: 7,
  cancelled: 8,
  attended: 9,
  absent: 10,
} as const;

export const FAMILY_CATEGORY = 0;
export const NON_FAMILY_CATEGORY = 25;
export const HIDDEN_ROLE = 0;

export const DEFAULT_TOKEN = 'a32-sim-token';
export const DEFAULT_PUBLIC_URL = 'http://a32-simulator.local';

export interface SeedAttendeeInput {
  firstName?: string | null;
  lastName?: string | null;
  firstName2?: string | null;
  lastName2?: string | null;
  gender?: 'MALE' | 'FEMALE' | 'UNSPECIFIED';
  /** `YYYY-MM-DD`. */
  actualBirthday?: string | null;
  /** `1800-MM-DD` for a known day with an unknown year. */
  estimatedBirthday?: string | null;
  grade?: number | null;
  allergies?: string | null;
  foodPref?: string | null;
  contacts?: Record<string, string>;
  /** Join the Tally meet as a student (default true). */
  enrolled?: boolean;
}

export interface SimulatorOptions {
  token?: string;
  /** Now, for deterministic seeds. Defaults to the real clock. */
  now?: () => Date;
}

let nextIntId = 1000;
function intId(): number {
  nextIntId += 1;
  return nextIntId;
}

export class A32SimulatorStore {
  token: string;
  /** When true every API route answers 503 — the "backend down" lever. */
  down = false;
  readonly requests: Array<{ method: string; path: string }> = [];

  readonly organization = { id: 1, slug: 'simorg' };
  readonly division = { id: 11, slug: 'simorg_tally_youth' };
  readonly assembly = { id: 21, slug: 'simorg_tally_youth_ministry', displayName: 'Youth ministry' };
  readonly character = { id: 31, slug: 'simorg_tally_student', displayName: 'Student' };
  readonly meet = {
    id: 41,
    slug: 'simorg_tally_gathering',
    displayName: 'Friday night',
    infos: { default_time_zone: 'America/Los_Angeles' } as Record<string, unknown>,
  };

  readonly relations: SimRelation[] = [
    { id: HIDDEN_ROLE, title: 'hidden', gender: 'UNSPECIFIED', emergencyContact: true, scheduler: true },
    { id: 1, title: 'father', gender: 'MALE', emergencyContact: true, scheduler: true },
    { id: 2, title: 'mother', gender: 'FEMALE', emergencyContact: true, scheduler: true },
    { id: 27, title: 'child', gender: 'UNSPECIFIED', emergencyContact: true, scheduler: false },
    { id: 28, title: 'self', gender: 'UNSPECIFIED', emergencyContact: true, scheduler: false },
    { id: 30, title: 'parent', gender: 'UNSPECIFIED', emergencyContact: true, scheduler: true },
    { id: 7, title: 'driver', gender: 'UNSPECIFIED', emergencyContact: false, scheduler: false },
  ];

  readonly attendees = new Map<string, SimAttendee>();
  readonly folks = new Map<string, SimFolk>();
  folkAttendees: SimFolkAttendee[] = [];
  attendings: SimAttending[] = [];
  attendingMeets: SimAttendingMeet[] = [];
  gatherings: SimGathering[] = [];
  attendances: SimAttendance[] = [];

  private readonly now: () => Date;

  constructor(options: SimulatorOptions = {}) {
    this.token = options.token ?? DEFAULT_TOKEN;
    this.now = options.now ?? (() => new Date());
  }

  private stamp(): string {
    return this.now().toISOString();
  }

  /** `Attendee.save()`'s name bookkeeping, so `searchValue` finds people. */
  private composeNames(attendee: SimAttendee): void {
    const name1 = `${attendee.firstName ?? ''} ${attendee.lastName ?? ''}`.trim();
    const name2 = `${attendee.lastName2 ?? ''}${attendee.firstName2 ?? ''}`.trim();
    const names = ((attendee.infos.names as Record<string, unknown> | undefined) ?? {});
    names.original = `${name1} ${name2}`.trim();
    names.romanization = names.original;
    attendee.infos.names = names;
  }

  /**
   * Creates an attendee with the same side effects the Django app performs:
   * name bookkeeping, the hidden non-family folk, and an `Attending` (the
   * simulated organization runs with `attendee_to_attending` on).
   */
  createAttendee(
    fields: Partial<SimAttendee> & { infos?: Record<string, unknown> },
  ): SimAttendee {
    const at = this.stamp();
    const attendee: SimAttendee = {
      id: (fields.id as string | undefined) ?? randomUUID(),
      created: at,
      modified: at,
      firstName: fields.firstName ?? null,
      lastName: fields.lastName ?? null,
      firstName2: fields.firstName2 ?? null,
      lastName2: fields.lastName2 ?? null,
      gender: fields.gender ?? 'UNSPECIFIED',
      actualBirthday: fields.actualBirthday ?? null,
      estimatedBirthday: fields.estimatedBirthday ?? null,
      deathday: fields.deathday ?? null,
      infos: { fixed: {}, contacts: {}, emergency_contacts: {}, schedulers: {}, ...(fields.infos ?? {}) },
      isRemoved: false,
      mergedInto: null,
    };
    this.composeNames(attendee);
    this.attendees.set(attendee.id, attendee);

    const hidden = this.createFolk(NON_FAMILY_CATEGORY, `${attendee.infos.names && (attendee.infos.names as Record<string, unknown>).original} other`);
    this.folkAttendees.push({
      id: intId(),
      folkId: hidden.id,
      attendeeId: attendee.id,
      roleId: HIDDEN_ROLE,
      isRemoved: false,
    });
    this.attendings.push({ id: intId(), attendeeId: attendee.id, category: 'auto-created' });
    return attendee;
  }

  /**
   * Merges one attendee into another, the way attendees32 does.
   *
   * The loser keeps its row, is soft-deleted, and points at the survivor. The
   * simulator does not move attendance — that is attendees32's business and
   * has its own tests over there; what a test against *this* needs is the
   * observable half, which is what an id answers afterwards.
   */
  mergeAttendee(loserId: string, survivorId: string): SimAttendee | null {
    const loser = this.attendees.get(loserId);
    const survivor = this.attendees.get(survivorId);
    if (!loser || !survivor || loser.id === survivor.id) return null;
    loser.mergedInto = survivor.id;
    loser.isRemoved = true;
    return survivor;
  }

  /**
   * Follows a chain of merges to whoever holds the record now, or null.
   *
   * Bounded for the same reason the real one is: a cycle is reachable by hand
   * and the answer to it is "gone", not a hang.
   */
  survivorOf(id: string): SimAttendee | null {
    const seen = new Set<string>([id]);
    let current = this.attendees.get(id) ?? null;

    for (let hop = 0; hop < 5 && current; hop += 1) {
      if (!current.mergedInto) return current.isRemoved ? null : current;
      if (seen.has(current.mergedInto)) return null;
      seen.add(current.mergedInto);
      current = this.attendees.get(current.mergedInto) ?? null;
    }
    return null;
  }

  updateAttendee(id: string, fields: Record<string, unknown>): SimAttendee | null {
    const attendee = this.attendees.get(id);
    if (!attendee || attendee.isRemoved) return null;

    if ('first_name' in fields) attendee.firstName = (fields.first_name as string | null) ?? null;
    if ('last_name' in fields) attendee.lastName = (fields.last_name as string | null) ?? null;
    if ('first_name2' in fields) attendee.firstName2 = (fields.first_name2 as string | null) ?? null;
    if ('last_name2' in fields) attendee.lastName2 = (fields.last_name2 as string | null) ?? null;
    if ('gender' in fields) attendee.gender = fields.gender as SimAttendee['gender'];
    if ('actual_birthday' in fields) attendee.actualBirthday = (fields.actual_birthday as string | null) ?? null;
    if ('estimated_birthday' in fields) attendee.estimatedBirthday = (fields.estimated_birthday as string | null) ?? null;
    // JSONField semantics: the body's `infos` replaces the whole blob, which
    // is why the real client must read-modify-write it.
    if ('infos' in fields) attendee.infos = (fields.infos as Record<string, unknown>) ?? {};
    this.composeNames(attendee);
    attendee.modified = this.stamp();
    return attendee;
  }

  createFolk(category: number, displayName: string): SimFolk {
    const folk: SimFolk = {
      id: randomUUID(),
      category,
      displayName,
      createdAt: this.stamp(),
      isRemoved: false,
    };
    this.folks.set(folk.id, folk);
    return folk;
  }

  addFolkAttendee(folkId: string, attendeeId: string, roleId: number): SimFolkAttendee {
    const existing = this.folkAttendees.find(
      (edge) => edge.folkId === folkId && edge.attendeeId === attendeeId && !edge.isRemoved,
    );
    if (existing) {
      existing.roleId = roleId;
      return existing;
    }
    const edge: SimFolkAttendee = { id: intId(), folkId, attendeeId, roleId, isRemoved: false };
    this.folkAttendees.push(edge);
    return edge;
  }

  attendingOf(attendeeId: string): SimAttending | undefined {
    return this.attendings.find((attending) => attending.attendeeId === attendeeId);
  }

  joinMeet(attendeeId: string, meetId: number, characterId: number): SimAttendingMeet {
    let attending = this.attendingOf(attendeeId);
    if (!attending) {
      attending = { id: intId(), attendeeId, category: 'auto-created' };
      this.attendings.push(attending);
    }
    const existing = this.attendingMeets.find(
      (row) => row.attendingId === attending.id && row.meetId === meetId && !row.isRemoved,
    );
    if (existing) return existing;
    const row: SimAttendingMeet = {
      id: intId(),
      attendingId: attending.id,
      meetId,
      characterId,
      isRemoved: false,
    };
    this.attendingMeets.push(row);
    return row;
  }

  seedGathering(start: string, finish: string, displayName?: string): SimGathering {
    const gathering: SimGathering = {
      id: intId(),
      meetId: this.meet.id,
      displayName: displayName ?? start.slice(0, 10),
      start,
      finish,
    };
    this.gatherings.push(gathering);
    return gathering;
  }

  seedAttendance(gathering: SimGathering, attendeeId: string, categoryId: number): SimAttendance {
    const attending = this.attendingOf(attendeeId);
    if (!attending) throw new Error(`No attending for attendee ${attendeeId}`);
    const attendance: SimAttendance = {
      id: intId(),
      gatheringId: gathering.id,
      attendingId: attending.id,
      characterId: this.character.id,
      categoryId,
    };
    this.attendances.push(attendance);
    return attendance;
  }

  /**
   * The runbook's whole provisioning, as one call: an attendee with a family,
   * contacts on the parent, and an enrollment in the Tally meet.
   */
  seedStudent(input: SeedAttendeeInput & { parents?: SeedAttendeeInput[] }): SimAttendee {
    const student = this.createAttendee({
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      firstName2: input.firstName2 ?? null,
      lastName2: input.lastName2 ?? null,
      gender: input.gender ?? 'UNSPECIFIED',
      actualBirthday: input.actualBirthday ?? null,
      estimatedBirthday: input.estimatedBirthday ?? null,
      infos: {
        fixed: {
          ...(input.grade !== null && input.grade !== undefined ? { grade: input.grade } : {}),
          ...(input.allergies ? { allergies: input.allergies } : {}),
          ...(input.foodPref ? { food_pref: input.foodPref } : {}),
        },
        contacts: input.contacts ?? {},
      },
    });
    if (input.enrolled !== false) this.joinMeet(student.id, this.meet.id, this.character.id);

    if (input.parents && input.parents.length > 0) {
      const family = this.createFolk(FAMILY_CATEGORY, `${student.lastName ?? ''} family`.trim());
      const childRole = this.relations.find((relation) => relation.title === 'child')!;
      this.addFolkAttendee(family.id, student.id, childRole.id);
      for (const parentInput of input.parents) {
        const parent = this.createAttendee({
          firstName: parentInput.firstName ?? null,
          lastName: parentInput.lastName ?? (student.lastName ?? null),
          gender: parentInput.gender ?? 'UNSPECIFIED',
          infos: { contacts: parentInput.contacts ?? {} },
        });
        const parentRole = this.relations.find((relation) => relation.title === 'parent')!;
        this.addFolkAttendee(family.id, parent.id, parentRole.id);
      }
    }
    return student;
  }

  familyFolksOf(attendeeId: string): SimFolk[] {
    return this.folkAttendees
      .filter((edge) => edge.attendeeId === attendeeId && !edge.isRemoved)
      .map((edge) => this.folks.get(edge.folkId))
      .filter((folk): folk is SimFolk => folk !== undefined && !folk.isRemoved);
  }
}
