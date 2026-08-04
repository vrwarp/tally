/**
 * The kiosk's state machine. Four phases, one overlay pair:
 *
 *   booting → pairing → choosing → ready
 *                          ↑___________|   (event ends, or a staff hold)
 *
 * `ready` renders the search screen; picking a student overlays confirm, and
 * confirming overlays success — which returns to the same query, because a
 * parent with three kids checks them all in off one phone number.
 *
 * Firebase loads *behind* the first paint: everything persisted — the
 * binding, the roster, the phone index — is read synchronously from
 * localStorage at mount, so a warm kiosk is searchable before the SDK has
 * parsed. Only the write needs the network to have caught up.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
// Type-only, so the services chunk stays out of this graph — the value import
// below is dynamic, and that boundary is the whole startup strategy.
import type * as ServicesModule from './services';
import { bindingIsLive, clearBinding, readBinding, writeBinding, type KioskBinding } from './binding';
import type { KioskKey } from './components/Keyboard';
import { type KioskStudent } from './search';
import { KIOSK_KEYS, readJson } from './storage';
import { ConfirmScreen } from './screens/ConfirmScreen';
import { EventChooser } from './screens/EventChooser';
import { PairingScreen } from './screens/PairingScreen';
import { SearchScreen } from './screens/SearchScreen';
import { SuccessScreen } from './screens/SuccessScreen';

export type KioskServices = typeof ServicesModule;
export type { KioskEventEntry } from './services';

type Phase = 'booting' | 'pairing' | 'choosing' | 'ready';

type Overlay =
  | { kind: 'confirm'; student: KioskStudent }
  | { kind: 'success'; student: KioskStudent; alreadyPresent: boolean }
  | null;

const MAX_BUFFER = 24;
const PRESENT_REFRESH_MS = 5 * 60_000;
const QUEUE_REPLAY_MS = 30_000;

/** ~4am local: reclaim memory and pick up deploys, but only while idle. */
function isQuietHour(): boolean {
  const hour = new Date().getHours();
  return hour === 4;
}

