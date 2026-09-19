/**
 * The page's whole value is that nobody has to type these, so what is worth
 * testing is the two things a reader cannot check by eye: that the required row
 * is actually correct for the origin it was generated from, and that the two
 * rows which can lock a tablet out come last.
 */
import { describe, expect, it } from 'vitest';
import { quietWindowMinutes } from '@/lib/kioskQuietHour';
import { webUsbPolicyJson } from '@/lib/printerVendor';
import {
  ADB_DEVICE_OWNER,
  TESTDPC_PROVISIONING,
  TESTDPC_QR_PAYLOAD,
  maintenanceWindow,
  policyRows,
} from '@/setup/policy';

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

describe('TESTDPC_QR_PAYLOAD', () => {
  /*
   * Nobody reads a QR code, so nothing about this payload is checkable by eye
   * once it is a square. What these pin is the three things Android refuses
   * over — a key it does not recognise, a component name in the wrong of the
   * two forms Test DPC uses, and a checksum that is not the one its signing
   * key produces — and the one thing a reviewer might reasonably "tidy": the
   * fully-qualified receiver, which unlike the adb command above may not be
   * abbreviated here.
   */
  it('carries the three extras the setup wizard provisions from', () => {
    expect(Object.keys(TESTDPC_PROVISIONING)).toEqual([
      'android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME',
      'android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM',
      'android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION',
    ]);
  });

  it('spells the component name out, which the adb form does not have to', () => {
    // `com.afwsamples.testdpc/.DeviceAdminReceiver` is what `dpm` accepts and
    // is not what goes here: the wizard is handed this before the package
    // exists on the device, so there is nothing for the leading dot to be
    // relative to.
    expect(
      TESTDPC_PROVISIONING['android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME'],
    ).toBe('com.afwsamples.testdpc/com.afwsamples.testdpc.DeviceAdminReceiver');
  });

  it('is the base64url checksum Android compares the downloaded APK against', () => {
    // Base64url, not base64: `+` and `/` would not survive being read out of a
    // QR and into an intent extra, and Android publishes it in this alphabet.
    const checksum =
      TESTDPC_PROVISIONING['android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM']!;
    expect(checksum).toBe('gJD2YwtOiWJHkSMkkIfLRlj-quNqG1fb6v100QmzM9w=');
    expect(checksum).toMatch(/^[A-Za-z0-9_-]+=*$/);
  });

  it('is minified JSON the wizard can parse back to exactly that object', () => {
    // Minified because every byte is a module a camera has to resolve, and the
    // pretty form pushes the symbol a version larger for nobody's benefit.
    expect(TESTDPC_QR_PAYLOAD).not.toContain('\n');
    expect(JSON.parse(TESTDPC_QR_PAYLOAD)).toEqual(TESTDPC_PROVISIONING);
  });

  it('stays inside what the QR encoder can draw', () => {
    // 412 bytes is version 15 at level M, which is `encodeQr`'s ceiling. This
    // is the test that fires if the download location is ever repointed at a
    // long self-hosted URL — the page falls back to the payload rather than
    // showing a square, and that is a decision to make deliberately.
    expect(new TextEncoder().encode(TESTDPC_QR_PAYLOAD).length).toBeLessThanOrEqual(412);
  });
});
