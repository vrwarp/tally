/**
 * The kiosk confirm screen, as a static prototype the critique loop can shoot.
 *
 * The rest of `uxr/prototype` is frozen HTML lifted out of the running app.
 * That does not work for the kiosk: it is a separate entry with its own
 * stylesheet, and the screen under review only exists after a search and a tap.
 * So this generates it instead, from the same token values `src/index.css`
 * defines and the same Tailwind measurements `ConfirmScreen.tsx` uses — the
 * critics are judging pixels, and these are the pixels.
 *
 * Two scenes, because the change under review must not break the one that
 * already works:
 *
 *   - **alone** — the kiosk found no brothers or sisters. This is the frame in
 *     the bug report: one name, one button, and the way to a sibling reduced to
 *     a line of grey text under the commit.
 *   - **family** — the kiosk found one, ticked. The "who else" question is
 *     already loud here, which is exactly why its absence in the other scene is
 *     the defect.
 *
 *   npx tsx uxr/kiosk-confirm.ts [variant]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* Its own directory: `uxr/shoot.ts` takes a folder, and the app prototypes
 * there are hand-edited by the ideator rather than generated. */
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'prototype-kiosk');

/** Straight from `src/index.css`, dark theme — the kiosk pins it. */
const TOKENS = `
  --ink-50:#f8fafc; --ink-100:#f1f5f9; --ink-200:#e2e8f0; --ink-300:#cbd5e1;
  --ink-400:#94a3b8; --ink-500:#64748b; --ink-600:#475569; --ink-700:#334155;
  --ink-800:#1e293b; --ink-900:#0f172a; --ink-950:#020617;
  --brand-300:#7dd3fc; --brand-400:#38bdf8; --brand-500:#0ea5e9; --brand-600:#0284c7;
  --present-400:#4ade80; --present-500:#22c55e; --present-600:#16a34a;
`;

const CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  :root { ${TOKENS} }
  html, body { height: 100%; margin: 0; }
  body {
    background: var(--ink-950);
    color: var(--ink-100);
    -webkit-font-smoothing: antialiased;
    font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto,
      'Helvetica Neue', Arial, sans-serif;
  }
  button { font: inherit; color: inherit; border: 0; background: none; cursor: pointer; }

  /* The frame ConfirmScreen renders: centred column, 2rem gaps, 2rem padding. */
  .screen {
    height: 100%; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 2rem; padding: 2rem; text-align: center;
  }
  .who { flex-shrink: 0; }
  .who .name { font-size: 3rem; line-height: 1; font-weight: 700; color: var(--ink-50); }
  .who .grade { padding-top: 0.75rem; font-size: 1.5rem; line-height: 2rem; color: var(--ink-400); }

  /* The ticked-sibling list. */
  .family { display: flex; min-height: 0; width: 100%; max-width: 28rem; flex-direction: column; }
  .family .ask { flex-shrink: 0; padding-bottom: 0.75rem; font-size: 1.125rem; line-height: 1.75rem; color: var(--ink-400); }
  .family .rows { display: flex; min-height: 0; flex-direction: column; gap: 0.5rem; }
  .row {
    display: flex; height: 4rem; flex-shrink: 0; align-items: center;
    justify-content: space-between; border-radius: 0.75rem; padding: 0 1.25rem;
    text-align: left; background: var(--ink-800);
  }
  .row .rname { font-size: 1.25rem; line-height: 1.75rem; font-weight: 600; color: var(--ink-100); }
  .row .tick {
    margin-left: 0.75rem; display: flex; height: 2.25rem; width: 2.25rem; flex-shrink: 0;
    align-items: center; justify-content: center; border-radius: 0.5rem;
    font-size: 1.25rem; background: var(--present-600); color: #fff;
  }

  /* The commit. */
  .commit {
    width: 100%; max-width: 28rem; flex-shrink: 0; border-radius: 1rem;
    padding: 1.75rem; font-size: 1.875rem; line-height: 2.25rem; font-weight: 700;
    background: var(--present-600); color: #fff;
  }

  /* What the loop is arguing about. */
  .sibling-link {
    flex-shrink: 0; border-radius: 0.75rem; padding: 1rem 2rem;
    font-size: 1.25rem; line-height: 1.75rem; color: var(--ink-400);
  }
  .sibling-btn {
    display: flex; width: 100%; max-width: 28rem; flex-shrink: 0;
    align-items: center; justify-content: center; gap: 0.625rem;
    border-radius: 1rem; padding: 1.25rem; font-size: 1.5rem; line-height: 2rem;
    font-weight: 600; background: var(--ink-800); color: var(--ink-100);
  }
  .sibling-btn.tinted {
    background: color-mix(in oklab, var(--brand-600) 15%, transparent);
    color: var(--brand-300);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--brand-500) 40%, transparent);
  }
  .sibling-btn .plus { font-size: 1.75rem; line-height: 1; font-weight: 400; }

  .back { flex-shrink: 0; border-radius: 0.75rem; padding: 1rem 2rem; font-size: 1.25rem; color: var(--ink-400); }
`;

type Scene = 'alone' | 'family';

/** The sibling affordance, per round. Everything else on the screen is fixed. */
const VARIANTS: Record<string, (scene: Scene) => { before?: string; after?: string }> = {
  /** What is on the glass today: a grey line, under the commit. */
  r0: () => ({ after: '<button class="sibling-link">Find a brother or sister</button>' }),
};

function page(scene: Scene, variant: string, tall: boolean): string {
  const build = VARIANTS[variant] ?? VARIANTS.r0!;
  const { before = '', after = '' } = build(scene);
  const family =
    scene === 'family'
      ? `<div class="family">
      <div class="ask">Checking in anyone else?</div>
      <div class="rows">
        <div class="row"><span class="rname">Amara Washington</span><span class="tick">&#10003;</span></div>
      </div>
    </div>`
      : '';

  return `<!doctype html>
<html lang="en" class="h-full" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Kiosk confirm — ${scene} — ${variant}</title>
<style>${CSS}</style>
</head>
<body style="width:${tall ? 800 : 1280}px;height:${tall ? 1280 : 800}px">
  <div class="screen">
    <div class="who">
      <div class="name">Nia Washington</div>
      <div class="grade">8th grade</div>
    </div>
    ${family}
    ${before}
    <button class="commit">Check in</button>
    ${after}
    <button class="back">&larr; Back</button>
  </div>
</body>
</html>`;
}

const variant = process.argv[2] ?? 'r0';
await mkdir(OUT, { recursive: true });
for (const scene of ['alone', 'family'] as Scene[]) {
  for (const [suffix, tall] of [
    ['kiosktall', true],
    ['kioskwide', false],
  ] as [string, boolean][]) {
    const file = join(OUT, `kiosk-confirm-${scene}--${suffix}.html`);
    await writeFile(file, page(scene, variant, tall), 'utf8');
    console.log(`wrote ${file}`);
  }
}
