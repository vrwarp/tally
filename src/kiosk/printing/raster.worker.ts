/**
 * The label rasteriser, off the main thread.
 *
 * This worker exists for one reason: the kiosk's UI must not stutter. Turning a
 * template into a Brother raster job means compositing, greyscaling,
 * thresholding and bit-packing a few hundred thousand pixels, and `brother_ql`
 * does all of it in one synchronous call with no yield points. Run on the main
 * thread it would land exactly where it is least welcome — the pre-raster fires
 * when the confirm screen opens, which is while a parent's thumb is on its way
 * to the button.
 *
 * What stays behind on the main thread is the USB transport, because
 * `navigator.usb` is not exposed to workers. So the division is: this builds the
 * bytes, `index.ts` sends them. `@vrwarp/brother-ql-webusb/printer-core` and
 * `.../convert` are separate entry points precisely so neither side carries the
 * other's weight — see the docblock on `printer-core.ts` upstream.
 *
 * The finished job is transferred rather than copied. It is the only large thing
 * crossing the boundary and it is a fresh buffer nobody here needs again.
 */
import { createJob, expectedImageSize } from '@vrwarp/brother-ql-webusb/convert';
import { isEndless, resolveLabel } from '@vrwarp/brother-ql-webusb/labels';
import { DOTS_PER_MM } from '@/lib/labelRender';
import type { LabelTemplate, LabelTokenValues } from '@/lib/labelTemplate';
import { drawLabel } from './draw';

export interface RasterRequest {
  /** Echoed back, so the controller can match a reply to a waiting caller. */
  id: number;
  model: string;
  label: string;
  /**
   * Blank millimetres above and below the text on continuous tape, if this
   * kiosk has been given a preference. Ignored on die-cut media, whose length
   * is fixed and whose block is centred. See `PrinterConfig.marginTopMm`.
   */
  marginTopMm?: number;
  marginBottomMm?: number;
  template: LabelTemplate;
  values: LabelTokenValues;
}

export type RasterReply =
  | { id: number; ok: true; job: Uint8Array; pageCount: number }
  | { id: number; ok: false; message: string };

/**
 * `self`, as a worker rather than as a window.
 *
 * `tsconfig.json` includes the DOM lib and not WebWorker — the app is a browser
 * app and the two libraries contradict each other on several globals — so `self`
 * is typed as a `Window`, whose `postMessage` has no transfer-list overload.
 * Naming the two members used here is cheaper than making the whole project
 * carry worker types for one file.
 */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<RasterRequest>) => void) | null;
  postMessage(message: RasterReply, transfer?: ArrayBuffer[]): void;
};

/** A margin a person typed, as dots, or undefined to leave the default alone. */
function marginDots(mm: number | undefined): number | undefined {
  return mm === undefined ? undefined : Math.round(mm * DOTS_PER_MM);
}

function build(request: RasterRequest): { job: Uint8Array; pageCount: number } {
  const [width, height] = expectedImageSize(request.label);
  const endless = isEndless(resolveLabel(request.label));

  const image = drawLabel(request.template, request.values, {
    width,
    // Continuous tape has no fixed length, so the content decides it. Die-cut
    // media does, and `prepareImage` will refuse anything else.
    height: endless ? null : height,
    // Only on tape. On die-cut media a margin cannot lengthen the label, so all
    // it could do is shove the text off-centre on a label somebody chose for its
    // size — a setting that says "continuous tape" on the screen it is set from
    // should not quietly do that.
    ...(endless
      ? { paddingTop: marginDots(request.marginTopMm), paddingBottom: marginDots(request.marginBottomMm) }
      : {}),
  });

  /*
   * Copies are pages: the same image handed over as many times as asked for.
   *
   * That is how the library models them — one raster pass and one page of wire
   * bytes each — so a two-copy job costs twice the work. Which is exactly the
   * cost this worker exists to absorb, and doing it here means the printer
   * receives one job and cuts between the copies itself rather than the kiosk
   * sending two and hoping they stay adjacent.
   *
   * dither, compress and red are all left off. Text thresholds crisper than it
   * dithers, and each flag left alone keeps a whole per-pixel pass out of the
   * path: Floyd-Steinberg, PackBits, and the HSV conversion behind the red/black
   * separation respectively.
   */
  const pageCount = Math.max(1, request.template.copies);
  const pages = Array.from({ length: pageCount }, () => image);

  const job = createJob(request.model, pages, request.label, {
    dither: false,
    compress: false,
    red: false,
  });

  return { job, pageCount };
}

ctx.onmessage = (event: MessageEvent<RasterRequest>) => {
  const request = event.data;
  try {
    const { job, pageCount } = build(request);
    // Transferred, not copied: the job is the only large thing crossing the
    // boundary and nothing here needs it again.
    ctx.postMessage({ id: request.id, ok: true, job, pageCount }, [job.buffer as ArrayBuffer]);
  } catch (error) {
    // Every failure here is a bad template, an unknown model or a label that
    // does not fit the head — all permanent, none worth retrying, and none of
    // them a reason to take the worker down with them.
    ctx.postMessage({
      id: request.id,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
