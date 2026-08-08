/**
 * What survives a round trip through this device's localStorage.
 *
 * The model and the media are strings and would not be worth a test on their
 * own. The margins are numbers a person stepped to, and the failure worth
 * catching is the one nobody would see until a roll ran out: a config carrying
 * a nonsense margin either printing a foot of blank tape per child, or taking
 * the printer away from a kiosk entirely because one field was wrong.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { KIOSK_KEYS } from '../storage';
import {
  MAX_LABEL_MARGIN_MM,
  clearPrinterConfig,
  hasConfiguredPrinter,
  readPrinterConfig,
  writePrinterConfig,
} from './device';

function store(value: unknown): void {
  localStorage.setItem(KIOSK_KEYS.printer, JSON.stringify(value));
}

beforeEach(() => {
  localStorage.clear();
});

describe('the stored printer config', () => {
  it('round-trips the model, the media and the margins', () => {
    writePrinterConfig({ model: 'QL-810W', label: '62', marginTopMm: 6, marginBottomMm: 2 });
    expect(readPrinterConfig()).toEqual({
      model: 'QL-810W',
      label: '62',
      marginTopMm: 6,
      marginBottomMm: 2,
    });
  });

  it('reads a config written before the margins existed', () => {
    // Every kiosk already set up. Undefined means the renderer's own padding,
    // which is exactly what those kiosks have been printing.
    store({ model: 'QL-810W', label: '62' });
    expect(readPrinterConfig()).toEqual({
      model: 'QL-810W',
      label: '62',
      marginTopMm: undefined,
      marginBottomMm: undefined,
    });
  });

  it('clamps a margin rather than refusing the config it came in', () => {
    // A wrong margin is a label that looks odd; a refused config is a kiosk
    // that has no printer until somebody drives out to it.
    store({ model: 'QL-810W', label: '62', marginTopMm: 900, marginBottomMm: -5 });
    expect(readPrinterConfig()).toMatchObject({
      marginTopMm: MAX_LABEL_MARGIN_MM,
      marginBottomMm: 0,
    });
  });

  it('drops a margin that is not a number at all', () => {
    store({ model: 'QL-810W', label: '62', marginTopMm: '6mm', marginBottomMm: Number.NaN });
    expect(readPrinterConfig()).toEqual({
      model: 'QL-810W',
      label: '62',
      marginTopMm: undefined,
      marginBottomMm: undefined,
    });
  });

  it('clamps on the way in as well as on the way out', () => {
    writePrinterConfig({ model: 'QL-810W', label: '62', marginTopMm: 900 });
    expect(JSON.parse(localStorage.getItem(KIOSK_KEYS.printer)!)).toMatchObject({
      marginTopMm: MAX_LABEL_MARGIN_MM,
    });
  });

  it('still answers the gate that decides whether to load the printing module', () => {
    expect(hasConfiguredPrinter()).toBe(false);
    writePrinterConfig({ model: 'QL-810W', label: '62' });
    expect(hasConfiguredPrinter()).toBe(true);
    clearPrinterConfig();
    expect(hasConfiguredPrinter()).toBe(false);
  });

  it('refuses a config with no model or no media', () => {
    store({ label: '62' });
    expect(readPrinterConfig()).toBeNull();
    store({ model: 'QL-810W', label: '' });
    expect(readPrinterConfig()).toBeNull();
  });
});
