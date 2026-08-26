/**
 * The one link out to Planning Center's own web app.
 *
 * Three screens used to hold private copies of this template, which is the kind
 * of string nobody notices drifting until a link quietly stops resolving. The
 * `AC` prefix is the part worth pinning: the web app addresses people by a
 * prefixed id while the API returns the bare number, and everything Tally holds
 * is the API's form.
 */
import { describe, expect, it } from 'vitest';
import { pcoPersonUrl } from '@/lib/planningCenter';

describe('pcoPersonUrl', () => {
  it('addresses the person the way the web app does', () => {
    expect(pcoPersonUrl('123')).toBe('https://people.planningcenteronline.com/people/AC123');
  });

  it('adds the prefix rather than expecting one to be stored', () => {
    expect(pcoPersonUrl('98765432')).toBe(
      'https://people.planningcenteronline.com/people/AC98765432',
    );
  });
});
