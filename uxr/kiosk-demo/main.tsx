/**
 * The kiosk, live, for the walkthroughs — the lobby-languages change first,
 * and now the family offer.
 *
 * Real components — `SearchScreen`, `ConfirmScreen`, `SuccessScreen`,
 * `PairingScreen`, `StaffScreen` — over a fixture roster and no network, with
 * the few things `KioskApp` owns rebuilt here in miniature: the typed buffer,
 * the lobby's pins, the clock that gives the screen back, and the family the
 * kiosk guesses from four digits (real `familyOf` over a real inverted index,
 * because a hard-coded sibling list would be demonstrating a different
 * screen). The strip along the top is the demo's, not the
 * kiosk's: it moves between the three screens and says what the language
 * clock is doing, which on a real tablet is invisible by design.
 *
 * Knobs, all optional, for the walkthrough's frames and deep links:
 *
 *   ?screen=checkin|pairing|staff|languages
 *                                   which screen to open on
 *   ?printer=none|ready|trouble     what the staff menu says about the printer
 *   ?owed=4                         name tags the printer owes, on that row
 *   ?pins=zh-Hans,es-MX,zh-Hant     the lobby's languages (default: all three)
 *   ?photo=1                        a photograph behind the idle screen
 *   ?buffer=Alva                    letters already typed
 *   ?nomatch=1                      the roster finds nobody, whatever is typed
 *   ?lang=zh-Hant                   the language a family chose
 *   ?bare=1                         no strip — the kiosk alone, for frames
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';
import { useLocaleControl } from '@/i18n/localeContext';
import { eventWindow, type KioskBinding } from '@/kiosk/binding';
import { Backdrop } from '@/kiosk/components/Backdrop';
import type { KioskKey } from '@/kiosk/components/Keyboard';
import type { KioskRefresh, KioskServices } from '@/kiosk/KioskApp';
import { KioskIntlProvider } from '@/kiosk/KioskIntlProvider';
import type { KioskSearchOutcome, KioskStudent } from '@/kiosk/search';
import { LanguagesScreen } from '@/kiosk/screens/LanguagesScreen';
import { PairingScreen } from '@/kiosk/screens/PairingScreen';
import { SearchScreen } from '@/kiosk/screens/SearchScreen';
import { ConfirmScreen } from '@/kiosk/screens/ConfirmScreen';
import { SuccessScreen } from '@/kiosk/screens/SuccessScreen';
import { buildFamilyDigits, familyOf } from '@/kiosk/family';
import { StaffScreen } from '@/kiosk/screens/StaffScreen';
import { sanitizePins } from '@/kiosk/storage';
import {
  DEFAULT_LOCALE,
  KIOSK_LOCALE_STORAGE_KEY,
  LOCALE_LABELS,
  isLocale,
  type Locale,
} from '@/lib/locales';

const params = new URLSearchParams(location.search);

/* The language the kiosk wakes in: the knob's, else English — a demo that
   remembered the last visitor's choice would look like a kiosk that had
   forgotten to reset. */
const lang = params.get('lang');
if (isLocale(lang)) localStorage.setItem(KIOSK_LOCALE_STORAGE_KEY, lang);
else localStorage.removeItem(KIOSK_LOCALE_STORAGE_KEY);

type Screen = 'checkin' | 'pairing' | 'staff' | 'languages';
const SCREENS: readonly Screen[] = ['checkin', 'pairing', 'staff', 'languages'];
const isScreen = (value: string | null): value is Screen =>
  (SCREENS as readonly string[]).includes(value ?? '');

const screenParam = params.get('screen');
const INITIAL_SCREEN: Screen = isScreen(screenParam) ? screenParam : 'checkin';
/* The owner's lobby: Chinese in both scripts and Spanish, which is the fullest
   shape the switch takes — two names across, two down. */
const INITIAL_PINS: Locale[] = params.has('pins')
  ? sanitizePins(params.get('pins')!.split(','))
  : ['zh-Hans', 'es-MX', 'zh-Hant'];
