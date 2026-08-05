/**
 * "Register on your phone" — the QR, and the way back from it.
 *
 * A parent would rather type on their own phone than on a tablet bolted to a
 * shelf: their keyboard, their autocorrect, and the queue behind them does not
 * have to watch. So this screen offers a code to scan, and stays on screen
 * while they use it.
 *
 * The two things worth knowing are both about what happens *after* they submit.
 *
 * The phone form checks nobody in — it cannot know the family walked into the
 * room — so the children arrive on the roster but not on the register, and the
 * parent taps them through here like anybody else.
 *
 * And this kiosk will not have noticed. It searches a copy of the roster held
 * in local storage and refreshes it on a six-hourly cadence; the server patched
 * the phone index the moment the form was submitted, but nothing has told the
 * shelf to go and look. **I've registered** is that telling. It is a button
 * rather than a poll because polling a lobby screen every few seconds all
 * evening, on the chance that somebody is mid-form, is a great deal of traffic
 * to buy a few seconds nobody is waiting on.
 */
import { useCallback, useEffect, useState } from 'react';
import { haptic } from '@/lib/utils';
import { encode } from 'uqr';

/** How the QR renders: one path over a light square, sized by the viewport. */
function QrCode({ text }: { text: string }) {
  const matrix = encode(text, { ecc: 'M' });
  const size = matrix.size;

  /*
   * One `<path>` of one-unit squares rather than `size²` rects. A version-6
   * code is over a thousand modules, and a thousand DOM nodes on a lobby
   * tablet is a visible pause on a screen that is meant to appear instantly.
   */
  let d = '';
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (matrix.data[y]![x]) d += `M${x} ${y}h1v1h-1z`;
    }
  }

  return (
    <svg
      viewBox={`-2 -2 ${size + 4} ${size + 4}`}
      className="h-full w-full"
      role="img"
      aria-label="Registration QR code"
      shapeRendering="crispEdges"
    >
      {/* The quiet zone is part of the code, not decoration: a scanner needs
          the light border to find the edges. */}
      <rect x={-2} y={-2} width={size + 4} height={size + 4} fill="#ffffff" />
      <path d={d} fill="#000000" />
    </svg>
  );
}

export interface QrScreenProps {
  /** Mints a fresh code; returns the code and how long before it should rotate. */
  mintCode: () => Promise<{ code: string; rotateAfterMs: number }>;
  /** Forces the roster and phone index to be re-read from the server. */
  refresh: () => Promise<void>;
  /** The parent would rather type here after all. */
  onRegisterHere: () => void;
  /** Refreshed and ready: back to search, primed for a phone number. */
  onRefreshed: () => void;
  onClose: () => void;
}

export function QrScreen({
  mintCode,
  refresh,
  onRegisterHere,
  onRefreshed,
  onClose,
}: QrScreenProps) {
  const [code, setCode] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  /*
   * Minted on arrival and re-minted at half its life, so a code scanned just
   * before a rotation still has ten-odd minutes of form-filling left on it. The
   * old one keeps working until it expires — rotation overlaps deliberately,
   * because taking a code away from somebody mid-form is the one failure this
   * screen can cause and cannot explain.
   */
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const mint = () => {
      void mintCode()
        .then((minted) => {
          if (cancelled) return;
          setCode(minted.code);
          setFailed(false);
          timer = setTimeout(mint, minted.rotateAfterMs);
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    };
    mint();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [mintCode]);

  const onRefresh = useCallback(() => {
    haptic();
    setRefreshing(true);
    void refresh()
      .catch(() => {})
      .then(() => onRefreshed());
  }, [refresh, onRefreshed]);

  const url = code ? `${window.location.origin}/welcome?c=${code}` : '';

  return (
    <div className="grid h-full grid-rows-[auto_1fr_auto] gap-2">
      <div className="relative px-6 pt-[max(1rem,var(--spacing-safe-top))] pb-1 text-center">
        <button
          type="button"
          tabIndex={-1}
          onPointerDown={onClose}
          className="absolute top-[max(0.75rem,var(--spacing-safe-top))] left-4 h-12 rounded-lg px-3 text-base text-ink-400 active:bg-ink-800"
        >
          ← Back
        </button>
        <div className="text-lg font-semibold text-ink-200">Register on your phone</div>
        <div className="text-sm text-ink-500">
          Scan this with your camera, and fill the form in on your own screen.
        </div>
      </div>

      <div className="flex min-h-0 flex-col items-center justify-center gap-3 px-6">
        {failed ? (
          <p className="max-w-md text-center text-lg text-ink-400">
            The code could not be fetched. Register right here instead — it takes about a minute.
          </p>
        ) : code === null ? (
          <p className="text-lg text-ink-500">Getting a code…</p>
        ) : (
          <>
            <div className="aspect-square h-full max-h-[46vh] rounded-2xl bg-white p-3">
              <QrCode text={url} />
            </div>
            {/* The address in words, for a camera that will not focus and a
                phone whose scanner has been switched off. */}
            <p className="text-center text-base text-ink-500">
              Or open <span className="text-ink-300">{window.location.host}/welcome</span> and enter
              code <span className="font-semibold tracking-widest text-ink-200">{code}</span>
            </p>
          </>
        )}
      </div>

      <div className="flex flex-col gap-2 p-4 pb-[max(1rem,var(--spacing-safe-bottom))]">
        <button
          type="button"
          tabIndex={-1}
          disabled={refreshing}
          onPointerDown={refreshing ? undefined : onRefresh}
          className="flex h-16 w-full items-center justify-center rounded-xl bg-brand-600 text-xl font-semibold text-white active:bg-brand-500 disabled:bg-ink-800 disabled:text-ink-500"
        >
          {refreshing ? 'Looking…' : "I've registered"}
        </button>
        <button
          type="button"
          tabIndex={-1}
          onPointerDown={() => {
            haptic(8);
            onRegisterHere();
          }}
          className="flex h-14 w-full items-center justify-center rounded-xl bg-ink-800 text-lg text-ink-200 active:bg-ink-600"
        >
          No phone? Register right here
        </button>
      </div>
    </div>
  );
}
