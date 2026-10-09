/**
 * attendees32's grade is an index, not a school grade.
 *
 * `infos.fixed.grade` is the position of a rung in the organization's
 * `grade_converter`, the list of labels its attendee form offers in a select.
 * For CFCCH that list is ["Under three 1", "Under three 2", "Under three 3",
 * "Preschool 1", "Preschool 2", "Kindergarten 1", "Kindergarten 2", "G1", …,
 * "G12", "Postsecondary 1", …], so G1 is 7 and G9 is 15, and a Tally "9"
 * stored as is would read back as G3. Tally's `Grade` is the school grade,
 * -1 (Pre-K) to 12.
 *
 * The scale is read from the organization (one read, cached) and translates
 * both ways by the labels, with an explicit rule:
 *
 *   "G<n>", "Grade <n>", "<n>th grade"   ↔ n, for 1–12
 *   "Preschool …", "Pre-K"               ↔ -1  (a write picks the first such rung)
 *   "Kindergarten …", "K"                ↔ 0   (same)
 *
 * Every other rung — "Under three", "Postsecondary", a label the rule does
 * not know — reads as "no grade" and is never written: Tally cannot hold it,
 * and guessing would file a toddler as a first-grader. An organization with
 * no converter stores school grades directly, and the scale is the identity.
 */
import { cacheKey, type TtlCache } from '../pco/cache.js';
import { A32ApiError, type A32Client } from './client.js';
import { API, type A32Organization } from './types.js';

export interface GradeScale {
  /** Where the scale came from; `fallback` means the organization could not be read. */
  readonly origin: 'organization' | 'identity' | 'fallback';
  /** The Tally grade a stored index means, or null for a rung Tally cannot hold. */
  toGrade(index: number | null): number | null;
  /** The index to store for a Tally grade, or null when the list has no rung for it. */
  toIndex(grade: number | null): number | null;
}

const NUMBERED = /^(?:g|gr|grade)\s*(\d{1,2})$|^(\d{1,2})(?:st|nd|rd|th)?\s*grade$/i;

/** The Tally grade a converter label names, by the rule above. */
export function gradeOfLabel(label: string): number | null {
  const text = label.trim();
  const numbered = NUMBERED.exec(text);
  if (numbered) {
    const n = Number.parseInt(numbered[1] ?? numbered[2] ?? '', 10);
    return n >= 1 && n <= 12 ? n : null;
  }
  // Pre-K before kindergarten: "Pre-kindergarten" names both.
  if (/pre-?k|preschool/i.test(text)) return -1;
  if (/kindergarten|^kinder|^k$/i.test(text)) return 0;
  return null;
}

function identityScale(origin: 'identity' | 'fallback'): GradeScale {
  const within = (value: number | null): number | null =>
    value !== null && Number.isInteger(value) && value >= -1 && value <= 12 ? value : null;
  return { origin, toGrade: within, toIndex: within };
}

export const IDENTITY_GRADE_SCALE: GradeScale = identityScale('identity');

/** The scale an organization's `grade_converter` defines; identity without one. */
export function gradeScaleFrom(converter: unknown): GradeScale {
  if (!Array.isArray(converter) || converter.length === 0) return IDENTITY_GRADE_SCALE;
  const grades = converter.map((label) => (typeof label === 'string' ? gradeOfLabel(label) : null));
  const firstIndex = new Map<number, number>();
  grades.forEach((grade, index) => {
    if (grade !== null && !firstIndex.has(grade)) firstIndex.set(grade, index);
  });
  return {
    origin: 'organization',
    toGrade: (index) =>
      index !== null && Number.isInteger(index) && index >= 0 && index < grades.length
        ? grades[index]!
        : null,
    toIndex: (grade) => (grade === null ? null : (firstIndex.get(grade) ?? null)),
  };
}

export function gradeScaleCacheKey(baseUrl: string): string {
  return cacheKey({ kind: 'a32-grade-scale', base: baseUrl });
}

export interface GradeScaleOptions {
  client: A32Client;
  cache: TtlCache;
  config: { baseUrl: string };
  force?: boolean;
}

/**
 * The organization's scale, read through `user_organizations`: the caller's
 * own organization, infos included. A server that has not opened that read to
 * token clients answers with an error page rather than the organization; the
 * scale then falls back to the identity so the roster still loads, and says so
 * in `origin`. Only a network failure propagates.
 */
export function loadGradeScale(options: GradeScaleOptions): Promise<GradeScale> {
  return options.cache.get(
    gradeScaleCacheKey(options.config.baseUrl),
    async () => {
      try {
        for await (const page of options.client.paginate<A32Organization>(API.organizations)) {
          return gradeScaleFrom(page.data[0]?.infos?.grade_converter ?? null);
        }
        return IDENTITY_GRADE_SCALE;
      } catch (error) {
        if (error instanceof A32ApiError) return identityScale('fallback');
        throw error;
      }
    },
    options.force,
  );
}
