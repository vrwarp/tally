/**
 * Printing over Wi-Fi, end to end: the real bridge, the real kiosk, a
 * simulated QL-810W, and the ways an evening goes wrong.
 *
 * What is real: Tally's app and kiosk against the emulators, the printer
 * library, and the bridge that ships (`vrwarp/brother_ql`'s `bridge/`, built,
 * named by `TALLY_BRIDGE_DIR`). What is simulated: the printer, as a TCP
 * port and an SNMP agent on a loopback alias, and the lobby's Wi-Fi, as a
 * proxy the kiosk's WebSocket crosses. See `e2e/support/printServer.ts` and
 * docs/wifi-printing.md.
 *
 * Serial, on one kiosk, because an evening is a sequence: the printer set up
 * once prints the labels that follow, and a fault's resolution is only a
 * resolution if the same kiosk recovers. The journeys are the plan's: set up
 * once in Settings, pick the printer on the kiosk, print; then the cover
 * opens, the printer is switched off and on, the Wi-Fi blips and goes away,
 * the token is rotated, the printer is taken off the server and put back,
 * the print server is removed from Settings and restored, and a second kiosk
 * shares the printer.
 */
import type { Page } from '@playwright/test';
import { gotoReady } from './support/auth';
import { readCollection } from './support/emulator';
import { expect, test } from './support/fixtures';
import { bindTo, hold, leaveGathering, openKiosk, pairKiosk, typeOnKiosk } from './support/kiosk';
import { ChaosProxy, FakePrinter, startBridge, type BridgeHandle } from './support/printServer';

const BRIDGE_DIR = process.env.TALLY_BRIDGE_DIR;

test.skip(
  !BRIDGE_DIR,
  'Set TALLY_BRIDGE_DIR to the built bridge/ of vrwarp/brother_ql to run the print server journeys.',
);
test.describe.configure({ mode: 'serial' });

const PRINTER_HOST = '127.0.0.2';
const BRIDGE_PORT = 8750;
const APP_ORIGIN = 'http://127.0.0.1:4173';

/** Seeded children, one per label, because a second check-in is "already checked in". */
const CHILDREN = [
  'Maya Adebayo',
  'Ethan Nguyen',
  'Sofia Ramirez',
  'Malik Johnson',
  'Grace Kim',
  'Isaiah Brooks',
  'Priya Patel',
  'Hannah Schmidt',
  'Diego Herrera',
  'Noah Fitzgerald',
  'Leila Haddad',
  'Jonah Weiss',
];
let nextChild = 0;

let printer: FakePrinter;
let bridge: BridgeHandle;
let proxy: ChaosProxy;
let token: string;
let tokenId: string;
let printerId: string;
let kiosk: Page;
let closeKiosk: () => Promise<void> = async () => {};

interface BridgeJob {
  client?: string;
  pagesPrinted: number | null;
  confirmation: string | null;
  outcome: string;
  printerName: string;
}

async function bridgeJobs(): Promise<BridgeJob[]> {
  const { jobs } = await bridge.admin<{ jobs: BridgeJob[] }>('GET', 'jobs');
  return jobs;
}

/** The address the core team types: the proxy, which is "the Wi-Fi". */
function serverAddress(): string {
  return `http://127.0.0.1:${proxy.port}`;
}

