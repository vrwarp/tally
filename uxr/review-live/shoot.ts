/**
 * Photographs the corrections walkthrough from the live component.
 *
 * `e2e/walkthrough.spec.ts` does this for the screens that live behind the
 * emulator suite: sign in, walk there, shoot. The Review screen can be reached
 * that way too — `e2e/review.spec.ts` does — but a *walkthrough* of it needs
 * more than one family: it needs a misspelled child whose correct spelling is
 * already on the roster, an adult called MOM, and a transposed phone number,
 * arranged so that each frame is one step of one journey. Seeding that through
 * a kiosk wizard costs more than mounting the component against a fixture, and
 * buys nothing the frames are about.
 *
 * So this points the same shutter at a dev server. What it photographs is the
 * app's own `ReviewPage`, its own markup and its own stylesheet; what is faked
 * is Firestore and the three callables (see `stubs.tsx`), and the fakes follow
 * the server's rules because those consequences are the subject.
 *
 *   npx tsx uxr/review-live/shoot.ts
 *
 * Writes PNGs and a manifest into docs/walkthrough/corrections/, which
 * `scripts/build-corrections-walkthrough.ts` assembles into a page.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Locator, type Page } from '@playwright/test';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createServer } from 'vite';

/** Same fallback as `uxr/shoot.ts`: an image that ships its own Chromium. */
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  ['/opt/pw-browsers/chromium/chrome-linux/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(
    (path) => existsSync(path),
  );

/** The two shapes the walkthrough is read in, named the way it names them. */
const VIEWPORTS = {
  desktop: { width: 1440, height: 980, scale: 1, touch: false },
  phone: { width: 390, height: 844, scale: 2, touch: true },
} as const;

