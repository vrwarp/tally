/**
 * What a gathering's colours actually look like, photographed from the live kiosk.
 *
 * Not a test — a documentation build, like `walkthrough.spec.ts`, `tour.spec.ts`
 * and `registration-walkthrough.spec.ts`. Every frame is the real lobby screen
 * bound to a real gathering through the real callable, so the colours in these
 * pictures were resolved by the same code path a church's kiosk runs.
 *
 * The argument it has to make is not "themes exist". It is:
 *
 *   - that four gatherings read as four rooms rather than four swatches, and in
 *     particular that *two sharing a ground* still tell themselves apart — which
 *     is the half a single before/after pair cannot show;
 *   - that the three slots do different jobs, which needs a checked-in frame as
 *     well as a search frame, since `confirm` never appears on an idle screen;
 *   - that the allergy line does not move, whatever else does.
 *
 * One shape only. A kiosk is a tablet in a stand — the 1280x800 landscape the
 * rest of the kiosk documentation uses — and photographing a phone would be
 * photographing something nobody runs this on. The editor frames are the same
 * width, so the two acts sit at one size on the page.
 *
 * Run it with:
 *   WALKTHROUGH=1 npx playwright test --project=chromium-desktop \
 *     e2e/theme-walkthrough.spec.ts
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { readCollection, writeDocument, type WritableValue } from './support/emulator';
import { test } from './support/fixtures';
import { bindTo, leaveGathering, openKiosk, pairKiosk, typeOnKiosk } from './support/kiosk';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(repoRoot, 'docs', 'walkthrough', 'themes');

/** The shape a lobby tablet is mounted in. Not a phone, not a laptop. */
const KIOSK_VIEWPORT = { width: 1280, height: 800 };

interface Shot {
  file: string;
  title: string;
  /** Which act: choosing the colours, or wearing them. */
  act: string;
  /** The chip above the frame — the gathering, or the step in the editor. */
  state: string;
  caption: string;
  /**
   * The four names this frame is wearing, when it is wearing any.
   *
   * Recorded so the page can resolve them back into swatches with the same
   * `kioskPalette()` the kiosk was sent, rather than the build script guessing
   * a colour from the hue's name. It is also what lets the four rooms be shown
   * side by side, which is the one comparison the page exists to make.
   */
  theme?: { ground: string; accent: string; confirm: string; backdrop: string };
  /**
   * Which slot the frame is *about*, when it is about one.
   *
   * A fact about the content, not a layout instruction — the build script is
   * what decides that the sparse `confirm` frames are better compared side by
   * side than given a screen each.
   */
  slot?: 'room' | 'confirm';
}

const shots: Shot[] = [];

