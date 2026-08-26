/**
 * Reading a failed Planning Center call, and writing it down for somebody else.
 *
 * The markdown is the deliverable: it goes on a clipboard and into a message to
 * whoever set the connection up, so it is asserted whole rather than by
 * fragments. A test that only checks a report *contains* `### Request` passes
 * while every label around it says something else.
 *
 * The parser has the opposite worry. The payload crosses a JSON boundary from a
 * Cloud Function that deploys separately, so a browser can meet last month's
 * shape or next month's, and every field has to survive being the wrong type,
 * missing, or an outright lie without the debug panel throwing on a screen
 * whose whole purpose is that something already went wrong.
 */
import { describe, expect, it } from 'vitest';
import {
  describeKind,
  parsePcoErrorDebug,
  pcoErrorMarkdown,
  pcoErrorReport,
  prettyBody,
} from '@/lib/pcoErrors';
import type { PcoErrorDebug, PcoErrorReport } from '@/types';

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

function report(overrides: Partial<PcoErrorReport> = {}): PcoErrorReport {
  return {
    message: 'Could not reach Planning Center.',
    code: 'functions/unavailable',
    reportedAt: '2026-02-13T19:30:00.000Z',
    debug: null,
    ...overrides,
  };
}

describe('pcoErrorReport', () => {
  it('keeps the message, the code and the details the server attached', () => {
    const result = pcoErrorReport(
      callableError(
        'Could not reach Planning Center to load your Planning Center lists.',
        'functions/unavailable',
        DEBUG,
      ),
      'Could not read your Planning Center lists.',
      at,
    );

    expect(result).toEqual({
      message: 'Could not reach Planning Center to load your Planning Center lists.',
      code: 'functions/unavailable',
      reportedAt: '2026-02-13T19:30:00.000Z',
      debug: DEBUG,
    });
  });

  it('falls back to the caller’s sentence when the error has nothing to say', () => {
    const result = pcoErrorReport({ nope: true }, 'Could not import that list.', at);

    expect(result.message).toBe('Could not import that list.');
    expect(result.code).toBeNull();
    expect(result.debug).toBeNull();
  });

  it('falls back for an Error whose message is empty', () => {
    // `new Error()` is what a rejected `fetch` looks like in some browsers, and
    // an empty banner is worse than the caller's sentence.
    expect(pcoErrorReport(new Error(''), 'Could not import that list.', at).message).toBe(
      'Could not import that list.',
    );
  });

  it('does not take a message off something that is not an Error', () => {
    // A plain object with a `message` is somebody else's shape; reading it
    // would put an unreviewed string in front of a leader.
    expect(pcoErrorReport({ message: 'raw internal detail' }, 'Could not import.', at).message).toBe(
      'Could not import.',
    );
  });

  it('reads a failure that never reached Planning Center as no debug at all', () => {
    const result = pcoErrorReport(
      callableError('Only the core team can do that.', 'functions/permission-denied', undefined),
      'Could not add that student.',
      at,
    );

    expect(result.message).toBe('Only the core team can do that.');
    expect(result.code).toBe('functions/permission-denied');
    expect(result.debug).toBeNull();
  });

  it('reads a code that is not a string as no code', () => {
    expect(pcoErrorReport({ code: 500 }, 'Could not import.', at).code).toBeNull();
  });

  it('stamps the time from the clock it was handed', () => {
    expect(pcoErrorReport(null, 'Could not import.', () => new Date(0)).reportedAt).toBe(
      '1970-01-01T00:00:00.000Z',
    );
  });

  it('reads the clock by default rather than leaving the field blank', () => {
    const before = Date.now();
    const stamped = Date.parse(pcoErrorReport(null, 'Could not import.').reportedAt);

    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(Date.now());
  });

  it('survives every shape a catch block can hand it', () => {
    for (const thrown of [null, undefined, 'boom', 42, [], () => {}]) {
      expect(() => pcoErrorReport(thrown, 'Could not import.', at)).not.toThrow();
    }
  });
});

