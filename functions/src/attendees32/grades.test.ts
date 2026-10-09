/**
 * The grade scale: attendees32's index ↔ Tally's school grade, by the labels
 * of the organization's grade list.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  A32SimulatorStore,
  createSimulatorFetch,
  DEFAULT_TOKEN,
  seedDefaultOrganization,
  SIMULATOR_ORIGIN,
} from '../../../tools/a32-simulator/src/index.js';
import { createTtlCache, type TtlCache } from '../pco/cache.js';
import { a32Config } from '../testing/a32Config.js';
import { createA32Client, type A32Client } from './client.js';
import { gradeOfLabel, gradeScaleFrom, IDENTITY_GRADE_SCALE, loadGradeScale } from './grades.js';

const CFCCH = [
  'Under three 1', 'Under three 2', 'Under three 3',
  'Preschool 1', 'Preschool 2',
  'Kindergarten 1', 'Kindergarten 2',
  'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10', 'G11', 'G12',
  'Postsecondary 1', 'Postsecondary 2',
];

describe('gradeOfLabel', () => {
  it('reads the numbered rungs in the spellings a church uses', () => {
    expect(gradeOfLabel('G1')).toBe(1);
    expect(gradeOfLabel('G12')).toBe(12);
    expect(gradeOfLabel('Grade 7')).toBe(7);
    expect(gradeOfLabel('3rd grade')).toBe(3);
    expect(gradeOfLabel(' g9 ')).toBe(9);
  });

  it('names kindergarten and pre-K, pre-K first because one label names both', () => {
    expect(gradeOfLabel('Kindergarten 1')).toBe(0);
    expect(gradeOfLabel('K')).toBe(0);
    expect(gradeOfLabel('Preschool 2')).toBe(-1);
    expect(gradeOfLabel('Pre-K')).toBe(-1);
    expect(gradeOfLabel('Pre-kindergarten')).toBe(-1);
  });

  it('answers null for rungs Tally cannot hold', () => {
    expect(gradeOfLabel('Under three 1')).toBeNull();
    expect(gradeOfLabel('Postsecondary 3')).toBeNull();
    expect(gradeOfLabel('G13')).toBeNull();
    expect(gradeOfLabel('')).toBeNull();
  });
});

describe('gradeScaleFrom', () => {
  const scale = gradeScaleFrom(CFCCH);

  it('reads an index as the grade its rung names', () => {
    expect(scale.origin).toBe('organization');
    expect(scale.toGrade(7)).toBe(1);
    expect(scale.toGrade(15)).toBe(9);
    expect(scale.toGrade(5)).toBe(0);
    expect(scale.toGrade(6)).toBe(0);
    expect(scale.toGrade(3)).toBe(-1);
  });

  it('reads the rungs outside Tally as no grade, and so for nonsense', () => {
    expect(scale.toGrade(0)).toBeNull();
    expect(scale.toGrade(19)).toBeNull();
    expect(scale.toGrade(99)).toBeNull();
    expect(scale.toGrade(-1)).toBeNull();
    expect(scale.toGrade(null)).toBeNull();
  });

  it('writes a grade as the first rung that names it', () => {
    expect(scale.toIndex(9)).toBe(15);
    expect(scale.toIndex(1)).toBe(7);
    expect(scale.toIndex(0)).toBe(5);
    expect(scale.toIndex(-1)).toBe(3);
    expect(scale.toIndex(null)).toBeNull();
  });

  it('has no index for a grade the list does not reach', () => {
    const short = gradeScaleFrom(['K', 'G1', 'G2']);
    expect(short.toIndex(2)).toBe(2);
    expect(short.toIndex(3)).toBeNull();
    expect(short.toIndex(-1)).toBeNull();
  });

  it('is the identity for an organization without a list', () => {
    for (const empty of [null, undefined, [], 'G1', 42]) {
      const identity = gradeScaleFrom(empty);
      expect(identity).toBe(IDENTITY_GRADE_SCALE);
      expect(identity.toGrade(9)).toBe(9);
      expect(identity.toIndex(-1)).toBe(-1);
      expect(identity.toGrade(13)).toBeNull();
    }
  });
});

describe('loadGradeScale', () => {
  let store: A32SimulatorStore;
  let client: A32Client;
  let cache: TtlCache;
  let requests: string[];
  let refuseOrganization: boolean;

  beforeEach(() => {
    store = new A32SimulatorStore();
    seedDefaultOrganization(store);
    requests = [];
    refuseOrganization = false;
    const simulator = createSimulatorFetch(store);
    client = createA32Client({
      token: DEFAULT_TOKEN,
      baseUrl: SIMULATOR_ORIGIN,
      fetchImpl: async (input, init) => {
        const url = typeof input === 'string' ? input : String(input);
        requests.push(url);
        if (refuseOrganization && url.includes('user_organizations')) {
          // A server that has not opened the organization read to tokens yet.
          return new Response(JSON.stringify({ detail: 'Forbidden' }), {
            status: 403,
            headers: { 'content-type': 'application/json' },
          });
        }
        return simulator(input, init);
      },
      sleep: async () => {},
    });
    cache = createTtlCache({ ttlMs: 30_000 });
  });

  it("reads the organization's list once and translates by it", async () => {
    const options = { client, cache, config: a32Config() };
    const scale = await loadGradeScale(options);
    expect(scale.origin).toBe('organization');
    expect(scale.toGrade(store.gradeIndex(9))).toBe(9);
    expect(scale.toIndex(9)).toBe(store.gradeIndex(9));
    await loadGradeScale(options);
    expect(requests.filter((url) => url.includes('user_organizations')).length).toBe(1);
  });

  it('falls back to the identity, and says so, when the server refuses the read', async () => {
    refuseOrganization = true;
    const scale = await loadGradeScale({ client, cache, config: a32Config() });
    expect(scale.origin).toBe('fallback');
    expect(scale.toGrade(9)).toBe(9);
  });
});
