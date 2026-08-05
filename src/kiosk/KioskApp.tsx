/**
 * The kiosk's state machine. Four phases, one overlay pair:
 *
 *   booting → pairing → choosing → ready
 *                          ↑___________|   (event ends, or a staff hold)
 *
 * `ready` renders the search screen; picking a student overlays confirm, and
 * confirming overlays success — which returns to an empty search, because the
 * next person at the kiosk is usually the next family in the queue, and a name
 * left on the glass is both their problem and the previous family's.
 *
 * One confirm can cover several children. The kiosk offers a tapped child's
 * brothers and sisters — see family.ts for what it takes to be that sure — so a
 * parent with three of them walks the flow once rather than three times.
 *
 * Firebase loads *behind* the first paint: everything persisted — the
 * binding, the roster, the phone index — is read synchronously from
 * localStorage at mount, so a warm kiosk is searchable before the SDK has
 * parsed. Only the write needs the network to have caught up.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// Type-only, so the services chunk stays out of this graph — the value import
// below is dynamic, and that boundary is the whole startup strategy.
import type * as ServicesModule from './services';
// The same arrangement for printing, with one extra condition: the value import
// only happens if this device has a printer configured, so a kiosk without one
// never parses the rasteriser, the worker or the WebUSB transport.
import type * as PrintingModule from './printing';
import type { PrinterState } from './printing';
// The same arrangement again for the registration wizard: a screen most
// families never reach must not sit on the path to the one they all use.
import type * as RegistrationModule from './registration';
import { bindingIsLive, clearBinding, readBinding, writeBinding, type KioskBinding } from './binding';
import type { KioskKey } from './components/Keyboard';
import { buildFamilyDigits, familyOf } from './family';
import {
  DEFAULT_PRINTER_LABEL,
  DEFAULT_PRINTER_MODEL,
  hasConfiguredPrinter,
  readPrinterConfig,
  type PrinterConfig,
} from './printing/device';
import { type KioskStudent } from './search';
import { KIOSK_KEYS, readCachedRoster, readJson } from './storage';
import { ConfirmScreen } from './screens/ConfirmScreen';
import { EventChooser } from './screens/EventChooser';
import { PairingScreen } from './screens/PairingScreen';
import { PrinterScreen } from './screens/PrinterScreen';
import { SearchScreen } from './screens/SearchScreen';
import { SuccessScreen } from './screens/SuccessScreen';

export type KioskServices = typeof ServicesModule;
export type KioskPrinting = typeof PrintingModule;
export type KioskRegistration = typeof RegistrationModule;
export type { KioskEventEntry } from './services';

/**
 * `printer` is a staff detour off the chooser rather than a phase of its own —
 * it is reached from there and returns there, and a kiosk mid-setup is not a
 * kiosk in a different state as far as the rest of this is concerned.
 */
type Phase = 'booting' | 'pairing' | 'choosing' | 'printer' | 'ready';

/**
 * What the overlay is asking about.
 *
 * `intent` is what a confirm would do, decided once when the row is tapped so
 * the confirm and the success screen cannot disagree — a register refresh
 * landing mid-tap must not turn "Collect" into "already checked in" under a
 * parent's thumb.
 */
export type KioskIntent = 'check-in' | 'check-out' | 'done';

/**
 * `family` is the same decision made the same way: who else the confirm could
 * cover, settled when the row is tapped. A sibling seen to by another kiosk
 * while this screen was up must not vanish from under the finger already on its
 * way to the button, and nothing is lost by letting the write go: a repeated
 * check-in converges on the document that is already there, and a pickup the
 * register has already recorded is refused by the rules rather than moved.
 */
type ConfirmOverlay = {
  kind: 'confirm';
  student: KioskStudent;
  intent: KioskIntent;
  family: KioskStudent[];
};

/**
 * How the "look again online" offer under an empty result is doing.
 *
 * One search's worth of state, not the device's: it resets whenever the buffer
 * empties, so the next family at the kiosk is offered the same thing this one
 * was rather than inheriting the answer somebody else got.
 */
export type KioskRefresh = 'idle' | 'refreshing' | 'done' | 'failed';

