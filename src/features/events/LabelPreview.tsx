/**
 * What the sticker will look like, drawn by the code that will draw it.
 *
 * Not a mock-up. The layout comes from `lib/labelRender.ts`, which is the same
 * module the kiosk's worker calls, so the decisions a leader needs to see before
 * a parent does — a long name shrinking, a line wrapping, a line dropped off the
 * bottom because it would not fit — are the decisions that will actually be
 * made. A hand-drawn approximation would agree with the printer right up until
 * it mattered.
 *
 * The differences from the kiosk are deliberate and both are about scale rather
 * than about layout. This measures on a DOM canvas instead of an
 * `OffscreenCanvas` in a worker, because there is nothing to keep responsive
 * here. And it draws at screen size rather than at 300 dpi, by laying out in
 * printer dots and then scaling the context — so the geometry is identical and
 * only the ruler changes.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { labelFont, layoutLabel, type LabelBox, type MeasureText } from '@/lib/labelRender';
import type { LabelTemplate, LabelTokenValues } from '@/lib/labelTemplate';

/**
 * A child who exercises the layout rather than flattering it.
 *
 * Long enough to shrink at `xl` on a 62mm label, so a leader sees the machinery
 * work on the sample instead of discovering it on a Bartholomew.
 */
const SAMPLE_VALUES: LabelTokenValues = {
  firstName: 'Bartholomew',
  lastName: 'Fitzwilliam',
  lastInitial: 'F',
  grade: '8th grade',
  eventTitle: 'Sunday Nursery',
  date: 'Aug 9',
  time: '9:04 AM',
};

/** How wide the preview is drawn, in CSS pixels. */
const PREVIEW_WIDTH_PX = 320;

export function LabelPreview({
  template,
  values = SAMPLE_VALUES,
  box,
  className,
}: {
  template: LabelTemplate;
  values?: LabelTokenValues;
  /** The media to preview against, in printer dots. */
  box: LabelBox;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [notes, setNotes] = useState<{ dropped: number; scaled: boolean }>({
    dropped: 0,
    scaled: false,
  });

  const scale = PREVIEW_WIDTH_PX / box.width;

  // Serialised so the effect re-runs when a line's text changes, not only when
  // the array identity does — the editor rebuilds this object on every keystroke
  // either way, but depending on the identity would hide a mutation.
  const key = useMemo(() => JSON.stringify([template, values, box]), [template, values, box]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const measure: MeasureText = (text, fontPx, bold) => {
      ctx.font = labelFont(fontPx, bold);
      return ctx.measureText(text).width;
    };

    // Measured unscaled, in dots, so the layout sees the same numbers the
    // printer will. The transform below only changes how it is painted.
    const layout = layoutLabel(template, values, box, measure);
    const heightDots = layout.height;

    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(box.width * scale * ratio);
    canvas.height = Math.round(heightDots * scale * ratio);
    canvas.style.width = `${Math.round(box.width * scale)}px`;
    canvas.style.height = `${Math.round(heightDots * scale)}px`;

    ctx.setTransform(scale * ratio, 0, 0, scale * ratio, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, box.width, heightDots);

    ctx.fillStyle = '#000000';
    ctx.textBaseline = 'alphabetic';
    for (const draw of layout.draws) {
      ctx.font = labelFont(draw.fontPx, draw.bold);
      ctx.textAlign = draw.align === 'center' ? 'center' : draw.align;
      ctx.fillText(draw.text, draw.x, draw.y);
    }

    setNotes({ dropped: layout.droppedLines, scaled: layout.scaledToFit });
    // `key` stands in for the three objects it serialises.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, scale]);

  return (
    <div className={className}>
      <canvas
        ref={canvasRef}
        // A white sticker on a dark form needs an edge, or it reads as a hole.
        className="rounded-sm shadow-md ring-1 ring-ink-700"
        role="img"
        aria-label="Preview of the printed label"
      />
      {/*
        * Said out loud, because the alternative is a leader designing a
        * four-line label, seeing three, and not knowing which rule did it.
        */}
      {notes.dropped > 0 ? (
        <p className="pt-2 text-xs leading-snug text-warn-400">
          {notes.dropped === 1 ? 'The last line does not' : `The last ${notes.dropped} lines do not`} fit
          on this label and will not be printed.
        </p>
      ) : notes.scaled ? (
        <p className="pt-2 text-xs leading-snug text-ink-500">
          Everything has been scaled down to fit. Fewer or smaller lines would print larger.
        </p>
      ) : null}
    </div>
  );
}