describe('parsePcoErrorDebug', () => {
  it('reads a whole payload back unchanged', () => {
    expect(parsePcoErrorDebug(structuredClone(DEBUG))).toEqual(DEBUG);
  });

  it('refuses a payload it does not recognise rather than half-reading it', () => {
    expect(parsePcoErrorDebug(null)).toBeNull();
    expect(parsePcoErrorDebug(undefined)).toBeNull();
    expect(parsePcoErrorDebug('boom')).toBeNull();
    expect(parsePcoErrorDebug(42)).toBeNull();
    expect(parsePcoErrorDebug({})).toBeNull();
    // The kind is the one field with no sensible default: it decides the
    // sentence the panel leads with.
    expect(parsePcoErrorDebug({ kind: 'teapot' })).toBeNull();
    expect(parsePcoErrorDebug({ kind: 7 })).toBeNull();
  });

  it('accepts each of the three kinds and nothing else', () => {
    for (const kind of ['api', 'network', 'unknown'] as const) {
      expect(parsePcoErrorDebug({ kind })?.kind).toBe(kind);
    }
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
    expect(debug?.message).toBe('');
    expect(debug?.request?.attempts).toBe(1);
    expect(debug?.request?.headers).toEqual({});
    // A response with no numeric status is not a response anybody can use.
    expect(debug?.response).toBeNull();
    expect(debug?.errors).toEqual(['Error: fetch failed']);
  });

  it('reads a field of the wrong type as absent rather than rendering it', () => {
    const debug = parsePcoErrorDebug({
      kind: 'api',
      operation: 42,
      occurredAt: { at: 'now' },
      message: ['boom'],
      errors: 'Server error',
    });

    expect(debug?.operation).toBe('');
    expect(debug?.occurredAt).toBe('');
    expect(debug?.message).toBe('');
    // A string is iterable; splitting it into characters would print a bullet
    // list one letter long each.
    expect(debug?.errors).toEqual([]);
  });

  describe('the request', () => {
    it('needs both a method and a URL before it is a request at all', () => {
      const base = { kind: 'api' as const };

      expect(parsePcoErrorDebug({ ...base, request: { url: 'https://x.test' } })?.request).toBeNull();
      expect(parsePcoErrorDebug({ ...base, request: { method: 'GET' } })?.request).toBeNull();
      expect(parsePcoErrorDebug({ ...base, request: 'GET https://x.test' })?.request).toBeNull();
      expect(parsePcoErrorDebug({ ...base, request: null })?.request).toBeNull();
      expect(
        parsePcoErrorDebug({ ...base, request: { method: 'GET', url: 'https://x.test' } })?.request,
      ).toEqual({ method: 'GET', url: 'https://x.test', headers: {}, attempts: 1 });
    });

    it('counts one attempt when the server did not say', () => {
      // Not zero: the call was made, and "sent 0 times" is a lie about a
      // request whose response is printed underneath it.
      const request = { method: 'GET', url: 'https://x.test', attempts: '5' };

      expect(parsePcoErrorDebug({ kind: 'api', request })?.request?.attempts).toBe(1);
    });

    it('keeps a genuine attempt count', () => {
      const request = { method: 'GET', url: 'https://x.test', attempts: 5 };

      expect(parsePcoErrorDebug({ kind: 'api', request })?.request?.attempts).toBe(5);
    });

    it('keeps the headers that are strings and drops the rest', () => {
      const request = {
        method: 'GET',
        url: 'https://x.test',
        headers: { Accept: 'application/json', 'x-count': 3, 'x-list': ['a'], 'x-null': null },
      };

      expect(parsePcoErrorDebug({ kind: 'api', request })?.request?.headers).toEqual({
        Accept: 'application/json',
      });
    });

    it('reads headers that are not a map at all as none', () => {
      const request = { method: 'GET', url: 'https://x.test', headers: 'Accept: text/html' };

      expect(parsePcoErrorDebug({ kind: 'api', request })?.request?.headers).toEqual({});
    });
  });

  describe('the response', () => {
    it('needs a numeric status before it is a response at all', () => {
      const base = { kind: 'api' as const };

      expect(parsePcoErrorDebug({ ...base, response: { status: '500' } })?.response).toBeNull();
      expect(parsePcoErrorDebug({ ...base, response: {} })?.response).toBeNull();
      expect(parsePcoErrorDebug({ ...base, response: 500 })?.response).toBeNull();
    });

    it('fills the rest in without inventing any of it', () => {
      expect(parsePcoErrorDebug({ kind: 'api', response: { status: 500 } })?.response).toEqual({
        status: 500,
        statusText: '',
        headers: {},
        body: '',
        bodyTruncated: false,
        durationMs: 0,
      });
    });

    it('keeps each field when the server sent it', () => {
      const response = {
        status: 429,
        statusText: 'Too Many Requests',
        headers: { 'retry-after': '30' },
        body: 'slow down',
        bodyTruncated: true,
        durationMs: 90,
      };

      expect(parsePcoErrorDebug({ kind: 'api', response })?.response).toEqual(response);
    });

    it('only says a body was truncated when the server said exactly that', () => {
      // A truthy value is not the same claim, and this note tells a reader
      // that what they are looking at is incomplete.
      for (const value of ['true', 1, {}, null, undefined]) {
        const response = { status: 500, bodyTruncated: value };
        expect(parsePcoErrorDebug({ kind: 'api', response })?.response?.bodyTruncated).toBe(false);
      }
    });

    it('reads a duration that is not a number as none', () => {
      const response = { status: 500, durationMs: '412' };

      expect(parsePcoErrorDebug({ kind: 'api', response })?.response?.durationMs).toBe(0);
    });
  });
});

