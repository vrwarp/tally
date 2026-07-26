import { describe, expect, it } from 'vitest';

import { FirebaseConfigError, missingKeys, parseFirebaseConfig } from './firebaseConfig';

/**
 * Shaped like a real config — `appId` carries colons and `storageBucket` a dot,
 * because those are what a naive key/value split would break on.
 */
const FIELDS = {
  apiKey: 'AIzaSyExampleKeyNotARealOne0000000000000',
  authDomain: 'tally-76406.firebaseapp.com',
  projectId: 'tally-76406',
  storageBucket: 'tally-76406.firebasestorage.app',
  messagingSenderId: '649041020951',
  appId: '1:649041020951:web:3c1f003736b67764e33452',
};

describe('parseFirebaseConfig', () => {
  it('reads strict JSON', () => {
    expect(parseFirebaseConfig(JSON.stringify(FIELDS))).toEqual(FIELDS);
  });

  // The whole point: what the Firebase console actually puts on the clipboard.
  it('reads the console snippet verbatim, declaration and semicolon included', () => {
    const pasted = `const firebaseConfig = {
  apiKey: "${FIELDS.apiKey}",
  authDomain: "${FIELDS.authDomain}",
  projectId: "${FIELDS.projectId}",
  storageBucket: "${FIELDS.storageBucket}",
  messagingSenderId: "${FIELDS.messagingSenderId}",
  appId: "${FIELDS.appId}"
};`;
    expect(parseFirebaseConfig(pasted)).toEqual(FIELDS);
  });

  it('reads a bare object literal with unquoted keys', () => {
    expect(parseFirebaseConfig('{ apiKey: "a", projectId: "p", appId: "1:2:web:3" }')).toEqual({
      apiKey: 'a',
      projectId: 'p',
      appId: '1:2:web:3',
    });
  });

  it('accepts single quotes, trailing commas and let/var/export default', () => {
    expect(parseFirebaseConfig("{ apiKey: 'a', projectId: 'p', appId: 'x', }")).toEqual({
      apiKey: 'a',
      projectId: 'p',
      appId: 'x',
    });
    expect(parseFirebaseConfig('let cfg = { apiKey: "a" };')).toEqual({ apiKey: 'a' });
    expect(parseFirebaseConfig('var cfg = { apiKey: "a" }')).toEqual({ apiKey: 'a' });
    expect(parseFirebaseConfig('export default { apiKey: "a" }')).toEqual({ apiKey: 'a' });
  });

  it('ignores comments, which a pasted snippet often carries', () => {
    const pasted = `// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "a", // the browser sees this anyway
  /* not a secret */
  projectId: "p",
};`;
    expect(parseFirebaseConfig(pasted)).toEqual({ apiKey: 'a', projectId: 'p' });
  });

  it('leaves string contents alone', () => {
    // A colon-heavy appId, a brace, and a comma inside a value: each one would
    // be a separator if the parser were not string-aware.
    const parsed = parseFirebaseConfig(
      '{ appId: "1:2:web:3", note: "a, b: c {d}", apiKey: "with \\"quotes\\"" }',
    );
    expect(parsed).toEqual({
      appId: '1:2:web:3',
      note: 'a, b: c {d}',
      apiKey: 'with "quotes"',
    });
  });

  it('keeps a double quote that was inside single quotes', () => {
    expect(parseFirebaseConfig(`{ apiKey: 'say "hi"' }`)).toEqual({ apiKey: 'say "hi"' });
  });

  it('does not treat a colon inside a value as a key', () => {
    expect(parseFirebaseConfig('{ authDomain: "https://x.example.org:8080" }')).toEqual({
      authDomain: 'https://x.example.org:8080',
    });
  });

  it('rejects anything that is not an object', () => {
    for (const raw of ['"just a string"', '42', '[1, 2]', 'null']) {
      expect(() => parseFirebaseConfig(raw)).toThrow(FirebaseConfigError);
    }
  });

  it('names the variable when the value is unparseable', () => {
    expect(() => parseFirebaseConfig('{ apiKey: }')).toThrow(/VITE_FIREBASE_CONFIG/);
  });
});

describe('missingKeys', () => {
  it('is empty for a complete config', () => {
    expect(missingKeys(FIELDS)).toEqual([]);
  });

  it('lists what the SDK cannot do without', () => {
    expect(missingKeys({ apiKey: 'a' })).toEqual(['projectId', 'appId']);
  });

  // A half-filled .env.example is likelier than an absent key.
  it('treats empty and blank strings as missing', () => {
    expect(missingKeys({ apiKey: '', projectId: '   ', appId: 'x' })).toEqual([
      'apiKey',
      'projectId',
    ]);
  });

  it('treats a non-string as missing', () => {
    expect(missingKeys({ apiKey: 1, projectId: null, appId: 'x' })).toEqual(['apiKey', 'projectId']);
  });
});
