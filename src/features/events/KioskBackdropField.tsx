/**
 * Choosing the photograph a lobby kiosk stands behind — the field beside
 * "Kiosk colours", because the two are one decision about one screen.
 *
 * Shaped by the five-way consultation that shaped the kiosk's own layer
 * (src/kiosk/components/Backdrop.tsx). What the consultation demanded of
 * *this* side:
 *
 * - **The preview is the shipped truth.** Both orientations, always — a
 *   landscape upload approved from a landscape mock becomes a strip of
 *   ceiling on the portrait shelf — under the very `.kiosk-backdrop-veil`
 *   class the kiosk paints, carrying the idle screen's real words, in this
 *   gathering's current colours, repainting live as the theme field beside
 *   it changes. The anchors are scaled through the veil's own custom
 *   properties; the alphas are the stylesheet's. One veil, so the office and
 *   the shelf cannot disagree.
 * - **The guidance is a stance with reasons, at the moment of upload.** The
 *   sentences below name the faces rule and why, not "think about
 *   permission".
 * - **The compressor says what it did** — a leader handing over a 40 MB
 *   panorama sees "1920 px · 240 KB", not silence.
 * - **Removal is one plain button**, mirroring "Use Tally's own colours",
 *   and the open panel carries the upload date so Christmas-in-February has
 *   a conscience to prick. Nothing expires on its own.
 *
 * The pixels themselves are made in `lib/backdropImage.ts` and stored by
 * `services/kioskBackdrops.ts` at save time — this field holds a prepared
 * image in memory until the event is actually saved, so closing the editor
 * abandons the upload with the rest of the form.
 */
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  BackdropImageError,
  describePrepared,
  prepareKioskBackdrop,
  type PreparedKioskBackdrop,
} from '@/lib/backdropImage';
import { DEFAULT_KIOSK_THEME, type KioskTheme } from '@/lib/kioskTheme';
import { fetchKioskBackdrop, type StoredKioskBackdrop } from '@/services/kioskBackdrops';
import { cn } from '@/lib/utils';
import { painted } from './kioskPreview';

/**
 * What the form holds: nothing, the photograph the event already points at,
 * or one chosen just now and not yet uploaded. The editor resolves `new` to
 * an id at save — see EventEditorModal.
 */
export type KioskBackdropChoice =
  | { kind: 'none' }
  | { kind: 'kept'; id: string }
  | { kind: 'new'; prepared: PreparedKioskBackdrop };

export interface KioskBackdropFieldProps {
  value: KioskBackdropChoice;
  /** The theme chosen beside this field, so the preview wears it live. */
  theme: KioskTheme | null;
  onChange: (value: KioskBackdropChoice) => void;
}

/**
 * The two shelves a kiosk actually stands on. One image serves both by
 * cover-cropping, which is exactly why both are always shown: the portrait
 * crop keeps roughly the middle two-fifths of a landscape photograph, and
 * that is a fact to meet on Tuesday rather than at 8:55 on Sunday.
 */
const CROPS = [
  { label: 'On a shelf', width: 1280, height: 800, box: { width: 232, height: 145 } },
  { label: 'Stood on end', width: 800, height: 1280, box: { width: 91, height: 145 } },
] as const;

/**
 * The veil, scaled to a preview box through its own custom properties.
 *
 * Every anchor inline, not only the scaled ones: the stylesheet moves two of
 * them under a viewport media query (a tall *monitor* would restyle a small
 * preview), and the strengths under a `[data-theme]` ancestor the main app
 * also uses for its own theme — inline values are what shield the preview
 * from both, and what let it follow the *gathering's* ground instead.
 */
function veilStyle(scale: number, tall: boolean, ground: 'dark' | 'light'): CSSProperties {
  const rem = (value: number) => `${(value * scale).toFixed(3)}rem`;
  return {
    '--backdrop-head-hold': rem(5.5),
    // The landscape shelf releases its header grade sooner — the same media
    // step the stylesheet applies, cropped here at this box's scale.
    '--backdrop-head-release': rem(tall ? 9 : 7),
    '--backdrop-foot-rise': rem(10),
    '--backdrop-head': ground === 'light' ? '92%' : '85%',
    '--backdrop-wash': ground === 'light' ? '30%' : '18%',
    '--backdrop-foot': ground === 'light' ? '0%' : '14%',
  } as CSSProperties;
}

