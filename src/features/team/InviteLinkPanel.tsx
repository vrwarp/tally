/**
 * A freshly minted invite link, shown the one time it can be shown.
 *
 * Tally stores a hash of the token and nothing else, so the string in
 * `minted.token` exists in this component and nowhere else in the world. That
 * single fact shapes everything here:
 *
 * - It replaces the form rather than sitting beside it, and it goes away on a
 *   deliberate **Done**. Nothing dismisses it on a timer, and no other control
 *   on the card can navigate over it.
 * - It says out loud that this is the only showing, and where a new one comes
 *   from — **Extend** on the row, which mints a fresh token and retires this
 *   one. A person who has lost a link should not be left wondering whether
 *   they are looking for it in the wrong place.
 * - The URL is a selectable field as well as a Copy button, because a
 *   clipboard that refuses (http origins, some in-app browsers) must not leave
 *   somebody with a token they can see and cannot take.
 *
 * The same panel serves all three ways a token appears — created, extended,
 * turned into a QR — because they are the same object with different lifetimes,
 * and a person who has learned to read one has learned to read all three.
 */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import type { InviteLife } from '@/services/functions';
import { useTimeFormats } from '@/hooks/useTimeFormats';
import { useTranslations } from 'use-intl';

/** How long "Copied" stays up. Long enough to read, short enough not to lie. */
const COPIED_FEEDBACK_MS = 2000;

export interface MintedLink {
  /** The invitation's new id — a re-mint gives the row a new one. */
  id: string;
  token: string;
  /** Epoch millis, from the server. */
  expiresAt: number;
  /** Who the inviter said it was for. */
  label: string;
  /** `qr` is the ten-minute token, minted because both people are in the room. */
  life: InviteLife;
}

/**
 * The QR, drawn from a module grid rather than fetched as an image.
 *
 * Black on white, always, whatever the app's theme is doing around it: a
 * scanner looks for a dark pattern on a light field, and an inverted QR is one
 * a good half of phone cameras will not read at all. The white border is the
 * quiet zone the spec requires — four modules of nothing, without which the
 * pattern has no edge to be found by.
 *
 * One `<path>` rather than a rectangle per module, because a version 10 symbol
 * is 3,481 of them and this draws inside a card that also holds a list.
 */
