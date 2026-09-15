/**
 * The page's whole value is that nobody has to type these, so what is worth
 * testing is the two things a reader cannot check by eye: that the required row
 * is actually correct for the origin it was generated from, and that the two
 * rows which can lock a tablet out come last.
 */
import { describe, expect, it } from 'vitest';
import { quietWindowMinutes } from '@/lib/kioskQuietHour';
import { webUsbPolicyJson } from '@/lib/printerVendor';
import { ADB_DEVICE_OWNER, maintenanceWindow, policyRows } from '@/setup/policy';

const ORIGIN = 'https://tally.example.org';

describe('policyRows', () => {
  it('carries the WebUSB rule for the origin it was asked about', () => {
    const row = policyRows(ORIGIN).find((r) => r.key === 'WebUsbAllowDevicesForUrls');
    expect(row?.weight).toBe('required');
    expect(row?.value).toBe(webUsbPolicyJson(ORIGIN));
    expect(JSON.parse(row?.value ?? 'null')[0].urls).toEqual([ORIGIN]);
  });

  it('is generated from the origin, not from a worked example', () => {
    // The failure this rules out is a page that looks right everywhere and is
    // correct only where it was written.
    const other = 'https://kiosk.example.church';
    const row = policyRows(other).find((r) => r.key === 'WebUsbAllowDevicesForUrls');
    expect(row?.value).toContain(other);
    expect(row?.value).not.toContain(ORIGIN);
  });

  it('puts the two rows that can lock a tablet out at the very end', () => {
    // URLBlocklist cuts off the page these values are copied from, so anybody
    // working top to bottom is safe.
    const rows = policyRows(ORIGIN);
    const careful = rows.filter((r) => r.weight === 'careful').map((r) => r.key);
    expect(careful).toEqual(['URLAllowlist', 'URLBlocklist']);
    expect(rows.at(-1)?.key).toBe('URLBlocklist');
    expect(rows.at(-2)?.key).toBe('URLAllowlist');
  });

  it('leads with the row the whole page exists for', () => {
    expect(policyRows(ORIGIN)[0].key).toBe('WebUsbAllowDevicesForUrls');
  });

  it('says why every row is there, because each one is somebody pasting blind', () => {
    for (const row of policyRows(ORIGIN)) {
      expect(row.note.length).toBeGreaterThan(20);
      expect(row.value.length).toBeGreaterThan(0);
    }
  });

  it('gives every value as one line, for a copy button and a paste', () => {
    for (const row of policyRows(ORIGIN)) expect(row.value).not.toContain('\n');
  });
});

describe('maintenanceWindow', () => {
  it('is the hour the kiosk already reloads in, not a second number', () => {
    expect(maintenanceWindow()).toMatchObject(quietWindowMinutes());
  });

  it('reads as a clock time for whoever is typing it into a console', () => {
    expect(maintenanceWindow().label).toMatch(/^\d{2}:\d{2}–\d{2}:\d{2}$/);
  });
});

describe('ADB_DEVICE_OWNER', () => {
  it('names Test DPC’s admin receiver, which is the part people get wrong', () => {
    expect(ADB_DEVICE_OWNER).toContain('com.afwsamples.testdpc/.DeviceAdminReceiver');
  });
});
