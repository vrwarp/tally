/**
 * The two questions this module keeps apart, kept apart by tests.
 *
 * The decimal values are asserted against the hex on purpose: the policy takes
 * base-10 integers and every published datasheet gives hex, so the conversion
 * is the step a human gets wrong. The test is the conversion, written twice.
 */
import { describe, expect, it } from 'vitest';
import {
  BROTHER_VENDOR_ID,
  DYMO_VENDOR_ID,
  LABEL_PRINTER_VENDOR_IDS,
  ZEBRA_VENDOR_ID,
  webUsbPolicyJson,
  webUsbPolicyValue,
} from '@/lib/printerVendor';

describe('the vendor identifiers', () => {
  it('are the USB-IF assignments, in the decimal the policy takes', () => {
    expect(BROTHER_VENDOR_ID).toBe(0x04f9);
    expect(BROTHER_VENDOR_ID).toBe(1273);
    expect(ZEBRA_VENDOR_ID).toBe(0x0a5f);
    expect(ZEBRA_VENDOR_ID).toBe(2655);
    expect(DYMO_VENDOR_ID).toBe(0x0922);
    expect(DYMO_VENDOR_ID).toBe(2338);
  });

  it('are all inside the 16-bit range the schema allows', () => {
    for (const id of LABEL_PRINTER_VENDOR_IDS) {
      expect(Number.isInteger(id)).toBe(true);
      expect(id).toBeGreaterThanOrEqual(0);
      expect(id).toBeLessThanOrEqual(65535);
    }
  });

  it('leads with the only vendor the kiosk can actually print to', () => {
    expect(LABEL_PRINTER_VENDOR_IDS[0]).toBe(BROTHER_VENDOR_ID);
  });
});

describe('webUsbPolicyValue', () => {
  const ORIGIN = 'https://tally.example.org';

  it('carries both fields Chromium requires of every entry', () => {
    // A dictionary missing either is dropped by the schema, silently.
    for (const entry of webUsbPolicyValue(ORIGIN)) {
      expect(Array.isArray(entry.devices)).toBe(true);
      expect(Array.isArray(entry.urls)).toBe(true);
      expect(entry.devices.length).toBeGreaterThan(0);
      expect(entry.urls).toEqual([ORIGIN]);
    }
  });

  it('never names a product id', () => {
    // A product_id without a vendor_id is invalid, and a model-pinned rule has
    // to be edited the first time a printer is replaced.
    for (const device of webUsbPolicyValue(ORIGIN)[0].devices) {
      expect(Object.keys(device)).toEqual(['vendor_id']);
    }
  });

  it('pre-grants every label vendor, not only the one we drive', () => {
    const granted = webUsbPolicyValue(ORIGIN)[0].devices.map((d) => d.vendor_id);
    expect(granted).toEqual([...LABEL_PRINTER_VENDOR_IDS]);
  });
});

describe('webUsbPolicyJson', () => {
  it('is one line, because it is pasted into a text box by hand', () => {
    const json = webUsbPolicyJson('https://tally.example.org');
    expect(json).not.toContain('\n');
    expect(json).toBe(
      '[{"devices":[{"vendor_id":1273},{"vendor_id":2655},{"vendor_id":2338}],' +
        '"urls":["https://tally.example.org"]}]',
    );
  });

  it('round-trips to the structured value', () => {
    const origin = 'https://kiosk.example.church';
    expect(JSON.parse(webUsbPolicyJson(origin))).toEqual(webUsbPolicyValue(origin));
  });
});
