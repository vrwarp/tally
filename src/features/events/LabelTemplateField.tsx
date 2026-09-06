/**
 * Designing the sticker a gathering prints.
 *
 * Off by default, and off is `null` rather than an empty template: printing is
 * opt-in per gathering because a printer plugged in for the nursery must not
 * start producing labels at youth group. Ticking the box seeds the default so a
 * leader starts from something that works rather than from a blank canvas.
 *
 * Split out of `EventEditorModal` like `CheckInWindowField` and for the same
 * reason — somewhere to be tested without dragging the whole editor, and Firebase
 * with it, into jsdom.
 *
 * What is deliberately absent is any mention of label size, printer model or
 * dots. That belongs to the kiosk, which is the only thing that knows which roll
 * is loaded this morning; the picker here is labelled as affecting the preview
 * only. The reasoning is in `lib/labelTemplate.ts`, and the consequence is that
 * changing rolls in the lobby is a change on one device rather than an edit to
 * every event.
 */
import { useState } from 'react';
import { CheckboxField, SelectField, TextField } from '@/components/ui';
import {
  DEFAULT_FIXED_LENGTH_MM,
  DEFAULT_LABEL_FONT_SCALE,
  DEFAULT_LABEL_MARGIN_MM,
  DEFAULT_LABEL_TEMPLATE,
  LABEL_LINE_ALIGNS,
  LABEL_LINE_SIZES,
  LABEL_TOKENS,
  MAX_LABEL_COPIES,
  MAX_LABEL_FIXED_LENGTH_MM,
  MAX_LABEL_FONT_SCALE,
  MAX_LABEL_LINES,
  MAX_LABEL_LINE_LENGTH,
  MAX_LABEL_MARGIN_MM,
  MIN_LABEL_FIXED_LENGTH_MM,
  MIN_LABEL_FONT_SCALE,
  fillLabelTokens,
  tokensIn,
  unknownTokensIn,
  type LabelLine,
  type LabelTemplate,
} from '@/lib/labelTemplate';
import { cn } from '@/lib/utils';
import { labelBoxFor } from '@/lib/labelRender';
import { LabelPreview } from '@/features/events/LabelPreview';
import { SAMPLE_VALUES, SPARSE_SAMPLE_VALUES } from '@/features/events/labelSamples';

/**
 * The media offered for the preview, in printable dots at 300 dpi.
 *
 * A short list rather than the library's twenty-seven, because this only decides
 * what shape the preview is drawn in — and because pulling the label tables into
 * the main app to populate a preview picker would be a strange amount of weight
 * for the job. The kiosk has the real list.
 */
const PREVIEW_MEDIA = [
  { id: '62x29', name: '62 × 29 mm die-cut', width: 696, height: 271 as number | null },
  { id: '62x100', name: '62 × 100 mm die-cut', width: 696, height: 1109 as number | null },
  { id: '29x90', name: '29 × 90 mm die-cut', width: 306, height: 991 as number | null },
  { id: '62', name: '62 mm continuous', width: 696, height: null as number | null },
  { id: '29', name: '29 mm continuous', width: 306, height: null as number | null },
] as const;

/** Human wording for the size names, which are terse on purpose in the data. */
const SIZE_LABELS: Record<(typeof LABEL_LINE_SIZES)[number], string> = {
  sm: 'Small',
  md: 'Medium',
  lg: 'Large',
  xl: 'Biggest',
};

const ALIGN_LABELS: Record<(typeof LABEL_LINE_ALIGNS)[number], string> = {
  left: 'Left',
  center: 'Centre',
  right: 'Right',
};

function blankLine(): LabelLine {
  return { text: '', size: 'md', bold: false, align: 'center', requiresValue: false };
}

