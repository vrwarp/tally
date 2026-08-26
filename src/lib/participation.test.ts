import { describe, expect, it } from 'vitest';
import {
  buildChainScopes,
  thresholdFor,
  PARTICIPATION_MAX_AGE_DAYS,
  type ChainInstance,
} from './participation';

const NOW = new Date('2026-08-06T19:00:00Z');
const DAY_MS = 86_400_000;

/** `n` days before `NOW`. */
function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * DAY_MS);
}

function instance(
  chain: string,
  days: number,
  present: string[],
  cancelled = false,
): ChainInstance {
  return { chain, startAt: daysAgo(days), cancelled, presentStudentIds: present };
}

const RULE = { ofLastN: 3, minAttended: 2 };

describe('thresholdFor', () => {
  it('clamps the requirement to the history that exists', () => {
    expect(thresholdFor(2, 3)).toBe(2);
    expect(thresholdFor(2, 1)).toBe(1);
    expect(thresholdFor(5, 3)).toBe(3);
  });

  it('is unreachable with no history at all', () => {
    expect(thresholdFor(2, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(thresholdFor(2, -1)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('buildChainScopes', () => {
  it('separates the year-wide list from the prediction', () => {
    const scopes = buildChainScopes(
      [
        instance('friday', 7, ['ada', 'bo']),
        instance('friday', 14, ['ada', 'bo']),
        instance('friday', 21, ['ada']),
        instance('friday', 200, ['cyd']),
      ],
      RULE,
      NOW,
    );

    const friday = scopes.get('friday')!;
    // Everyone through the door in the last year, however long ago.
    expect(friday.participated).toEqual(['ada', 'bo', 'cyd']);
    // 2 of the last 3: Ada three times, Bo twice, Cyd not in the window at all.
    expect(friday.recent).toEqual(['ada', 'bo']);
  });

  it('keeps recent a subset of participated', () => {
    const scopes = buildChainScopes(
      [instance('friday', 7, ['ada']), instance('friday', 14, ['ada'])],
      RULE,
      NOW,
    );
    const friday = scopes.get('friday')!;
    for (const id of friday.recent) expect(friday.participated).toContain(id);
  });

  it('never crosses chains', () => {
    const scopes = buildChainScopes(
      [
        instance('friday', 7, ['ada']),
        instance('friday', 14, ['ada']),
        instance('sunday', 7, ['bo']),
        instance('sunday', 14, ['bo']),
      ],
      RULE,
      NOW,
    );
    expect(scopes.get('friday')).toEqual({ participated: ['ada'], recent: ['ada'] });
    expect(scopes.get('sunday')).toEqual({ participated: ['bo'], recent: ['bo'] });
  });

  describe('the year boundary', () => {
    it('counts an instance a day inside it', () => {
      const scopes = buildChainScopes(
        [instance('friday', PARTICIPATION_MAX_AGE_DAYS - 1, ['ada'])],
        RULE,
        NOW,
      );
      expect(scopes.get('friday')?.participated).toEqual(['ada']);
    });

    it('counts one exactly on it', () => {
      // A year to the day is still inside the year. The boundary matters
      // because the nightly build runs against a rolling window: a chain that
      // meets weekly has an instance land on it about once a week, and moving
      // the edge by one comparison drops a real Friday out of the roster.
      const scopes = buildChainScopes(
        [instance('friday', PARTICIPATION_MAX_AGE_DAYS, ['ada'])],
        RULE,
        NOW,
      );
      expect(scopes.get('friday')?.participated).toEqual(['ada']);
    });

    it('drops an instance a day outside it', () => {
      const scopes = buildChainScopes(
        [instance('friday', PARTICIPATION_MAX_AGE_DAYS + 1, ['ada'])],
        RULE,
        NOW,
      );
      expect(scopes.has('friday')).toBe(false);
    });
  });

  it('never reads an instance that has not happened yet', () => {
    const ahead: ChainInstance = {
      chain: 'friday',
      startAt: new Date(NOW.getTime() + DAY_MS),
      cancelled: false,
      presentStudentIds: ['ada'],
    };
    expect(buildChainScopes([ahead], RULE, NOW).has('friday')).toBe(false);
  });

  it('does not read the gathering happening right now', () => {
    /*
     * Tonight's own register is not evidence about tonight. The kiosk asks this
     * question *at* the gathering, while people are walking in — so a window
     * that included the instance it is scoping for would decide who is a
     * regular from whoever happened to arrive first.
     */
    const tonight: ChainInstance = {
      chain: 'friday',
      startAt: NOW,
      cancelled: false,
      presentStudentIds: ['ada'],
    };
    expect(buildChainScopes([tonight], RULE, NOW).has('friday')).toBe(false);
  });

  /*
   * The ordering this whole module is arranged around. A night that did not
   * happen must cost the window nothing — if it consumed one of the three
   * slots, every regular in the ministry would need 2 of the 2 that remain.
   */
  describe('a gathering that did not happen', () => {
    it('costs the prediction window nothing when it was cancelled', () => {
      const scopes = buildChainScopes(
        [
          instance('friday', 7, ['ada'], true),
          instance('friday', 14, ['ada', 'bo']),
          instance('friday', 21, ['ada', 'bo']),
          instance('friday', 28, ['ada', 'bo']),
        ],
        RULE,
        NOW,
      );
      expect(scopes.get('friday')?.recent).toEqual(['ada', 'bo']);
    });

    it('costs it nothing when nobody was ever checked in', () => {
      const scopes = buildChainScopes(
        [
          instance('friday', 7, []),
          instance('friday', 14, ['ada', 'bo']),
          instance('friday', 21, ['ada', 'bo']),
          instance('friday', 28, ['ada', 'bo']),
        ],
        RULE,
        NOW,
      );
      expect(scopes.get('friday')?.recent).toEqual(['ada', 'bo']);
    });
  });

  it('reads the last three by date, whatever order they arrive in', () => {
    /*
     * Instances come off a query that is ordered by nothing in particular, and
     * the window is the *newest* three rather than the first three seen. Ada
     * has been to the last three; Cyd came to the three before that and has not
     * been since. Read in arrival order the two would swap places, and the
     * kiosk would tick a box beside a student who stopped coming in the spring.
     */
    const scopes = buildChainScopes(
      [
        instance('friday', 90, ['cyd']),
        instance('friday', 7, ['ada']),
        instance('friday', 97, ['cyd']),
        instance('friday', 21, ['ada']),
        instance('friday', 104, ['cyd']),
        instance('friday', 14, ['ada']),
      ],
      RULE,
      NOW,
    );

    expect(scopes.get('friday')?.recent).toEqual(['ada']);
  });

  it('counts only the last N, not everything in the year', () => {
    // Cyd made two of the six, which is 2 of 6 — but the rule is 2 of the last
    // 3, and Cyd is in neither of those. Widening the window to the whole year
    // is how "a regular now" quietly becomes "came twice, ever".
    const scopes = buildChainScopes(
      [
        instance('friday', 7, ['ada']),
        instance('friday', 14, ['ada']),
        instance('friday', 21, ['ada']),
        instance('friday', 28, ['cyd']),
        instance('friday', 35, ['cyd']),
      ],
      RULE,
      NOW,
    );

    expect(scopes.get('friday')?.participated).toEqual(['ada', 'cyd']);
    expect(scopes.get('friday')?.recent).toEqual(['ada']);
  });

  it('leaves out somebody who came to the window once', () => {
    // One of the last three is not two of the last three. A threshold that
    // waved through anybody seen at all would tick every visitor's box.
    const scopes = buildChainScopes(
      [
        instance('friday', 7, ['ada', 'bo']),
        instance('friday', 14, ['ada']),
        instance('friday', 21, ['ada']),
      ],
      RULE,
      NOW,
    );

    expect(scopes.get('friday')?.participated).toEqual(['ada', 'bo']);
    expect(scopes.get('friday')?.recent).toEqual(['ada']);
  });

  it('clamps the threshold to a chain that has only met once', () => {
    const scopes = buildChainScopes([instance('friday', 7, ['ada'])], RULE, NOW);
    // "2 of 3" against one Friday would leave nobody recent, which reads as a
    // broken feature rather than a young series.
    expect(scopes.get('friday')?.recent).toEqual(['ada']);
  });

  it('omits a chain with nothing to say rather than answering empty', () => {
    // A missing chain is what the kiosk reads as "no history to scope by".
    expect(buildChainScopes([instance('friday', 7, [])], RULE, NOW).has('friday')).toBe(false);
    expect(buildChainScopes([], RULE, NOW).size).toBe(0);
  });

  it('sorts both lists so an unchanged rebuild writes an unchanged document', () => {
    const scopes = buildChainScopes(
      [instance('friday', 7, ['zed', 'ada', 'moe']), instance('friday', 14, ['moe', 'zed', 'ada'])],
      RULE,
      NOW,
    );
    expect(scopes.get('friday')).toEqual({
      participated: ['ada', 'moe', 'zed'],
      recent: ['ada', 'moe', 'zed'],
    });
  });
});