describe('prettyBody', () => {
  it('re-indents JSON, because the point is that somebody reads it', () => {
    expect(prettyBody('{"errors":[{"title":"Server error"}]}')).toEqual({
      text: '{\n  "errors": [\n    {\n      "title": "Server error"\n    }\n  ]\n}',
      json: true,
    });
  });

  it('shows anything else exactly as it was sent', () => {
    // An HTML error page, or a proxy's plain text. Reformatting it would lose
    // the one detail somebody is squinting for.
    expect(prettyBody('<html>\n  <body>502</body>\n</html>')).toEqual({
      text: '<html>\n  <body>502</body>\n</html>',
      json: false,
    });
  });

  it('keeps the surrounding whitespace of a body that is not JSON', () => {
    expect(prettyBody('  not json  ').text).toBe('  not json  ');
  });

  it('reads a body that is only whitespace as no body', () => {
    expect(prettyBody('   \n\t ')).toEqual({ text: '', json: false });
    expect(prettyBody('')).toEqual({ text: '', json: false });
  });

  it('reads a bare JSON scalar as JSON', () => {
    expect(prettyBody('null')).toEqual({ text: 'null', json: true });
    expect(prettyBody('42')).toEqual({ text: '42', json: true });
  });
});

describe('describeKind', () => {
  it('says which of the three happened, in words', () => {
    expect(describeKind('api')).toBe('Planning Center answered with an error');
    expect(describeKind('network')).toBe('Planning Center could not be reached');
    expect(describeKind('unknown')).toBe('Unrecognised failure');
  });
});