type Overlay =
  | ConfirmOverlay
  | { kind: 'success'; students: KioskStudent[]; intent: KioskIntent }
  | null;

const MAX_BUFFER = 24;
const PRESENT_REFRESH_MS = 5 * 60_000;
const QUEUE_REPLAY_MS = 30_000;
/**
 * How long a forced refresh answers for.
 *
 * Behind that button is a sweep of the whole church at both backends, and the
 * families who cannot find themselves arrive in a clump — the ten minutes after
 * a service starts. Without this, one queue of latecomers is one sweep each. Two
 * minutes is long enough to collapse a clump and short enough that a leader who
 * adds a child *because* the kiosk could not find them is picked up on the
 * family's second try.
 */
const REFRESH_COOLDOWN_MS = 2 * 60_000;

/**
 * The id one run of the registration wizard submits under, for as many attempts
 * as it takes.
 *
 * `randomUUID` needs a secure context, which a real kiosk always has (WebUSB
 * already demands one) — the fallback is for a test renderer and an http LAN
 * address, where uniqueness within one device is all this has to buy.
 */
function newRegistrationId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** ~4am local: reclaim memory and pick up deploys, but only while idle. */
function isQuietHour(): boolean {
  const hour = new Date().getHours();
  return hour === 4;
}

export function KioskApp() {
  const [phase, setPhase] = useState<Phase>('booting');
  const [services, setServices] = useState<KioskServices | null>(null);
  const [printing, setPrinting] = useState<KioskPrinting | null>(null);
  const [printerConfig, setPrinterConfig] = useState<PrinterConfig | null>(() => readPrinterConfig());
  const [printerState, setPrinterState] = useState<PrinterState | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [binding, setBinding] = useState<KioskBinding | null>(() => readBinding());
  const [students, setStudents] = useState<KioskStudent[]>(
    () => readCachedRoster()?.students ?? [],
  );
  const [last4Index, setLast4Index] = useState<Record<string, string[]>>(
    () => readJson<{ last4: Record<string, string[]> }>(KIOSK_KEYS.phoneIndex)?.last4 ?? {},
  );
  const [presentIds, setPresentIds] = useState<ReadonlySet<string>>(new Set());
  const [checkedOutIds, setCheckedOutIds] = useState<ReadonlySet<string>>(new Set());
  const [buffer, setBuffer] = useState('');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [refresh, setRefresh] = useState<KioskRefresh>('idle');
  /**
   * A registration in progress: the QR offer, or the wizard itself with the id
   * it will submit under.
   *
   * The id is minted here rather than inside the wizard so that a re-render of
   * the flow cannot mint a second one: it is what makes a retried call answer
   * instead of creating the family twice.
   */
  const [registering, setRegistering] = useState<
    { screen: 'qr' } | { screen: 'wizard'; registrationId: string } | null
  >(null);
  const [registration, setRegistration] = useState<KioskRegistration | null>(null);
  /**
   * Set by "I've registered": the search screen says so until the parent types.
   * A family who has just filled a form in on their phone needs telling that
   * the digits are the next step, on the screen where they will type them.
   */
  const [justRefreshed, setJustRefreshed] = useState(false);

  const idleRef = useRef(true);
  // A family halfway through the wizard is not an idle kiosk: the binding must
  // not expire under them and the 4am reload must not take the screen away.
  idleRef.current = buffer === '' && overlay === null && registering === null;

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

  /* ---- Printing: only if this device has a printer ----------------------- */

  /*
   * Behind its own dynamic import, and behind a localStorage check before that.
   * The check is the point: most kiosks have no printer, and this graph is the
   * rasteriser plus a WebUSB transport. `getPairedDevices` needs no user gesture,
   * so a printer paired weeks ago is reopened silently here.
   *
   * The setup screen is the other way in, and has to be: a kiosk being given a
   * printer for the first time has nothing in localStorage to gate on, and the
   * module is what knows how to ask the browser for a device.
   */
  const wantsPrinting = phase === 'printer' || hasConfiguredPrinter();

  useEffect(() => {
    if (!wantsPrinting) return;
    let cancelled = false;
    void import('./printing').then((loaded) => {
      if (cancelled) return;
      setPrinting(loaded);
      void loaded.ready();
    });
    return () => {
      cancelled = true;
    };
  }, [wantsPrinting, printerConfig]);

  useEffect(() => printing?.subscribe(setPrinterState), [printing]);

  /*
   * The one thing a label needs that the printing chunk cannot fetch for itself.
   *
   * `services.ts` is the only module under src/kiosk/ allowed to import
   * Firebase, so the printing module is handed the callable rather than reaching
   * for it — see `AllergySource`. Here because this is where both chunks are
   * known to have landed, and cleared on the way out so a module kept alive by a
   * dynamic import cannot go on holding a reference to a torn-down session.
   */
  useEffect(() => {
    if (!printing) return;
    printing.setAllergySource(services ? services.fetchAllergyNote : null);
    return () => printing.setAllergySource(null);
  }, [printing, services]);
  /* ---- Registration: only once somebody asks for it ---------------------- */

  useEffect(() => {
    if (registering === null || registration !== null) return;
    let cancelled = false;
    void import('./registration').then((loaded) => {
      if (!cancelled) setRegistration(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [registering, registration]);

  /* ---- Bound: load the roster, the index, who is already here ------------ */

  const hydrate = useCallback(
    (loaded: KioskServices, bound: KioskBinding) => {
      void loaded.loadRoster(setStudents).then(setStudents);
      void loaded.loadPhoneIndex(setLast4Index).then(setLast4Index);
      void loaded
        .fetchAttendance(bound.eventId)
        .then((register) => {
          setPresentIds(register.present);
          setCheckedOutIds(register.checkedOut);
        })
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
        .fetchAttendance(binding.eventId)
        .then((register) => {
          // Never un-green a row this kiosk itself marked: the union keeps an
          // optimistic tick standing until the server copy includes it. The
          // same argument applies to a pickup — both are one-way here, and a
          // staff undo on the main app is picked up on the next rebind.
          setPresentIds((held) => new Set([...register.present, ...held]));
          setCheckedOutIds((held) => new Set([...register.checkedOut, ...held]));
        })
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
        setCheckedOutIds(new Set());
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

  /* ---- Looking again, for somebody the cached roster does not hold -------- */

  /*
   * A family who cannot find themselves is usually a family somebody added
   * minutes ago — at the welcome desk, or in Tally while they queued — and the
   * kiosk's roster is up to six hours old by design. "Please see a leader" is
   * the right last word, but it should not be the first one when the answer is
   * one read away.
   *
   * Offered rather than automatic: an empty result is the common shape of a
   * half-typed name, and sweeping the church on every keystroke that matches
   * nobody is how a lobby full of parents becomes a rate limit.
   */
  const refreshedAtRef = useRef(0);

  // A cleared buffer is the next person at the kiosk, and they are owed the
  // offer this one got — except while a read is actually in flight, which is
  // the one state that must survive them walking away from it, or a second tap
  // would start a second sweep of the church behind the first.
  useEffect(() => {
    if (buffer === '') setRefresh((current) => (current === 'refreshing' ? current : 'idle'));
  }, [buffer]);

  const onRefresh = useCallback(() => {
    if (!services || refresh === 'refreshing') return;
    // Already answered, for anybody who asks inside the window. The read that
    // matters happened; saying so costs nothing and skips the sweep.
    if (Date.now() - refreshedAtRef.current < REFRESH_COOLDOWN_MS) {
      setRefresh('done');
      return;
    }
    setRefresh('refreshing');
    // Each half lands on its own: a name that has arrived shows up without
    // waiting behind a rebuild of every phone number in the church, and a half
    // that failed leaves what the kiosk already held alone.
    void services
      .refreshDirectory(setStudents, setLast4Index)
      .then(() => {
        refreshedAtRef.current = Date.now();
        setRefresh('done');
      })
      .catch(() => setRefresh('failed'));
  }, [services, refresh]);

  /* ---- Check-in and pickup ------------------------------------------------ */

  /**
   * What tapping this student would do, right now.
   *
   * On a gathering that does not track check-out this is the behaviour the
   * kiosk has always had: check them in, or tell them they already are. Where
   * it does, a present child becomes collectable and a collected one is done.
   */
  /**
   * Whether this gathering produces stickers at all.
   *
   * Asked once, here, so the warm and the print cannot disagree — and so a
   * gathering that prints nothing never reaches the printing module, rather than
   * reaching it and being turned away inside. `printing.warmLabel` and
   * `printLabel` check the template too, which is not redundant: they are also
   * reachable from the printer screen, and a module that trusts its caller about
   * something this cheap to verify is a module that will one day be wrong.
   */
  const prints = printing !== null && !!binding?.labelTemplate;

  const intentFor = useCallback(
    (student: KioskStudent): KioskIntent => {
      if (!presentIds.has(student.id)) return 'check-in';
      if (!binding?.requiresCheckOut) return 'done';
      return checkedOutIds.has(student.id) ? 'done' : 'check-out';
    },
    [presentIds, checkedOutIds, binding],
  );

  /** Inverted once per index rather than once per tap. See family.ts. */
  const familyDigits = useMemo(() => buildFamilyDigits(last4Index), [last4Index]);

  /**
   * The brothers and sisters this tap could cover.
   *
   * Only the ones the confirm would do the *same* thing to. A screen that
   * offered to collect a sibling under a "Check in" button would be two actions
   * wearing one, and the dangerous one is not the one being read.
   *
   * Nothing is offered alongside `done`: that screen has no button to put an
   * offer under, and a parent who re-tapped a child already on the register is
   * not mid-flow — they are checking, and the answer is on the screen already.
   */
  const familyFor = useCallback(
    (student: KioskStudent, intent: KioskIntent): KioskStudent[] => {
      if (intent === 'done') return [];
      return familyOf(student, students, familyDigits).filter(
        (member) => intentFor(member) === intent,
      );
    },
    [students, familyDigits, intentFor],
  );

  const onConfirm = useCallback(
    (confirm: ConfirmOverlay, chosen: KioskStudent[]) => {
      if (!services || !binding || !uid || chosen.length === 0) return;
      const { intent } = confirm;
      // Optimistic: the tick paints now; the writes follow.
      setOverlay({ kind: 'success', students: chosen, intent });

      // A sibling unticked on the way past is a label nobody wants — the warm
      // raster for them was started when this screen opened.
      const taking = new Set(chosen.map((student) => student.id));
      for (const member of confirm.family) {
        if (!taking.has(member.id)) printing?.forgetLabel(member.id);
      }

      if (intent === 'done') return;

      if (intent === 'check-out') {
        setCheckedOutIds((held) => {
          const next = new Set(held);
          for (const student of chosen) next.add(student.id);
          return next;
        });
        for (const student of chosen) {
          void services
            .performCheckOut({ eventId: binding.eventId, studentId: student.id, uid })
            .catch((error: { code?: string }) => {
              // Refused outright — a pickup already stands, and only staff may
              // move one. The row stays collected because it is.
              if (error.code?.includes('permission-denied')) return;
              services.enqueueCheckOut({ binding, student, uid });
            });
        }
        return;
      }

      setPresentIds((held) => {
        const next = new Set(held);
        for (const student of chosen) next.add(student.id);
        return next;
      });
      for (const student of chosen) {
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

        /*
         * The label, and only here.
         *
         * A check-out prints nothing — handing a child back does not produce an
         * artifact, the sticker went on at the door — and neither does `done`,
         * which returned above: a parent re-tapping a child who is already
         * checked in is exactly the runaway reprint loop to avoid. A second copy
         * is a staff action on the printer screen. A family checked in together
         * gets one sticker each, which is the one thing each of them is for.
         *
         * Last, and inside a `try`. `printLabel` is written not to throw, but the
         * ordering and the catch are what make that not matter: the attendance
         * write is already dispatched and the tick is already on screen, so there
         * is nothing left for a printer to spoil. Nothing about a sticker may reach
         * back into a screen that has told a parent their child is checked in — a
         * red line beside a green tick reads as "your check-in failed", and a
         * parent cannot fix a printer anyway. Printer trouble surfaces on the staff
         * surfaces instead. One child's jam must not cost the next child's label
         * either, which is why the `try` is inside the loop.
         */
        if (prints) {
          try {
            printing?.printLabel(student, binding);
          } catch {
            // Deliberately swallowed. See above.
          }
        }
      }
    },
    [services, printing, prints, binding, uid],
  );

  /* ---- Registration ------------------------------------------------------- */

  /*
   * The QR first, and the wizard behind it.
   *
   * A family with a phone in their hand will nearly always rather use it, and
   * the ones without one are one tap from the wizard — which is the right way
   * round, because the wizard is the longer of the two on the harder keyboard.
   */
  const startRegistration = useCallback(() => {
    setBuffer('');
    setJustRefreshed(false);
    setRegistering({ screen: 'qr' });
  }, []);

  const startWizard = useCallback(() => {
    setRegistering({ screen: 'wizard', registrationId: newRegistrationId() });
  }, []);

  /**
   * A family that exists now, and did not a second ago.
   *
   * The server has already written them, checked them in and patched the phone
   * index; what is left is everything this screen holds in memory. The children
   * go into the roster so the next search finds them, their digits into the
   * local index so the *parent* finds them, and their rows go green because
   * they are. Then the stickers, last and inside a `try`, on exactly the terms
   * a tap's label prints on — see `onConfirm`.
   */
  const onRegistered = useCallback(
    (result: { children: readonly KioskStudent[]; last4: string; checkedIn: boolean }) => {
      if (!services || !binding) return;
      const added = services.applyRegistration({
        children: result.children.map((child) => ({
          studentId: child.id,
          firstName: child.firstName,
          lastName: child.lastName,
          grade: child.grade,
          searchName: child.searchName,
        })),
        last4: result.last4,
      });

      setStudents((held) => {
        const byId = new Map(held.map((student) => [student.id, student]));
        for (const student of added) byId.set(student.id, student);
        return [...byId.values()];
      });
      setLast4Index((held) => ({
        ...held,
        [result.last4]: [
          ...new Set([...(held[result.last4] ?? []), ...added.map((student) => student.id)]),
        ].sort(),
      }));
      if (result.checkedIn) {
        setPresentIds((held) => new Set([...held, ...added.map((student) => student.id)]));
      }

      if (prints && result.checkedIn) {
        for (const student of added) {
          try {
            printing?.printLabel(student, binding);
          } catch {
            // Deliberately swallowed, exactly as in `onConfirm`: a printer
            // cannot be allowed to contradict a screen that has told a family
            // they are checked in, and they cannot fix one anyway.
          }
        }
      }
    },
    [services, binding, printing, prints],
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

  if (phase === 'printer' && printing) {
    return (
      <PrinterScreen
        printing={printing}
        // Defaults for a kiosk being set up for the first time — the QL-810W and
        // the 62x29mm name badge, which is what `device.ts` says is likeliest.
        config={printerConfig ?? { model: DEFAULT_PRINTER_MODEL, label: DEFAULT_PRINTER_LABEL }}
        onDone={() => {
          // Re-read rather than trusting the screen: pairing writes the config,
          // and this is what makes the boot effect above pick up a printer that
          // was set up for the first time just now.
          setPrinterConfig(readPrinterConfig());
          setPhase('choosing');
        }}
      />
    );
  }

  if (phase === 'choosing' && services) {
    return (
      <EventChooser
        services={services}
        printerState={printerState}
        onSetUpPrinter={() => setPhase('printer')}
        onBound={(bound) => {
          writeBinding(bound);
          setBinding(bound);
          setBuffer('');
          setPresentIds(new Set());
          setCheckedOutIds(new Set());
          setPhase('ready');
        }}
      />
    );
  }

  if (phase === 'ready' && binding) {
    if (registering && services) {
      // The chunk is a few tens of kilobytes off a warm cache; the word is for
      // the cold first tap of an evening, and it holds the frame's shape.
      if (!registration) {
        return <div className="flex h-full items-center justify-center text-ink-500">Loading…</div>;
      }
      if (registering.screen === 'qr') {
        return (
          <registration.QrScreen
            mintCode={services.mintRegistrationCode}
            // The same forced read the no-match state offers, and for the same
            // reason: this kiosk holds a roster cache that has never heard of
            // the family who just filled a form in on their phone. Each half
            // lands on its own and a half that fails leaves what was already
            // held alone — see `refreshDirectory`.
            refresh={() => services.refreshDirectory(setStudents, setLast4Index)}
            onRefreshed={() => {
              setRegistering(null);
              setBuffer('');
              setJustRefreshed(true);
            }}
            onRegisterHere={startWizard}
            onClose={() => {
              setRegistering(null);
              setBuffer('');
            }}
          />
        );
      }
      return (
        <registration.RegistrationFlow
          binding={binding}
          registrationId={registering.registrationId}
          submit={({ registrationId, children, guardian }) =>
            services.registerFamily({
              registrationId,
              children,
              guardian,
              eventId: binding.eventId,
            })
          }
          onRegistered={(result) =>
            onRegistered({
              children: result.children.map((child) => ({
                id: child.studentId,
                firstName: child.firstName,
                lastName: child.lastName,
                grade: child.grade,
                searchName: child.searchName,
                // Nothing is on file for a child registered a second ago; an
                // allergy note only ever arrives on the phone form, lands
                // upstream, and reaches this screen through a later read.
                hasAllergies: false,
              })),
              last4: result.last4,
              checkedIn: result.checkedIn,
            })
          }
          onClose={() => {
            setRegistering(null);
            setBuffer('');
          }}
        />
      );
    }
    if (overlay?.kind === 'success') {
      return (
        <SuccessScreen
          students={overlay.students}
          intent={overlay.intent}
          onDone={() => {
            // Home, cleared. A parent with three kids retypes their four digits
            // rather than the whole queue behind them reading the last one's
            // name — and a kiosk left alone mid-search shows nothing about
            // whoever walked away from it.
            setOverlay(null);
            setBuffer('');
          }}
        />
      );
    }
    if (overlay?.kind === 'confirm') {
      return (
        <ConfirmScreen
          student={overlay.student}
          intent={overlay.intent}
          family={overlay.family}
          onConfirm={(chosen) => onConfirm(overlay, chosen)}
          onBack={() => {
            // Backed out, so the labels warmed on the way in are not wanted. The
            // cache evicts on its own, but a parent who picks the wrong Noah
            // twice should not push the right one out of it.
            printing?.forgetLabel(overlay.student.id);
            for (const member of overlay.family) printing?.forgetLabel(member.id);
            setOverlay(null);
          }}
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
        checkedOutIds={checkedOutIds}
        tracksCheckOut={binding.requiresCheckOut ?? false}
        // Only "trouble" — a kiosk with no printer is not a kiosk with a broken
        // one, and neither is one whose printer is simply unpaired.
        printerNeedsAttention={printerState?.kind === 'trouble'}
        refresh={refresh}
        onRefresh={onRefresh}
        onRegister={startRegistration}
        justRegisteredRemotely={justRefreshed}
        onPick={(student) => {
          const intent = intentFor(student);
          const family = familyFor(student, intent);
          services?.warmStudentDates(student.id);
          /*
           * Start building the label now, while the confirm screen is on its way
           * up and a thumb is on its way to the button. The same trick
           * `warmStudentDates` plays with the read it needs, and the whole reason
           * a label is moving by the time the tick paints — the rasterising is a
           * few hundred thousand pixels in a worker, and this is the slack.
           *
           * Only for a check-in, because only a check-in prints. On a gathering
           * that tracks check-out, most taps once the room has filled are
           * collections, and rasterising for those is work thrown away.
           *
           * The siblings are warmed too, because they arrive ticked and are
           * about to be printed. An unticked one is forgotten again on the way
           * through the confirm — the same eviction a Back gets.
           */
          for (const member of family) services?.warmStudentDates(member.id);
          if (prints && intent === 'check-in') {
            printing?.warmLabel(student, binding);
            for (const member of family) printing?.warmLabel(member, binding);
          }
          setOverlay({ kind: 'confirm', student, intent, family });
        }}
        onUnbind={() => {
          // A kiosk that has left a gathering has no business still holding
          // notes about the children who were at it.
          printing?.forgetAllergies();
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
