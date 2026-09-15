/**
 * Two claims, and the second is the one that matters.
 *
 * Parsing is ordinary input validation. The removal is not: the parameter is a
 * live credential on a tablet that sits in a lobby for weeks, and it has to
 * leave the address bar whatever else happens — including when the link was
 * malformed, and including when the claim it was read for then fails.
 */
import { describe, expect, it, vi } from 'vitest';
import { PAIR_PARAM, parsePairLink, stripPairLink, takePairLink } from '@/kiosk/pairLink';

const CODE = 'K7MQ2X';
const SECRET = 'a'.repeat(32);

/** A Location and a History, as much of each as the module touches. */
function at(href: string) {
  const location = { href } as Location;
  const replaceState = vi.fn();
  const history = { state: { n: 1 }, replaceState } as unknown as History;
  return { location, history, replaceState };
}

describe('parsePairLink', () => {
  it('reads the two halves a staging link carries', () => {
    expect(parsePairLink(`${CODE}.${SECRET}`)).toEqual({ code: CODE, secret: SECRET });
  });

  it('forgives the case and spacing a copy-paste introduces', () => {
    expect(parsePairLink(` k7mq2x.${SECRET.toUpperCase()} `)).toEqual({
      code: CODE,
      secret: SECRET,
    });
  });

  it('refuses anything that is not the shape it expects', () => {
    for (const raw of [
      null,
      '',
      CODE, // no secret
      `${CODE}.`,
      `.${SECRET}`,
      `TOOLONG.${SECRET}`,
      `K7MQ2.${SECRET}`, // five characters
      `K7MQ2!.${SECRET}`,
      `${CODE}.${'a'.repeat(31)}`,
      `${CODE}.${'z'.repeat(32)}`, // not hex
      `${CODE}.${SECRET}.extra`.replace(`${CODE}.`, 'X.'),
    ]) {
      expect(parsePairLink(raw)).toBeNull();
    }
  });

  it('keeps everything after the first dot, since the secret cannot contain one', () => {
    // A defensive split on every dot would silently truncate a valid secret if
    // the format ever grew a third part. Only the first separator is special.
    expect(parsePairLink(`${CODE}.${SECRET}`)?.secret).toBe(SECRET);
  });
});

describe('stripPairLink', () => {
  it('takes the credential out of the address and the history entry', () => {
    const { location, history, replaceState } = at(
      `https://tally.example.org/kiosk?${PAIR_PARAM}=${CODE}.${SECRET}`,
    );
    stripPairLink(location, history);

    expect(replaceState).toHaveBeenCalledWith({ n: 1 }, '', '/kiosk');
  });

  it('leaves every other part of the address alone', () => {
    const { location, history, replaceState } = at(
      `https://tally.example.org/kiosk?lang=es&${PAIR_PARAM}=${CODE}.${SECRET}&debug=1#top`,
    );
    stripPairLink(location, history);

    expect(replaceState).toHaveBeenCalledWith({ n: 1 }, '', '/kiosk?lang=es&debug=1#top');
  });

  it('does nothing when there is nothing to strip', () => {
    const { location, history, replaceState } = at('https://tally.example.org/kiosk');
    stripPairLink(location, history);

    expect(replaceState).not.toHaveBeenCalled();
  });

  it('does not fail a boot when the browser refuses', () => {
    const location = { href: `https://x.test/kiosk?${PAIR_PARAM}=${CODE}.${SECRET}` } as Location;
    const history = {
      state: null,
      replaceState: () => {
        throw new Error('SecurityError');
      },
    } as unknown as History;

    expect(() => stripPairLink(location, history)).not.toThrow();
  });
});

describe('takePairLink', () => {
  it('returns the link and removes it in one go', () => {
    const { location, history, replaceState } = at(
      `https://tally.example.org/kiosk?${PAIR_PARAM}=${CODE}.${SECRET}`,
    );

    expect(takePairLink(location, history)).toEqual({ code: CODE, secret: SECRET });
    expect(replaceState).toHaveBeenCalled();
  });

  it('still removes a parameter it could not parse', () => {
    // The whole point. A malformed value is no less something that should not
    // stay in the address bar of a tablet in a lobby.
    const { location, history, replaceState } = at(
      `https://tally.example.org/kiosk?${PAIR_PARAM}=rubbish`,
    );

    expect(takePairLink(location, history)).toBeNull();
    expect(replaceState).toHaveBeenCalledWith({ n: 1 }, '', '/kiosk');
  });

  it('is null and quiet on an ordinary boot', () => {
    const { location, history, replaceState } = at('https://tally.example.org/kiosk');

    expect(takePairLink(location, history)).toBeNull();
    expect(replaceState).not.toHaveBeenCalled();
  });
});
