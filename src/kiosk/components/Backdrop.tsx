/**
 * The gathering's photograph, behind the idle search screen and nowhere else.
 *
 * This layer is decoration with a rulebook, and the rulebook came out of a
 * five-way consultation (journey, harmony, parent, newcomer, staff — see the
 * PR that added it). The rules that survived all five:
 *
 * **It is an idle-state object.** `shown` is true exactly when the kiosk is
 * bound, on the search screen, with an empty buffer and no overlay or wizard —
 * and the layer is at opacity 0 in every other state. Not "heavily dimmed":
 * zero. Everything above this in the stack assumes an opaque page — the
 * results ramp is a painted gradient to `ink-950`, a checked-in row is
 * `present-600/20` over the page, the collected state is an opacity step —
 * and a photograph left visible under any of them turns those constructions
 * arbitrary. The overlays (confirm, success, staff) render transparent over
 * the same page, so zero here is also what keeps the tick screen exactly as
 * plain as it was: a parent's receipt, and the queue's "the kiosk is free"
 * signal, stay flat by this one number.
 *
 * **The recede must cost the first keystroke nothing.** The layer re-renders
 * only when `shown` flips — the memo sees primitives, so keystrokes two
 * through twenty never touch it — and what a flip does is toggle one class:
 * the fade runs as a composited opacity transition on a layer that carried
 * `will-change: opacity` from the moment it mounted, so no promotion, paint or
 * texture upload lands in the keystroke's frame. Out is fast (the parent is
 * working); back in is slower and starts late (see index.css), so a returning
 * idle screen leads with the instruction and the photograph arrives third —
 * and a first letter landing mid-return reverses the transition continuously
 * rather than cutting.
 *
 * **It never races the roster.** The pixels arrive through
 * `src/kiosk/backdrop.ts` — cache first, network only after the reads that
 * make the kiosk searchable have settled — and are revealed only once decoded,
 * so neither the fetch nor the decode can ride a boot or a keystroke.
 *
 * **No clock may be added in service of this layer.** A walked-away-from
 * search keeps the glass receded until somebody presses Clear, and that is
 * the accepted cost: the buffer and confirm screens deliberately have no
 * timeout of their own (see ABANDONED_MS in KioskApp), and an idle clock
 * added to bring the photograph back would race the slow parent that decision
 * protects. The photograph is the between-families face of the kiosk, not its
 * constant one.
 *
 * The veil the image sits under is `.kiosk-backdrop-veil` in index.css —
 * built from `--color-ink-950`, never a literal black, so its direction and
 * tint follow the gathering's ground and hue turn by construction. The image
 * runs full bleed under a light wash (the appeal consultation's verdict on
 * the first, banded construction: every guarantee kept, a photograph owning
 * a fifth of the frame, the point lost), and the legibility numbers ride the
 * content instead: the idle instruction's own plate, the register chip's
 * underlay, the keys' translucent fill, and one header token step — all page
 * token, all compositing back to the bare page on a kiosk with no
 * photograph. The editor's preview shares the same classes, which is what
 * keeps the office and the shelf from disagreeing.
 */
import { memo, useEffect, useRef, useState } from 'react';
import { tallyRender } from '../renderTally';

export const Backdrop = memo(function Backdrop({
  url,
  shown,
}: {
  /** An object URL for the decoded-size image, or null for no photograph. */
  url: string | null;
  /** The one predicate: bound ∧ search screen ∧ idle. Opacity is 0 otherwise. */
  shown: boolean;
}) {
  tallyRender('Backdrop');

  /*
   * Revealed only once the browser has pixels, so the fade-in is a fade and
   * never a decode: an image revealed before decoding paints its first frame
   * whenever the raster thread gets to it, which on the hardware this targets
   * is exactly the kind of surprise frame the perf doc exists to hunt.
   */
  const [decoded, setDecoded] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!url) {
      setDecoded(null);
      return;
    }
    let cancelled = false;
    const img = imgRef.current;
    const reveal = () => {
      if (!cancelled) setDecoded(url);
    };
    /*
     * `decode()` where the browser has it, the load event where it does not
     * (and as the safety net for a decode() that rejects — some engines refuse
     * on memory pressure, and a slightly later, undecoded reveal beats none).
     */
    if (img && typeof img.decode === 'function') {
      img.decode().then(reveal, reveal);
    } else if (img) {
      img.addEventListener('load', reveal, { once: true });
    }
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!url) return null;

  const visible = shown && decoded === url;

  return (
    <div
      aria-hidden="true"
      data-testid="kiosk-backdrop"
      className={`kiosk-backdrop pointer-events-none fixed inset-0 -z-10 overflow-hidden ${
        visible ? '' : 'kiosk-backdrop-hidden'
      }`}
    >
      {/*
        * `alt=""` and aria-hidden on the frame: this is scenery, and a screen
        * reader walking the kiosk should never meet it. Cover-cropped, centred
        * — the one image serves both orientations, which is why the editor
        * previews both crops before Sunday.
        */}
      <img
        ref={imgRef}
        src={url}
        alt=""
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="kiosk-backdrop-veil absolute inset-0" />
    </div>
  );
});
