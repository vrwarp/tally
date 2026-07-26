/**
 * The cost of getting this wrong is asymmetric, and the tests are shaped
 * around that. Resolving to a domain that is *not* registered with Google does
 * not degrade the flow, it ends it — `redirect_uri_mismatch`, nobody signs in.
 * So the cases that matter most are the ones where resolution must decline:
 * an unlisted host, a preview channel, a dev server, a typo in the variable.
 */
import { describe, expect, it } from 'vitest';
import { hostOf, parseAuthDomains, resolveAuthDomain } from '@/lib/authDomain';

const DEFAULT = 'tally-76406.firebaseapp.com';

describe('hostOf', () => {
  it('accepts a bare host', () => {
    expect(hostOf('tally.example.org')).toBe('tally.example.org');
  });

  it('strips the scheme and path an operator pastes from a browser bar', () => {
    expect(hostOf('https://tally.example.org/')).toBe('tally.example.org');
    expect(hostOf('https://tally.example.org/login?next=/')).toBe('tally.example.org');
  });

  it('keeps a port, which a dev server needs', () => {
    expect(hostOf('localhost:5173')).toBe('localhost:5173');
  });

  it('lower-cases, because host comparison is case-insensitive', () => {
    expect(hostOf('Tally.Example.ORG')).toBe('tally.example.org');
  });

  it('returns undefined for nothing useful rather than throwing', () => {
    expect(hostOf(undefined)).toBeUndefined();
    expect(hostOf('')).toBeUndefined();
    expect(hostOf('   ')).toBeUndefined();
    expect(hostOf('https://')).toBeUndefined();
  });
});

describe('parseAuthDomains', () => {
  it('reads a comma-separated list', () => {
    expect(parseAuthDomains('tally.example.org,tally-76406.web.app')).toEqual([
      'tally.example.org',
      'tally-76406.web.app',
    ]);
  });

  it('tolerates whitespace, newlines and stray commas', () => {
    expect(parseAuthDomains(' tally.example.org , \n tally-76406.web.app ')).toEqual([
      'tally.example.org',
      'tally-76406.web.app',
    ]);
  });

  it('de-duplicates, including across spellings of the same host', () => {
    expect(parseAuthDomains('tally.example.org, https://Tally.Example.org/')).toEqual([
      'tally.example.org',
    ]);
  });

  it('drops unparseable entries instead of failing the app at startup', () => {
    expect(parseAuthDomains('tally.example.org, ://nope')).toEqual(['tally.example.org']);
  });

  it('treats an unset variable as no declared domains', () => {
    expect(parseAuthDomains(undefined)).toEqual([]);
    expect(parseAuthDomains('')).toEqual([]);
  });
});

describe('resolveAuthDomain', () => {
  it('makes the handler first-party when the host is declared', () => {
    expect(
      resolveAuthDomain({
        configured: DEFAULT,
        publicDomains: ['tally.example.org'],
        host: 'tally.example.org',
      }),
    ).toBe('tally.example.org');
  });

  /**
   * The whole reason the list is matched at runtime rather than baked in: one
   * build is reached at several hosts and has to be right at each of them.
   */
  it('picks whichever declared domain is actually being browsed', () => {
    const publicDomains = ['tally.example.org', 'tally-76406.web.app'];
    expect(resolveAuthDomain({ configured: DEFAULT, publicDomains, host: 'tally-76406.web.app' })).toBe(
      'tally-76406.web.app',
    );
    expect(resolveAuthDomain({ configured: DEFAULT, publicDomains, host: 'tally.example.org' })).toBe(
      'tally.example.org',
    );
  });

  it('leaves the console default alone on an undeclared host', () => {
    expect(
      resolveAuthDomain({
        configured: DEFAULT,
        publicDomains: ['tally.example.org'],
        host: 'tally-76406--pr-12-a1b2c3d4.web.app',
      }),
    ).toBe(DEFAULT);
  });

  it('leaves a dev server alone, so localhost keeps the popup', () => {
    expect(
      resolveAuthDomain({
        configured: DEFAULT,
        publicDomains: ['tally.example.org'],
        host: 'localhost:5173',
      }),
    ).toBe(DEFAULT);
  });

  it('declares nothing when the variable is unset', () => {
    expect(
      resolveAuthDomain({ configured: DEFAULT, publicDomains: [], host: 'tally.example.org' }),
    ).toBe(DEFAULT);
  });

  it('compares hosts, not the strings an operator happened to type', () => {
    expect(
      resolveAuthDomain({
        configured: DEFAULT,
        publicDomains: ['https://Tally.Example.org/'],
        host: 'tally.example.org',
      }),
    ).toBe('tally.example.org');
  });

  it('falls back to the configured value when there is no host to compare', () => {
    expect(
      resolveAuthDomain({ configured: DEFAULT, publicDomains: ['tally.example.org'], host: undefined }),
    ).toBe(DEFAULT);
  });
});
