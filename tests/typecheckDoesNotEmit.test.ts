/**
 * `npm run typecheck` must not write JavaScript into the source tree.
 *
 * It used to. The script was `tsc -b --noEmit false --emitDeclarationOnly
 * false`, which overrode the `noEmit: true` in tsconfig.json and dropped a .js
 * beside every .ts it checked — 285 of them, none visible in `git status`
 * because .gitignore covers the extension under every source tree.
 *
 * That is worse than untidy. Vite resolves a sibling `.js` ahead of the `.tsx`,
 * so once those files existed `npm test` imported *yesterday's compiled output*
 * and reported it as passing. A change to a module could be fully written,
 * fully typechecked and completely absent from the run that was supposed to
 * prove it. The failure mode is a green suite, which is the one thing nobody
 * investigates.
 *
 * Two things are asserted here, and the second is the one that matters: it is
 * easy to make the script quiet by breaking it, so this checks that it still
 * *reports* a type error as well as that it leaves nothing behind.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The trees tsconfig.json's `include` covers, which is where emit would land. */
const SOURCE_TREES = ['src', 'tests', 'scripts', 'firestore-tests'];

function emittedJavaScript(): string[] {
  return SOURCE_TREES.flatMap((tree) =>
    globSync(`${tree}/**/*.js`, { cwd: repoRoot }).filter(
      // The one hand-written JavaScript file the config checks.
      (file) => !file.endsWith('eslint.config.js'),
    ),
  );
}

describe('npm run typecheck', () => {
  it('is not configured to emit', () => {
    const scripts = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).scripts as
      Record<string, string>;
    // `--noEmit false` is the specific override that caused this; `--outDir`
    // would be a different way to the same place.
    expect(scripts.typecheck).not.toMatch(/--noEmit\s+false|--outDir/);
  });

  it('leaves no JavaScript behind in the source tree', () => {
    // Not run here — a full `tsc -b` costs about a minute. What is asserted is
    // the state of the working tree, which fails the moment somebody runs a
    // command that emits, whether or not it was this script.
    expect(emittedJavaScript()).toEqual([]);
  });

  it('still reports a type error, so a quiet run means a clean one', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'tally-typecheck-'));
    const project = join(scratch, 'tsconfig.json');
    const source = join(scratch, 'broken.ts');

    try {
      writeFileSync(
        project,
        JSON.stringify({
          compilerOptions: { strict: true, noEmit: true, skipLibCheck: true },
          include: ['broken.ts'],
        }),
      );
      writeFileSync(source, 'export const broken: number = "not a number";\n');

      let failed = false;
      let output = '';
      try {
        execFileSync('npx', ['tsc', '-b', project, '--pretty', 'false'], {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: 'pipe',
        });
      } catch (error) {
        failed = true;
        output = String((error as { stdout?: string }).stdout ?? '');
      }

      expect(failed, 'tsc -b accepted a program with a type error').toBe(true);
      expect(output).toContain('TS2322');
      // And the build-mode invocation the script uses still emits nothing.
      expect(globSync('*.js', { cwd: scratch })).toEqual([]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
