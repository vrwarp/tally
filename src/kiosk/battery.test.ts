/**
 * Every way of having no answer has to look the same from outside.
 *
 * This is read on the path that also decides whether the kiosk still has a
 * standing — a rejected promise here must not become a refused report, and a
 * browser with no batteries must not become an error.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readBattery, resetBatteryForTests } from '@/kiosk/battery';

function withGetBattery(value: unknown) {
  Object.defineProperty(navigator, 'getBattery', { configurable: true, value });
}

beforeEach(() => resetBatteryForTests());

afterEach(() => {
  Reflect.deleteProperty(navigator, 'getBattery');
  resetBatteryForTests();
});

describe('readBattery', () => {
  it('reports what the tablet says', async () => {
    withGetBattery(async () => ({ level: 0.42, charging: true }));
    await expect(readBattery()).resolves.toEqual({ level: 0.42, charging: true });
  });

  it('reports a tablet somebody unplugged', async () => {
    withGetBattery(async () => ({ level: 0.08, charging: false }));
    await expect(readBattery()).resolves.toEqual({ level: 0.08, charging: false });
  });

  it('says nothing on an engine that removed the API', async () => {
    // Firefox and Safari, and every test in this repo that does not opt in.
    await expect(readBattery()).resolves.toBeNull();
  });

  it('says nothing rather than rejecting when the call is refused', async () => {
    withGetBattery(async () => {
      throw new Error('NotAllowedError');
    });
    await expect(readBattery()).resolves.toBeNull();
  });

  it('does not keep asking a browser that already refused', async () => {
    let calls = 0;
    withGetBattery(async () => {
      calls += 1;
      throw new Error('no');
    });
    await readBattery();
    await readBattery();
    await readBattery();
    expect(calls).toBe(1);
  });

  it('asks once and then re-reads the live manager', async () => {
    // The manager's fields update in place, so a second report must see the
    // new charge without a second call.
    let calls = 0;
    const live = { level: 0.5, charging: false };
    withGetBattery(async () => {
      calls += 1;
      return live;
    });
    await expect(readBattery()).resolves.toEqual({ level: 0.5, charging: false });
    live.level = 0.9;
    live.charging = true;
    await expect(readBattery()).resolves.toEqual({ level: 0.9, charging: true });
    expect(calls).toBe(1);
  });

  it('refuses a level that is not a level', async () => {
    for (const level of [-0.1, 1.5, Number.NaN, '80%' as unknown as number]) {
      resetBatteryForTests();
      withGetBattery(async () => ({ level, charging: true }));
      await expect(readBattery()).resolves.toBeNull();
    }
  });

  it('refuses a charging flag that is not a flag', async () => {
    withGetBattery(async () => ({ level: 0.5, charging: 'yes' as unknown as boolean }));
    await expect(readBattery()).resolves.toBeNull();
  });
});
