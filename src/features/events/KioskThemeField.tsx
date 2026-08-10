/**
 * Choosing what a lobby kiosk looks like at this gathering.
 *
 * Inline, like `IconPickerField` and for the same reason: the editor is already
 * a modal, and a second one over it would need its own dismissal story on a
 * phone, where the back gesture closes whichever sheet is on top — a leader
 * trying to shut the colour picker would find they had abandoned the whole form.
 *
 * Four decisions, in the order somebody makes them: the ground, then three hues
 * labelled by the job each does rather than by the token family behind it. A
 * leader knows what "what you touch" means; nobody outside this repository
 * knows what `brand-400` means.
 *
 * The preview is the point of the whole component. The screen being themed is
 * on a shelf in another room, and a row of swatches does not tell anybody what
 * a berry tick on an amber page will actually look like — so this paints one,
 * from the same `kioskPalette()` the kiosk itself is sent, which is what stops
 * the two disagreeing.
 */
import { useId, useMemo, useState } from 'react';
import {
  CONFIRM_HUES,
  DEFAULT_KIOSK_THEME,
  KIOSK_HUES,
  KIOSK_SOURCE_RAMPS,
  kioskPalette,
  type KioskGround,
  type KioskHue,
  type KioskTheme,
} from '@/lib/kioskTheme';
import { cn } from '@/lib/utils';

export interface KioskThemeFieldProps {
  value: KioskTheme | null;
  onChange: (value: KioskTheme | null) => void;
}

type Slot = 'accent' | 'confirm' | 'backdrop';

const SLOTS: readonly { slot: Slot; label: string; hint: string; offered: readonly KioskHue[] }[] =
  [
    {
      slot: 'accent',
      label: 'What you touch',
      hint: 'Keys, the check-in button, the ring around whatever has focus.',
      offered: KIOSK_HUES,
    },
    {
      slot: 'confirm',
      label: 'What just happened',
      hint: 'The tick beside a child who is in, and the screen that says so.',
      // The amber band is missing on purpose — see `CONFIRM_HUES`.
      offered: CONFIRM_HUES,
    },
    {
      slot: 'backdrop',
      label: 'The room',
      hint: 'A wash over the page and the cards. Deliberately faint.',
      offered: KIOSK_HUES,
    },
  ];

/** What the kiosk would actually paint: the stylesheet, with the palette over it. */
function painted(theme: KioskTheme): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [family, ramp] of Object.entries(KIOSK_SOURCE_RAMPS[theme.ground])) {
    for (const [step, hex] of Object.entries(ramp)) base[`--color-${family}-${step}`] = hex;
  }
  return { ...base, ...(kioskPalette(theme) ?? {}) };
}

/**
 * One hue as it would land in a given slot, for the swatch.
 *
 * `brand` and `present` are read at 400 on either ground. `ink` cannot be, and
 * the reason is the ramp rather than a preference: it inverts between the two
 * grounds, so `ink-700` is a mid slate on a dark ground (L .37, C .039) but a
 * near-white on a light one (L .87, C .028) — and a hue turn that close to
 * white is a turn nobody can see, whatever chroma it carries. It made the light
 * room row nine circles of the same pale grey.
 *
 * So the light ground reads `ink-500` instead, which is where that ramp keeps
 * its chroma (C .041 — what the dark row has always shown, so the two rows
 * separate by the same amount). It is a step the light kiosk really paints,
 * secondary text on the cards, so the circle is still the room's own colour and
 * not a swatch-only invention. What the wash itself looks like is the preview's
 * job, and the preview is underneath.
 */
function swatch(theme: KioskTheme, slot: Slot, hue: string): string {
  const family = slot === 'accent' ? 'brand' : slot === 'confirm' ? 'present' : 'ink';
  const step = slot !== 'backdrop' ? '400' : theme.ground === 'light' ? '500' : '700';
  return painted({ ...theme, [slot]: hue })[`--color-${family}-${step}`];
}