/** Checks a child in and returns to the search screen. */
async function checkIn(name: string): Promise<void> {
  await typeOnKiosk(kiosk, name.split(' ')[0]!);
  const row = kiosk.getByRole('button', { name: new RegExp(name, 'i') }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  await kiosk.getByRole('button', { name: /^Check in$/ }).click();
  await expect(kiosk.getByText(/welcome/i)).toBeVisible({ timeout: 15_000 });
  await kiosk.getByText(/welcome/i).click();
  await expect(kiosk.getByText(/^type your child’s name$/i)).toBeVisible({ timeout: 15_000 });
}

/** The next seeded child nobody has checked in yet. */
function child(): string {
  const name = CHILDREN[nextChild];
  if (!name) throw new Error('Out of seeded children; add more to CHILDREN.');
  nextChild += 1;
  return name;
}

/** The amber dot on the search screen — the only thing a parent's glass shows. */
function attentionDot() {
  return kiosk.getByRole('button', { name: 'The label printer needs attention' });
}

/** Opens the printer screen from the staff gate. */
async function openPrinterScreen(): Promise<void> {
  await hold(kiosk, '[data-key="clear"]');
  await expect(kiosk.getByText('Staff')).toBeVisible();
  await kiosk.getByRole('button', { name: /Label printer/i }).click();
  await expect(kiosk.getByText('Label printer')).toBeVisible();
}

/** Leaves the printer screen, whichever door it was opened through. */
async function closePrinterScreen(): Promise<void> {
  const home = kiosk.getByRole('button', { name: /Done — back to check-in/i });
  if (await home.isVisible().catch(() => false)) {
    await home.click();
  } else {
    await kiosk.getByRole('button', { name: /^Done$/ }).click();
    await expect(kiosk.getByText('Staff')).toBeVisible();
    await kiosk.getByRole('button', { name: /Keep checking in/i }).click();
  }
  await expect(kiosk.getByText(/^type your child’s name$/i)).toBeVisible({ timeout: 15_000 });
}

async function expectPages(count: number): Promise<void> {
  await expect.poll(() => printer.pages, { timeout: 30_000, message: 'pages out of the printer' }).toBe(count);
}

/** The page count once the printer has been quiet for a moment — a label from the last journey may still be landing. */
async function settledPages(): Promise<number> {
  for (;;) {
    const before = printer.pages;
    await kiosk.waitForTimeout(1_500);
    if (printer.pages === before) return before;
  }
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  printer = new FakePrinter({ host: PRINTER_HOST });
  await printer.start();
  bridge = await startBridge({ dir: BRIDGE_DIR!, port: BRIDGE_PORT, allowedOrigins: APP_ORIGIN });
  proxy = new ChaosProxy({ host: '127.0.0.1', port: BRIDGE_PORT });
  await proxy.start();

  const minted = await bridge.admin<{ token: string; record: { id: string } }>('POST', 'tokens', {
    name: 'Kiosks',
  });
  token = minted.token;
  tokenId = minted.record.id;
  const registered = await bridge.admin<{ printer: { id: string } }>('POST', 'printers', {
    name: 'Shipping desk',
    host: PRINTER_HOST,
    port: 9100,
    model: 'QL-810W',
    statusMode: 'snmp',
    snmpCommunity: 'public',
  });
  printerId = registered.printer.id;

  const opened = await openKiosk(browser);
  kiosk = opened.page;
  closeKiosk = () => opened.context.close();
});

test.afterEach(async ({}, info) => {
  if (info.status === info.expectedStatus) return;
  // What the kiosk and the bridge each wrote down, for whoever reads the failure.
  const kioskLog = await kiosk
    .evaluate(() => localStorage.getItem('tally:kiosk:printerLog'))
    .catch(() => null);
  const entries = kioskLog ? (JSON.parse(kioskLog) as { entries?: unknown[] }).entries ?? [] : [];
  console.log(`[kiosk printer log]\n${entries.slice(-40).map((entry) => JSON.stringify(entry)).join('\n')}`);
  console.log(`[bridge log]\n${bridge.log().split('\n').slice(-40).join('\n')}`);
  console.log(`[printer] pages=${printer.pages} jobs=${printer.jobs} status=${printer.statusRequests} faults=${JSON.stringify(printer.faults)}`);
});

test.afterAll(async () => {
  await closeKiosk();
  await proxy.stop();
  await bridge.stop();
  await printer.stop();
});