interface Shot {
  file: string;
  title: string;
  journey: string;
  caption: string;
  viewport: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(dirname(here));
const OUT_DIR = join(projectRoot, 'docs', 'walkthrough', 'corrections');
const src = join(projectRoot, 'src');

/**
 * The script, as data.
 *
 * Each step drives the page and then names the frame. Written once and run at
 * both viewports, so step N is the same moment on a laptop and on a phone —
 * which is what lets the page put them side by side.
 */
interface Step {
  journey: string;
  title: string;
  caption: string;
  /** What has to happen before the shutter. */
  run?: (page: Page, card: Locator) => Promise<void>;
}

const SURNAME = 'Okonkwo';

const STEPS: Step[] = [
  {
    journey: 'The card that had no proportionate answer',
    title: 'A form a stranger typed',
    caption:
      'A family who registered themselves at the lobby kiosk on Friday, waiting on Tuesday. Everything here was typed on a glass keyboard with a queue behind it, and everything here is wrong in a way the screen cannot see: the child’s name is misspelled, the grade is a guess, the adult is called MOM, and two digits of the phone number are transposed. There is no duplicate warning and the blue button is live — because the roster scan at the door matched on the name as typed, and “Micheal” collides with nobody. Until now the only two answers were to approve the misspelling permanently into a database with no delete, or to press “Not ours” and lose a real family along with the only phone number Tally holds for them.',
  },
  {
    journey: 'Journey A — the misspelling that would have become permanent',
    title: 'The editor takes the row, not a dialog',
    caption:
      'One person at a time, in place. A dialog would cover the duplicate candidates — which are exactly what this edit may change — and on a phone it would cover the card entirely. Notice what has gone grey: approve, “Not ours”, and every other Edit button on the card. A card mid-correction is a card whose facts are in flux, and the approve caption names children by names somebody is in the middle of changing. Each control carries its sentence above it, in the card’s own grammar — and the one above Save changes as soon as the name does, which is the next frame but one.',
    run: async (page, card) => {
      await card.getByRole('button', { name: new RegExp(`Edit Micheal ${SURNAME}`) }).click();
      await page.waitForTimeout(200);
    },
  },
  {
    journey: 'Journey A — the misspelling that would have become permanent',
    title: 'Refused in the door’s own words',
    caption:
      'No round trip. The form and the Cloud Function share one module of field rules — `src/lib/registrationFields.ts`, copied verbatim into the functions package — so a digit typed into a name is refused under the box that holds it, immediately, in the sentence the kiosk itself uses. “Room 3” in a name field is somebody misreading the question, and silently keeping “Room” would put that on a sticker.',
    run: async (page, card) => {
      await card.getByLabel('First name').fill('Room 3');
      await card.getByRole('button', { name: /Save the correction/ }).click();
      await page.waitForTimeout(200);
    },
  },
  {
    journey: 'Journey A — the misspelling that would have become permanent',
    title: 'The fix reveals the duplicate the door missed',
    caption:
      'This is the whole reason a correction is a server call and not a field write. The roster scan re-runs in the same breath, and the corrected spelling collides with a child the church already has — so the card comes back with a “Possible duplicate” badge, the approve button held, and the candidate offered with the two facts that separate two children of one name: whether the church already finds that row under this family’s own four digits, and whether the grade matches. The toast says so out loud, because a button going grey under a reviewer’s hand otherwise reads as the app breaking. A correction that only fixed the spelling would have handed them a clean-looking card over a duplicate the fix itself created.',
    run: async (page, card) => {
      await card.getByLabel('First name').fill('Michael');
      await card.getByRole('button', { name: /Save the correction/ }).click();
      await page.waitForTimeout(600);
    },
  },
  {
    journey: 'Journey B — the parent who is not a person yet',
    title: 'The one field that becomes a contact card',
    caption:
      'Under the corrected name, a rung quieter, the card has stopped claiming to be the form: “Typed at the kiosk as Micheal Okonkwo.” A colleague opening this on Thursday can see at a glance why the roster’s Michael was not offered at the door. Now the adult. Approving this would create a person in Planning Center called MOM, attached to a household, for ever — and it is the one field on this screen somebody will later try to phone. The kiosk asked “who is bringing them?” and a parent in a hurry answered the question they thought was being asked.',
    run: async (page, card) => {
      await card.getByRole('button', { name: new RegExp(`Edit MOM ${SURNAME}`) }).click();
      await page.waitForTimeout(200);
    },
  },
  {
    journey: 'Journey C — the wrong digit',
    title: 'The number is an index, not a field',
    caption:
      'The most expensive typo on the screen and the least visible. Those four digits are the key this family types at the lobby kiosk next week to find their own children — so a wrong number means the family is unfindable at the door on Friday, and somebody else’s real number finds these children by name, which is the exact failure the kiosk’s search screen is built around. The sentence above Save names both sets of digits before the press, because “your old four stop working” is something a reviewer may have to say to the family on the phone.',
    run: async (page, card) => {
      await card.getByLabel('First name').fill('Renata');
      await card.getByLabel('Phone').fill('5550163355');
      await page.waitForTimeout(200);
    },
  },
  {
    journey: 'Journey C — the wrong digit',
    title: 'Kept: the name they typed. Never kept: the number',
    caption:
      'The card reads Renata now, and under the phone: “Typed at the kiosk as MOM Okonkwo. The number was corrected here.” The original name is held on the registration record from the first correction onwards — once, never overwritten, because the point is what the family wrote and not what the last reviewer saw. The original number is deliberately not held at all: a mistyped one belongs to a stranger, and keeping a stranger’s number for thirty days to caption a correction is exactly the retention this record’s TTL exists to prevent. That one was corrected is all a second reviewer needs.',
    run: async (page, card) => {
      await card.getByRole('button', { name: /Save the correction/ }).click();
      await page.waitForTimeout(600);
    },
  },
  {
    journey: 'Journeys D and E — the grade, and the allergy note',
    title: 'Two fields that are not cosmetic',
    caption:
      'The grade is a filter on the check-in roster and one of the two discriminators on the merge picker above — a candidate whose grade matches is drawn emphasised, because a name alone often cannot tell two children apart, so a wrong grade makes the duplicate comparison worse exactly where somebody is leaning on it. “No grade” is the first option and an answer rather than a blank: a child too young for one has none. The allergy note is pushed into the church’s medical notes on approval and is what a leader reads afterwards — the only field on this screen with a safety consequence, and the last chance to fix it.',
    run: async (page, card) => {
      await card.getByRole('button', { name: new RegExp(`Edit Michael ${SURNAME}`) }).click();
      await page.waitForTimeout(200);
      await card.getByLabel('Grade').selectOption({ label: '4th grade' });
      await card.getByLabel('Allergies').fill('Peanut allergy — carries an EpiPen in his bag');
      await page.waitForTimeout(200);
    },
  },
  {
    journey: 'The end of the job',
    title: 'A corrected family, and a decision that can now be made',
    caption:
      'Saved, and the grade now matches the roster row it is being compared against — which is the comparison a reviewer settles next. Every fact on the card is one somebody has checked; the collision the correction surfaced is still held, deliberately, because it is a real question and the approve button stays shut until it is answered. Nothing corrected here has touched the church’s database: that is what makes it safe, and it is why a child who has already been pushed gets no Edit button at all but a pointer to their own page, which knows how to carry a rename upstream.',
    run: async (page, card) => {
      await card.getByRole('button', { name: /Save the correction/ }).click();
      await page.waitForTimeout(700);
    },
  },
];

/* -------------------------------------------------------------------------- */

await mkdir(join(OUT_DIR, 'shots'), { recursive: true });

const stubs = join(here, 'stubs.tsx');
const server = await createServer({
  configFile: false,
  root: projectRoot,
  plugins: [react(), tailwindcss()],
  resolve: {
    /*
     * Three aliases, and they are the point — they swap Firestore for the
     * fixture. Everything else is the app's build: the same React plugin, the
     * same Tailwind plugin, the same `@`, so the stylesheet this shoots with is
     * the stylesheet the app paints with.
     */
    alias: [
      { find: /^@\/services\/functions$/, replacement: stubs },
      { find: /^@\/context\/toastContext$/, replacement: stubs },
      { find: /^@\/context\/dataContext$/, replacement: stubs },
      { find: /^@\//, replacement: `${src}/` },
    ],
  },
  // Without this the dependency scan crawls `index.html` — the app's entry, not
  // this one — and fails on the PWA plugin's virtual module.
  optimizeDeps: { entries: ['uxr/review-live/index.html'] },
  server: { port: 5198, strictPort: true },
  logLevel: 'error',
});
await server.listen();
const url = 'http://127.0.0.1:5198/uxr/review-live/index.html';

const browser = await chromium.launch(executablePath ? { executablePath } : {});
const shots: Shot[] = [];

for (const [name, view] of Object.entries(VIEWPORTS)) {
  const context = await browser.newContext({
    viewport: { width: view.width, height: view.height },
    deviceScaleFactor: view.scale,
    colorScheme: 'dark',
    hasTouch: view.touch,
    isMobile: view.touch,
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });

  const card = page.locator('section').filter({ hasText: SURNAME }).first();
  await card.waitFor({ timeout: 30_000 });

  for (const [index, step] of STEPS.entries()) {
    if (step.run) await step.run(page, card);
    const slug = step.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const file = `${name}-${String(index + 1).padStart(2, '0')}-${slug}.png`;
    // The card rather than the window: on a phone one review card is taller
    // than the screen, and a full-page shot of it would be a picture of a
    // scrollbar. `scrollIntoViewIfNeeded` keeps the frame on the part that
    // moved.
    await card.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(OUT_DIR, 'shots', file) });
    shots.push({ ...step, file, viewport: name });
  }

  await context.close();
}

await browser.close();
await server.close();

for (const viewport of Object.keys(VIEWPORTS)) {
  await writeFile(
    join(OUT_DIR, `corrections-${viewport}.json`),
    JSON.stringify(
      shots.filter((shot) => shot.viewport === viewport),
      null,
      2,
    ),
    'utf8',
  );
}

console.log(`${shots.length} frames → ${join(OUT_DIR, 'shots')}`);