function numberOrUndefined(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** What the checkbox that drops a line is called, quoted in the hint below. */
const REQUIRES_VALUE_LABEL = 'Only if filled in';

/**
 * What this line would print for a child none of its tokens has a value for.
 *
 * Filling against nothing is the whole trick: `fillLabelTokens` empties every
 * token and collapses what is left, so an empty answer means the line already
 * disappears on its own and a non-empty one is the literal text that would be
 * printed on its own — "Allergy:", "Grade", "Room". That string is both how the
 * editor knows to warn and the most convincing way to say it.
 */
function leftoverText(text: string): string {
  return tokensIn(text).length === 0 ? '' : fillLabelTokens(text, {});
}

/**
 * The length of a fixed-length label, which is allowed to be empty while it is
 * being retyped.
 *
 * Its own component because it needs its own draft, and it needs a draft
 * because `undefined` already means something here that it does not mean for
 * the margins beside it. There, absent is "no opinion, let the renderer decide"
 * — so an emptied box can simply store nothing and show the default faded
 * behind. Here, absent is the *off* state of the tick box above, and the
 * condition this field is rendered under at all: storing it on the first
 * backspace would untick the box and pull the input out from under the caret.
 *
 * So an empty box is held locally rather than written up. The template keeps the
 * last length that parsed — a half-typed number is not a shape anybody asked to
 * print — and blur decides what an abandoned empty box meant: the default,
 * because turning the setting off is what the tick box is for.
 */
function FixedLengthField({
  value,
  onChange,
}: {
  value: number;
  onChange: (next: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <TextField
      label="Length (mm)"
      type="number"
      inputMode="decimal"
      min={MIN_LABEL_FIXED_LENGTH_MM}
      max={MAX_LABEL_FIXED_LENGTH_MM}
      step={1}
      className="w-36"
      value={draft ?? String(value)}
      placeholder={String(DEFAULT_FIXED_LENGTH_MM)}
      onChange={(changed) => {
        setDraft(changed.target.value);
        const parsed = numberOrUndefined(changed.target.value);
        if (parsed !== undefined) onChange(parsed);
      }}
      onBlur={() => {
        if (draft !== null && numberOrUndefined(draft) === undefined) {
          onChange(DEFAULT_FIXED_LENGTH_MM);
        }
        // Back to following the template, so a length changed from elsewhere —
        // or the box ticked again after being cleared — shows up here.
        setDraft(null);
      }}
    />
  );
}

export function LabelTemplateField({
  value,
  onChange,
}: {
  value: LabelTemplate | null;
  onChange: (next: LabelTemplate | null) => void;
}) {
  const [media, setMedia] = useState<string>(PREVIEW_MEDIA[0].id);
  const chosen = PREVIEW_MEDIA.find((entry) => entry.id === media) ?? PREVIEW_MEDIA[0];
  /*
   * The same mapping the kiosk's rasteriser makes, from the same function — so
   * a rotated label previews as the long thin sticker it will actually be, and
   * a fixed length shows up as one.
   */
  const preview = labelBoxFor(value ?? DEFAULT_LABEL_TEMPLATE, {
    widthDots: chosen.width,
    lengthDots: chosen.height,
  });

  /**
   * Which of the two sample children the preview is drawn for.
   *
   * The full one exercises the layout — a long name shrinking, a line wrapping.
   * The sparse one exercises the template, which is a different question and the
   * one leaders get wrong: a child with no grade and no allergy is most of a
   * roster, and until now the editor never showed them.
   */
  const [previewSparse, setPreviewSparse] = useState(false);

  /**
   * Whether this gathering is about to print medical information.
   *
   * Worth saying out loud once, where the decision is being made. Everywhere
   * else in Tally an allergy note is behind a tap by somebody signed in; a
   * sticker is read by whoever is holding the child, which is the point of
   * putting it there and also the whole of the trade. A leader ticking this for
   * a nursery should know they have made that choice, and a leader who did not
   * mean to should be able to see that they did.
   */
  const printsAllergies =
    value?.lines.some((line) => tokensIn(line.text).includes('allergy')) ?? false;

  const patchLine = (index: number, patch: Partial<LabelLine>) => {
    if (!value) return;
    onChange({
      ...value,
      lines: value.lines.map((line, at) => (at === index ? { ...line, ...patch } : line)),
    });
  };

  const removeLine = (index: number) => {
    if (!value) return;
    const lines = value.lines.filter((_line, at) => at !== index);
    // The last line coming off means the gathering prints nothing — which is
    // what `null` means, and what the rules insist on rather than an empty list.
    onChange(lines.length === 0 ? null : { ...value, lines });
  };

  const addLine = () => {
    if (!value || value.lines.length >= MAX_LABEL_LINES) return;
    onChange({ ...value, lines: [...value.lines, blankLine()] });
  };

  /**
   * Swap a line with its neighbour.
   *
   * Two buttons rather than a drag: the order matters most on a phone, where a
   * leader is editing between services, and a drag handle inside a scrolling
   * form is the one gesture guaranteed to fight the scroll.
   */
  const moveLine = (index: number, delta: number) => {
    if (!value) return;
    const to = index + delta;
    if (to < 0 || to >= value.lines.length) return;
    const lines = [...value.lines];
    const moving = lines[index]!;
    lines[index] = lines[to]!;
    lines[to] = moving;
    onChange({ ...value, lines });
  };

  /**
   * A shape setting, or its absence.
   *
   * Absent is a real answer here and not a missing one — it means "whatever the
   * renderer does by default" — so an emptied box stores nothing rather than a
   * zero, and the label goes back to printing what it printed before anybody
   * touched this.
   */
  const patchShape = (patch: Partial<LabelTemplate>) => {
    if (!value) return;
    const next = { ...value, ...patch };
    for (const [key, entry] of Object.entries(patch)) {
      if (entry === undefined) delete next[key as keyof LabelTemplate];
    }
    onChange(next);
  };

  const insertToken = (index: number, token: string) => {
    if (!value) return;
    const line = value.lines[index];
    if (!line) return;
    const spacer = line.text === '' || line.text.endsWith(' ') ? '' : ' ';
    patchLine(index, { text: `${line.text}${spacer}{{${token}}}`.slice(0, MAX_LABEL_LINE_LENGTH) });
  };

  return (
    <div className="flex flex-col gap-3">
      <CheckboxField
        label="Print a label at check-in"
        hint="For a room children are checked out from. Needs a Brother QL plugged into the kiosk."
        checked={value !== null}
        onChange={(changed) =>
          onChange(changed.target.checked ? structuredClone(DEFAULT_LABEL_TEMPLATE) : null)
        }
      />

      {value === null ? null : (
        <div className="flex flex-col gap-4 rounded-xl bg-ink-950/40 p-3 ring-1 ring-ink-800">
          {printsAllergies ? (
            <p className="rounded-lg bg-warn-500/10 p-2 text-xs leading-snug text-warn-400 ring-1 ring-warn-500/25">
              These labels will print each child&rsquo;s allergy note, so a volunteer holding them can
              read it. It is the one medical detail Tally puts on paper — anyone who can see the
              sticker can see it too.
            </p>
          ) : null}

          <div className="@container">
            <div className="grid gap-4 @min-[34rem]:grid-cols-[1fr_auto]">
              <div className="flex min-w-0 flex-col gap-3">
                {value.lines.map((line, index) => {
                  const unknown = unknownTokensIn(line.text);
                  const hasTokens = tokensIn(line.text).length > 0;
                  /*
                   * The caption that would be left standing on its own. Only a
                   * problem while the line is set to print regardless — ticking
                   * the box is exactly the fix, so the warning goes away when it
                   * has been applied rather than nagging about a solved case.
                   */
                  const leftover = line.requiresValue ? '' : leftoverText(line.text);
                  return (
                    <div key={index} className="flex flex-col gap-2 rounded-lg bg-ink-900/60 p-2">
                      <TextField
                        label={`Line ${index + 1}`}
                        value={line.text}
                        maxLength={MAX_LABEL_LINE_LENGTH}
                        placeholder="{{firstName}}"
                        autoComplete="off"
                        /*
                         * The trap this catches: a token comes to nothing for
                         * plenty of children, but the wording typed around it
                         * survives them — `Allergy: {{allergy}}` leaves a bare
                         * "Allergy:" on every sticker in the room. Quoting the
                         * exact string that would print says it better than any
                         * description of the rule, and the preview cannot show
                         * it unless the leader thinks to switch samples.
                         */
                        hint={
                          leftover === ''
                            ? undefined
                            : `A child with none of these still prints “${leftover}”. Tick “${REQUIRES_VALUE_LABEL}” to drop the whole line instead.`
                        }
                        onChange={(changed) => patchLine(index, { text: changed.target.value })}
                        error={
                          unknown.length > 0
                            ? `Tally does not know ${unknown.map((name) => `{{${name}}}`).join(', ')} — it will print as nothing.`
                            : null
                        }
                      />

                      <div className="flex flex-wrap gap-1">
                        {LABEL_TOKENS.map((token) => (
                          <button
                            key={token}
                            type="button"
                            onClick={() => insertToken(index, token)}
                            className="rounded-md bg-ink-800 px-2 py-1 text-xs text-ink-300 hover:bg-ink-700"
                          >
                            {token}
                          </button>
                        ))}
                      </div>
                      {/*
                        * Shown on the line that has tokens in it, where the
                        * problem it solves is about to appear. A leader who has
                        * only ever typed one token per line never needs it, and
                        * never sees it.
                        */}
                      {hasTokens ? (
                        <p className="text-xs leading-snug text-ink-500">
                          Put square brackets round a part that should disappear on its own:{' '}
                          <code className="text-ink-400">{'{{lastName}}[ ({{grade}})]'}</code> prints
                          the brackets only for a child who has a grade.
                        </p>
                      ) : null}

                      <div className="flex flex-wrap items-end gap-2">
                        <SelectField
                          label="Size"
                          value={line.size}
                          className="min-w-28"
                          onChange={(changed) =>
                            patchLine(index, { size: changed.target.value as LabelLine['size'] })
                          }
                        >
                          {LABEL_LINE_SIZES.map((size) => (
                            <option key={size} value={size}>
                              {SIZE_LABELS[size]}
                            </option>
                          ))}
                        </SelectField>
                        <SelectField
                          label="Align"
                          value={line.align}
                          className="min-w-28"
                          onChange={(changed) =>
                            patchLine(index, { align: changed.target.value as LabelLine['align'] })
                          }
                        >
                          {LABEL_LINE_ALIGNS.map((align) => (
                            <option key={align} value={align}>
                              {ALIGN_LABELS[align]}
                            </option>
                          ))}
                        </SelectField>
                        <div className="pb-1">
                          <CheckboxField
                            label="Bold"
                            checked={line.bold}
                            onChange={(changed) => patchLine(index, { bold: changed.target.checked })}
                          />
                        </div>
                        {/*
                          * Offered only where it can do anything. A line of
                          * fixed text has no token to wait on, and a checkbox
                          * that does nothing on half the rows is a checkbox
                          * nobody trusts on the other half.
                          */}
                        {hasTokens ? (
                          <div className="pb-1">
                            <CheckboxField
                              label={REQUIRES_VALUE_LABEL}
                              checked={line.requiresValue}
                              onChange={(changed) =>
                                patchLine(index, { requiresValue: changed.target.checked })
                              }
                            />
                          </div>
                        ) : null}
                        {/*
                          * The order is the label: the name goes at the top and
                          * the time at the bottom, and getting that wrong is the
                          * commonest thing to want to undo after typing four
                          * lines. Disabled at the ends rather than hidden, so
                          * the pair does not jump about as lines move.
                          */}
                        <div className="ml-auto flex items-center gap-1">
                          <button
                            type="button"
                            aria-label={`Move line ${index + 1} up`}
                            disabled={index === 0}
                            onClick={() => moveLine(index, -1)}
                            className={cn(
                              'rounded-md px-2 py-1 text-sm',
                              index === 0 ? 'text-ink-600' : 'text-ink-300 hover:bg-ink-800',
                            )}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            aria-label={`Move line ${index + 1} down`}
                            disabled={index === value.lines.length - 1}
                            onClick={() => moveLine(index, 1)}
                            className={cn(
                              'rounded-md px-2 py-1 text-sm',
                              index === value.lines.length - 1
                                ? 'text-ink-600'
                                : 'text-ink-300 hover:bg-ink-800',
                            )}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            onClick={() => removeLine(index)}
                            className="rounded-md px-2 py-1 text-xs font-semibold text-danger-400 hover:bg-ink-800"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                <div className="flex flex-wrap items-end gap-3">
                  <button
                    type="button"
                    onClick={addLine}
                    disabled={value.lines.length >= MAX_LABEL_LINES}
                    className={cn(
                      'rounded-lg px-3 py-2 text-sm font-semibold',
                      value.lines.length >= MAX_LABEL_LINES
                        ? 'text-ink-600'
                        : 'text-brand-300 hover:bg-ink-800',
                    )}
                  >
                    {value.lines.length >= MAX_LABEL_LINES
                      ? `${MAX_LABEL_LINES} lines is the most a label can hold`
                      : '+ Add a line'}
                  </button>

                  <SelectField
                    label="Copies"
                    value={String(value.copies)}
                    className="min-w-24"
                    onChange={(changed) => onChange({ ...value, copies: Number(changed.target.value) })}
                  >
                    {Array.from({ length: MAX_LABEL_COPIES }, (_unused, index) => index + 1).map(
                      (count) => (
                        <option key={count} value={count}>
                          {count}
                        </option>
                      ),
                    )}
                  </SelectField>
                </div>

                {/*
                  * How the sticker sits on the roll, as opposed to what it says.
                  *
                  * Here rather than on the kiosk because this is where somebody
                  * can see the result: the preview beside it is drawn by the
                  * same code that will print it, and nobody standing at the
                  * printer setup screen is looking at labels. The three that
                  * only continuous tape can honour say so once, at the bottom,
                  * rather than each repeating it.
                  */}
                <fieldset className="flex flex-col gap-3 rounded-lg bg-ink-900/60 p-3">
                  <legend className="px-1 text-xs font-semibold tracking-wide text-ink-400 uppercase">
                    On the roll
                  </legend>

                  <CheckboxField
                    label="Print along the tape"
                    hint="Turns the label a quarter turn, so a long name runs down the roll instead of being shrunk to fit across it."
                    checked={value.rotated === true}
                    onChange={(changed) =>
                      patchShape({ rotated: changed.target.checked ? true : undefined })
                    }
                  />

                  <TextField
                    label="Text size (×)"
                    hint="Scales every line together, so the sizes you chose keep their proportions. Worth turning up when the label has room to spare."
                    type="number"
                    inputMode="decimal"
                    min={MIN_LABEL_FONT_SCALE}
                    max={MAX_LABEL_FONT_SCALE}
                    step={0.1}
                    className="w-36"
                    value={value.fontScale ?? ''}
                    placeholder={String(DEFAULT_LABEL_FONT_SCALE)}
                    onChange={(changed) =>
                      patchShape({ fontScale: numberOrUndefined(changed.target.value) })
                    }
                  />

                  {/*
                    * Above and below the sticker as it comes off the roll, which
                    * is what the preview shows — and stays that end when the
                    * label is turned, because a margin is blank tape and the
                    * roll's width is not this template's to spend.
                    */}
                  <div className="flex flex-wrap items-start gap-3">
                    <TextField
                      label="Space above (mm)"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={MAX_LABEL_MARGIN_MM}
                      step={0.1}
                      className="w-36"
                      value={value.marginTopMm ?? ''}
                      placeholder={String(DEFAULT_LABEL_MARGIN_MM)}
                      onChange={(changed) =>
                        patchShape({ marginTopMm: numberOrUndefined(changed.target.value) })
                      }
                    />
                    <TextField
                      label="Space below (mm)"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={MAX_LABEL_MARGIN_MM}
                      step={0.1}
                      className="w-36"
                      value={value.marginBottomMm ?? ''}
                      placeholder={String(DEFAULT_LABEL_MARGIN_MM)}
                      onChange={(changed) =>
                        patchShape({ marginBottomMm: numberOrUndefined(changed.target.value) })
                      }
                    />
                  </div>
                  <p className="-mt-1 text-xs leading-snug text-ink-500">
                    Blank tape at each end of the sticker — the two ends the cutter makes, whichever
                    way the text runs.
                  </p>

                  <div className="flex flex-wrap items-start gap-3">
                    <CheckboxField
                      label="Same length every time"
                      hint="Otherwise the label is as long as the text needs, so a short name makes a short sticker."
                      checked={value.fixedLengthMm !== undefined}
                      onChange={(changed) =>
                        patchShape({
                          fixedLengthMm: changed.target.checked ? DEFAULT_FIXED_LENGTH_MM : undefined,
                        })
                      }
                    />
                    {value.fixedLengthMm === undefined ? null : (
                      <FixedLengthField
                        value={value.fixedLengthMm}
                        onChange={(next) => patchShape({ fixedLengthMm: next })}
                      />
                    )}
                  </div>

                  {/*
                    * Said when it is being ignored rather than always, because
                    * "the preview is not showing what you just ticked" is the
                    * only moment this matters — and the preview beside it is
                    * about to look exactly as though the tick did nothing.
                    */}
                  {chosen.height !== null && (value.rotated === true || value.fixedLengthMm !== undefined) ? (
                    <p className="text-xs leading-snug text-warn-400">
                      {chosen.name} is die-cut, so the preview ignores these — its size is already
                      decided. A kiosk with a continuous roll loaded will use them.
                    </p>
                  ) : (
                    <p className="text-xs leading-snug text-ink-500">
                      The turn and the fixed length need a continuous roll. A die-cut label is already
                      a fixed size, and a kiosk with one loaded ignores them.
                    </p>
                  )}
                </fieldset>
              </div>

              <div className="flex flex-col gap-2">
                <SelectField
                  label="Preview on"
                  hint="Preview only — the kiosk knows which roll is loaded."
                  value={media}
                  onChange={(changed) => setMedia(changed.target.value)}
                >
                  {PREVIEW_MEDIA.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </SelectField>
                <LabelPreview
                  template={value}
                  values={previewSparse ? SPARSE_SAMPLE_VALUES : SAMPLE_VALUES}
                  box={preview.box}
                  rotated={preview.rotated}
                />
                <CheckboxField
                  label="A child with nothing on file"
                  hint="No grade, no allergy, no surname — the label most children get."
                  checked={previewSparse}
                  onChange={(changed) => setPreviewSparse(changed.target.checked)}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
