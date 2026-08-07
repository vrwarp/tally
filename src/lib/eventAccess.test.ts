import { describe, expect, it } from 'vitest';
import { canWorkChain, type ChainAccess } from '@/lib/eventAccess';

const MEMBER = 'uid-miriam';
const OUTSIDER = 'uid-sam';

function access(overrides: Partial<ChainAccess> = {}): ChainAccess {
  return { restricted: true, members: [MEMBER], ...overrides };
}

describe('canWorkChain', () => {
  describe('the gathering nobody has restricted', () => {
    /*
     * The hot path, and the whole migration story. Every deployment starts
     * with no `eventAccess` document anywhere and most gatherings stay that
     * way, so "undefined" is the ordinary answer rather than an edge case. If
     * this pair ever went red, shipping the feature would take the app dark.
     */
    it('admits anybody when there is no document', () => {
      expect(canWorkChain(undefined, OUTSIDER, false)).toBe(true);
    });

    it('admits anybody when a document exists but is not restricted', () => {
      // Re-opening writes `restricted: false` rather than deleting, so this
      // shape is what a gathering that was once locked looks like.
      expect(canWorkChain(access({ restricted: false, members: [MEMBER] }), OUTSIDER, false)).toBe(
        true,
      );
    });
  });

  describe('the gathering somebody has restricted', () => {
    it('admits a member', () => {
      expect(canWorkChain(access(), MEMBER, false)).toBe(true);
    });

    it('refuses everybody else', () => {
      expect(canWorkChain(access(), OUTSIDER, false)).toBe(false);
    });

    it('refuses an empty list rather than treating it as open', () => {
      // A restricted gathering with nobody on it is somebody's mistake, and
      // the safe reading of a mistake is "ask an admin", not "let everybody
      // in". `restricted` is the switch; `members` is not a second one.
      expect(canWorkChain(access({ members: [] }), OUTSIDER, false)).toBe(false);
    });
  });

  describe('admins', () => {
    it('pass a gathering they are not on', () => {
      // Break-glass, and deliberate: the mistake this feature makes easiest is
      // one core member restricting the gathering the whole ministry works.
      // Somebody has to be able to undo that without a database console.
      expect(canWorkChain(access(), OUTSIDER, true)).toBe(true);
    });
  });

  describe('the two shapes of members', () => {
    it('accepts the stored array', () => {
      // What the functions and a raw document hold.
      expect(canWorkChain({ restricted: true, members: [MEMBER] }, MEMBER, false)).toBe(true);
    });

    it('accepts the hydrated set', () => {
      // What the client holds, so a membership test on a long list is not a
      // linear scan on every render.
      expect(canWorkChain({ restricted: true, members: new Set([MEMBER]) }, MEMBER, false)).toBe(
        true,
      );
      expect(canWorkChain({ restricted: true, members: new Set([MEMBER]) }, OUTSIDER, false)).toBe(
        false,
      );
    });
  });
});