/** "12 Oct", for the conscience line. */
function uploadedOn(date: Date): string {
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function KioskBackdropField({ value, theme, onChange }: KioskBackdropFieldProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The stored copy behind a `kept` id, fetched once the panel opens. */
  const [stored, setStored] = useState<{ id: string; image: StoredKioskBackdrop | null } | null>(
    null,
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const labelId = useId();
  const valueId = useId();

  const worn = theme ?? DEFAULT_KIOSK_THEME;
  const colours = useMemo(() => painted(worn), [worn]);

  /*
   * The stored image is a third of a megabyte, so it is read only when
   * somebody opens the panel that shows it — never on every editor open.
   */
  const keptId = value.kind === 'kept' ? value.id : null;
  useEffect(() => {
    if (!open || !keptId || stored?.id === keptId) return;
    let cancelled = false;
    void fetchKioskBackdrop(keptId).then((image) => {
      if (!cancelled) setStored({ id: keptId, image });
    });
    return () => {
      cancelled = true;
    };
  }, [open, keptId, stored]);

  const previewBlob =
    value.kind === 'new'
      ? value.prepared.blob
      : value.kind === 'kept' && stored?.id === value.id
        ? (stored.image?.blob ?? null)
        : null;

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!previewBlob) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(previewBlob);
    setPreviewUrl(url);
    return () => {
      setPreviewUrl(null);
      URL.revokeObjectURL(url);
    };
  }, [previewBlob]);

  const summary =
    value.kind === 'none'
      ? 'None'
      : value.kind === 'new'
        ? `New photo · ${describePrepared(value.prepared)}`
        : stored?.id === value.id && stored.image?.updatedAt
          ? `Photo · uploaded ${uploadedOn(stored.image.updatedAt)}`
          : 'Photo';

  const pick = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChange({ kind: 'new', prepared: await prepareKioskBackdrop(file) });
    } catch (thrown) {
      setError(
        thrown instanceof BackdropImageError
          ? thrown.message
          : 'Couldn’t read that photo — try a different one.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-1.5 pointer-fine:gap-1">
      <span id={labelId} className="text-sm font-medium text-ink-300 pointer-fine:text-xs">
        Kiosk photo
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
          className="size-6 shrink-0 overflow-hidden rounded-full bg-ink-800 ring-1 ring-ink-700"
        >
          {previewUrl && <img src={previewUrl} alt="" className="size-full object-cover" />}
        </span>
        <span id={valueId} className="min-w-0 flex-1 truncate text-sm text-ink-200">
          {summary}
        </span>
        <span aria-hidden="true" className="shrink-0 text-xs font-semibold text-brand-300">
          {open ? 'Done' : 'Change'}
        </span>
      </button>

      {open ? (
        <div className="mt-1 flex flex-col gap-3 rounded-xl bg-ink-950 p-3 ring-1 ring-ink-800">
          {value.kind !== 'none' && (
            /*
             * Both crops of the one image, under the kiosk's own veil, over
             * the idle screen's own words, on the gathering's own page —
             * scaled, never mocked up. The container pins the page token so
             * the veil and the ground read this gathering's colours rather
             * than the app's.
             */
            <div className="flex items-end gap-3">
              {CROPS.map((crop) => {
                const scale = crop.box.height / crop.height;
                const tall = crop.height >= 1000;
                return (
                  <div key={crop.label} className="flex min-w-0 flex-col items-center gap-1">
                    <div
                      className="relative overflow-hidden rounded-lg ring-1 ring-ink-700"
                      style={{
                        width: crop.box.width,
                        height: crop.box.height,
                        background: colours['--color-ink-950'],
                        '--color-ink-950': colours['--color-ink-950'],
                      } as CSSProperties}
                    >
                      {previewUrl ? (
                        <img
                          src={previewUrl}
                          alt=""
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                      ) : (
                        <div className="absolute inset-0 animate-pulse bg-ink-900" />
                      )}
                      <div
                        className="kiosk-backdrop-veil absolute inset-0"
                        style={veilStyle(scale, tall, worn.ground)}
                      />
                      {/* The idle screen's words on their plate, at the
                          veil's own scale — the same construction the shelf
                          paints, so the preview cannot oversell the wash. */}
                      <div
                        className="absolute inset-x-0 flex justify-center text-center"
                        style={{ top: `${(8.5 * scale).toFixed(2)}rem` }}
                      >
                        <div className="relative px-2.5 py-1">
                          <div
                            aria-hidden="true"
                            className="absolute"
                            style={{
                              inset: '-90% -45%',
                              background: `radial-gradient(ellipse closest-side, color-mix(in srgb, ${colours['--color-ink-950']} ${worn.ground === 'light' ? '55%' : '45%'}, transparent), transparent)`,
                            }}
                          />
                          <div
                            aria-hidden="true"
                            className="absolute inset-0 rounded"
                            style={{
                              background: `color-mix(in srgb, ${colours['--color-ink-950']} ${worn.ground === 'light' ? '90%' : '78%'}, transparent)`,
                            }}
                          />
                          <div
                            className="relative text-[10px] leading-tight font-semibold"
                            style={{ color: colours['--color-ink-100'] }}
                          >
                            Type a name
                          </div>
                          <div
                            className="relative text-[6px] leading-tight"
                            style={{ color: colours['--color-ink-400'] }}
                          >
                            or the last 4 digits of your phone
                          </div>
                        </div>
                      </div>
                      {/* The keys, as shapes: what says "machine, for
                          touching" — tinted the 80% the real keyboard is. */}
                      <div
                        className="absolute inset-x-1 bottom-1 grid grid-cols-3 gap-0.5"
                        aria-hidden="true"
                      >
                        {[0, 1, 2, 3, 4, 5].map((key) => (
                          <div
                            key={key}
                            className="h-1.5 rounded-[2px]"
                            style={{
                              background: `color-mix(in srgb, ${colours['--color-ink-800']} 80%, transparent)`,
                            }}
                          />
                        ))}
                      </div>
                    </div>
                    <span className="text-[10px] text-ink-500">{crop.label}</span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(event) => {
                void pick(event.target.files?.[0] ?? null);
                // So choosing the same file again still fires a change.
                event.target.value = '';
              }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="min-h-11 rounded-lg bg-ink-900 px-4 text-sm font-semibold text-ink-100 ring-1 ring-ink-700 active:bg-ink-800 disabled:opacity-60 pointer-fine:min-h-9"
            >
              {busy ? 'Reading the photo…' : value.kind === 'none' ? 'Choose a photo' : 'Replace the photo'}
            </button>
            {value.kind === 'new' && (
              <span className="text-xs text-ink-400">Resized to {describePrepared(value.prepared)}</span>
            )}
          </div>

          {error && <p className="text-xs leading-snug text-warn-400">{error}</p>}

          {/*
           * The stance, not a sentiment, where the choice is being made. The
           * longer story — rights, seasonal review — belongs to the docs.
           */}
          <div className="flex flex-col gap-1.5">
            <p className="text-xs leading-snug text-ink-500">
              Photographs, not posters: no words in the image — the kiosk&rsquo;s own
              instructions must stay the loudest thing on the glass.
            </p>
            <p className="text-xs leading-snug text-ink-500">
              A child&rsquo;s face on this screen needs their parent&rsquo;s yes — it stands in a
              public lobby all morning. Rooms, decorations and seasons work better than people.
              Use a photo the church owns or took.
            </p>
          </div>

          {value.kind !== 'none' && (
            <button
              type="button"
              onClick={() => {
                onChange({ kind: 'none' });
                setOpen(false);
              }}
              className="min-h-11 rounded-lg text-xs font-semibold text-ink-400 active:bg-ink-900 pointer-fine:min-h-8"
            >
              No photo — colours only
            </button>
          )}
        </div>
      ) : null}

      <p className="text-xs leading-snug text-ink-500">
        Behind the kiosk&rsquo;s idle screen while it is bound to this gathering, and gone the
        moment a family starts typing. Changes reach a shelf when its kiosk next rebinds.
      </p>
    </div>
  );
}
