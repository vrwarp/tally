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
  DEFAULT_LABEL_TEMPLATE,
  LABEL_LINE_ALIGNS,
  LABEL_LINE_SIZES,
  LABEL_TOKENS,
  MAX_LABEL_COPIES,
  MAX_LABEL_LINES,
  MAX_LABEL_LINE_LENGTH,
  unknownTokensIn,
  type LabelLine,
  type LabelTemplate,
} from '@/lib/labelTemplate';
import { cn } from '@/lib/utils';
import { LabelPreview } from '@/features/events/LabelPreview';

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
  return { text: '', size: 'md', bold: false, align: 'center' };
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
        hint="For a room children are collected from. Needs a Brother QL plugged into the kiosk."
        checked={value !== null}
        onChange={(changed) =>
          onChange(changed.target.checked ? structuredClone(DEFAULT_LABEL_TEMPLATE) : null)
        }
      />

      {value === null ? null : (
        <div className="flex flex-col gap-4 rounded-xl bg-ink-950/40 p-3 ring-1 ring-ink-800">
          <div className="@container">
            <div className="grid gap-4 @min-[34rem]:grid-cols-[1fr_auto]">
              <div className="flex min-w-0 flex-col gap-3">
                {value.lines.map((line, index) => {
                  const unknown = unknownTokensIn(line.text);
                  return (
                    <div key={index} className="flex flex-col gap-2 rounded-lg bg-ink-900/60 p-2">
                      <TextField
                        label={`Line ${index + 1}`}
                        value={line.text}
                        maxLength={MAX_LABEL_LINE_LENGTH}
                        placeholder="{{firstName}}"
                        autoComplete="off"
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
                        <button
                          type="button"
                          onClick={() => removeLine(index)}
                          className="ml-auto rounded-md px-2 py-1 text-xs font-semibold text-danger-400 hover:bg-ink-800"
                        >
                          Remove
                        </button>
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
                  box={{ width: chosen.width, height: chosen.height }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