function QrSquare({ modules, label }: { modules: readonly (readonly boolean[])[]; label: string }) {
  const size = modules.length;
  const quiet = 4;
  const parts: string[] = [];
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (modules[row]![col]) parts.push(`M${col + quiet} ${row + quiet}h1v1h-1z`);
    }
  }
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size + quiet * 2} ${size + quiet * 2}`}
      className="h-56 w-56 rounded-xl bg-white"
      shapeRendering="crispEdges"
    >
      <path d={parts.join('')} fill="#000" />
    </svg>
  );
}

/** What the QR is doing: nothing yet, working, drawn, or beyond this encoder. */
type QrState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; modules: boolean[][] }
  | { status: 'failed' };

export function InviteLinkPanel({
  minted,
  onDismiss,
}: {
  minted: MintedLink;
  onDismiss: () => void;
}) {
  const t = useTranslations('Team');
  const tCommon = useTranslations('Common');
  const time = useTimeFormats();
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [qr, setQr] = useState<QrState>({ status: 'idle' });
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  const url = `${window.location.origin}/join/${minted.token}`;
  const expiresAt = new Date(minted.expiresAt);

  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  /*
   * A QR that was drawn for the previous token must never be left on screen
   * beside a new one: pressing QR on a row re-mints, and the old square would
   * then be a picture of a link that has just stopped working.
   *
   * A ten-minute token draws itself. Somebody who pressed **QR** on a row has
   * already said what they want, and the clock on that token started at the
   * mint rather than at the press — making them ask a second time spends the
   * thing they were given.
   */
  useEffect(() => {
    setCopied('idle');
    if (minted.life !== 'qr') {
      setQr({ status: 'idle' });
      return;
    }
    let live = true;
    setQr({ status: 'loading' });
    void (async () => {
      try {
        const { encodeQr } = await import('@/lib/qr');
        const { modules } = encodeQr(`${window.location.origin}/join/${minted.token}`);
        if (live) setQr({ status: 'ready', modules });
      } catch {
        if (live) setQr({ status: 'failed' });
      }
    })();
    return () => {
      live = false;
    };
  }, [minted.token, minted.life]);

  const flash = (state: 'copied' | 'failed') => {
    setCopied(state);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied('idle'), COPIED_FEEDBACK_MS);
  };

  const copy = async () => {
    if (!navigator.clipboard) {
      // Select it instead, so the next act is a long-press rather than
      // twenty-two characters read off the glass.
      field.current?.select();
      flash('failed');
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      flash('copied');
    } catch {
      field.current?.select();
      flash('failed');
    }
  };

  const share = async () => {
    try {
      await navigator.share({ title: t('shareTitle'), text: t('shareText'), url });
    } catch {
      /* Dismissed the sheet, or the platform refused. Neither is news: the
         link is still on screen with Copy beside it. */
    }
  };

  /*
   * The encoder is ~6KB and most invitations never become a QR — the link goes
   * into a text message and that is the end of it — so it is fetched on the
   * press rather than bundled into the screen. See `src/lib/qr.ts`.
   */
  const showQr = async () => {
    setQr({ status: 'loading' });
    try {
      const { encodeQr } = await import('@/lib/qr');
      setQr({ status: 'ready', modules: encodeQr(url).modules });
    } catch {
      setQr({ status: 'failed' });
    }
  };

  return (
    <div className="flex flex-col gap-3 border-b border-ink-800 px-4 py-3">
      <div>
        <h3 className="text-sm font-semibold text-ink-50">
          {t('linkReadyTitle', { label: minted.label })}
        </h3>
        <p className="mt-0.5 text-xs text-ink-400">
          {minted.life === 'qr'
            ? t('linkLifeQr', { when: time.relative(expiresAt) })
            : t('linkLifeLink', { when: time.weekdayDate(expiresAt) })}
        </p>
      </div>

      {/*
        * Wrapped, not scrolled. A single-line field clipped this mid-token
        * against its own right edge with no ellipsis — on the one screen in the
        * app that says out loud the value can never be shown again. Somebody
        * who does not trust Copy, or whose clipboard refused, reads it off the
        * glass, and half a token is a different link.
        */}
      <textarea
        ref={field}
        readOnly
        rows={2}
        value={url}
        aria-label={t('linkFieldLabel')}
        onFocus={(event) => event.currentTarget.select()}
        className="w-full resize-none break-all rounded-xl bg-ink-950 px-3 py-2.5 font-mono text-xs leading-relaxed text-ink-100 ring-1 ring-ink-700 focus:outline-none focus:ring-2 focus:ring-brand-400"
      />

      {/* Above the controls, not below them. It is the reason the row exists —
          an admin who reads Copy, Show QR and Done first has already decided
          what to press by the time they meet the sentence that says what Done
          costs. */}
      <p className="text-xs leading-snug text-ink-400">{t('linkShownOnce')}</p>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void copy()}>
          {copied === 'copied' ? t('copied') : t('copy')}
        </Button>
        {/* Only where the platform actually has a share sheet. A button that
            opens nothing is worse than one that was never offered. */}
        {typeof navigator.share === 'function' ? (
          <Button variant="secondary" onClick={() => void share()}>
            {t('share')}
          </Button>
        ) : null}
        {qr.status === 'idle' || qr.status === 'failed' ? (
          <Button variant="secondary" onClick={() => void showQr()}>
            {t('showQr')}
          </Button>
        ) : (
          /* The same weight as Show QR. A toggle whose two states wear
             different chrome makes the open state look like the weaker one,
             and the row's rhythm collapses the moment the code appears. */
          <Button variant="secondary" onClick={() => setQr({ status: 'idle' })}>
            {t('hideQr')}
          </Button>
        )}
        <Button variant="ghost" className="ml-auto" onClick={onDismiss}>
          {tCommon('done')}
        </Button>
      </div>

      {copied === 'failed' ? (
        <p role="status" className="text-xs text-warn-400">
          {t('copyByHand')}
        </p>
      ) : null}

      {qr.status === 'loading' ? (
        <p role="status" className="text-xs text-ink-400">
          {t('qrLoading')}
        </p>
      ) : null}
      {qr.status === 'failed' ? (
        <p role="status" className="text-xs text-warn-400">
          {t('qrFailed')}
        </p>
      ) : null}
      {qr.status === 'ready' ? (
        <div className="flex flex-col items-start gap-2">
          {/* The square centres itself; its explanation does not. Every other
              string in this panel is flush left, and a centred paragraph under
              a centred image lands on an edge the card does not use. */}
          <div className="self-center">
            <QrSquare modules={qr.modules} label={t('qrAlt', { label: minted.label })} />
          </div>
          {/* Two lifetimes, two sentences. **Show QR** on a fourteen-day link
              draws that link; saying "ten minutes" under it would be a
              security claim the token does not honour. */}
          <p className="text-xs leading-snug text-ink-400">
            {minted.life === 'qr' ? t('qrExplain') : t('qrExplainLink')}
          </p>
        </div>
      ) : null}

    </div>
  );
}
