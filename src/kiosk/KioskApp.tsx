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
 * binding, the roster, the phone index, who belongs to this gathering — is read
 * synchronously from localStorage at mount, so a warm kiosk is searchable before
 * the SDK has parsed. Only the write needs the network to have caught up.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// Type-only, so the services chunk stays out of this graph — the value import
// below is dynamic, and that boundary is the whole startup strategy.
import type * as ServicesModule from './services';
import type { KioskParticipation } from './services';
// The same arrangement for printing, with one extra condition: the value import
// only happens if this device has a printer configured, so a kiosk without one
// never parses the rasteriser, the worker or the WebUSB transport.
import type * as PrintingModule from './printing';
import type { PrinterState } from './printing';
// The same arrangement again for the registration wizard: a screen most
// families never reach must not sit on the path to the one they all use.
import type * as RegistrationModule from './registration';
import {
  bindingIsLive,
  clearBinding,
  eventWindow,
  opensAtLabel,
  readBinding,
  windowHasOpened,
  writeBinding,
  type KioskBinding,
} from './binding';
import { applyKioskTheme } from './theme';
import type { KioskKey } from './components/Keyboard';
import { sortByName } from '@/lib/utils';
import { buildFamilyDigits, familyOf } from './family';
import {
  DEFAULT_PRINTER_LABEL,
  DEFAULT_PRINTER_MODEL,
  hasConfiguredPrinter,
  readPrinterConfig,
  type PrinterConfig,
} from './printing/device';
import { searchStudents, type KioskStudent } from './search';
import {
  KIOSK_KEYS,
  readCachedParticipation,
  readCachedPulse,
  readCachedRoster,
  readJson,
  type CachedPulse,
} from './storage';
import { keepScreenAwake } from './wakeLock';
import { ConfirmScreen } from './screens/ConfirmScreen';
import { StaffScreen } from './screens/StaffScreen';
import { ReprintScreen, MAX_REPRINT_RESULTS } from './screens/ReprintScreen';
import { ReprintConfirmScreen } from './screens/ReprintConfirmScreen';
import { StaffSession } from './components/StaffSession';
import { reprintOffer, reprintStanding, type ReprintStanding } from './reprintOffer';
import { SiblingScreen } from './screens/SiblingScreen';
import { EventChooser } from './screens/EventChooser';
import { PairingScreen } from './screens/PairingScreen';
import { PrinterScreen } from './screens/PrinterScreen';
import { SearchScreen } from './screens/SearchScreen';
import { ChangeEventScreen } from './screens/ChangeEventScreen';
import { SuccessScreen } from './screens/SuccessScreen';
import { NotOpenScreen } from './screens/NotOpenScreen';

export type KioskServices = typeof ServicesModule;
export type KioskPrinting = typeof PrintingModule;
export type KioskRegistration = typeof RegistrationModule;
export type { KioskEventEntry, KioskParticipation } from './services';

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
  /**
   * Siblings the parent has unticked. Empty means everybody, because a family
   * arrives together.
   *
   * Held here rather than inside the confirm screen so that it survives the
   * detour through "find a brother or sister": that screen unmounts the
   * confirm, and a decision somebody made with their thumb must outlive the
   * screen they made it on.
   */
  skipped: ReadonlySet<string>;
  /**
   * Whether a parent-facing reprint is on the table, decided here for the same
   * reason `intent` and `family` are — see `reprintStanding`. Only whether the
   * *one label* has since been spent is read live.
   */
  standing: ReprintStanding;
};

/**
 * How the "look again online" offer under an empty result is doing.
 *
 * One search's worth of state, not the device's: it resets whenever the buffer
 * empties, so the next family at the kiosk is offered the same thing this one
 * was rather than inheriting the answer somebody else got.
 */
export type KioskRefresh = 'idle' | 'refreshing' | 'done' | 'failed';

/**
 * "Who else is with them" — a sub-screen of the confirm, not a screen of its
 * own.
 *
 * It carries the confirm it came from so that Back is a genuine return rather
 * than a re-entry: a parent who opens it, finds nobody, and goes back is
 * looking at the same ticked family they left.
 */
type SiblingOverlay = { kind: 'sibling'; from: ConfirmOverlay };

/**
 * Where a reprint confirm was opened from, so Back is a return.
 *
 * The two doors onto the same act — find a name, or pick a row out of the
 * evening's log — go through one confirm, and a volunteer who backs out of it
 * belongs on the screen they came from rather than on whichever one the code
 * happens to name first.
 */
type ReprintFrom = 'reprint' | 'printer';

type Overlay =
  | ConfirmOverlay
  | SiblingOverlay
  /**
   * The staff flow: what the two-second hold on Clear opens, and the three
   * screens behind it.
   *
   * All four are overlays rather than phases, which is the whole point of the
   * work — the kiosk stays bound to its gathering while a volunteer prints a
   * name tag, so the door does not shut on the queue standing at it. The old
   * route to a reprint went out through `unbind` and the chooser, and the
   * kiosk was out of service for the whole errand.
   *
   * Being overlays also keeps `idleRef` honest for free: a kiosk with a
   * volunteer on it is not idle, so the binding cannot expire and the nightly
   * reload cannot fire underneath them.
   */
  | { kind: 'staff' }
  | { kind: 'reprint' }
  | { kind: 'reprint-confirm'; student: KioskStudent; from: ReprintFrom }
  | { kind: 'printer' }
  | { kind: 'success'; students: KioskStudent[]; intent: KioskIntent }
  /**
   * The refusal — a check-in offered to a gathering that has not opened yet.
   *
   * Carries the sentence rather than the binding so the screen does no clock
   * work of its own: the moment that matters is the tap, and an overlay that
   * re-derived "is it today" on every render would relabel itself under a
   * parent's eyes at midnight. See NotOpenScreen.
   */
  | { kind: 'not-open'; opensAt: string }
  /**
   * The staff gate's question — see ChangeEventScreen.
   *
   * An overlay like the others, which is what keeps `idleRef` honest: a kiosk
   * with a question on it is not idle, so the binding cannot expire and the
   * nightly reload cannot fire while somebody stands there deciding.
   */
  | { kind: 'unbind' }
  | null;

const MAX_BUFFER = 24;
const PRESENT_REFRESH_MS = 5 * 60_000;
const QUEUE_REPLAY_MS = 30_000;
/**
 * How often the kiosk asks "did anything I cache change?"
 *
 * The QR screen used to argue that polling a lobby screen all evening was a
 * great deal of traffic to buy a few seconds nobody was waiting on — and that
 * was right about polling the *data* and wrong about polling a *signal*. This
 * reads one small document (`kioskIndex/pulse`), ~2,900 reads a day, next to
 * an attendance poll that already re-reads a whole subcollection every five
 * minutes. The expensive refetches happen only when a revision moved, and the
 * two church-wide sweeps a parent used to trigger by button are gone.
 */
export const PULSE_POLL_MS = 30_000;
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
 * How long a name query has to sit still before an empty result is believed.
 *
 * Four digits are complete by construction and skip this; letters are a name
 * somebody may still be typing, and "no match" two characters in is not a
 * finding, it is a keystroke.
 */