test.describe('printing over Wi-Fi through the print server', () => {
  test.setTimeout(180_000);

  test('the core team sets the print server up once, testing it before saving', async ({ page, signedInAs }) => {
    await signedInAs('core');
    await gotoReady(page, '/settings');

    await page.getByRole('button', { name: 'Set up' }).click();
    await page.getByLabel('Server address').fill(serverAddress());
    await page.getByLabel('Token').fill(token);
    await page.getByRole('button', { name: 'Test' }).click();

    await expect(page.getByText('The print server answered. 1 printer is registered:')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Shipping desk')).toBeVisible();

    await page.getByRole('button', { name: 'Save print server' }).click();
    await expect(page.getByText(`Kiosks print through 127.0.0.1:${proxy.port}`)).toBeVisible({ timeout: 20_000 });

    // The address went where the core team can read it, and the token did not.
    const config = await readCollection('config');
    const stored = config.find((doc) => doc.id === 'printServer');
    expect(stored?.data.url).toBe(`ws://127.0.0.1:${proxy.port}/ws`);
    expect(JSON.stringify(config)).not.toContain(token);
    // And it did go somewhere the server can read it back for the kiosks.
    const secret = await readCollection('private');
    expect(secret.find((doc) => doc.id === 'printServer')?.data.token).toBe(token);
  });

  test('the kiosk picks the server’s printer by name and reads the roll off it over SNMP', async ({
    page,
    signedInAs,
  }) => {
    await signedInAs('core');
    await pairKiosk(kiosk, page);
    await bindTo(kiosk, /nursery/i);

    await openPrinterScreen();
    await kiosk.getByRole('button', { name: 'Use the print server' }).click();
    await expect(kiosk.getByText('Which printer should this kiosk use?')).toBeVisible({ timeout: 20_000 });
    await kiosk.getByRole('button', { name: 'Shipping desk' }).click();

    await expect(
      kiosk.getByText('Connected to Shipping desk through the print server — model and roll read off the printer.'),
    ).toBeVisible({ timeout: 30_000 });
    await expect(kiosk.getByText(/QL-810W · .*62.*29.* · via the print server/)).toBeVisible();
    expect(printer.statusRequests).toBeGreaterThan(0);

    // The proof step: a label through the whole chain — worker, rasteriser,
    // WebSocket, bridge, port 9100.
    await kiosk.getByRole('button', { name: 'Print a test label' }).click();
    await expectPages(1);
    await expect(kiosk.getByText(/The test label has been sent/)).toBeVisible();

    await closePrinterScreen();
  });

  test('a check-in prints a name tag through the print server, and the server’s log says which kiosk', async () => {
    await checkIn(child());
    await expectPages(2);

    // The job closes once the kiosk has heard the printer finish, a moment
    // after the page is out.
    await expect.poll(async () => (await bridgeJobs()).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
    await expect
      .poll(async () => (await bridgeJobs())[0]!.outcome, { timeout: 15_000 })
      .toBe('printed');
    const latest = (await bridgeJobs())[0]!;
    expect(latest.printerName).toBe('Shipping desk');
    expect(latest.client).toMatch(/^kiosk-/);
    expect(latest.pagesPrinted).toBe(1);
    expect(latest.confirmation).toBe('phase');
    // The printer is held only while labels flow: nobody is on it now.
    const { printers } = await bridge.admin<{ printers: { id: string; busy: boolean }[] }>('GET', 'printers');
    await expect.poll(async () => (await bridge.admin<{ printers: { busy: boolean }[] }>('GET', 'printers')).printers[0]!.busy, { timeout: 10_000 }).toBe(false);
    expect(printers[0]!.id).toBe(printerId);
  });

  test('a cover opened mid-evening reaches the kiosk in the printer’s own words, and the tag is owed until it is shut', async () => {
    printer.faults.coverOpen = true;
    const name = child();
    await checkIn(name);

    // The parent saw nothing but the welcome; the volunteer sees the dot.
    await expect(attentionDot()).toBeVisible({ timeout: 30_000 });
    await attentionDot().click();
    await expect(kiosk.getByText(/Cover opened while printing/).first()).toBeVisible({ timeout: 15_000 });
    await expect(kiosk.getByText(/Check the lid, the roll and the cutter\./).first()).toBeVisible();
    // While the printer is in trouble the tag is waiting; once it is back
    // the line says what did not print, and the primary offers it.
    await expect(kiosk.getByText('1 name tag is waiting.')).toBeVisible();
    const pagesBefore = await settledPages();

    // Shut the cover. Look again brings the printer back, and the owed tag
    // becomes the one blue thing on the screen.
    printer.faults.coverOpen = false;
    await kiosk.getByRole('button', { name: 'Look again' }).first().click();
    await expect(kiosk.getByRole('button', { name: 'Print 1 name tag' })).toBeVisible({ timeout: 30_000 });
    await expect(kiosk.getByText('1 name tag did not print.')).toBeVisible();
    await kiosk.getByRole('button', { name: 'Print 1 name tag' }).click();
    // The confirm names the child, then prints on a second press.
    await expect(kiosk.getByText(new RegExp(name.split(' ')[0]!))).toBeVisible();
    await kiosk.getByRole('button', { name: 'Print 1 name tag' }).click();
    await expectPages(pagesBefore + 1);
    await expect(kiosk.getByText(/1 name tag printed — take it to the room\./)).toBeVisible({ timeout: 20_000 });

    await closePrinterScreen();
    await expect(attentionDot()).toHaveCount(0);
  });

  test('the printer is switched off: the kiosk says the server could not reach it, and recovers when it is on again', async () => {
    await printer.stop();
    await checkIn(child());

    await expect(attentionDot()).toBeVisible({ timeout: 45_000 });
    await attentionDot().click();
    await expect(kiosk.getByText(/The print server could not reach the printer\./).first()).toBeVisible({ timeout: 15_000 });
    await expect(kiosk.getByText(/Check that the printer is switched on and on the Wi‑Fi\./).first()).toBeVisible();
    const pagesBefore = await settledPages();

    await printer.start();
    await kiosk.getByRole('button', { name: 'Look again' }).first().click();
    await expect(kiosk.getByRole('button', { name: 'Print 1 name tag' })).toBeVisible({ timeout: 30_000 });
    await kiosk.getByRole('button', { name: 'Print 1 name tag' }).click();
    await kiosk.getByRole('button', { name: 'Print 1 name tag' }).click();
    await expectPages(pagesBefore + 1);

    await closePrinterScreen();
  });

  test('the Wi-Fi blips: the kiosk reconnects on its own, says nothing, and the next tag prints', async () => {
    const dialled = proxy.accepted;
    proxy.dropConnections();

    // The ladder's first try is immediate and silent; a new socket crosses the
    // proxy within the grace period plus a moment.
    await expect.poll(() => proxy.accepted, { timeout: 15_000 }).toBeGreaterThan(dialled);
    await kiosk.waitForTimeout(1_000);
    await expect(attentionDot()).toHaveCount(0);

    const pagesBefore = await settledPages();
    await checkIn(child());
    await expectPages(pagesBefore + 1);
  });

  test('the Wi-Fi is slow: a tag still prints', async () => {
    proxy.latencyMs = 250;
    try {
      const pagesBefore = await settledPages();
      await checkIn(child());
      await expectPages(pagesBefore + 1);
    } finally {
      proxy.latencyMs = 0;
    }
  });

  test('the Wi-Fi goes away: the kiosk says the server could not be reached, and comes back by itself', async () => {
    proxy.outage();
    await checkIn(child());

    await expect(attentionDot()).toBeVisible({ timeout: 45_000 });
    await attentionDot().click();
    await expect(kiosk.getByText(/The print server could not be reached\./).first()).toBeVisible({ timeout: 15_000 });
    await expect(kiosk.getByText(/Check the Wi‑Fi and that the print server is running\./).first()).toBeVisible();

    // Back on: the ladder's next rung reopens it with nobody pressing anything.
    proxy.restore();
    await expect(kiosk.getByRole('button', { name: 'Print 1 name tag' })).toBeVisible({ timeout: 90_000 });
    const pagesBefore = await settledPages();
    await kiosk.getByRole('button', { name: 'Print 1 name tag' }).click();
    await kiosk.getByRole('button', { name: 'Print 1 name tag' }).click();
    await expectPages(pagesBefore + 1);
    await closePrinterScreen();
  });

  test('a rotated token: the kiosk says its key was refused, and takes the new one from Settings without a visit', async ({
    page,
    signedInAs,
  }) => {
    const minted = await bridge.admin<{ token: string; record: { id: string } }>('POST', 'tokens', {
      name: 'Kiosks (rotated)',
    });
    await bridge.admin('DELETE', `tokens/${tokenId}`);
    tokenId = minted.record.id;
    // The live socket keeps its authentication; the next connection does not.
    proxy.dropConnections();

    await expect(attentionDot()).toBeVisible({ timeout: 45_000 });
    await attentionDot().click();
    await expect(kiosk.getByText(/The print server refused this kiosk’s key\./).first()).toBeVisible({ timeout: 15_000 });
    await expect(kiosk.getByText(/Paste the print server’s current token into Tally’s Settings\./).first()).toBeVisible();

    await signedInAs('core');
    await gotoReady(page, '/settings');
    // The Print server card's own Change; the backend cards have one each too.
    await page.locator('section', { hasText: 'Kiosks print through' }).getByRole('button', { name: 'Change' }).click();
    await expect(page.getByLabel('Server address')).toHaveValue(serverAddress());
    await page.getByLabel('Token').fill(minted.token);
    await page.getByRole('button', { name: 'Save print server' }).click();
    await expect(page.getByText(/Print server saved/)).toBeVisible({ timeout: 20_000 });
    token = minted.token;

    // The pulse reaches the kiosk within its thirty-second poll, and the
    // kiosk reconnects with what it now holds.
    await expect(
      kiosk.getByText('Connected to Shipping desk through the print server — model and roll read off the printer.'),
    ).toBeVisible({ timeout: 90_000 });
    await closePrinterScreen();
    await expect(attentionDot()).toHaveCount(0);
  });

  test('the printer is taken off the print server and put back: the kiosk says so, and is picked again by name', async () => {
    await expect.poll(async () => (await bridge.admin<{ printers: { busy: boolean }[] }>('GET', 'printers')).printers[0]!.busy, { timeout: 10_000 }).toBe(false);
    await bridge.admin('DELETE', `printers/${printerId}`);
    proxy.dropConnections();

    await expect(attentionDot()).toBeVisible({ timeout: 45_000 });
    await attentionDot().click();
    await expect(kiosk.getByText(/The print server no longer lists this printer\./).first()).toBeVisible({ timeout: 15_000 });

    const registered = await bridge.admin<{ printer: { id: string } }>('POST', 'printers', {
      name: 'Shipping desk',
      host: PRINTER_HOST,
      port: 9100,
      model: 'QL-810W',
      statusMode: 'snmp',
      snmpCommunity: 'public',
    });
    printerId = registered.printer.id;

    await kiosk.getByRole('button', { name: 'Use the print server' }).click();
    await kiosk.getByRole('button', { name: 'Shipping desk' }).click();
    await expect(
      kiosk.getByText('Connected to Shipping desk through the print server — model and roll read off the printer.'),
    ).toBeVisible({ timeout: 30_000 });
    await closePrinterScreen();

    const pagesBefore = await settledPages();
    await checkIn(child());
    await expectPages(pagesBefore + 1);
  });

  test('the Kiosk page says how this kiosk prints', async ({ page, signedInAs }) => {
    // The standing report goes out when the kiosk binds; leaving and coming
    // back to the gathering is the quickest way to hear it.
    await leaveGathering(kiosk);
    await bindTo(kiosk, /nursery/i);

    await expect
      .poll(
        async () => {
          const devices = await readCollection('kioskDevices');
          return devices.map((doc) => JSON.stringify(doc.data)).join('\n');
        },
        { timeout: 30_000 },
      )
      .toContain('Shipping desk');

    await signedInAs('core');
    await gotoReady(page, '/pair-kiosk');
    await expect(page.getByText('Prints through the print server · Shipping desk')).toBeVisible({ timeout: 20_000 });
  });

  test('the print server is removed in Settings: the kiosk says so, and takes it back when it returns', async ({
    page,
    signedInAs,
  }) => {
    await signedInAs('core');
    await gotoReady(page, '/settings');
    await page.getByRole('button', { name: 'Remove print server' }).click();
    await page.getByRole('button', { name: 'Yes, remove it' }).click();
    await expect(page.getByText('No print server')).toBeVisible({ timeout: 20_000 });

    await expect(attentionDot()).toBeVisible({ timeout: 90_000 });
    await attentionDot().click();
    await expect(
      kiosk.getByText(/This kiosk is set up for a print server, but Tally no longer has one\./).first(),
    ).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Set up' }).click();
    await page.getByLabel('Server address').fill(serverAddress());
    await page.getByLabel('Token').fill(token);
    await page.getByRole('button', { name: 'Save print server' }).click();
    await expect(page.getByText(/Print server saved/)).toBeVisible({ timeout: 20_000 });

    await expect(
      kiosk.getByText('Connected to Shipping desk through the print server — model and roll read off the printer.'),
    ).toBeVisible({ timeout: 90_000 });
    await closePrinterScreen();
  });

  test('two kiosks share the one printer, each holding it only while its labels flow', async ({
    browser,
    page,
    signedInAs,
  }) => {
    await signedInAs('core');
    const second = await openKiosk(browser);
    try {
      await pairKiosk(second.page, page);
      await bindTo(second.page, /nursery/i);
      await hold(second.page, '[data-key="clear"]');
      await second.page.getByRole('button', { name: /Label printer/i }).click();
      await second.page.getByRole('button', { name: 'Use the print server' }).click();
      await second.page.getByRole('button', { name: 'Shipping desk' }).click();
      await expect(
        second.page.getByText('Connected to Shipping desk through the print server — model and roll read off the printer.'),
      ).toBeVisible({ timeout: 30_000 });
      await second.page.getByRole('button', { name: /^Done$/ }).click();
      await expect(second.page.getByText('Staff')).toBeVisible();
      await second.page.getByRole('button', { name: /Keep checking in/i }).click();
      await expect(second.page.getByText(/^type your child’s name$/i)).toBeVisible({ timeout: 15_000 });

      const pagesBefore = await settledPages();
      const first = child();
      const other = child();
      // Both at once, the way two doors fill up at the same moment.
      await Promise.all([
        checkIn(first),
        (async () => {
          await typeOnKiosk(second.page, other.split(' ')[0]!);
          const row = second.page.getByRole('button', { name: new RegExp(other, 'i') }).first();
          await expect(row).toBeVisible({ timeout: 15_000 });
          await row.click();
          await second.page.getByRole('button', { name: /^Check in$/ }).click();
          await expect(second.page.getByText(/welcome/i)).toBeVisible({ timeout: 15_000 });
        })(),
      ]);
      await expectPages(pagesBefore + 2);

      const jobs = await bridgeJobs();
      const clients = new Set(jobs.slice(0, 2).map((job) => job.client));
      expect(clients.size).toBe(2);
      await expect(attentionDot()).toHaveCount(0);
      await expect(second.page.getByRole('button', { name: 'The label printer needs attention' })).toHaveCount(0);
    } finally {
      await second.context.close();
    }
  });
});