export function KioskThemeField({ value, onChange }: KioskThemeFieldProps) {
  const [open, setOpen] = useState(false);
  const labelId = useId();
  const valueId = useId();

  const theme = value ?? DEFAULT_KIOSK_THEME;
  const colours = useMemo(() => painted(theme), [theme]);

  const summary = value
    ? [
        value.ground === 'light' ? 'Light' : 'Dark',
        KIOSK_HUES.find((hue) => hue.name === value.accent)?.label ?? 'Sky',
      ].join(' · ')
    : 'Tally’s own';

  const set = (patch: Partial<KioskTheme>) => onChange({ ...theme, ...patch });

  return (
    <div className="flex min-w-0 flex-col gap-1.5 pointer-fine:gap-1">
      <span id={labelId} className="text-sm font-medium text-ink-300 pointer-fine:text-xs">
        Kiosk colours
      </span>

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-labelledby={`${labelId} ${valueId}`}
        className={cn(
          'flex min-h-14 items-center gap-3 rounded-xl bg-ink-900 px-3 text-left ring-1',
          'pointer-fine:min-h-11 pointer-fine:rounded-lg',
          open ? 'ring-brand-400' : 'ring-ink-700 active:bg-ink-800',
        )}
      >
        <span
          aria-hidden="true"
          className="size-6 shrink-0 rounded-full ring-1 ring-ink-700"
          style={{
            background: `linear-gradient(135deg, ${colours['--color-brand-400']} 50%, ${colours['--color-present-400']} 50%)`,
          }}
        />
        <span id={valueId} className="min-w-0 flex-1 truncate text-sm text-ink-200">
          {summary}
        </span>
        <span aria-hidden="true" className="shrink-0 text-xs font-semibold text-brand-300">
          {open ? 'Done' : 'Change'}
        </span>
      </button>

      {open ? (
        <div className="mt-1 flex flex-col gap-3 rounded-xl bg-ink-950 p-3 ring-1 ring-ink-800">
          <fieldset className="flex min-w-0 flex-col gap-1.5">
            <legend className="mb-1.5 text-xs font-semibold text-ink-400">Ground</legend>
            <div className="flex gap-2">
              {(['dark', 'light'] as KioskGround[]).map((ground) => (
                <button
                  key={ground}
                  type="button"
                  onClick={() => set({ ground })}
                  aria-pressed={theme.ground === ground}
                  className={cn(
                    'min-h-11 flex-1 rounded-lg text-sm font-semibold capitalize ring-1',
                    theme.ground === ground
                      ? 'bg-brand-500/20 text-brand-300 ring-brand-500/40'
                      : 'text-ink-300 ring-ink-700 active:bg-ink-900',
                  )}
                >
                  {ground}
                </button>
              ))}
            </div>
          </fieldset>

          {SLOTS.map(({ slot, label, hint, offered }) => (
            <fieldset key={slot} className="flex min-w-0 flex-col gap-1.5">
              <legend className="text-xs font-semibold text-ink-400">{label}</legend>
              <p className="mb-1 text-xs leading-snug text-ink-500">{hint}</p>
              <div className="flex flex-wrap gap-2">
                {offered.map((hue) => {
                  const active = theme[slot] === hue.name;
                  return (
                    <button
                      key={hue.name}
                      type="button"
                      onClick={() => set({ [slot]: hue.name })}
                      aria-pressed={active}
                      title={hue.label}
                      className={cn(
                        'size-9 rounded-full ring-1 pointer-fine:size-7',
                        active ? 'ring-2 ring-ink-100' : 'ring-ink-700 active:opacity-80',
                      )}
                      style={{ background: swatch(theme, slot, hue.name) }}
                    >
                      <span className="sr-only">{hue.label}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}

          {/*
            Not a mock-up of the lobby screen — a strip of the four surfaces the
            colours actually land on, at the sizes they land at. The kiosk's own
            layout would be a second thing to keep in step for no extra answer.
          */}
          <div
            className="flex flex-col gap-2 rounded-lg p-3"
            style={{ background: colours['--color-ink-950'] }}
          >
            <span className="text-xs font-semibold" style={{ color: colours['--color-ink-100'] }}>
              Sunday Nursery
            </span>
            <div className="flex items-center gap-2">
              <span
                className="rounded-md px-3 py-2 text-xs font-bold"
                style={{ background: colours['--color-brand-600'], color: '#ffffff' }}
              >
                7
              </span>
              <span
                className="rounded-md px-3 py-2 text-xs font-bold"
                style={{ background: colours['--color-present-600'], color: '#ffffff' }}
              >
                Check in
              </span>
              <span
                className="text-xs font-semibold"
                style={{ color: colours['--color-present-400'] }}
              >
                ✓ Checked in
              </span>
            </div>
            {/*
              Fixed, and shown so that is visible here rather than discovered in
              a lobby: `warn` is what an allergy line is painted in, and no
              gathering may recolour it.
            */}
            <span className="text-xs" style={{ color: colours['--color-warn-400'] }}>
              Allergies: peanuts
            </span>
          </div>

          {value ? (
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="min-h-11 rounded-lg text-xs font-semibold text-ink-400 active:bg-ink-900 pointer-fine:min-h-8"
            >
              Use Tally’s own colours
            </button>
          ) : null}
        </div>
      ) : null}

      <p className="text-xs leading-snug text-ink-500">
        Worn by a lobby kiosk while it is bound to this gathering. Nobody’s phone changes.
      </p>
    </div>
  );
}