export function KioskApp() {
  const [phase, setPhase] = useState<Phase>('booting');
  const [services, setServices] = useState<KioskServices | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [binding, setBinding] = useState<KioskBinding | null>(() => readBinding());
  const [students, setStudents] = useState<KioskStudent[]>(
    () => readJson<{ students: KioskStudent[] }>(KIOSK_KEYS.roster)?.students ?? [],
  );
  const [last4Index, setLast4Index] = useState<Record<string, string[]>>(
    () => readJson<{ last4: Record<string, string[]> }>(KIOSK_KEYS.phoneIndex)?.last4 ?? {},
  );
  const [presentIds, setPresentIds] = useState<ReadonlySet<string>>(new Set());
  const [buffer, setBuffer] = useState('');
  const [overlay, setOverlay] = useState<Overlay>(null);

  const idleRef = useRef(true);
  idleRef.current = buffer === '' && overlay === null;

  /* ---- Boot: load Firebase after first paint, restore the session -------- */

  useEffect(() => {
    let cancelled = false;
    void import('./services').then(async (loaded) => {
      if (cancelled) return;
      setServices(loaded);
      const restored = await loaded.restoredUid();
      if (cancelled) return;
      setUid(restored);
      if (!restored) {
        setPhase('pairing');
        return;
      }
      const stored = readBinding();
      setPhase(stored && bindingIsLive(stored, Date.now()) ? 'ready' : 'choosing');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---- Bound: load the roster, the index, who is already here ------------ */

  const hydrate = useCallback(
    (loaded: KioskServices, bound: KioskBinding) => {
      void loaded.loadRoster(setStudents).then(setStudents);
      void loaded.loadPhoneIndex(setLast4Index).then(setLast4Index);
      void loaded
        .fetchPresentIds(bound.eventId)
        .then(setPresentIds)
        .catch(() => {});
      void loaded.replayQueue().catch(() => {});
    },
    [],
  );

  useEffect(() => {
    if (phase !== 'ready' || !services || !binding) return;
    hydrate(services, binding);

    const present = setInterval(() => {
      void services
        .fetchPresentIds(binding.eventId)
        .then((ids) =>
          setPresentIds((held) => {
            // Never un-green a row this kiosk itself marked: the union keeps
            // an optimistic tick standing until the server copy includes it.
            const merged = new Set(ids);
            for (const id of held) merged.add(id);
            return merged;
          }),
        )
        .catch(() => {});
    }, PRESENT_REFRESH_MS);
    const replay = setInterval(() => void services.replayQueue().catch(() => {}), QUEUE_REPLAY_MS);
    const online = () => void services.replayQueue().catch(() => {});
    window.addEventListener('online', online);

    return () => {
      clearInterval(present);
      clearInterval(replay);
      window.removeEventListener('online', online);
    };
  }, [phase, services, binding, hydrate]);

  /* ---- The clock: binding expiry and the nightly reload ------------------ */

  useEffect(() => {
    const tick = setInterval(() => {
      if (!idleRef.current) return;
      if (binding && !bindingIsLive(binding, Date.now())) {
        clearBinding();
        setBinding(null);
        setBuffer('');
        setOverlay(null);
        setPresentIds(new Set());
        setPhase((current) => (current === 'ready' ? 'choosing' : current));
      }
      // A page that runs for weeks needs a moment to shed what Chromium
      // accumulates; 4am while unbound-or-idle is that moment, and the
      // no-cache kiosk.html makes it double as the update channel.
      if (isQuietHour() && (!binding || !bindingIsLive(binding, Date.now()))) {
        window.location.reload();
      }
    }, 60_000);
    return () => clearInterval(tick);
  }, [binding]);

  /* ---- Input ------------------------------------------------------------- */

  const onKey = useCallback((key: KioskKey) => {
    setBuffer((current) => {
      if (key.kind === 'clear') return '';
      if (key.kind === 'backspace') return current.slice(0, -1);
      const next = current + (current === '' ? key.value.trimStart() : key.value);
      if (next.length > MAX_BUFFER) return current;
      // Four digits answer the phone index completely; a fifth is noise.
      if (/^\d{5,}$/.test(next)) return current;
      return next.replace(/\s{2,}/g, ' ');
    });
  }, []);

  /* ---- Check-in ----------------------------------------------------------- */

  const onConfirm = useCallback(
    (student: KioskStudent) => {
      if (!services || !binding || !uid) return;
      const alreadyPresent = presentIds.has(student.id);
      // Optimistic: the tick paints now; the write follows.
      setOverlay({ kind: 'success', student, alreadyPresent });
      if (alreadyPresent) return;

      setPresentIds((held) => new Set(held).add(student.id));
      void services
        .performCheckIn({ binding, student, uid })
        .then(() => services.forgetStudentDates(student.id))
        .catch((error: { code?: string }) => {
          // Refused outright — frozen student, or a record the kiosk may not
          // touch. Not retryable; the row stays green because they are, in
          // every way that matters at a door, here.
          if (error.code?.includes('permission-denied')) return;
          services.enqueueCheckIn({ binding, student, uid });
        });
    },
    [services, binding, uid, presentIds],
  );

  /* ---- Render ------------------------------------------------------------- */

  if (phase === 'booting') {
    return <div className="flex h-full items-center justify-center text-ink-500">Tally</div>;
  }

  if (phase === 'pairing' && services) {
    return (
      <PairingScreen
        services={services}
        onPaired={(paired) => {
          setUid(paired);
          setPhase('choosing');
        }}
      />
    );
  }

  if (phase === 'choosing' && services) {
    return (
      <EventChooser
        services={services}
        onBound={(bound) => {
          writeBinding(bound);
          setBinding(bound);
          setBuffer('');
          setPresentIds(new Set());
          setPhase('ready');
        }}
      />
    );
  }

  if (phase === 'ready' && binding) {
    if (overlay?.kind === 'success') {
      return (
        <SuccessScreen
          student={overlay.student}
          alreadyPresent={overlay.alreadyPresent}
          onDone={() => setOverlay(null)}
        />
      );
    }
    if (overlay?.kind === 'confirm') {
      return (
        <ConfirmScreen
          student={overlay.student}
          alreadyPresent={presentIds.has(overlay.student.id)}
          onConfirm={() => onConfirm(overlay.student)}
          onBack={() => setOverlay(null)}
        />
      );
    }
    return (
      <SearchScreen
        binding={binding}
        buffer={buffer}
        onKey={onKey}
        students={students}
        last4Index={last4Index}
        presentIds={presentIds}
        onPick={(student) => {
          services?.warmStudentDates(student.id);
          setOverlay({ kind: 'confirm', student });
        }}
        onUnbind={() => {
          clearBinding();
          setBinding(null);
          setBuffer('');
          setOverlay(null);
          setPresentIds(new Set());
          setPhase('choosing');
        }}
      />
    );
  }

  // Waiting on the services chunk for a screen that needs it.
  return <div className="flex h-full items-center justify-center text-ink-500">Loading…</div>;
}
