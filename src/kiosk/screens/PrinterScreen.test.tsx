/**
 * The margins, which are the one setting on this screen that is a preference.
 *
 * The model and the media are facts about the shelf — a wrong answer there is a
 * label that does not print, which announces itself. A margin is different: it
 * only ever produces a label, and a wrong one produces a label that looks fine
 * on the screen it was set from and wrong in a badge holder. So what is pinned
 * here is when the question is asked at all, and that the answer reaches the
 * stored config, which is what the rasteriser reads.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PrinterScreen } from '@/kiosk/screens/PrinterScreen';
import type { KioskPrinting } from '@/kiosk/KioskApp';
import type { PrinterConfig } from '@/kiosk/printing';

/** Enough of a `Label` for this screen: it only reads the identifier. */
function media(identifier: string) {
  return { identifier } as unknown as { identifier: string };
}

const DIE_CUT = '62x29';
const TAPE = '62';

/** The stored config, as the screen last asked for it to be written. */
let written: PrinterConfig | null = null;

const configure = vi.fn(async (next: PrinterConfig) => {
  written = next;
  return { kind: 'ready' as const };
});

function handle(): KioskPrinting {
  return {
    currentState: () => ({ kind: 'ready', config: { model: 'QL-810W', label: TAPE } }),
    subscribe: () => () => {},
    modelIdentifiers: () => ['QL-810W'],
    labelsForModel: () => [media(DIE_CUT), media(TAPE)],
    labelName: (entry: { identifier: string }) => entry.identifier,
    isEndless: (entry: { identifier: string }) => entry.identifier === TAPE,
    suggestLabels: () => [],
    configure,
    pairPrinter: vi.fn(),
    readStatus: vi.fn(),
    testPrint: vi.fn(),
    canReprint: () => false,
    reprintLast: vi.fn(),
    DEFAULT_LABEL_MARGIN_MM: 0.7,
    MAX_LABEL_MARGIN_MM: 25,
  } as unknown as KioskPrinting;
}

function show(config: Partial<PrinterConfig> = {}): void {
  render(
    <PrinterScreen
      printing={handle()}
      config={{ model: 'QL-810W', label: TAPE, ...config }}
      onDone={() => {}}
    />,
  );
}

/**
 * Change something, and let the write settle.
 *
 * `configure` is awaited before the screen stops being busy, so a bare
 * `fireEvent` leaves a state update outside `act`.
 */
async function change(run: () => void): Promise<void> {
  await act(async () => {
    run();
  });
}

/** What `configure` was last asked to store. */
function stored(): PrinterConfig {
  if (!written) throw new Error('Nothing was configured.');
  return written;
}

const above = () => screen.getByRole('button', { name: 'More space above' });
const below = () => screen.getByRole('button', { name: 'Less space below' });

afterEach(() => {
  cleanup();
  written = null;
});

describe('PrinterScreen margins', () => {
  it('does not ask about them for a die-cut roll', () => {
    // The length is fixed and the block is centred in it, so there is nothing
    // here a margin could do. A control that cannot act is one more thing to try.
    show({ label: DIE_CUT });
    expect(screen.queryByText('Blank tape around the text')).toBeNull();
  });

  it('asks about them for continuous tape', () => {
    show();
    expect(screen.getByText('Blank tape around the text')).toBeTruthy();
  });

  it('starts at what a kiosk set up before this existed already prints', () => {
    show();
    expect(screen.getAllByText('0.7 mm').length).toBe(2);
  });

  it('steps to the whole millimetre it is heading for', async () => {
    show();
    await change(() => fireEvent.click(above()));
    expect(stored().marginTopMm).toBe(1);
    await change(() => fireEvent.click(above()));
    expect(stored().marginTopMm).toBe(2);
  });

  it('steps down to nothing rather than to a negative margin', async () => {
    show();
    await change(() => fireEvent.click(below()));
    expect(stored().marginBottomMm).toBe(0);
    expect(below().hasAttribute('disabled')).toBe(true);
  });

  it('will not spend more than the cap on one label', () => {
    show({ marginTopMm: 25 });
    expect(above().hasAttribute('disabled')).toBe(true);
  });

  it('keeps the margins when the media is changed', async () => {
    // Swapping to die-cut for an afternoon should not cost the tape its setting.
    show({ marginTopMm: 6, marginBottomMm: 3 });
    await change(() =>
      fireEvent.change(screen.getByDisplayValue(TAPE), { target: { value: DIE_CUT } }),
    );
    expect(stored()).toMatchObject({ label: DIE_CUT, marginTopMm: 6, marginBottomMm: 3 });
  });

  it('changes one end without disturbing the other', async () => {
    show({ marginTopMm: 6, marginBottomMm: 3 });
    await change(() => fireEvent.click(above()));
    expect(stored()).toMatchObject({ marginTopMm: 7, marginBottomMm: 3 });
  });
});
