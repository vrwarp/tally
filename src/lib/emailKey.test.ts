/**
 * One mailbox, one key — and only for the mailboxes that work that way.
 *
 * Both directions matter. A Gmail invitation typed without dots has to match
 * the dotted address Google's token carries, or a counselor who was added on
 * Tuesday is refused on Sunday. And a Workspace address with dots must *not*
 * match one without, or two members of staff become one account with the
 * higher role.
 *
 * The key must stay identical to `functions/src/pco/mapping.ts`, which spells
 * it out in its own test; a change here that is not made there fails one of
 * the two.
 */
import { describe, expect, it } from 'vitest';
import { canonicalEmail, emailKey, sameAccount } from '@/lib/emailKey';

describe('canonicalEmail', () => {
  it('lowercases and trims, whatever the domain', () => {
    expect(canonicalEmail('  Jo.Smith@Church.ORG ')).toBe('jo.smith@church.org');
  });

  it('drops the dots from a Gmail local part', () => {
    expect(canonicalEmail('jo.smith@gmail.com')).toBe('josmith@gmail.com');
    expect(canonicalEmail('j.o.s.m.i.t.h@gmail.com')).toBe('josmith@gmail.com');
  });

  it('drops a +tag from a Gmail local part', () => {
    expect(canonicalEmail('josmith+tally@gmail.com')).toBe('josmith@gmail.com');
    expect(canonicalEmail('jo.smith+church+2026@gmail.com')).toBe('josmith@gmail.com');
  });

  it('reads googlemail.com as gmail.com', () => {
    expect(canonicalEmail('Jo.Smith@googlemail.com')).toBe('josmith@gmail.com');
  });

  it('keeps the dots on every other domain, Workspace included', () => {
    // Dots are significant everywhere but consumer Gmail; a rule that merged
    // them would merge two real staff.
    expect(canonicalEmail('jo.smith@church.org')).toBe('jo.smith@church.org');
    expect(canonicalEmail('jo.smith@example.org')).not.toBe(canonicalEmail('josmith@example.org'));
  });

  it('keeps a +tag on every other domain', () => {
    expect(canonicalEmail('jo+tally@church.org')).toBe('jo+tally@church.org');
  });

  it('leaves a dot in a Gmail lookalike domain alone', () => {
    expect(canonicalEmail('jo.smith@gmail.com.example.org')).toBe('jo.smith@gmail.com.example.org');
    expect(canonicalEmail('jo.smith@notgmail.com')).toBe('jo.smith@notgmail.com');
  });

  it('does nothing clever with something that is not an address', () => {
    expect(canonicalEmail('  Not An Address ')).toBe('not an address');
  });
});

describe('emailKey', () => {
  it('folds case and turns the dots into commas', () => {
    expect(emailKey('Sam.Smith@Example.org')).toBe('sam,smith@example,org');
  });

  it('trims, because an address pasted into a form carries whitespace', () => {
    expect(emailKey('  sam@example.org  ')).toBe('sam@example,org');
  });

  it('replaces every dot, not just the first', () => {
    expect(emailKey('a.b.c@d.e.f')).toBe('a,b,c@d,e,f');
  });

  it('is one id for every spelling of a Gmail mailbox', () => {
    const key = emailKey('josmith@gmail.com');
    expect(emailKey('jo.smith@gmail.com')).toBe(key);
    expect(emailKey('Jo.Smith+tally@googlemail.com')).toBe(key);
    expect(key).toBe('josmith@gmail,com');
  });

  it('is still a Firestore document id', () => {
    // No slashes, no dots — a segment, not a path.
    expect(emailKey('jo.smith+tally@googlemail.com')).not.toMatch(/[./]/);
  });
});

describe('sameAccount', () => {
  it('matches a dotted Gmail sign-in to an invitation typed without dots', () => {
    expect(sameAccount('jo.smith@gmail.com', 'josmith@gmail.com')).toBe(true);
  });

  it('matches googlemail.com to gmail.com', () => {
    expect(sameAccount('josmith@googlemail.com', 'josmith@gmail.com')).toBe(true);
  });

  it('matches across case and whitespace', () => {
    expect(sameAccount(' Jo.Smith@Church.org', 'jo.smith@church.org ')).toBe(true);
  });

  it('does not match a Workspace address with dots to one without', () => {
    expect(sameAccount('jo.smith@church.org', 'josmith@church.org')).toBe(false);
  });

  it('does not match two different mailboxes', () => {
    expect(sameAccount('jo@gmail.com', 'jo@church.org')).toBe(false);
    expect(sameAccount('jo@gmail.com', 'joe@gmail.com')).toBe(false);
  });
});