const NO_MATCH_SWEEP_DEBOUNCE_MS = 2_000;
/**
 * The shortest a **Search everyone** press is allowed to look like work.
 *
 * Two of the three things behind that button can answer in no time at all: the
 * widening is a re-search of memory, and a sweep inside the two-minute cooldown
 * is answered from the read that already happened. A control that searches an
 * entire church and returns before the finger is off it does not read as fast,
 * it reads as broken, and the parent's next move is to press it again or to
 * stop trusting the answer. Only ever felt when the answer is "nobody" — a
 * press that finds somebody takes the whole panel off the screen.
 */
const MIN_WIDEN_SPINNER_MS = 1_500;
/**
 * How long the glass has to go untouched before the kiosk stops believing
 * there is anybody in front of it.
 *
 * The expiry clock below refuses to unbind a kiosk somebody is using, and the
 * test for "somebody is using it" is what is on screen — a query typed, an
 * overlay open, a wizard part-answered. That is exactly right while a parent is
 * standing there and exactly wrong an hour after they walked off mid-tap: the
 * state they abandoned is indistinguishable from the state they are working in,
 * so a kiosk left on a confirm screen at the end of a nursery Sunday stayed
 * bound to it — and stayed showing one child's name on a lobby shelf — until
 * somebody drove out and reloaded it. This is the backstop under that.
 *
 * Two minutes, so the flows that clean up after themselves get there first and
 * this is never the thing a person meets: the wizard puts a half-typed
 * registration away after ninety seconds (`INACTIVITY_MS`), the staff gate
 * hands the kiosk back after forty-five (`STAFF_RETURN_MS`), and a success
 * screen returns in four. What is left is the search buffer and the confirm
 * screens, which have no clock of their own because a parent reading a list of
 * their own children should not be raced by one.
 */
const ABANDONED_MS = 2 * 60_000;

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

/**
 * The id every child put on the register by one press of the confirm button
 * shares, so the pickup screen can ask who came in together.
 *
 * Minted per confirm rather than per child, and unique even for a child who
 * arrived alone: "came alone" is a real answer, and it is what stops a sibling
 * dropped off half an hour later from arriving pre-ticked for collection.
 */
