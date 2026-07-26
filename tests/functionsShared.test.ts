/**
 * The guard that makes sharing code with the Cloud Functions safe.
 *
 * `functions/src/generated` is a mechanical copy of the modules in `src/lib`
 * that the nightly occurrence job needs, because the functions package deploys
 * on its own and cannot import from `src/`. A copy is only defensible while it
 * is provably current — otherwise the expander running in the cloud drifts from
 * the one under test, and the divergence shows up as gatherings that quietly
 * fail to appear.
 *
 * So this fails the build rather than the ministry's calendar.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain Node ESM, deliberately untyped: it has to run from
// `functions/` as a prebuild, where the root's toolchain is not available.
import { SHARED_FILES, readGenerated, render, stale } from '../scripts/sync-functions-shared.mjs';

describe('functions shared modules', () => {
  it('are in sync with their originals', () => {
    // Names, so a failure says which file rather than dumping 400 lines of diff.
    expect(stale()).toEqual([]);
  });

  it('really are byte-identical, not merely present', () => {
    for (const name of SHARED_FILES as string[]) {
      expect(readGenerated(name), `functions/src/generated/${name}`).toBe(render(name));
    }
  });

  it('import nothing the functions package does not have', () => {
    for (const name of SHARED_FILES as string[]) {
      const specifiers = [...(render(name) as string).matchAll(/\bfrom\s+'([^']+)'/g)].map(
        (match) => match[1],
      );

      for (const specifier of specifiers) {
        // Relative only. A bare specifier would be a dependency the functions
        // package does not declare (`date-fns`, `firebase/firestore`), and an
        // `@/` alias does not resolve under NodeNext at all.
        expect(specifier, `${name} imports ${specifier}`).toMatch(/^\.\//);
        // And the emitted file is `.js`, which NodeNext requires spelled out.
        expect(specifier).toMatch(/\.js$/);
      }
    }
  });
});