describe('pcoErrorMarkdown', () => {
  it('writes the whole exchange out for a paste into a message', () => {
    expect(pcoErrorMarkdown(report({ debug: DEBUG }))).toBe(
      [
        '## Planning Center error',
        '',
        '- **Tally was trying to:** load your Planning Center lists',
        '- **What the screen said:** Could not reach Planning Center.',
        '- **Underlying error:** Planning Center 500 for https://api.planningcenteronline.com/people/v2/lists',
        '- **Error code:** `functions/unavailable`',
        '- **Failure kind:** Planning Center answered with an error',
        '- **When:** 2026-02-13T19:29:58.000Z',
        '',
        '### Request',
        '',
        '```http',
        'GET https://api.planningcenteronline.com/people/v2/lists?per_page=100&offset=0',
        'Authorization: [redacted]',
        'Accept: application/json',
        '```',
        '',
        'Sent 5 times (Tally retried before giving up).',
        '',
        '### Response',
        '',
        '```http',
        'HTTP 500 Internal Server Error — 412 ms',
        'content-type: application/json',
        '```',
        '',
        '```json',
        '{',
        '  "errors": [',
        '    {',
        '      "title": "Server error"',
        '    }',
        '  ]',
        '}',
        '```',
        '',
        '### Errors',
        '',
        '- Server error',
        '',
      ].join('\n'),
    );
  });

  it('says plainly when there is no request to show', () => {
    expect(
      pcoErrorMarkdown(
        report({ message: 'Only the core team can do that.', code: 'functions/permission-denied' }),
      ),
    ).toBe(
      [
        '## Planning Center error',
        '',
        '- **What the screen said:** Only the core team can do that.',
        '- **Error code:** `functions/permission-denied`',
        '- **When:** 2026-02-13T19:30:00.000Z',
        '',
        '_Tally has no request or response for this one: the call failed before it reached Planning Center._',
        '',
      ].join('\n'),
    );
  });

  it('leaves out every line it has no fact for', () => {
    const bare: PcoErrorDebug = {
      kind: 'network',
      operation: '',
      occurredAt: '',
      message: '',
      request: null,
      response: null,
      errors: [],
    };

    // Nothing here invents facts: a debug panel that guesses is worse than one
    // that admits it does not know.
    expect(pcoErrorMarkdown(report({ code: null, debug: bare }))).toBe(
      [
        '## Planning Center error',
        '',
        '- **What the screen said:** Could not reach Planning Center.',
        '- **Failure kind:** Planning Center could not be reached',
        '- **When:** 2026-02-13T19:30:00.000Z',
        '',
      ].join('\n'),
    );
  });

  it('falls back to when Tally noticed, when the server did not say when', () => {
    const debug = { ...DEBUG, occurredAt: '' };

    expect(pcoErrorMarkdown(report({ debug }))).toContain('- **When:** 2026-02-13T19:30:00.000Z');
  });

  it('does not repeat the banner sentence as the underlying error', () => {
    const text = pcoErrorMarkdown(
      report({ debug: { ...DEBUG, message: 'Could not reach Planning Center.' } }),
    );

    expect(text).not.toContain('**Underlying error:**');
  });

  it('says nothing about attempts when the call was made once', () => {
    const debug = { ...DEBUG, request: { ...DEBUG.request!, attempts: 1 } };

    expect(pcoErrorMarkdown(report({ debug }))).not.toContain('Tally retried');
  });

  it('counts the attempts from two upwards', () => {
    const debug = { ...DEBUG, request: { ...DEBUG.request!, attempts: 2 } };

    expect(pcoErrorMarkdown(report({ debug }))).toContain(
      'Sent 2 times (Tally retried before giving up).',
    );
  });

  it('drops the status text when the server sent none', () => {
    const debug = { ...DEBUG, response: { ...DEBUG.response!, statusText: '' } };

    expect(pcoErrorMarkdown(report({ debug }))).toContain('HTTP 500 — 412 ms');
  });

  it('fences a body that contains a fence of its own', () => {
    const text = pcoErrorMarkdown(
      report({
        debug: {
          ...DEBUG,
          response: {
            ...DEBUG.response!,
            body: 'Cloudflare says:\n```\nblocked\n```',
            bodyTruncated: true,
          },
        },
      }),
    );

    // Otherwise the rest of the report renders as prose in whoever's chat
    // window it landed in.
    expect(text).toContain('````\nCloudflare says:\n```\nblocked\n```\n````');
    expect(text).toContain('````\n\n_Body truncated by Tally._');
  });

  it('says nothing about truncation for a body that is whole', () => {
    expect(pcoErrorMarkdown(report({ debug: DEBUG }))).not.toContain('_Body truncated');
  });

  it('notes an empty body rather than leaving a blank block', () => {
    const debug = { ...DEBUG, response: { ...DEBUG.response!, body: '   ' } };
    const text = pcoErrorMarkdown(report({ debug }));

    expect(text).toContain('_Planning Center sent an empty body._');
    expect(text).not.toContain('```json');
  });

  it('leaves out the errors section when the payload carried none', () => {
    expect(pcoErrorMarkdown(report({ debug: { ...DEBUG, errors: [] } }))).not.toContain(
      '### Errors',
    );
  });

  it('lists every error the payload carried', () => {
    const debug = { ...DEBUG, errors: ['Server error', 'Rate limited'] };

    expect(pcoErrorMarkdown(report({ debug }))).toContain(
      '### Errors\n\n- Server error\n- Rate limited\n',
    );
  });

  it('ends with exactly one newline, so a paste does not carry a blank line', () => {
    for (const debug of [null, DEBUG]) {
      const text = pcoErrorMarkdown(report({ debug }));
      expect(text.endsWith('\n')).toBe(true);
      expect(text.endsWith('\n\n')).toBe(false);
    }
  });
});