const NOBODY = params.get('nomatch') === '1';
/* The staff menu's own knobs. Its tallest state — a printer in trouble, which
   draws a sentence under the reprint door, plus a photograph, which draws a
   row — is the one worth measuring: the screen is a centred column. */
const PRINTER =
  (['none', 'ready', 'trouble'] as const).find((kind) => kind === params.get('printer')) ?? 'none';
const OWED = Number(params.get('owed') ?? '0') || 0;
const BARE = params.get('bare') === '1';
const PHOTO_URL = new URL('./backdrop-demo.svg', import.meta.url).href;

/** How long a chosen language outlives the last touch — `KioskApp`'s figure. */
const LANGUAGE_RESET_MS = 60_000;

const NOW = Date.now();
const binding: KioskBinding = {
  eventId: 'demo-event',
  seriesId: null,
  title: 'Sunday Kids',
  startAtMs: NOW - 22 * 60_000,
  endAtMs: NOW + 68 * 60_000,
  checkInClosesAtMs: NOW + 98 * 60_000,
  boundAtMs: NOW - 45 * 60_000,
  requiresCheckOut: false,
  allergiesSupported: true,
  // What the confirm and success screens name, and what a sticker would print.
  location: 'Room 104',
};

/**
 * The households the kiosk would guess from four digits.
 *
 * Real `familyOf` over a real inverted index, rather than a hand-drawn list of
 * siblings: the whole point of the offer is that it is a guess from a phone
 * number, and a demo that hard-coded the answer would be demonstrating a
 * different screen. Ramona's household is the one a visitor lands in by typing
 * anything four digits long.
 */
const LAST4: Record<string, string[]> = {
  '0134': ['1', '2', '3'],
  '7788': ['7', '8'],
  '2200': ['9', '10'],
};

const FAMILY_DIGITS = buildFamilyDigits(LAST4);

const STUDENTS: KioskStudent[] = [
  { id: '1', firstName: 'Ramona', lastName: 'Alvarez', grade: 7 },
  { id: '2', firstName: 'Noah', lastName: 'Alvarez', grade: 9 },
  { id: '3', firstName: 'Priya', lastName: 'Alvarez-Bell', grade: 11 },
  { id: '4', firstName: 'Sam', lastName: 'Alvarado', grade: 6 },
  { id: '5', firstName: 'Jonah', lastName: 'Alvarado', grade: 12 },
  { id: '6', firstName: 'Alice', lastName: 'Alberts', grade: 6 },
  { id: '7', firstName: 'Benson “蔡秉洲”', lastName: 'Tsai', grade: 3 },
  { id: '8', firstName: 'Emily “陳恩慈”', lastName: 'Chen', grade: 1 },
  { id: '9', firstName: 'Mateo', lastName: 'Hernández', grade: 4 },
  { id: '10', firstName: 'Lucía', lastName: 'Hernández', grade: 2 },
  { id: '11', firstName: 'Alonzo', lastName: 'Allred', grade: 9 },
] as KioskStudent[];

/** The search `KioskApp` would run, over the fixture: names by prefix, four digits find the Tsai and Chen households. */
function outcomeFor(buffer: string): KioskSearchOutcome {
  const digits = /^\d+$/.test(buffer);
  const mode = !buffer ? 'idle' : digits ? (buffer.length === 4 ? 'phone' : 'phone-partial') : 'name';
  const needles = buffer.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matched =
    NOBODY || needles.length === 0
      ? []
      : mode === 'phone'
        ? /* The household those four digits answer to, out of the same index
             `familyOf` reads, so the names a visitor finds and the names the
             confirm then offers cannot disagree. Any other four digits find the
             Tsai and Chen households, which is what the languages walkthrough
             photographs. */
          STUDENTS.filter((student) =>
            (LAST4[buffer] ?? ['7', '8']).includes(student.id),
          )
        : mode === 'phone-partial'
          ? []
          : STUDENTS.filter((student) => {
              const words = `${student.firstName} ${student.lastName}`
                .toLowerCase()
                .split(/[\s-“”]+/);
              return needles.every((needle) => words.some((word) => word.startsWith(needle)));
            });
  return { mode, results: matched.slice(0, 8), total: matched.length } as KioskSearchOutcome;
}

