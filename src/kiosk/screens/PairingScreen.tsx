/**
 * The kiosk waiting to be claimed.
 *
 * Shows the pairing code as large as the screen allows and polls for the
 * approval a staff member performs from their own signed-in session. The code
 * is public by design; the secret behind it never leaves this device. An
 * expired pairing silently starts a fresh one — the screen is a shelf, and
 * nobody is there to press "retry".
 */
import { useEffect, useRef, useState } from 'react';
import type { KioskServices } from '../KioskApp';
import { InstallPrompt } from '../components/InstallPrompt';

/** Exported so tests can drive the poll loop rather than wait through it. */
export const POLL_MS = 2000;

/**
 * How many consecutive failures before the screen says anything.
 *
 * At a two-second poll this is roughly six seconds of silence — longer than any
 * blip worth mentioning, shorter than a leader's patience after tapping approve.
 */
export const TROUBLE_AFTER_FAILURES = 3;

/**
 * Which of the two waits this is. The distinction is *where* it stalled, which
 * the screen knows for certain, rather than *why*, which it cannot know.
 *
 * The tempting version of this reads the Firebase error code and reports a
 * server fault on `internal`. It does not work: the Functions SDK gives a
 * failed fetch an HTTP status of 0 and maps both 0 and a real 500 to
 * `internal`, so a kiosk with its network unplugged is indistinguishable by
 * code from a deployment that cannot sign tokens. Asserting a cause from that
 * would send a leader to edit IAM over a dropped connection.
 *
 * Having a code is a fact, and a useful one: this device reached Tally, Tally
 * answered, and the handshake began. Only the second half is failing.
 */
type PairingTrouble = 'no-code' | 'stuck';

/**
 * Addressed to the leader standing at the kiosk — no parent sees this screen
 * while it is pairing. The `stuck` line states what is observably true and
 * hands off to the one screen that *can* name a cause, rather than guessing at
 * one here.
 */
const TROUBLE_TEXT: Record<PairingTrouble, string> = {
  'no-code': 'Can’t reach Tally right now. Trying again shortly…',
  stuck:
    'This kiosk has its code, but the pairing isn’t completing. If a leader has already ' +
    'approved it, they should open Tally, tap their name and choose Check-in kiosk, which ' +
    'will say whether anything needs fixing.',
};

export function PairingScreen({
  services,
  onPaired,
}: {
  services: KioskServices;
  onPaired: (uid: string) => void;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [trouble, setTrouble] = useState<PairingTrouble | null>(null);
  const pairedRef = useRef(onPaired);
  pairedRef.current = onPaired;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const run = async () => {
      try {
        setTrouble(null);
        const pairing = await services.beginPairing();
        if (cancelled) return;
        setCode(pairing.code);

        /*
         * Consecutive, not cumulative: one failure in an otherwise healthy
         * hour is the lobby wifi, and a kiosk that has been failing since it
         * was switched on is a fault. Only an unbroken run means anything.
         */
        let failures = 0;

        const poll = async () => {
          if (cancelled) return;
          try {
            const outcome = await services.pollPairing(pairing.code, pairing.secret);
            if (cancelled) return;
            if (typeof outcome === 'object') {
              pairedRef.current(outcome.uid);
              return;
            }
            if (outcome === 'gone') {
              // Expired or swept — start over with a fresh code.
              void run();
              return;
            }
            failures = 0;
            setTrouble(null);
          } catch {
            if (cancelled) return;
            // Still patient with a dropped poll — but no longer silent once
            // the failures stop looking like a blip.
            failures += 1;
            if (failures >= TROUBLE_AFTER_FAILURES) setTrouble('stuck');
          }
          timer = setTimeout(poll, POLL_MS);
        };
        timer = setTimeout(poll, POLL_MS);
      } catch {
        if (cancelled) return;
        // Could not even start a pairing — network down, or the cap reached.
        setCode(null);
        setTrouble('no-code');
        timer = setTimeout(run, 30_000);
      }
    };

    void run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [services]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 p-8 text-center">
      <div className="text-lg font-medium text-ink-400">Pair this kiosk</div>
      {code ? (
        <>
          {/*
            * Sized to the glass, not to a breakpoint.
            *
            * `text-8xl` is right on the 10" tablet the kiosk lives on and far
            * too wide on a phone, where the code ran off both edges and the
            * first and last characters were simply missing — the one thing on
            * the screen that has to be read. Phones reach this screen often
            * enough to matter: it is the URL a leader opens to see what a kiosk
            * is asking for, and the first thing a new device shows before
            * anyone decides what it will be.
            *
            * The width is knowable rather than guessed. The code is always
            * `CODE_LENGTH` (6) characters, monospace, so every glyph advances
            * the same ~0.6em, plus the 0.3em of tracking after each — call it
            * 5.6em for the whole string with a little room for the widest
            * monospace face in the stack. Divide the space actually available
            * (the viewport less this screen's `p-8` on both sides) by that and
            * the code fills the line exactly, then stops growing at the 6rem
            * `text-8xl` was already giving the tablet.
            *
            * The negative inline-end margin takes back the trailing letter-space
            * that tracking adds after the final character, which would otherwise
            * hang off the right and push the code visibly left of centre.
            */}
          <div
            data-testid="kiosk-pairing-code"
            className="-me-[0.3em] font-mono text-[length:min(6rem,calc((100vw_-_4rem)/5.6))] font-bold tracking-[0.3em] text-ink-50"
          >
            {code}
          </div>
          {/*
            * The instruction has to name a screen the reader can actually
            * open. It used to say "Settings → Pair a kiosk", and Settings is
            * core-team only — so on the Friday evenings when the person next to
            * the kiosk is a counselor, which is most of them, this sentence
            * named a door they had no key to. Kiosk is in the account menu for
            * every active member; see `uxr/JOURNEY-kiosk.md`.
            */}
          <div className="max-w-md text-lg leading-relaxed text-ink-300">
            In Tally, tap your name and choose{' '}
            <span className="font-semibold text-ink-100">Kiosk</span>, then enter this code.
          </div>
          {/* The code stays up: it is still the right code, and a leader may be
              mid-approval. This only adds why nothing is happening. */}
          {trouble ? (
            <div className="max-w-md text-base leading-relaxed text-warn-400">
              {TROUBLE_TEXT[trouble]}
            </div>
          ) : null}
        </>
      ) : trouble ? (
        <div className="max-w-md text-lg text-ink-300">{TROUBLE_TEXT[trouble]}</div>
      ) : (
        <div className="text-lg text-ink-400">Getting a code…</div>
      )}

      {/*
        * The best moment to install, and the reason the offer is here rather
        * than only on the chooser: this device is unpaired, so installing now
        * costs nothing, while installing after pairing costs a second code on
        * iOS — where the installed app gets storage of its own and comes up
        * knowing nothing about the pairing done in Safari. Renders nothing when
        * the kiosk is already installed, which is every boot after the first.
        */}
      <InstallPrompt className="max-w-md" />
    </div>
  );
}
