/**
 * Which printer is on this shelf, and what is loaded in it.
 *
 * Both facts are stored rather than discovered, and both have to be: `brother_ql`
 * has no model detection and cannot have one, and while the printer does report
 * the media it senses, the report is not unique — 62mm tape is both `62` and
 * `62red`, and the status packet cannot tell black tape from black/red. So a
 * staff member answers once and the answer is what prints.
 *
 * `hasConfiguredPrinter` is the one export the kiosk shell calls, and it is the
 * gate on loading the printing module at all — so it has to answer from
 * localStorage alone, without touching `navigator.usb` or the library. That is
 * why a half-written config reads as no printer rather than as a printer with a
 * missing field: the shell would load the module and find nothing to print with.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PRINTER_LABEL,
  DEFAULT_PRINTER_MODEL,
  clearPrinterConfig,
  hasConfiguredPrinter,
  readPrinterConfig,
  writePrinterConfig,
} from '@/kiosk/printing/device';
import { KIOSK_KEYS } from '@/kiosk/storage';

const stored = () => window.localStorage.getItem(KIOSK_KEYS.printer);

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('the defaults', () => {
  it('name the printer this was built against and its ordinary label', () => {
    // The QL-810W is the model; 62x29mm die-cut is the name-badge label, and
    // its 696x271 dot box is what the renderer targets when nobody has said
    // otherwise.
    expect(DEFAULT_PRINTER_MODEL).toBe('QL-810W');
    expect(DEFAULT_PRINTER_LABEL).toBe('62x29');
  });
});

describe('writePrinterConfig', () => {
  it('stores the two fields on this device', () => {
    writePrinterConfig({ model: 'QL-800', label: '62' });

    expect(JSON.parse(stored() ?? 'null')).toEqual({ model: 'QL-800', label: '62' });
  });

  it('stores those two and nothing else', () => {
    // The form's state picks up stray keys; a fact about the shelf should not.
    writePrinterConfig({ model: 'QL-800', label: '62', margins: 4 } as never);

    expect(JSON.parse(stored() ?? 'null')).toEqual({ model: 'QL-800', label: '62' });
  });

  it('keeps working where storage refuses', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => writePrinterConfig({ model: 'QL-800', label: '62' })).not.toThrow();
  });
});

describe('readPrinterConfig', () => {
  it('reads back what was written', () => {
    writePrinterConfig({ model: 'QL-810W', label: '62x29' });

    expect(readPrinterConfig()).toEqual({ model: 'QL-810W', label: '62x29' });
  });

  it('has nothing to say on a kiosk nobody has set up', () => {
    expect(readPrinterConfig()).toBeNull();
  });

  it('reads a half-written config as no printer', () => {
    for (const half of [{ model: 'QL-810W' }, { label: '62x29' }, {}]) {
      window.localStorage.setItem(KIOSK_KEYS.printer, JSON.stringify(half));
      expect(readPrinterConfig()).toBeNull();
    }
  });

  it('reads an empty field as no printer', () => {
    // `''` would reach `brother_ql` as a model it cannot find, which fails
    // later and further away than saying so here.
    window.localStorage.setItem(KIOSK_KEYS.printer, JSON.stringify({ model: '', label: '62x29' }));
    expect(readPrinterConfig()).toBeNull();

    window.localStorage.setItem(KIOSK_KEYS.printer, JSON.stringify({ model: 'QL-810W', label: '' }));
    expect(readPrinterConfig()).toBeNull();
  });

  it('reads a field of the wrong type as no printer', () => {
    window.localStorage.setItem(KIOSK_KEYS.printer, JSON.stringify({ model: 810, label: '62x29' }));
    expect(readPrinterConfig()).toBeNull();
  });

  it('reads something that is not an object at all as no printer', () => {
    for (const nonsense of ['null', '"QL-810W"', '42', '[]']) {
      window.localStorage.setItem(KIOSK_KEYS.printer, nonsense);
      expect(readPrinterConfig()).toBeNull();
    }
  });

  it('reads corrupt JSON as no printer rather than throwing', () => {
    window.localStorage.setItem(KIOSK_KEYS.printer, 'not json');

    expect(readPrinterConfig()).toBeNull();
  });

  it('drops any stray key that got stored beside the two', () => {
    window.localStorage.setItem(
      KIOSK_KEYS.printer,
      JSON.stringify({ model: 'QL-810W', label: '62x29', margins: 4 }),
    );

    expect(readPrinterConfig()).toEqual({ model: 'QL-810W', label: '62x29' });
  });
});

describe('clearPrinterConfig', () => {
  it('forgets the printer', () => {
    writePrinterConfig({ model: 'QL-810W', label: '62x29' });

    clearPrinterConfig();

    expect(readPrinterConfig()).toBeNull();
    expect(stored()).toBeNull();
  });

  it('keeps working where storage refuses', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(() => clearPrinterConfig()).not.toThrow();
  });
});

describe('hasConfiguredPrinter', () => {
  it('is the gate on loading the printing module at all', () => {
    expect(hasConfiguredPrinter()).toBe(false);

    writePrinterConfig({ model: 'QL-810W', label: '62x29' });
    expect(hasConfiguredPrinter()).toBe(true);

    clearPrinterConfig();
    expect(hasConfiguredPrinter()).toBe(false);
  });

  it('is false for a half-written config, so the shell loads nothing', () => {
    window.localStorage.setItem(KIOSK_KEYS.printer, JSON.stringify({ model: 'QL-810W' }));

    expect(hasConfiguredPrinter()).toBe(false);
  });
});
