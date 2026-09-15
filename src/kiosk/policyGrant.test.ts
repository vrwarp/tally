/**
 * The probe's whole contract is that it answers, quietly, always.
 *
 * It runs on the boot path of a screen in a lobby. There is nowhere to show an
 * error and nobody to read one, so every way of failing has to come back as
 * "no printer" — which is the same answer the overwhelming majority of kiosks
 * get honestly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BROTHER_VENDOR_ID, DYMO_VENDOR_ID, ZEBRA_VENDOR_ID } from '@/lib/printerVendor';
import { hasGrantedPrinter } from '@/kiosk/policyGrant';

/** jsdom has no `navigator.usb`, so every test installs the one it wants. */
function withUsb(usb: unknown) {
  Object.defineProperty(navigator, 'usb', { configurable: true, value: usb });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'usb');
  vi.restoreAllMocks();
});

describe('hasGrantedPrinter', () => {
  it('is true when the policy has granted a Brother', async () => {
    withUsb({ getDevices: async () => [{ vendorId: BROTHER_VENDOR_ID }] });
    await expect(hasGrantedPrinter()).resolves.toBe(true);
  });

  it('is false when the origin has been granted nothing', async () => {
    withUsb({ getDevices: async () => [] });
    await expect(hasGrantedPrinter()).resolves.toBe(false);
  });

  it('ignores vendors the kiosk cannot print to', async () => {
    // The tablet policy pre-grants Zebra and Dymo because a grant costs
    // nothing. Loading a Brother transport for one of them costs a confusing
    // failure deep inside a library, so they are not a reason to load it.
    withUsb({
      getDevices: async () => [{ vendorId: ZEBRA_VENDOR_ID }, { vendorId: DYMO_VENDOR_ID }],
    });
    await expect(hasGrantedPrinter()).resolves.toBe(false);
  });

  it('finds the Brother among devices it does not care about', async () => {
    withUsb({
      getDevices: async () => [{ vendorId: ZEBRA_VENDOR_ID }, { vendorId: BROTHER_VENDOR_ID }],
    });
    await expect(hasGrantedPrinter()).resolves.toBe(true);
  });

  it('says no on a browser with no WebUSB at all', async () => {
    // Every engine that is not Chromium, and jsdom.
    await expect(hasGrantedPrinter()).resolves.toBe(false);
    withUsb({});
    await expect(hasGrantedPrinter()).resolves.toBe(false);
  });

  it('says no rather than rejecting when the bus will not answer', async () => {
    withUsb({
      getDevices: async () => {
        throw new Error('NotAllowedError');
      },
    });
    await expect(hasGrantedPrinter()).resolves.toBe(false);
  });

  it('says no rather than throwing when the accessor itself throws', async () => {
    Object.defineProperty(navigator, 'usb', {
      configurable: true,
      get() {
        throw new Error('blocked by permissions policy');
      },
    });
    await expect(hasGrantedPrinter()).resolves.toBe(false);
  });
});
