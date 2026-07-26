import { describe, expect, it } from 'vitest';
import { parsePcoErrorDebug, pcoErrorMarkdown, pcoErrorReport } from '@/lib/pcoErrors';
import type { PcoErrorDebug } from '@/types';

const at = () => new Date('2026-02-13T19:30:00Z');

/** What a Cloud Function actually attaches, verbatim from functions/src/pco/debug.ts. */
const DEBUG: PcoErrorDebug = {
  kind: 'api',
  operation: 'load your Planning Center lists',
  occurredAt: '2026-02-13T19:29:58.000Z',
  message: 'Planning Center 500 for https://api.planningcenteronline.com/people/v2/lists',
  request: {
    method: 'GET',
    url: 'https://api.planningcenteronline.com/people/v2/lists?per_page=100&offset=0',
    headers: { Authorization: '[redacted]', Accept: 'application/json' },
    attempts: 5,
  },
  response: {
    status: 500,
    statusText: 'Internal Server Error',
    headers: { 'content-type': 'application/json' },
    body: '{"errors":[{"title":"Server error"}]}',
    bodyTruncated: false,
    durationMs: 412,
  },
  errors: ['Server error'],
};

/** A callable failure, as `firebase/functions` hands it to a `.catch`. */
function callableError(message: string, code: string, details: unknown): Error {
  return Object.assign(new Error(message), { code, details });
}

describe('pcoErrorReport', () => {
  it('keeps the message, the code and the details the server attached', () => {
    const report = pcoErrorReport(
      callableError('Could not reach Planning Center to load your Planning Center lists.', 'functions/unavailable', DEBUG),
      'Could not read your Planning Center lists.',
      at,
    );

    expect(report.message).toBe(
      'Could not reach Planning Center to load your Planning Center lists.',
    );
    expect(report.code).toBe('functions/unavailable');
    expect(report.reportedAt).toBe('2026-02-13T19:30:00.000Z');
    expect(report.debug?.response?.status).toBe(500);
  });

  it('falls back to the caller’s sentence when the error has nothing to say', () => {
    const report = pcoErrorReport({ nope: true }, 'Could not import that list.', at);

    expect(report.message).toBe('Could not import that list.');
    expect(report.code).toBeNull();
    expect(report.debug).toBeNull();
  });

  it('reads a failure that never reached Planning Center as no debug at all', () => {
    const report = pcoErrorReport(
      callableError('Only the core team can do that.', 'functions/permission-denied', undefined),
      'Could not add that student.',
      at,
    );

    expect(report.message).toBe('Only the core team can do that.');
    expect(report.code).toBe('functions/permission-denied');
    expect(report.debug).toBeNull();
  });
});

describe('parsePcoErrorDebug', () => {
  it('refuses a payload it does not recognise rather than half-reading it', () => {
    expect(parsePcoErrorDebug(null)).toBeNull();
    expect(parsePcoErrorDebug('boom')).toBeNull();
    expect(parsePcoErrorDebug({ kind: 'teapot' })).toBeNull();
  });

  it('fills in what an older or newer function version left out', () => {
    const debug = parsePcoErrorDebug({
      kind: 'network',
      operation: 'load the roster',
      request: { method: 'GET', url: 'https://example.test/people' },
      response: { status: 'five hundred' },
      errors: ['Error: fetch failed', 42],
    });

    expect(debug?.occurredAt).toBe('');
    expect(debug?.request?.attempts).toBe(1);
    expect(debug?.request?.headers).toEqual({});
    // A response with no numeric status is not a response anybody can use.
    expect(debug?.response).toBeNull();
    expect(debug?.errors).toEqual(['Error: fetch failed']);
  });
});

describe('pcoErrorMarkdown', () => {
  const markdown = (debug: PcoErrorDebug | null, message = 'Could not reach Planning Center.') =>
    pcoErrorMarkdown({ message, code: 'functions/unavailable', reportedAt: '2026-02-13T19:30:00.000Z', debug });

  it('writes the whole exchange out for a paste into a message', () => {
    const text = markdown(DEBUG);

    expect(text).toContain('## Planning Center error');
    expect(text).toContain('- **Tally was trying to:** load your Planning Center lists');
    expect(text).toContain('- **Error code:** `functions/unavailable`');
    expect(text).toContain('- **When:** 2026-02-13T19:29:58.000Z');
    expect(text).toContain('GET https://api.planningcenteronline.com/people/v2/lists?per_page=100&offset=0');
    expect(text).toContain('Authorization: [redacted]');
    expect(text).toContain('Sent 5 times');
    expect(text).toContain('HTTP 500 Internal Server Error — 412 ms');
    // JSON is re-indented, because the point is that somebody reads it.
    expect(text).toContain('```json\n{\n  "errors": [');
    expect(text).toContain('- Server error');
  });

  it('says plainly when there is no request to show', () => {
    const text = markdown(null, 'Only the core team can do that.');

    expect(text).toContain('- **What the screen said:** Only the core team can do that.');
    expect(text).toContain('failed before it reached Planning Center');
    expect(text).not.toContain('### Request');
  });

  it('does not repeat the banner sentence as the underlying error', () => {
    const text = markdown({ ...DEBUG, message: 'Could not reach Planning Center.' });

    expect(text).not.toContain('**Underlying error:**');
  });

  it('fences a body that contains a fence of its own', () => {
    const text = markdown({
      ...DEBUG,
      response: { ...DEBUG.response!, body: 'Cloudflare says:\n```\nblocked\n```', bodyTruncated: true },
    });

    expect(text).toContain('````\nCloudflare says:');
    expect(text).toContain('_Body truncated by Tally._');
  });

  it('notes an empty body rather than leaving a blank block', () => {
    const text = markdown({ ...DEBUG, response: { ...DEBUG.response!, body: '   ' } });

    expect(text).toContain('_Planning Center sent an empty body._');
  });
});
