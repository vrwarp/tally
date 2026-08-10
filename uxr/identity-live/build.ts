/**
 * Builds the walkthrough into one file that carries itself.
 *
 * `../review-live/shoot.ts` points a shutter at a dev server and writes PNGs,
 * which is right for a walkthrough whose subject is a sequence of states. This
 * one's subject is a set of *decisions*, and half of what they do is invisible
 * on a still image: a chooser nobody touched still names an id, "none of them"
 * reaches the server as a decision rather than as an omission, and an approve
 * button is held for one shape of ambiguity and not another. Those are things a
 * reader has to press.
 *
 * So this builds rather than photographs — and inlines everything, because the
 * page has to run somewhere that permits no requests at all. The three aliases
 * are `review-live`'s: swap the callables, the toast and the events
 * subscription for local fakes, and leave every other import pointing at `src/`
 * so the component and the stylesheet are the app's own.
 *
 *   npx tsx uxr/identity-live/build.ts
 *
 * Writes docs/walkthrough/identity/identity.html — one file, no assets.
 */
import { mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { build } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(dirname(here));
const src = join(projectRoot, 'src');
const stubs = join(here, 'stubs.tsx');
const outDir = join(projectRoot, 'docs', 'walkthrough', 'identity');
const staging = join(projectRoot, 'node_modules', '.identity-live');

await rm(staging, { recursive: true, force: true });

await build({
  configFile: false,
  /*
   * The project root, not this directory, and that is not a detail.
   *
   * Tailwind v4 detects the classes it emits by scanning from the root it is
   * given. Rooted here it sees this harness and none of `src/features/review`,
   * so the page renders the real component with half its utilities missing —
   * a count badge as bare text, a chooser with no ring — which looks like a
   * broken screen rather than a misconfigured build. Same reason
   * `../review-live/shoot.ts` roots its dev server at the project.
   */
  root: projectRoot,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^@\/services\/functions$/, replacement: stubs },
      { find: /^@\/context\/toastContext$/, replacement: stubs },
      { find: /^@\/context\/dataContext$/, replacement: stubs },
      { find: /^@\//, replacement: `${src}/` },
    ],
  },
  build: {
    outDir: staging,
    emptyOutDir: true,
    // One chunk and one stylesheet, so the inlining below has two files to find
    // rather than a graph to walk.
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: join(here, 'index.html'),
      output: { inlineDynamicImports: true },
    },
    // Fonts and images become data URIs rather than requests.
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    target: 'es2022',
  },
  logLevel: 'error',
});

/* ---- Fold the assets into the document ----------------------------------- */

const assetsDir = join(staging, 'assets');
const assets = await readdir(assetsDir);
const scriptFile = assets.find((name) => name.endsWith('.js'));
const styleFile = assets.find((name) => name.endsWith('.css'));
if (!scriptFile) throw new Error('The build produced no script to inline.');

const script = await readFile(join(assetsDir, scriptFile), 'utf8');
const style = styleFile ? await readFile(join(assetsDir, styleFile), 'utf8') : '';
/*
 * Rooted at the project, Vite emits the entry at its path *relative to the
 * root* — so the document lands under `uxr/identity-live/` inside the staging
 * directory rather than at its top.
 */
let html = await readFile(join(staging, 'uxr', 'identity-live', 'index.html'), 'utf8');

html = html
  .replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, '')
  .replace(/<link[^>]*rel="stylesheet"[^>]*>/g, '')
  .replace(/<link[^>]*rel="modulepreload"[^>]*>/g, '');

/*
 * `</script>` anywhere inside the bundle would close the tag early. It is a
 * real possibility in a bundle that carries string literals of markup, and the
 * failure — a page that renders half a script as text — is baffling enough to
 * be worth two characters of insurance.
 */
const guarded = script.replace(/<\/script>/g, '<\\/script>');

/*
 * Replacer *functions*, not replacement strings.
 *
 * `String.prototype.replace` reads `$&`, `` $` `` and `$'` out of a replacement
 * string, and a minified bundle contains all three as ordinary characters. The
 * string form spliced the document's own head into the middle of the script
 * tag, which produced a page whose only symptom was a syntax error a thousand
 * characters from the cause. A function replacement is taken literally.
 */
html = html.replace('</head>', () => `<style>${style}</style>\n</head>`);
html = html.replace('</body>', () => `<script type="module">${guarded}</script>\n</body>`);

await mkdir(outDir, { recursive: true });
const target = join(outDir, 'identity.html');
await writeFile(target, html, 'utf8');

/* ---- The same page, shaped for a host that supplies the document ---------- */

/*
 * A second output, because a published artifact is wrapped: the host provides
 * the doctype, `<html>` and `<body>`, and a file that brings its own is a
 * document nested inside a document. So this variant is the *contents* — the
 * stylesheet, the mount point and the bundle — and nothing else.
 *
 * The theme stamp has to move with it. The standalone file carries
 * `data-theme="dark"` on `<html>`, which is what a signed-in laptop resolves
 * to and the world this screen was designed in; here that element belongs to
 * the host, so the stamp is written at run time, before React mounts. Without
 * it the page inherits whatever the viewer's own theme resolved to and paints
 * Tally's dark card on a light ground — the app's own `body` rule is what
 * fills the ground either way, and it reads the same attribute.
 */
const fragment = [
  `<style>${style}</style>`,
  `<div id="root"></div>`,
  `<script>document.documentElement.dataset.theme = 'dark';</script>`,
  `<script type="module">${guarded}</script>`,
].join('\n');
const artifactTarget = join(outDir, 'identity.artifact.html');
await writeFile(artifactTarget, fragment, 'utf8');

await rm(staging, { recursive: true, force: true });

const kb = (value: string) => Math.round(Buffer.byteLength(value) / 1024);
console.log(`Wrote ${target} — ${kb(html)} KB, no external requests.`);
console.log(`Wrote ${artifactTarget} — ${kb(fragment)} KB, for a host-supplied document.`);