function newArrivalId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
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
  /**
   * Who belongs to *this* gathering, and who comes to it regularly.
   *
   * Seeded off the disk at mount like the roster and the phone index, so a warm
   * kiosk is scoped from the first paint rather than for a moment after it. The
   * gap would be safe — every reader treats empty as "no scope" and falls back
   * to what the kiosk did before, see `searchable` and `skippedFor` — but a
   * search that quietly widens for the first second of every boot is not
   * something to leave to timing.
   *
   * Empty, and staying empty, on a kiosk bound before this existed or to a
   * chain nothing has been run for.
   */
  const [scope, setScope] = useState<KioskParticipation>(() =>
    readCachedParticipation(readBinding()?.predictsFrom),
  );
  const [presentIds, setPresentIds] = useState<ReadonlySet<string>>(new Set());
  const [checkedOutIds, setCheckedOutIds] = useState<ReadonlySet<string>>(new Set());
  /**
   * Student id -> the arrival that put them here, for the ones that carry one.
   *
   * The register's answer to "who came in together", which is the question a
   * pickup is really asking. Only records this kiosk's own confirm button
   * wrote carry it — see `attendancePayload` — so a missing entry is "nobody
   * stated it", not "came alone".
   */
  const [arrivals, setArrivals] = useState<ReadonlyMap<string, string>>(new Map());
  const [buffer, setBuffer] = useState('');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [refresh, setRefresh] = useState<KioskRefresh>('idle');

  /*
   * When this kiosk checked each child in tonight, and who has had a second
   * name tag since.
   *
   * Both exist for one question — may the parent standing here print a name tag
   * again — and `reprintOffer.ts` is where that question is answered. Its first
   * condition is *this kiosk checked them in*, not *they are on the register*,
   * which is why this is a timestamp written beside the tick rather than
   * anything read back from Firestore: a child checked in at the other kiosk, or
   * by a leader in the app, is not this screen's business.
   *
   * `reprintedIds` is the shared counter. A staff reprint spends it exactly as a
   * parent's own hold does, because the cap is one label per child and not one
   * per surface.
   */
  const [checkedInAtMs, setCheckedInAtMs] = useState<ReadonlyMap<string, number>>(new Map());
  const [reprintedIds, setReprintedIds] = useState<ReadonlySet<string>>(new Set());
  /*
   * The child whose name tag just went to the printer, for the line on their
   * row. By id, never by rendered name: this list exists because a church has
   * two Alvarezes in it.
   */
  const [sentId, setSentId] = useState<string | null>(null);
  /*
   * Bumped whenever a label is queued, so the printer screen's list re-reads.
   * The log lives in the printing module's queue — it is the same list the
   * evening's check-ins wrote — and nothing about it is React state.
   */
  const [printTick, setPrintTick] = useState(0);
  /**
   * A registration in progress: the wizard, with the id it will submit under.
   *
   * The id is minted here rather than inside the wizard so that a re-render of
   * the flow cannot mint a second one: it is what makes a retried call answer
   * instead of creating the family twice.
   */
  const [registering, setRegistering] = useState<{
    registrationId: string;
    /**
     * The family a sibling is being added to, when the wizard was opened
     * from a confirm screen rather than from the front door. Empty means
     * the six-question form for a family nobody has met.
     */
    anchors: KioskStudent[];
  } | null>(null);
  const [registration, setRegistration] = useState<KioskRegistration | null>(null);

  const idleRef = useRef(true);
  // A family halfway through the wizard is not an idle kiosk: the binding must
  // not expire under them and the 4am reload must not take the screen away.
  idleRef.current = buffer === '' && overlay === null && registering === null;

  /**
   * When the glass was last touched — the other half of that question.
   *
   * What is on screen says whether somebody *was* here; only a touch says
   * whether they still are. Recorded on the window in the capture phase so it
   * counts every press, including the ones a control swallows, and cheap enough
   * to run on a Pi: one ref write, no render. `keydown` is here for the
   * walkthrough runner and a bench with a real keyboard on it, not for the
   * lobby.
   */
  const touchedAtRef = useRef(Date.now());
  useEffect(() => {
    const touched = () => {
      touchedAtRef.current = Date.now();
    };
    window.addEventListener('pointerdown', touched, { capture: true });
    window.addEventListener('keydown', touched, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', touched, { capture: true });
      window.removeEventListener('keydown', touched, { capture: true });
    };
  }, []);

  /**
   * The pulse revisions this kiosk last acted on — seeded from disk, so the
   * first poll after a reboot compares against what it last *saw* and catches
   * anything that changed while it was powered off. Null only on a
   * storage-cold boot, where the first sighting seeds without refetching
   * (hydrate has just loaded everything anyway).
   */
  const pulseRef = useRef<CachedPulse | null>(readCachedPulse());

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
  /*
   * The overlay counts as well as the phase, and leaving it out was a trap.
   *
   * The reasoning above is why `phase === 'printer'` is here at all: a kiosk
   * being given a printer for the first time has nothing in localStorage to gate
   * on. The staff screen opens the same screen as an overlay — the kiosk stays
   * bound — which bypassed that clause, so on a kiosk that has never had a
   * printer the module was never fetched and the screen sat on `Loading…` with
   * nothing on it to press. The gate's own clock is no way out either: it
   * re-arms on every pointer event, so tapping a dead-looking tablet is what
   * holds it there.
   */
  const wantsPrinting = phase === 'printer' || overlay?.kind === 'printer' || hasConfiguredPrinter();

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
      // Per binding rather than per boot: a kiosk moved from Friday to Sunday
      // is a kiosk asking about a different set of children.
      void loaded.loadParticipation(bound.predictsFrom, setScope).then(setScope).catch(() => {});
      void loaded
        .fetchAttendance(bound.eventId)
        .then((register) => {
          setPresentIds(register.present);
          setCheckedOutIds(register.checkedOut);
          setArrivals(register.arrivals);
        })
        .catch(() => {});
      void loaded.replayQueue().catch(() => {});
    },
    [],
  );

  /**
   * One poll of the pulse, and the refetches it routes to.
   *
   * Revisions are opaque change markers, compared with `!==` and never
   * ordered. Everything in here is void-and-swallow: a pulse failure must
   * never surface on the glass, and the next tick tries again.
   */
  const onPulse = useCallback(async () => {
    if (!services || !binding) return;
    const seen = pulseRef.current;
    const fresh = await services.fetchPulse();
    if (!fresh) return; // No signal — the TTLs the loaders run under govern.

    const next = {
      roster: fresh.roster,
      phones: fresh.phones,
      participation: fresh.participation,
    };
    pulseRef.current = next;
    services.rememberPulse(next);
    // First sighting ever (storage-cold boot): hydrate has just loaded
    // everything this could refetch, so seeing the revs is enough.
    if (!seen) return;

    if (fresh.roster !== seen.roster) void services.refetchRoster(setStudents);
    if (fresh.phones !== seen.phones) void services.refetchPhoneIndex(setLast4Index);
    if (fresh.participation !== seen.participation) {
      void services.refetchParticipation(binding.predictsFrom, setScope);
    }
  }, [services, binding]);

  useEffect(() => {
    if (phase !== 'ready' || !services || !binding) return;
    hydrate(services, binding);
    // Seed (or catch up) within a tick of binding rather than a poll later.
    void onPulse();

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
          // Same union, same reason: an arrival this kiosk recorded a second
          // ago must not vanish because the server copy has not caught up.
          setArrivals((held) => new Map([...register.arrivals, ...held]));
        })
        .catch(() => {});
    }, PRESENT_REFRESH_MS);
    const replay = setInterval(() => void services.replayQueue().catch(() => {}), QUEUE_REPLAY_MS);
    const pulse = setInterval(() => void onPulse(), PULSE_POLL_MS);
    const online = () => void services.replayQueue().catch(() => {});
    window.addEventListener('online', online);

    return () => {
      clearInterval(present);
      clearInterval(replay);
      clearInterval(pulse);
      window.removeEventListener('online', online);
    };
  }, [phase, services, binding, hydrate, onPulse]);

  /* ---- The screen: awake for as long as this page is on it ---------------- */

  /*
   * Every phase, not just `ready`. A kiosk showing its pairing code is a kiosk
   * somebody is walking back and forth to a laptop to approve, and a screen that
   * sleeps between the two trips is the one that loses the code. Unconditional
   * for the same reason it is unconditional in wakeLock.ts: there is no state
   * this app can be in where a lobby screen going dark is what anybody wanted.
   */
  useEffect(() => keepScreenAwake(), []);

  /* ---- The gathering's colours ------------------------------------------ */

  /*
   * Worn while bound, and taken off the moment the binding goes.
   *
   * Keyed on the binding rather than on `phase` on purpose. src/kiosk/main.tsx
   * has already put a live binding's colours on the document before this
   * component first rendered — that is what stops a themed kiosk booting navy —
   * and `phase` spends the first few hundred milliseconds on `booting` while
   * the Firebase chunk loads. Reacting to the phase would strip the theme for
   * exactly that window and paint it back, which is the flash the pre-paint
   * apply exists to avoid.
   *
   * The liveness test is the same one main.tsx makes: an expired binding is
   * still in state until the clock below clears it, and a kiosk on its way to
   * the chooser is not at any gathering.
   */
  useEffect(() => {
    const wearing = binding && bindingIsLive(binding, Date.now()) ? binding : null;
    applyKioskTheme(wearing?.kioskGround, wearing?.kioskPalette);
  }, [binding]);

  /* ---- Leaving a gathering ----------------------------------------------- */

  /**
   * Everything the kiosk holds about the gathering it was on, put down at once.
   *
   * One function because there are two doors out — a volunteer choosing
   * **Leave** on the staff gate, and the clock below reaching the end of the
   * evening — and they were clearing different halves of the same state. The
   * clock's half was the dangerous one to get wrong: it dropped the register
   * and kept `forgetGathering`'s side of it, so a kiosk that unbound itself at
   * the end of a nursery Sunday sat in the lobby all week still holding that
   * morning's allergy notes and the list of which children had a name tag
   * printed. Which door was used is not a fact about how much a lobby tablet
   * should remember.
   *
   * `phase` moves only off `ready`: the expiry clock runs in every phase, and a
   * kiosk on its pairing screen or halfway through printer setup must not be
   * pushed to the chooser by a binding it is not looking at.
   */
  const leaveGathering = useCallback(() => {
    printing?.forgetGathering();
    clearBinding();
    setBinding(null);
    setBuffer('');
    setOverlay(null);
    setRegistering(null);
    setPresentIds(new Set());
    setCheckedOutIds(new Set());
    setArrivals(new Map());
    setCheckedInAtMs(new Map());
    setReprintedIds(new Set());
    setSentId(null);
    setPhase((current) => (current === 'ready' ? 'choosing' : current));
  }, [printing]);

  /* ---- The clock: binding expiry and the nightly reload ------------------ */

  useEffect(() => {
    const tick = setInterval(() => {
      /*
       * Nobody on it, or nobody on it for long enough.
       *
       * The first test is what is on screen and the second is when the glass
       * was last touched, and the binding needs only one of them. On its own
       * the first is a guard that a parent can leave latched: a query typed at
       * ten past eight and walked away from is "in use" for as long as the
       * page lives, which is weeks — so the evening ended, the gathering was
       * over, and the kiosk stayed on it. See ABANDONED_MS.
       */
      const free = idleRef.current || Date.now() - touchedAtRef.current >= ABANDONED_MS;
      if (!free) return;
      if (binding && !bindingIsLive(binding, Date.now())) leaveGathering();
      // A page that runs for weeks needs a moment to shed what Chromium
      // accumulates; 4am while unbound-or-idle is that moment, and the
      // no-cache kiosk.html makes it double as the update channel.
      if (isQuietHour() && (!binding || !bindingIsLive(binding, Date.now()))) {
        window.location.reload();
      }
    }, 60_000);
    return () => clearInterval(tick);
  }, [binding, leaveGathering]);

  /* ---- Input ------------------------------------------------------------- */

  const onKey = useCallback((key: KioskKey) => {
    setBuffer((current) => {
      if (key.kind === 'clear') return '';
      if (key.kind === 'backspace') return current.slice(0, -1);
      // Unreachable: search renders the keyboard without a shift key, because
      // it folds case anyway. Handled rather than cast, so the day somebody
      // gives search a shift key this is a decision and not a crash.
      if (key.kind === 'shift') return current;
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
    if (buffer === '') {
      setRefresh((current) => (current === 'refreshing' ? current : 'idle'));
    }
  }, [buffer]);

  /**
   * The sweep in flight, if there is one.
   *
   * A ref rather than the `refresh` state it used to be guarded by, for two
   * reasons. It is synchronous, so two calls in the same tick cannot both find
   * "not refreshing" and start two sweeps of the church. And it is a promise,
   * so a second asker can *wait on the first one's read* rather than being
   * told there is nothing to wait for — which is what the button now needs:
   * pressing it while the silent sweep is already running has to keep the
   * spinner up until that read lands, not for a token second and a half.
   */
  const sweepRef = useRef<Promise<void> | null>(null);

  const runSweep = useCallback((): Promise<void> => {
    if (!services) return Promise.resolve();
    if (sweepRef.current) return sweepRef.current;
    // Already answered, for anybody who asks inside the window. The read that
    // matters happened; saying so costs nothing and skips the sweep.
    if (Date.now() - refreshedAtRef.current < REFRESH_COOLDOWN_MS) {
      setRefresh('done');
      return Promise.resolve();
    }
    setRefresh('refreshing');
    // Each half lands on its own: a name that has arrived shows up without
    // waiting behind a rebuild of every phone number in the church, and a half
    // that failed leaves what the kiosk already held alone.
    const sweep = services
      .refreshDirectory(setStudents, setLast4Index)
      .then(() => {
        refreshedAtRef.current = Date.now();
        setRefresh('done');
      })
      .catch(() => setRefresh('failed'))
      .finally(() => {
        sweepRef.current = null;
      });
    sweepRef.current = sweep;
    return sweep;
  }, [services]);

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
   * The roster the front door searches: the children who belong to *this*
   * gathering.
   *
   * The kiosk used to search every active student in Tally, which is not the
   * population standing in front of it. A parent at Friday Fellowship typing
   * four digits could be shown a family who has only ever come to Sunday
   * nursery, and — because four digits are four digits — a newcomer could be
   * shown somebody else's children, sorted, spelled correctly, and looking
   * exactly like the answer.
   *
   * The rule is the year look-back the check-in screen already uses to decide
   * who has been to a gathering (`lib/participation.ts`), not the narrower
   * "Recent" prediction: a child who came twice last autumn belongs here, and
   * being asked to register again would be wrong.
   *
   * Three ways out, and all of them widen rather than narrow:
   *
   * - a chain with no history at all scopes to nothing, so the whole roster is
   *   searched. That covers a gathering meeting for the first time, a one-off,
   *   a binding written before this existed, and every kind of failure to read
   *   the aggregate. Scoping switches itself on once a gathering has been run;
   *   there is nothing to configure and nothing to turn off.
   * - anyone on tonight's register is always findable, whatever the aggregate
   *   said at 03:20. They are in the building — a parent must be able to
   *   collect them — and it covers the family who registered at this kiosk
   *   twenty minutes ago.
   * - `widened`, the "Search everyone" row on the no-match panel.
   *
   * Only the front door is scoped. `familyOf` keeps the whole roster, because
   * the point of the confirm screen's list is to *offer* the siblings the
   * prediction does not expect; so does `SiblingScreen`, whose whole population
   * is the children this scope would wrongly exclude.
   */
  /**
   * Whether this search has been widened past the gathering to all of Tally.
   *
   * Real state, set by exactly one thing: the **Search everyone** row on the
   * no-match panel — a control that says what it does, where "I already
   * registered" used to widen as a side effect of a network read nobody could
   * see. One family's worth of lifetime: the buffer-empty effect stands it
   * back down, so the next family at the kiosk starts scoped again.
   *
   * The widening itself is free and instant — the wider roster is already in
   * memory — but the tap that asks for it is not only a widening any more; see
   * `widening` below.
   */
  const [widened, setWidened] = useState(false);
  useEffect(() => {
    if (buffer === '') setWidened(false);
  }, [buffer]);

  /**
   * Whether **Search everyone** is working, which is the whole of its feedback.
   *
   * The button used to widen the pool and then vanish, on the reasoning that a
   * control which has done its job is clutter. What a parent saw was a button
   * disappearing under their finger and a list that still said nothing, with
   * the only evidence of the press being one word changing in the line above —
   * a change nobody watching their own finger is looking at. A press that
   * produces no visible work reads as a press that did not register, and the
   * next thing a parent does about that is find a leader.
   *
   * So it stays on screen and reports instead: its label becomes a spinner
   * while the work runs and comes back when it is done. Staying is not only
   * for the feedback, either — four digits are a small keyspace and names
   * collide, so a family who widened and still sees nobody theirs has a second
   * reason to press it, and a control that removed itself after one use had
   * nothing to offer them.
   *
   * The work behind it is the church-wide re-read: widening only re-searches
   * what this device already holds, and a family added at the welcome desk two
   * minutes ago is not in it. The read is shared with the silent sweep through
   * `sweepRef`, so pressing during one waits on that one rather than starting
   * a second.
   */
  const [widening, setWidening] = useState(false);
  const wideningRef = useRef(false);

  // A spinner belonging to the family who walked away. The read it was waiting
  // on carries on and still lands — `runSweep` owns that, and the next family
  // gets the benefit of it — but the next person's screen must not open on
  // somebody else's busy button.
  useEffect(() => {
    if (buffer !== '') return;
    wideningRef.current = false;
    setWidening(false);
  }, [buffer]);

  const onWiden = useCallback(async () => {
    // A second press while the spinner is up is the same request, not a new
    // one. The button is allowed to be pressed again — it is still there, and
    // a spinner is not a disabled state — it just has nothing new to do.
    if (wideningRef.current) return;
    const alreadyWidened = widened;
    setWidened(true);
    /*
     * When the *widening* answers, that is the whole of the press.
     *
     * The child who belongs to Sunday mornings is on this device already, so a
     * church-wide read here would be spent on a question the free half just
     * answered. Computed from the full roster rather than from `outcome`,
     * which is a memo this render has not recomputed yet.
     *
     * Only the press that turns widening *on* gets that exemption, and the
     * `alreadyWidened` check is what makes the button honest now that it also
     * stands beside a list of results. Pressing it a second time cannot widen
     * anything — the pool is already everybody — so if the exemption applied
     * there too, the press would do nothing at all and say nothing about it.
     * That is the state a parent holding a common name is in: rows on screen,
     * none of them theirs, and the only thing left worth doing is asking the
     * church whether their child was added since this device last looked.
     */
    if (!alreadyWidened && searchStudents(buffer, students, last4Index).results.length > 0) {
      return;
    }

    wideningRef.current = true;
    setWidening(true);

    const started = Date.now();
    try {
      await runSweep();
    } finally {
      /*
       * Held to a floor, deliberately, and only ever felt when the answer is
       * "nobody". An instant return from a search of an entire church is not
       * read as fast, it is read as broken — the same reflex that makes a
       * card reader that beeps immediately feel like it did not read the
       * card. A second and a half is long enough to look like a search and
       * short enough not to be a wait.
       *
       * When the read *does* turn somebody up, nobody sees the end of this:
       * the no-match panel only exists while there are no results, so the
       * button and its spinner leave the screen with it.
       */
      const held = MIN_WIDEN_SPINNER_MS - (Date.now() - started);
      if (held > 0) await new Promise((resolve) => setTimeout(resolve, held));
      wideningRef.current = false;
      setWidening(false);
    }
  }, [runSweep, buffer, students, last4Index, widened]);

  const searchable = useMemo(() => {
    if (widened || scope.participated.size === 0) return students;
    return students.filter(
      (student) => scope.participated.has(student.id) || presentIds.has(student.id),
    );
  }, [students, scope, presentIds, widened]);

  /**
   * The search itself, lifted out of SearchScreen so this file owns the one
   * signal the silent sweep needs: "a completed search found nobody".
   */
  const outcome = useMemo(
    () => searchStudents(buffer, searchable as KioskStudent[], last4Index),
    [buffer, searchable, last4Index],
  );

  /*
   * The sweep, silent now.
   *
   * This is the church-wide forced re-read that used to hide behind
   * "I already registered" — the answer for the family somebody added straight
   * into the backend minutes ago, whom no pulse ever fires for. It runs by
   * itself when a *completed* search finds nobody: a 4-digit phone query is
   * complete by construction and sweeps at once; a name is complete when the
   * typing stops for a couple of seconds, because an empty result is the
   * common shape of a half-typed name and sweeping the church per keystroke is
   * how a lobby of parents becomes a rate limit. The 2-minute cooldown in
   * `runSweep` still collapses a queue of latecomers into one read.
   *
   * Checked against the FULL roster, not the scoped pool: a child who merely
   * needs "Search everyone" is already on this kiosk, and finding them must
   * never cost a backend sweep.
   */
  useEffect(() => {
    if (outcome.mode !== 'phone' && outcome.mode !== 'name') return;
    if (outcome.results.length > 0) return;
    if (searchStudents(buffer, students, last4Index).results.length > 0) return;
    if (refresh !== 'idle') return;
    if (outcome.mode === 'phone') {
      runSweep();
      return;
    }
    const timer = setTimeout(runSweep, NO_MATCH_SWEEP_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [outcome, buffer, students, last4Index, refresh, runSweep]);

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
      const guess = familyOf(student, students, familyDigits);
      if (intent !== 'check-out') return guess.filter((member) => intentFor(member) === intent);

      /*
       * A pickup asks the same question the check-in asked, and has a better
       * answer available: not the kiosk's guess at a family from four phone
       * digits, but the set that actually walked in together — stated by
       * somebody's thumb an hour ago and written on the register.
       *
       * Both, though, and that is the point of the union. The arrival is
       * frequently *wider* than the guess (a child found through "find a
       * brother or sister", a cousin, a neighbour's boy who came in the same
       * car — none of whom share a number with anybody) and sometimes
       * narrower, when a family arrived in two waves. Offering only one of them
       * would drop real children off a screen a parent is using to take their
       * family home. Which of the two are *ticked* is the part that differs;
       * see `skippedFor`.
       *
       * The whole roster either way, never `searchable`: the scope narrows the
       * front door, and the point of this list is to offer the children a
       * narrower answer would have dropped.
       */
      const mine = arrivals.get(student.id);
      const together = mine
        ? students.filter((other) => other.id !== student.id && arrivals.get(other.id) === mine)
        : [];
      const offered = new Map<string, KioskStudent>();
      for (const member of [...together, ...guess]) offered.set(member.id, member);
      return [...offered.values()]
        .filter((member) => intentFor(member) === 'check-out')
        .sort(sortByName);
    },
    [students, familyDigits, intentFor, arrivals],
  );

  /**
   * Which of the offered names arrive unticked.
   *
   * The offer and the tick are two different claims, and they used to be one.
   * `familyOf` is a guess from four phone digits, and it is frequently right
   * about the *household* and wrong about *tonight*: the other children may have
   * come once, or belong to a different programme entirely. Ticking all of them
   * turned that wrong guess into a silent check-in of a child who is not in the
   * building — a name on a register, a sticker printed, and a room count nobody
   * can reconcile.
   *
   * So each intent ticks whatever it has the best evidence for, and offers the
   * rest.
   *
   * **A check-in** ticks the children the gathering actually expects: the ones
   * who pass the same "Recent" prediction the check-in screen uses to decide
   * whose names to put in front of a counselor (see `lib/participation.ts`).
   * Everyone else the guess turned up is still listed, at full weight, one tap
   * from being included — because the parent is the only party who knows who
   * they arrived with, and the screen's job is to make that easy either way.
   *
   * **A pickup** has a better answer than any prediction: the set that actually
   * walked in together, stated by somebody's thumb an hour ago and written on
   * the register. That group is ticked and anyone else the phone guess turned up
   * is listed but left alone — they are on the screen because families do leave
   * together after arriving apart, and unticked because nothing says they are
   * going now.
   *
   * Both fail open. No arrival on file (a volunteer checked them in one at a
   * time, or the record predates arrivals), or no participation aggregate for
   * this chain, and there is nothing better than the guess — so everything is
   * ticked, exactly as it was before either rule existed.
   */
  const skippedFor = useCallback(
    (student: KioskStudent, intent: KioskIntent, family: readonly KioskStudent[]): Set<string> => {
      if (intent === 'check-in') {
        if (scope.recent.size === 0) return new Set();
        return new Set(
          family.filter((member) => !scope.recent.has(member.id)).map((member) => member.id),
        );
      }
      const mine = intent === 'check-out' ? arrivals.get(student.id) : undefined;
      if (!mine) return new Set();
      return new Set(
        family.filter((member) => arrivals.get(member.id) !== mine).map((member) => member.id),
      );
    },
    [arrivals, scope],
  );

  const onConfirm = useCallback(
    (confirm: ConfirmOverlay, chosen: KioskStudent[]) => {
      if (!services || !binding || !uid || chosen.length === 0) return;
      const { intent } = confirm;

      /*
       * The floor under every arrival this kiosk writes.
       *
       * Here rather than on the search screen, and here rather than in
       * `performCheckIn`. The search screen is where the sentence goes but not
       * where the decision belongs — a parent can reach a confirm through the
       * sibling screen and the registration wizard too, and all three land on
       * this one callback. `performCheckIn` is too late for the opposite
       * reason: by then the tick has painted, the label has been printed and
       * the row is green, so a refusal down there would tell a family they are
       * checked in and quietly not do it.
       *
       * Check-in only. A pickup is never premature — a child cannot be
       * collected from an evening they were not checked into, so the presence
       * that makes `check-out` reachable already proves the window opened —
       * and `done` writes nothing at all.
       */
      if (intent === 'check-in' && !windowHasOpened(binding, Date.now())) {
        setOverlay({ kind: 'not-open', opensAt: opensAtLabel(binding, Date.now()) });
        return;
      }

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

      /*
       * One id for this press, recorded locally at the same time as the tick.
       *
       * Locally as well as upstream because a family can be collected before
       * the register has been re-read — a parent who drops a child and comes
       * straight back for a forgotten coat is inside the poll interval — and
       * the pickup screen would otherwise have to fall back to the guess for
       * the one arrival it knows most about.
       */
      const arrivalId = newArrivalId();
      setArrivals((held) => {
        const next = new Map(held);
        for (const student of chosen) next.set(student.id, arrivalId);
        return next;
      });
      /*
       * And when, which the arrival id does not carry.
       *
       * This is the clock the parent's ten-minute reprint window is measured
       * against, and it is written here — beside the tick, for the children this
       * kiosk itself checked in — rather than read back from the register. See
       * `reprintOffer.ts`.
       */
      const checkedInAt = Date.now();
      setCheckedInAtMs((held) => {
        const next = new Map(held);
        for (const student of chosen) next.set(student.id, checkedInAt);
        return next;
      });

      for (const student of chosen) {
        void services
          .performCheckIn({ binding, student, uid, arrivalId })
          .then(() => services.forgetStudentDates(student.id))
          .catch((error: { code?: string }) => {
            // Refused outright — frozen student, or a record the kiosk may not
            // touch. Not retryable; the row stays green because they are, in
            // every way that matters at a door, here.
            if (error.code?.includes('permission-denied')) return;
            services.enqueueCheckIn({ binding, student, uid, arrivalId });
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
            // The printer screen lists what has been attempted tonight, and the
            // log is the queue's rather than React's — this is what tells a
            // screen that is open to read it again.
            setPrintTick((tick) => tick + 1);
          } catch {
            // Deliberately swallowed. See above.
          }
        }
      }
    },
    [services, printing, prints, binding, uid],
  );

  /**
   * Print this child's name tag again.
   *
   * The one place a reprint happens, whichever of the three doors asked for it:
   * the by-name staff screen, a row of the evening's log, or the parent's hold
   * inside their ten minutes. All three spend the same counter, because the cap
   * is one label per child rather than one per surface.
   *
   * Nothing here touches the register — no check-in, no check-out, no arrival
   * id, nothing upstream. That is the promise the staff screen makes in words
   * and the reason the parent's version is allowed to exist at all.
   */
  const reprintFor = useCallback(
    (student: KioskStudent) => {
      if (!binding || !printing) return;
      try {
        printing.reprintLabel(student, binding);
      } catch {
        // Same reasoning as the check-in path: a sticker may never reach back
        // into the screen that asked for it.
      }
      setReprintedIds((held) => new Set(held).add(student.id));
      setSentId(student.id);
      setPrintTick((tick) => tick + 1);
    },
    [binding, printing],
  );

  /**
   * The reprint screen's own search: the whole roster, and six of it.
   *
   * Not `searchable`. The scope exists so a parent is not shown a stranger's
   * children; a volunteer already knows the name of the child in front of them,
   * and a child whose family came to Sunday nursery is exactly the case where
   * the label went missing.
   */
  const reprintOutcome = useMemo(() => {
    const found = searchStudents(buffer, students as KioskStudent[], last4Index);
    return {
      results: found.results.slice(0, MAX_REPRINT_RESULTS),
      total: found.total ?? found.results.length,
    };
  }, [buffer, students, last4Index]);

  /** The evening's attempts. Held by the queue, not by React — see `printTick`. */
  const printedTonight = useMemo(() => {
    void printTick;
    return printing?.printedTonight() ?? [];
  }, [printing, printTick]);

  /**
   * When this child's name tag last came out, and what the next one would say.
   *
   * Both are for the confirm, and both are the reason it is a confirm rather
   * than a button: a volunteer is usually here because they suspect something
   * did not print, or printed wrong, and these are the two answers to that
   * available before the tape moves.
   */
  const lastPrintedAt = useCallback(
    (studentId: string): string | null => {
      const entry = printedTonight.find((row) => row.studentId === studentId && !row.failed);
      return entry
        ? new Date(entry.atMs).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
        : null;
    },
    [printedTonight],
  );

  const labelLinesFor = useCallback(
    (student: KioskStudent): string[] =>
      binding && printing ? printing.labelPreview(student, binding) : [],
    [binding, printing],
  );

  /**
   * Whether a staff surface should say the printer may not come through.
   *
   * Broader than the amber dot a parent gets, and deliberately so. That dot is
   * `kind === 'trouble'` only — "a kiosk with no printer is not a kiosk with a
   * broken one, and neither is one whose printer is simply unpaired" — because a
   * parent can do nothing about any of it and a warning beside a green tick
   * reads as a failed check-in.
   *
   * A volunteer is not a parent. `unpaired` is the state a browser restart
   * leaves behind, and it is exactly when somebody standing at the printer wants
   * to be told that the next press may produce nothing — while still being
   * allowed to try, because the queue's `send` reopens the device for this case
   * rather than failing.
   */
  const printerUnready = printerState !== null && printerState.kind !== 'ready';

  /** Leaving the staff flow, by hand or by the gate's own clock. */
  const leaveStaff = useCallback(() => {
    setOverlay(null);
    setBuffer('');
    setSentId(null);
  }, []);

  /* ---- Registration ------------------------------------------------------- */

  /*
   * "First time here?" opens the wizard directly — one tap from the question
   * to the first question. The QR screen that used to stand between them (a
   * phone form, codes, a pulse channel to walk the kiosk back) is retired:
   * once-per-family work did not earn a standing second door, and the wizard
   * asks everything the phone form asked.
   */
  /**
   * Whether an arrival may be written at all right now.
   *
   * The wizard is a check-in door as much as the keypad is — `registerFamily`
   * creates the children *and* marks them present in one call — so it is gated
   * on the same clock, and refused at the door rather than six questions in.
   * A family who typed a guardian's name and three birthdays only to be told
   * the gathering has not started would have been asked for all of it for
   * nothing.
   */
  const arrivalsOpen = useCallback(
    () => !binding || windowHasOpened(binding, Date.now()),
    [binding],
  );

  const refuseAsNotOpen = useCallback(() => {
    if (!binding) return;
    setOverlay({ kind: 'not-open', opensAt: opensAtLabel(binding, Date.now()) });
    setBuffer('');
  }, [binding]);

  const startWizard = useCallback(() => {
    if (!arrivalsOpen()) {
      refuseAsNotOpen();
      return;
    }
    setBuffer('');
    setRegistering({ registrationId: newRegistrationId(), anchors: [] });
  }, [arrivalsOpen, refuseAsNotOpen]);

  /**
   * The registration half of "who else is with them".
   *
   * The anchors are the children the kiosk already has for this family, which
   * is what lets the wizard skip the adult's three questions entirely: the
   * household upstream already holds a parent, and the server re-verifies every
   * anchor before it believes any of it. The overlay closes first — the parent
   * is leaving the confirm screen, not stacking a third thing on it.
   */
  const startSiblingWizard = useCallback(
    (anchors: KioskStudent[]) => {
      if (!arrivalsOpen()) {
        refuseAsNotOpen();
        return;
      }
      setOverlay(null);
      setBuffer('');
      setRegistering({ registrationId: newRegistrationId(), anchors });
    },
    [arrivalsOpen, refuseAsNotOpen],
  );

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
    (result: {
      children: readonly KioskStudent[];
      last4: string;
      checkedIn: boolean;
      /** The arrival the server recorded for them — the registration's own id. */
      registrationId: string;
    }) => {
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
        /*
         * The same arrival the server wrote on their attendance, mirrored here
         * so a pickup works before the register has been re-read. A family who
         * registers two children has made the clearest "we came in together"
         * statement the kiosk ever gets, and it should not take a poll to hear
         * it.
         */
        setArrivals((held) => {
          const next = new Map(held);
          for (const student of added) next.set(student.id, result.registrationId);
          return next;
        });
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
        /*
         * Setup, reached from the chooser, so this kiosk is not on a gathering:
         * there is no evening to list and nothing a reprint could be aimed at.
         * The same screen mid-service — reached from the staff gate, with the
         * binding still in place — carries both.
         */
        printedTonight={[]}
        onReprint={() => {}}
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
      return (
        <registration.RegistrationFlow
          binding={binding}
          registrationId={registering.registrationId}
          mode={registering.anchors.length > 0 ? 'sibling' : 'family'}
          anchors={registering.anchors}
          submit={({ registrationId, children, guardian, anchorStudentIds }) => {
            /*
             * The notes ride beside the children, not inside them: the wire
             * shape is the index-aligned array the phone form used, and the
             * key is only sent at all when the binding said the backend can
             * carry it AND somebody typed one. Omitting an all-null array
             * costs nothing (the server fills nulls) and keeps every
             * "No allergies" run working across a functions rollback to a
             * version that refuses the key.
             */
            const notes = children.map((child) => (child.allergies === '' ? null : child.allergies));
            const carryNotes =
              (binding.allergiesSupported ?? false) && notes.some((note) => note !== null);
            return services.registerFamily({
              registrationId,
              children: children.map((child) => ({
                firstName: child.firstName,
                lastName: child.lastName,
                grade: child.grade,
              })),
              guardian,
              anchorStudentIds,
              eventId: binding.eventId,
              ...(carryNotes ? { allergies: notes } : {}),
            });
          }}
          onRegistered={(result) =>
            onRegistered({
              children: result.children.map((child) => ({
                id: child.studentId,
                firstName: child.firstName,
                lastName: child.lastName,
                grade: child.grade,
                searchName: child.searchName,
                // The callable's echo — the one place tonight's truth lives;
                // the roster read answers false for Tally-owned students by
                // rule until approval pushes the note upstream.
                hasAllergies: child.hasAllergies === true,
              })),
              last4: result.last4,
              checkedIn: result.checkedIn,
              // The id this run submitted under, which is what the server used
              // as the arrival — see registration.ts. Read off the overlay
              // rather than the response so the two cannot drift.
              registrationId: registering.registrationId,
            })
          }
          onClose={() => {
            setRegistering(null);
            setBuffer('');
          }}
        />
      );
    }
    /*
     * The staff flow, behind one clock.
     *
     * `StaffSession` hands the kiosk back after forty-five seconds of nothing
     * happening, and it wraps the whole flow rather than each screen in it: a
     * timer per screen is a timer the next screen does not get, and the screen
     * that missed out was the printer screen — which, left up, is a lobby tablet
     * showing five children's names and arrival times to whoever walks past.
     */
    if (
      overlay?.kind === 'staff' ||
      overlay?.kind === 'reprint' ||
      overlay?.kind === 'reprint-confirm' ||
      overlay?.kind === 'printer' ||
      overlay?.kind === 'unbind'
    ) {
      const staffScreen =
        overlay.kind === 'unbind' ? (
          <ChangeEventScreen
            title={binding.title}
            iconPath={binding.iconPath}
            /*
             * Back to the menu it was opened from, not out to the search screen.
             *
             * This prompt is only ever reached from the staff screen now, and a
             * volunteer lands on it two ways: they mis-tapped the row under the
             * one they wanted, or they opened it to check which gathering the
             * kiosk is on. Both of them want to be where they were. Dropping
             * them at the front door instead costs another two-second hold on
             * Clear, with the parent still standing there — and the gate is the
             * gate, so there is no cheaper way back in.
             */
            onStay={() => setOverlay({ kind: 'staff' })}
            // A kiosk that has left a gathering has no business still holding
            // notes about the children who were at it — nor the evening's list
            // of who had a name tag printed, which is the same argument about
            // the same names. All of it goes, by whichever door: see
            // `leaveGathering`.
            onLeave={leaveGathering}
          />
        ) : overlay.kind === 'staff' ? (
          <StaffScreen
            title={binding.title}
            iconPath={binding.iconPath}
            window={eventWindow(binding)}
            /*
             * `none` means *there is nothing here to print*, and nothing else.
             *
             * It used to include `unpaired`, which was wrong in the direction
             * that costs a volunteer a label: a kiosk whose printer is
             * configured but not currently claimed — a browser restarted, a
             * device replugged without a connect event landing — reports
             * `unpaired`, and the queue's `send` deliberately reopens rather
             * than failing for exactly that case. So the door was refusing a
             * reprint the printer would have made, and the person standing
             * there was told to go away by a kiosk that worked.
             *
             * A printer that is configured and not ready is a printer that
             * needs attention, which is what the word says. The reprint screens
             * carry the same warning, and the attempt is what discovers the
             * truth.
             */
            printer={
              !prints || printerState === null || printerState.kind === 'idle'
                ? 'none'
                : printerState.kind === 'ready'
                  ? 'ready'
                  : 'trouble'
            }
            trouble={printerState?.kind === 'trouble' ? printerState.message : null}
            onReprint={() => {
              setBuffer('');
              setSentId(null);
              setOverlay({ kind: 'reprint' });
            }}
            onPrinter={() => setOverlay({ kind: 'printer' })}
            onChangeEvent={() => setOverlay({ kind: 'unbind' })}
            onStay={leaveStaff}
          />
        ) : overlay.kind === 'reprint' ? (
          <ReprintScreen
            buffer={buffer}
            outcome={reprintOutcome}
            presentIds={presentIds}
            sentId={sentId}
            printerNeedsAttention={printerUnready}
            onKey={onKey}
            onPick={(student) => {
              // Warmed on the tap, the same trick the confirm screen plays: the
              // rasterising is a few hundred thousand pixels in a worker and
              // this is the slack while the confirm is on its way up.
              printing?.warmLabel(student, binding);
              setOverlay({ kind: 'reprint-confirm', student, from: 'reprint' });
            }}
            onDone={leaveStaff}
          />
        ) : overlay.kind === 'reprint-confirm' ? (
          <ReprintConfirmScreen
            student={overlay.student}
            lines={labelLinesFor(overlay.student)}
            printedAt={lastPrintedAt(overlay.student.id)}
            printerNeedsAttention={printerUnready}
            onPrint={() => {
              reprintFor(overlay.student);
              setOverlay({ kind: overlay.from === 'printer' ? 'printer' : 'reprint' });
            }}
            onBack={() => {
              // Backed out, so the raster warmed on the way in is not wanted.
              printing?.forgetLabel(overlay.student.id);
              setOverlay({ kind: overlay.from === 'printer' ? 'printer' : 'reprint' });
            }}
          />
        ) : (
          <PrinterScreen
            printing={printing!}
            config={printerConfig ?? { model: DEFAULT_PRINTER_MODEL, label: DEFAULT_PRINTER_LABEL }}
            printedTonight={printedTonight}
            onReprint={(label) => {
              /*
               * A row of the log opens the same confirm the by-name path opens.
               * It used to print on contact, inside a pane that has to be
               * scrolled to reach the rest of itself — so the first touch of a
               * scroll gesture spent a label for whichever child the thumb
               * pushed off with, and this device has no undo.
               *
               * A child who has left the roster since cannot be re-rastered, so
               * their row does nothing rather than printing something built from
               * a name.
               */
              const student = students.find((row) => row.id === label.studentId);
              if (student) {
                printing?.warmLabel(student, binding);
                setOverlay({ kind: 'reprint-confirm', student, from: 'printer' });
              }
            }}
            onReprintByName={() => {
              setBuffer('');
              setSentId(null);
              setOverlay({ kind: 'reprint' });
            }}
            onDone={() => {
              setPrinterConfig(readPrinterConfig());
              setOverlay({ kind: 'staff' });
            }}
          />
        );

      return (
        <StaffSession onReturn={leaveStaff}>
          {overlay.kind === 'printer' && !printing ? (
            <div className="flex h-full items-center justify-center text-ink-500">Loading…</div>
          ) : (
            staffScreen
          )}
        </StaffSession>
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
    if (overlay?.kind === 'not-open') {
      return (
        <NotOpenScreen
          opensAt={overlay.opensAt}
          onDone={() => {
            // Home, cleared — the same landing the tick makes, for the same
            // reason: the next family starts from blank glass.
            setOverlay(null);
            setBuffer('');
          }}
        />
      );
    }
    if (overlay?.kind === 'sibling') {
      const { from } = overlay;
      const already = new Set([from.student.id, ...from.family.map((member) => member.id)]);
      return (
        <SiblingScreen
          student={from.student}
          buffer={buffer}
          onKey={onKey}
          students={students}
          excludeIds={already}
          presentIds={presentIds}
          onPick={(found) => {
            /*
             * Straight back to the confirm with them on it, ticked. Not a
             * second confirm screen of their own: the parent is assembling one
             * group, and the button at the end says how many it covers.
             */
            services?.warmStudentDates(found.id);
            printing?.warmLabel(found, binding);
            setBuffer('');
            setOverlay({ ...from, family: [...from.family, found] });
          }}
          onRegister={() => startSiblingWizard([from.student, ...from.family])}
          onBack={() => {
            setBuffer('');
            setOverlay(from);
          }}
        />
      );
    }
    if (overlay?.kind === 'confirm') {
      return (
        <ConfirmScreen
          student={overlay.student}
          intent={overlay.intent}
          /*
           * Half of this was decided when the row was tapped and half is read
           * here, and which half is which is the whole of `reprintOffer.ts`: the
           * window and the printer are the world's answer and must not move
           * under a thumb already two seconds into a hold; the one label having
           * been spent is the parent's own answer, given on this screen, and a
           * receipt they have to leave and come back for is no receipt.
           */
          reprintOffer={reprintOffer({
            standing: overlay.standing,
            spent: reprintedIds.has(overlay.student.id),
          })}
          onReprint={() => reprintFor(overlay.student)}
          family={overlay.family}
          skipped={overlay.skipped}
          onToggle={(studentId) => {
            const next = new Set(overlay.skipped);
            const ticking = next.delete(studentId);
            if (!ticking) next.add(studentId);
            /*
             * A sibling the prediction did not expect is warmed when the parent
             * says otherwise, not before — see the pick handler. Still ahead of
             * the thumb: a tick is followed by a look at the list, and the
             * commit is a separate press.
             */
            if (ticking && overlay.intent === 'check-in') {
              const member = overlay.family.find((row) => row.id === studentId);
              if (member) {
                services?.warmStudentDates(member.id);
                if (prints) printing?.warmLabel(member, binding);
              }
            }
            setOverlay({ ...overlay, skipped: next });
          }}
          onConfirm={(chosen) => onConfirm(overlay, chosen)}
          onFindSibling={() => {
            setBuffer('');
            setOverlay({ kind: 'sibling', from: overlay });
          }}
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
        // Computed here, over the scoped pool (or everybody, once widened) —
        // see `searchable` and `outcome`. The screen renders what it is handed.
        outcome={outcome}
        presentIds={presentIds}
        checkedOutIds={checkedOutIds}
        tracksCheckOut={binding.requiresCheckOut ?? false}
        // Only "trouble" — a kiosk with no printer is not a kiosk with a broken
        // one, and neither is one whose printer is simply unpaired.
        printerNeedsAttention={printerState?.kind === 'trouble'}
        refresh={refresh}
        widening={widening}
        onWiden={() => void onWiden()}
        onRegister={startWizard}
        onPick={(student) => {
          const intent = intentFor(student);
          const family = familyFor(student, intent);
          // Before the warming, not after: which siblings arrive ticked is now
          // a real question, and the answer decides what is worth preparing.
          const skipped = skippedFor(student, intent, family);
          const taking = family.filter((member) => !skipped.has(member.id));
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
           * Only the siblings arriving *ticked*, for the same reason: a child
           * the prediction does not expect is more likely than not to be
           * unticked and left, and rasterising for them is a few hundred
           * thousand pixels of work thrown away — in the worker the ticked
           * children are queued behind. A sibling the parent does tick is warmed
           * on the tap, which is still ahead of the thumb reaching the button.
           */
          for (const member of taking) services?.warmStudentDates(member.id);
          if (prints && intent === 'check-in') {
            printing?.warmLabel(student, binding);
            for (const member of taking) printing?.warmLabel(member, binding);
          }
          setOverlay({
            kind: 'confirm',
            student,
            intent,
            family,
            skipped,
            standing: reprintStanding({
              studentId: student.id,
              now: Date.now(),
              checkedInAtMs,
              labelWouldPrint: prints && printerState?.kind !== 'trouble',
            }),
          });
        }}
        /*
         * The hold on Clear used to open **Change event?** directly, so every
         * staff errand was on the far side of unbinding the kiosk: to get one
         * child a second sticker a volunteer shut the door on the queue, walked
         * out through the chooser, and held a row for two seconds to put the
         * kiosk back where it already was. It opens the doors now, and leaving
         * the gathering is one of them rather than all of them.
         */
        onStaffGate={() => setOverlay({ kind: 'staff' })}
      />
    );
  }

  // Waiting on the services chunk for a screen that needs it.
  return <div className="flex h-full items-center justify-center text-ink-500">Loading…</div>;
}