function slugOf(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function capture(
  page: Page,
  shot: {
    title: string;
    act: string;
    state: string;
    caption: string;
    theme?: Shot['theme'];
    slot?: Shot['slot'];
  },
): Promise<void> {
  const file = `${String(shots.length + 1).padStart(2, '0')}-${slugOf(shot.title)}.png`;
  await mkdir(join(OUT_DIR, 'shots'), { recursive: true });
  // Let the check-in flash, the haptic and any height change finish first.
  await page.waitForTimeout(450);
  await page.screenshot({ path: join(OUT_DIR, 'shots', file), fullPage: false });
  shots.push({ ...shot, file });
}

/* -------------------------------------------------------------------------- */
/* The four rooms                                                              */
/* -------------------------------------------------------------------------- */

interface Room {
  /** The seeded gathering's title, which is also what `bindTo` matches on. */
  title: string;
  ground: 'dark' | 'light';
  accent: string;
  confirm: string;
  backdrop: string;
  /** Why this room wants these colours. Becomes the caption. */
  why: string;
}

/*
 * Two dark and two light, and the pairing is the point: `violet` beside `ember`
 * and `forest` beside `teal` are the comparison that a single themed screenshot
 * cannot make. If two gatherings on the same ground read as the same screen,
 * this document has failed and it should be visible here rather than argued
 * about in a commit message.
 */
/**
 * The child who gets checked in, four times, on four different evenings.
 *
 * A visitor rather than a regular, so no gathering's seeded attendance already
 * has them and every room's frame shows the same fresh transition.
 */
const VISITOR = 'Micah Sullivan';

const ROOMS: readonly Room[] = [
  {
    title: 'Friday Fellowship',
    ground: 'dark',
    accent: 'violet',
    confirm: 'teal',
    backdrop: 'violet',
    why: 'A youth night in a dim hall. The dark ground is the one the kiosk has always had; what changes is that the keys and the page now belong to this evening rather than to the app.',
  },
  {
    title: 'Fall Lock-In',
    ground: 'dark',
    accent: 'ember',
    confirm: 'forest',
    backdrop: 'ember',
    why: 'The same dark ground, and unmistakably not the same night. This is the comparison that matters: a ground is not a theme, and two gatherings sharing one still have to read as two rooms.',
  },
  {
    title: 'Nursery',
    ground: 'light',
    accent: 'forest',
    confirm: 'forest',
    backdrop: 'forest',
    why: 'A bright Sunday morning lobby, where a dark screen is the thing that looks broken. Note the cards stay white — pure white has no hue to turn, and a tinted card on paper reads as a stain.',
  },
  {
    title: 'Sunday School',
    ground: 'light',
    accent: 'teal',
    confirm: 'sky',
    backdrop: 'teal',
    why: 'Light again, an hour after the nursery, in the same building. Two light rooms that a parent can still tell apart at a glance is the same test the two dark ones just passed.',
  },
];

/* -------------------------------------------------------------------------- */
/* Staging                                                                     */
/* -------------------------------------------------------------------------- */

interface Staged {
  id: string;
  restore: () => Promise<void>;
}

/**
 * Gives a seeded gathering its colours, and a window the kiosk will offer it in.
 *
 * Two things are written, and the second is not decoration. The chooser only
 * lists what is within its horizon, and of the four rooms above the Lock-In is
 * three weeks past — so a walkthrough that only wrote themes would photograph
 * three gatherings and fail on the fourth. Times are moved to a window around
 * now and put back afterwards.
 *
 * The document is picked by title and then by *nearest to now*, because the seed
 * writes a term of Friday instances and their ids carry the date they land on.
 * Hard-coding one would make this spec expire.
 */
async function stage(room: Room): Promise<Staged> {
  const events = await readCollection('events');
  const matching = events.filter((doc) => doc.data.title === room.title);
  if (matching.length === 0) {
    throw new Error(`The seed produced no "${room.title}"; see scripts/seed.ts.`);
  }

  const now = Date.now();
  const nearest = matching.sort(
    (a, b) =>
      Math.abs(Date.parse(String(a.data.startAt)) - now) -
      Math.abs(Date.parse(String(b.data.startAt)) - now),
  )[0]!;

  const before = nearest.data;
  const path = `events/${nearest.id}`;

  await writeDocument(path, {
    ...(before as Record<string, WritableValue>),
    kioskTheme: {
      ground: room.ground,
      accent: room.accent,
      confirm: room.confirm,
      backdrop: room.backdrop,
    },
    startAt: new Date(now - 30 * 60_000),
    endAt: new Date(now + 120 * 60_000),
    checkInOpensAt: new Date(now - 60 * 60_000),
    checkInClosesAt: new Date(now + 180 * 60_000),
  });

  return {
    id: nearest.id,
    restore: () => writeDocument(path, before as Record<string, WritableValue>),
  };
}

/**
 * One student, findable from any of the four gatherings.
 *
 * The kiosk opens filtered to the people who actually come to *this* gathering,
 * which is the whole point of the scoped roster — and it means one name is not
 * on all four rosters. Rather than pick a different child per room (four more
 * things to keep true as the seed changes), this takes the door a volunteer
 * takes: type the name, and if this gathering has never seen them, press
 * **Search everyone**.
 */
async function findAnywhere(kiosk: Page, name: string) {
  await typeOnKiosk(kiosk, name.split(' ')[0]!);
  const row = kiosk.getByRole('button', { name: new RegExp(name, 'i') }).first();

  if (!(await row.isVisible().catch(() => false))) {
    const widen = kiosk.getByRole('button', { name: /search everyone/i });
    if (await widen.isVisible().catch(() => false)) await widen.click();
  }

  await expect(row).toBeVisible({ timeout: 20_000 });
  return row;
}

/* -------------------------------------------------------------------------- */
/* The build                                                                   */
/* -------------------------------------------------------------------------- */

test('capture the theme walkthrough', async ({ browser, page, signedInAs }) => {
  test.setTimeout(600_000);

  const staged: Staged[] = [];

  try {
    /* ---- Act 1: choosing --------------------------------------------------- */

    await signedInAs('core');
    await page.setViewportSize(KIOSK_VIEWPORT);
    await page.goto('/events');
    await page.getByRole('button', { name: 'New event' }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^Title/).fill('Sunday Nursery');
    const field = dialog.getByRole('button', { name: /^Kiosk colours/ });
    await field.scrollIntoViewIfNeeded();

    await capture(page, {
      title: 'Every gathering starts with Tally’s own colours',
      act: 'Choosing',
      state: 'Untouched',
      caption:
        'The field sits with the label template, because both are about the screen in the lobby rather than the phone at the door. Shut, it states the current answer — and the ordinary answer is that there is no answer: an unthemed gathering is the kiosk that shipped, stored as null and costing nothing anywhere down the path.',
    });

    await field.click();
    await capture(page, {
      title: 'Three slots, named for the job rather than the rank',
      act: 'Choosing',
      state: 'Open',
      caption:
        'Not primary, secondary and tertiary. Those are a ranking, and the kiosk has nothing to rank — there is no secondary button and no tertiary chip, so two of the three would need screen furniture invented to justify them. Its palette is already semantic, so the slots follow it: what you touch, what just happened, and the room.',
    });

    const ground = (name: string) =>
      dialog.getByRole('group', { name: 'Ground' }).getByRole('button', { name });
    const slot = (group: string, hue: string) =>
      dialog.getByRole('group', { name: group }).getByRole('button', { name: hue });

    await slot('What you touch', 'Violet').click();
    await slot('What just happened', 'Teal').click();
    await slot('The room', 'Violet').click();
    // The preview is the subject of this frame, and the picker is tall enough to
    // push it under the fold of a 1280x800 dialog. Scroll to it by the one
    // string only it contains.
    await dialog.getByText(/allergies: peanuts/i).scrollIntoViewIfNeeded();
    await capture(page, {
      title: 'The preview is the point',
      act: 'Choosing',
      state: 'Dark · violet',
      caption:
        'The screen being themed is on a shelf in another room, and a row of swatches does not tell anybody what a teal tick on a violet page will look like. So the preview paints one — from the same resolver the kiosk is sent, which is what stops the two disagreeing.',
    });

    await ground('light').click();
    await slot('What you touch', 'Forest').click();
    await slot('What just happened', 'Forest').click();
    await slot('The room', 'Forest').click();
    await dialog.getByText(/allergies: peanuts/i).scrollIntoViewIfNeeded();
    await capture(page, {
      title: 'The same four choices on a light ground',
      act: 'Choosing',
      state: 'Light · forest',
      caption:
        'Ground is a separate axis from hue, and it reuses the light theme the app already had — the whole ink ramp flipped and the accents re-picked rather than lightened. A hue means the same thing on either ground because every ramp holds its lightness and turns only its hue. Two things are also missing from this picker, on purpose: the amber band is absent from “what just happened”, and warning amber is absent from every row. That is what an allergy line is painted in, on the screen and on the printed label, and a gathering that softened it to match its theme would be recolouring the one thing whose whole job is to stop a child being handed the wrong food. It stays amber in the preview above whatever else moves — visible here rather than discovered in a lobby.',
    });

    await dialog.getByRole('button', { name: /^Cancel|^Close/ }).first().click();

    /* ---- Act 2: wearing ---------------------------------------------------- */

    const { context, page: kiosk } = await openKiosk(browser, { viewport: KIOSK_VIEWPORT });

    try {
      await pairKiosk(kiosk, page);

      // The baseline first, on a gathering nothing has themed, so every frame
      // after it has something to be different from.
      await bindTo(kiosk, /friday fellowship/i);
      await typeOnKiosk(kiosk, 'ma');
      await capture(kiosk, {
        title: 'The kiosk that shipped',
        act: 'Wearing',
        state: 'Unthemed',
        caption:
          'Sky blue keys on near-black, which is what every kiosk looked like before this and what every unthemed gathering still looks like. Worth holding in mind for the eight frames below: none of them is a redesign, they are this screen with three hues turned.',
      });

      for (const room of ROOMS) {
        staged.push(await stage(room));
      }

      for (const room of ROOMS) {
        // Back to the chooser through the staff gate — a two-second hold on
        // Clear, the staff screen, then leaving the gathering. The same path a
        // volunteer uses.
        await leaveGathering(kiosk);
        await bindTo(kiosk, new RegExp(room.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));

        // A mis-bind would photograph the wrong room in the right colours, which
        // is the one failure this document could not survive.
        await expect(kiosk.getByText(room.title, { exact: false }).first()).toBeVisible();

        await typeOnKiosk(kiosk, 'ma');
        await capture(kiosk, {
          title: `${room.title} — searching`,
          act: 'Wearing',
          state: `${room.ground === 'light' ? 'Light' : 'Dark'} · ${room.accent}`,
          theme: room,
          slot: 'room',
          // Just this room's reason. What the accent and the backdrop each paint
          // is the same in all four, so it is said once, at the top of the act.
          caption: room.why,
        });

        // Check somebody in, so the second slot has something to colour: the
        // confirm hue never appears on an idle screen.
        const row = await findAnywhere(kiosk, VISITOR);
        await row.click();

        const checkIn = kiosk.getByRole('button', { name: /^Check in$/ });
        if (await checkIn.isVisible().catch(() => false)) await checkIn.click();
        await expect(kiosk.getByText(/checked in/i).first()).toBeVisible({ timeout: 20_000 });

        await capture(kiosk, {
          title: `${room.title} — checked in`,
          act: 'Wearing',
          state: `Confirm · ${room.confirm}`,
          theme: room,
          slot: 'confirm',
          caption: `${room.title} sets its confirmation to ${room.confirm}.`,
        });

        /*
         * Let the success screen retire on its own before touching anything.
         * It returns after four seconds *and* on any pointer-down, so pressing
         * Clear now would spend the press dismissing this rather than opening
         * the staff gate, and the hold would silently never start.
         */
        await kiosk.locator('[data-key="clear"]').waitFor({ state: 'visible', timeout: 20_000 });
        await kiosk.waitForTimeout(500);
      }
    } finally {
      await context.close();
    }
  } finally {
    // A walkthrough that leaves the world edited quietly changes what every
    // other spec is testing. Restore even if a frame threw.
    for (const item of staged) await item.restore();
  }

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, 'themes.json'), JSON.stringify(shots, null, 2), 'utf8');
});
