/**
 * The Attendees configuration the simulator suites run on — the values the
 * seeded organization answers to, mirroring what `setup_tally_integration`
 * would print for it.
 */
import {
  DEFAULT_TOKEN,
  SIMULATOR_ORIGIN,
} from '../../../tools/a32-simulator/src/index.js';
import type { A32Config } from '../config.js';

export function a32Config(overrides: Partial<A32Config> = {}): A32Config {
  return {
    token: DEFAULT_TOKEN,
    baseUrl: SIMULATOR_ORIGIN,
    divisionId: '11',
    meetSlug: 'simorg_tally_gathering',
    characterSlug: 'simorg_tally_student',
    assemblySlug: 'simorg_tally_youth_ministry',
    writeBack: 'create',
    minGrade: 6,
    maxGrade: 12,
    cacheTtlSeconds: 30,
    enabled: true,
    managedInApp: false,
    configError: null,
    ...overrides,
  };
}