/** Enough of the pairing service to show a code that never pairs. */
const services = {
  beginPairing: async () => ({ code: 'HJ4K2P', secret: 'demo', expiresInSeconds: 600 }),
  pollPairing: async () => 'pending' as const,
} as unknown as KioskServices;

const EMPTY = new Set<string>();

export function Demo() {
  const { locale, setLocale } = useLocaleControl();
  const [screen, setScreen] = useState<Screen>(INITIAL_SCREEN);
  const [pins, setPins] = useState<Locale[]>(INITIAL_PINS);
  const [buffer, setBuffer] = useState(params.get('buffer') ?? '');
  const [photo, setPhoto] = useState(params.get('photo') === '1');
  const [present, setPresent] = useState<Set<string>>(EMPTY);
  const [widening, setWidening] = useState(false);
  const [refresh, setRefresh] = useState<KioskRefresh>('idle');
  const [note, setNote] = useState<string | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<{
    student: KioskStudent;
    family: readonly KioskStudent[];
    skipped: ReadonlySet<string>;
  } | null>(null);
  const [done, setDone] = useState<readonly KioskStudent[] | null>(null);

  /* What `KioskApp` does with the same facts: a language is a family's, and
     goes home when they do — on the way back to the door from any other
     screen, and after a minute nobody has touched the glass. */
  const touchedAt = useRef(Date.now());
  useEffect(() => {
    const touched = () => {
      touchedAt.current = Date.now();
    };
    window.addEventListener('pointerdown', touched, { capture: true });
    window.addEventListener('keydown', touched, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', touched, { capture: true });
      window.removeEventListener('keydown', touched, { capture: true });
    };
  }, []);

  const home = useCallback(() => {
    setScreen('checkin');
    setBuffer('');
    setRefresh('idle');
    setConfirm(null);
    setDone(null);
    setLocale(DEFAULT_LOCALE);
  }, [setLocale]);

  const armed = screen === 'checkin' && locale !== DEFAULT_LOCALE;
  useEffect(() => {
    if (!armed) {
      setLeft(null);
      return;
    }
    const tick = () => {
      const since = Date.now() - touchedAt.current;
      if (since >= LANGUAGE_RESET_MS) {
        setLocale(DEFAULT_LOCALE);
        setLeft(null);
        return;
      }
      setLeft(Math.ceil((LANGUAGE_RESET_MS - since) / 1000));
    };
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [armed, setLocale]);

  const say = useCallback((words: string) => {
    setNote(words);
    setTimeout(() => setNote((current) => (current === words ? null : current)), 3200);
  }, []);

  const onKey = useCallback((key: KioskKey) => {
    setRefresh('idle');
    if (key.kind === 'char') setBuffer((typed) => typed + key.value);
    else if (key.kind === 'backspace') setBuffer((typed) => typed.slice(0, -1));
    else if (key.kind === 'clear') setBuffer('');
  }, []);

  /* "Search everyone" reads the whole church; here the fixture is the whole
     church, so the read comes back with the same answer and the headline says
     so — which is the state a real parent meets when the sweep finds nobody. */
  const onWiden = useCallback(() => {
    setWidening(true);
    setTimeout(() => {
      setWidening(false);
      setRefresh('done');
    }, 900);
  }, []);

  /*
   * Tapping a name opens the confirm, exactly as `KioskApp` does — and the
   * offer arrives with nothing ticked but the child who was tapped, which is
   * the change this demo exists to let somebody feel rather than read about.
   */
  const onPick = useCallback((student: KioskStudent) => {
    const family = familyOf(student, STUDENTS, FAMILY_DIGITS).filter(
      (member) => !present.has(member.id),
    );
    setConfirm({ student, family, skipped: new Set(family.map((member) => member.id)) });
  }, [present]);

  const outcome = outcomeFor(buffer);
  const idle = outcome.mode === 'idle';

  const strip = BARE ? null : (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-ink-800 bg-ink-950 px-2 text-sm text-ink-300">
      {SCREENS.map((candidate) => (
        <button
          key={candidate}
          type="button"
          onClick={() => (candidate === 'checkin' ? home() : setScreen(candidate))}
          className={`h-8 rounded-md px-3 font-semibold ${
            screen === candidate ? 'bg-ink-700 text-ink-50' : 'text-ink-400 hover:bg-ink-800 hover:text-ink-200'
          }`}
        >
          {candidate === 'checkin'
            ? 'Check-in'
            : candidate === 'pairing'
              ? 'Pairing'
              : candidate === 'staff'
                ? 'Staff'
                : 'Languages'}
        </button>
      ))}
      <span className="min-w-0 flex-1 truncate px-2 text-ink-400">
        {note ??
          (screen !== 'checkin'
            ? ''
            : left !== null
              ? `${LOCALE_LABELS[locale]} — English again in ${left}s untouched`
              : 'Resting in English')}
      </span>
      <button
        type="button"
        onClick={() => setPhoto((on) => !on)}
        aria-pressed={photo}
        className={`h-8 rounded-md px-3 font-semibold ${
          photo ? 'bg-ink-700 text-ink-50' : 'text-ink-400 hover:bg-ink-800 hover:text-ink-200'
        }`}
      >
        Photo
      </button>
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      {strip}
      <div className="relative min-h-0 flex-1">
        {done ? (
          <SuccessScreen
            students={done}
            intent="check-in"
            room={binding.location ?? null}
            onDone={() => {
              setDone(null);
              home();
            }}
          />
        ) : confirm ? (
          <ConfirmScreen
            student={confirm.student}
            intent="check-in"
            family={confirm.family}
            skipped={confirm.skipped}
            reprintOffer="none"
            onReprint={() => {}}
            room={binding.location ?? null}
            onToggle={(studentId) =>
              setConfirm((held) => {
                if (!held) return held;
                const next = new Set(held.skipped);
                if (!next.delete(studentId)) next.add(studentId);
                return { ...held, skipped: next };
              })
            }
            onConfirm={(chosen) => {
              setPresent((held) => new Set([...held, ...chosen.map((one) => one.id)]));
              setConfirm(null);
              setDone(chosen);
              say(
                chosen.length === 1
                  ? 'One child checked in — the button said so before the press.'
                  : `${chosen.length} children checked in, each one ticked by hand.`,
              );
            }}
            onBack={() => setConfirm(null)}
          />
        ) : screen === 'pairing' ? (
          <PairingScreen services={services} onPaired={() => {}} pins={pins} onPins={setPins} />
        ) : screen === 'staff' ? (
          <StaffScreen
            title={binding.title}
            window={eventWindow(locale, binding)}
            printer={PRINTER}
            owed={OWED}
            trouble={PRINTER === 'trouble' ? { key: 'troubleUnplugged' } : null}
            backdrop={photo}
            onHideBackdrop={() => {
              setPhoto(false);
              home();
            }}
            onReprint={() => say('The reprint screen is not part of this demo.')}
            onPrinter={() => say('The printer screen is not part of this demo.')}
            onChangeEvent={() => say('Changing the gathering is not part of this demo.')}
            pins={pins}
            onLanguages={() => setScreen('languages')}
            onStay={home}
          />
        ) : screen === 'languages' ? (
          <LanguagesScreen
            pins={pins}
            onPins={setPins}
            onEnglishOnly={() => {
              setPins([]);
              home();
            }}
            onDone={home}
          />
        ) : (
          <>
            {photo && <Backdrop url={PHOTO_URL} shown={idle} />}
            <SearchScreen
              binding={binding}
              buffer={buffer}
              onKey={onKey}
              outcome={outcome}
              presentIds={present}
              checkedOutIds={EMPTY}
              tracksCheckOut={false}
              printerNeedsAttention={false}
              onPrinter={() => {}}
              owedNotice={0}
              onOwedNotice={() => {}}
              backdrop={photo && idle}
              refresh={refresh}
              widening={widening}
              onWiden={onWiden}
              onPick={onPick}
              onRegister={() => say('The registration wizard is not part of this demo.')}
              onStaffGate={() => setScreen('staff')}
              pins={pins}
            />
          </>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <KioskIntlProvider>
    <Demo />
  </KioskIntlProvider>,
);
