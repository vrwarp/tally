/**
 * What the printer can be asked about itself.
 *
 * Against the library's real tables rather than a mock of them, because the
 * whole value of these three functions is what they do with the actual model
 * list and the actual media list — a fake `62` that is not also a `62red` would
 * assert nothing about the case they exist for.
 *
 * The status packets are built by hand: `parseStatus` wants a real 32 byte
 * frame, and every field these functions read is at a known offset.
 */
import { describe, expect, it } from 'vitest';
import { getLabel } from '@vrwarp/brother-ql-webusb/labels';
import { parseStatus, type PrinterStatus } from '@vrwarp/brother-ql-webusb/printer-core';
import { matchLabels, modelFromProductName, preferredLabel } from '@/kiosk/printing/detect';

/**
 * A status packet reporting the given media.
 *
 * Byte 10 is the width in mm, byte 11 the media type (0x0a continuous, 0x0b
 * die-cut), byte 17 the length in mm. Everything else is zero, which parses as
 * a reply with no errors.
 */
function packet({
  widthMm,
  lengthMm = 0,
  dieCut = false,
}: {
  widthMm: number;
  lengthMm?: number;
  dieCut?: boolean;
}): PrinterStatus {
  const bytes = new Uint8Array(32);
  bytes[0] = 0x80;
  bytes[1] = 0x20;
  bytes[2] = 0x42;
  bytes[10] = widthMm;
  bytes[11] = dieCut ? 0x0b : 0x0a;
  bytes[17] = lengthMm;
  return parseStatus(bytes);
}

describe('reading the model off the USB bus', () => {
  it('takes the name the printer puts on the bus', () => {
    expect(modelFromProductName('QL-810W')).toBe('QL-810W');
  });

  it('finds it inside whatever the host wraps it in', () => {
    // Some hosts prefix the maker, some do not, and the string is not ours.
    expect(modelFromProductName('Brother QL-810W')).toBe('QL-810W');
  });

  it('does not care about the punctuation', () => {
    // The hyphen in the library's identifier is not load-bearing, and a device
    // that spells itself without one is the same printer.
    expect(modelFromProductName('brother ql810w')).toBe('QL-810W');
  });

  it('takes the most specific model when two of them fit', () => {
    /*
     * A real case: the QL-1110NWBc is a QL-1110NWB with a letter after it, and
     * the shorter identifier is a prefix of the longer. Matching the first
     * entry in the table would set a kiosk up as a printer it is not.
     */
    expect(modelFromProductName('QL-1110NWBc')).toBe('QL-1110NWB');
  });

  it('refuses to guess at a printer the table does not carry', () => {
    // A wrong model rasters at the wrong head width and prints something that
    // looks almost right, which is worse than a list somebody has to answer.
    expect(modelFromProductName('Brother PT-9800PCN')).toBeNull();
  });

  it('has nothing to say about a device that named itself nothing', () => {
    expect(modelFromProductName(null)).toBeNull();
    expect(modelFromProductName(undefined)).toBeNull();
    expect(modelFromProductName('')).toBeNull();
    expect(modelFromProductName('   ')).toBeNull();
  });
});

describe('reading the roll off a status packet', () => {
  it('names the die-cut label the printer has sensed', () => {
    const matched = matchLabels(packet({ widthMm: 62, lengthMm: 29, dieCut: true }), 'QL-810W');

    expect(matched.map((entry) => entry.identifier)).toEqual(['62x29']);
  });

  it('cannot tell 62mm tape from 62mm black/red tape', () => {
    // The case the whole "and say that you guessed" half of this exists for.
    const matched = matchLabels(packet({ widthMm: 62 }), 'QL-810W');

    expect(matched.map((entry) => entry.identifier)).toEqual(['62', '62red']);
  });

  it('offers nothing at all for an empty printer', () => {
    expect(matchLabels(packet({ widthMm: 0 }), 'QL-810W')).toEqual([]);
  });

  it('offers only rolls that fit the head', () => {
    /*
     * `suggestLabels` applies the media table and each label's restriction
     * list, but not whether the label physically fits — nothing in that list
     * stops 62mm tape being offered for a P-touch whose head is 128 dots
     * across, and the rasteriser would then refuse every label the kiosk sent
     * it.
     */
    expect(
      matchLabels(packet({ widthMm: 62 }), 'QL-810W').map((entry) => entry.identifier),
    ).toContain('62');
    expect(matchLabels(packet({ widthMm: 62 }), 'PT-P750W')).toEqual([]);
  });
});

describe('choosing between rolls that look the same', () => {
  it('takes the plainer of the two 62mm tapes', () => {
    // `62mm endless` over `62mm endless (black/red/white)`: the special roll is
    // the one somebody went out of their way to buy.
    const matched = matchLabels(packet({ widthMm: 62 }), 'QL-810W');

    expect(preferredLabel(matched)?.identifier).toBe('62');
  });

  it('leaves a single match alone', () => {
    const matched = matchLabels(packet({ widthMm: 62, lengthMm: 29, dieCut: true }), 'QL-810W');

    expect(preferredLabel(matched)?.identifier).toBe('62x29');
  });

  it('keeps the table’s own order when two names are the same length', () => {
    // `17mm x 54mm die-cut` and `17mm x 87mm die-cut` are the same number of
    // characters, and nothing here is entitled to prefer one of them.
    const first = getLabel('17x54');
    const second = getLabel('17x87');

    expect(preferredLabel([first, second])).toBe(first);
    expect(preferredLabel([second, first])).toBe(second);
  });

  it('has nothing to choose from an empty list', () => {
    expect(preferredLabel([])).toBeNull();
  });
});
