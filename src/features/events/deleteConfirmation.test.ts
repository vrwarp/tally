/**
 * What counts as having typed the phrase.
 *
 * The interesting cases are the two edges. Too strict and a phone's
 * autocapitalise makes a leader retype a gathering's name three times, which
 * teaches them to copy and paste it — and a phrase that gets pasted has stopped
 * being read, which was the entire point of asking for it. Too loose and the
 * confirmation stops distinguishing one gathering from another, which is the
 * mistake the chain phrase exists to catch.
 */
import { describe, expect, it } from 'vitest';
import {
  EVENT_PHRASE,
  UNTITLED_CHAIN_PHRASE,
  confirmationPhrase,
  matchesConfirmation,
} from '@/features/events/deleteConfirmation';

describe('confirmationPhrase', () => {
  it('asks for one word for a single gathering', () => {
    expect(confirmationPhrase({ scope: 'event', title: 'Friday Fellowship' })).toBe(EVENT_PHRASE);
  });

  it('asks for the gathering by name for a whole chain', () => {
    expect(confirmationPhrase({ scope: 'chain', title: 'Friday Fellowship' })).toBe(
      'Friday Fellowship',
    );
  });

  it('tidies the whitespace it asks somebody to reproduce', () => {
    expect(confirmationPhrase({ scope: 'chain', title: '  Friday   Fellowship\n' })).toBe(
      'Friday Fellowship',
    );
  });

  it('falls back to a phrase when the gathering has no title', () => {
    expect(confirmationPhrase({ scope: 'chain', title: '   ' })).toBe(UNTITLED_CHAIN_PHRASE);
  });
});

describe('matchesConfirmation', () => {
  it('accepts the phrase typed exactly', () => {
    expect(matchesConfirmation('DELETE', 'DELETE')).toBe(true);
  });

  it('forgives the case a phone keyboard chose', () => {
    expect(matchesConfirmation('delete', 'DELETE')).toBe(true);
    expect(matchesConfirmation('Friday fellowship', 'Friday Fellowship')).toBe(true);
  });

  it('forgives surrounding and doubled whitespace', () => {
    expect(matchesConfirmation('  Friday  Fellowship ', 'Friday Fellowship')).toBe(true);
  });

  it('refuses a different gathering', () => {
    expect(matchesConfirmation('Sunday Fellowship', 'Friday Fellowship')).toBe(false);
  });

  it('refuses a prefix of the phrase', () => {
    expect(matchesConfirmation('Friday', 'Friday Fellowship')).toBe(false);
    expect(matchesConfirmation('DEL', 'DELETE')).toBe(false);
  });

  it('refuses an empty box', () => {
    expect(matchesConfirmation('', 'DELETE')).toBe(false);
    expect(matchesConfirmation('   ', 'DELETE')).toBe(false);
  });

  it('refuses everything when there is no phrase to match', () => {
    expect(matchesConfirmation('', '')).toBe(false);
    expect(matchesConfirmation('anything', '  ')).toBe(false);
  });
});
