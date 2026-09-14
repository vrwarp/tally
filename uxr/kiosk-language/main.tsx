/**
 * The kiosk's home screen, mounted from `src/` for the language campaign.
 *
 * The feedback that started it: members of the Chinese congregation who read
 * no English at all found the home screen confusing. The screen has a language
 * control — three quiet chips in the readout band — and a catalogue in both
 * Chinese scripts, so the question is not whether the words exist but whether
 * a parent who cannot read the screen can find the way to the words. That is
 * a question about the *idle* frame, in every language, on every glass, which
 * is what this harness photographs.
 *
 * Mounted rather than frozen, as `uxr/kiosk-live/` is, and for the same
 * reason: `SearchScreen` is a pure function of its props and a frame of the
 * real component cannot drift. One knob is new. The kiosk's language is a
 * property of the tablet, read from `localStorage` before the first render
 * (`KioskIntlProvider`), so the harness writes it there from the query string
 * before React mounts — exactly what a volunteer's press on the pairing screen
 * does, minus the volunteer.
 *
 *   ?lang=en|zh-Hant|zh-Hans   the kiosk's language          (default: English)
 *   ?lang=es                   a language the kiosk does not speak yet — the
 *                              provider rests in English and only a candidate's
 *                              own panels change (see `Lang` in the variants file)
 *   ?variant=<id>              a candidate home screen from `SearchScreen.variants.tsx`;
 *                              absent means the shipping component, byte for byte
 *   ?pins=zh-Hant,es           the languages this lobby pins beside English at rest
 *   ?speaks=es                 a language the kiosk will have a catalogue for — photographs
 *                              the day it lands, when a pinned line becomes a plate
 *   ?buffer=Alva               what has been typed
 *   ?present=1,2               ids already checked in
 *   ?nomatch=1                 the search finished and found nobody
 *   ?pickup=1                  a gathering that also hands children back
 *   ?title=…  ?icon=groups     the gathering's name and mark
 *   ?photo=1                   the gathering's photograph behind the idle screen
 *   ?chosen=1|<lang>           a family has chosen a language this visit — ?lang's, or the named one
 *   ?ground=light              the light ground, as a light-themed gathering wears it
 *   ?phase=0|1|2               pin a cycling greeting to one of its moments
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';
import { findEventIcon } from '@/lib/eventIcons';
import { KIOSK_LOCALE_STORAGE_KEY, LOCALES, isLocale } from '@/lib/locales';
import type { KioskBinding } from '@/kiosk/binding';
import { Backdrop } from '@/kiosk/components/Backdrop';
import type { KioskKey } from '@/kiosk/components/Keyboard';
import { KioskIntlProvider } from '@/kiosk/KioskIntlProvider';
import type { KioskSearchOutcome, KioskStudent } from '@/kiosk/search';
import { SearchScreen } from '@/kiosk/screens/SearchScreen';
import { LANGS, SearchScreenVariant, VARIANTS, type Lang } from './SearchScreen.variants';

const params = new URLSearchParams(location.search);

/* The room's language, set the way the pairing screen sets it. Written
   before anything reads it: the provider's first render is the first frame.
   A language the provider does not know (Spanish, for now) leaves the kiosk
   resting in English, which is also what the tablet does with a stale key. */
const lang = params.get('lang');
if (isLocale(lang)) localStorage.setItem(KIOSK_LOCALE_STORAGE_KEY, lang);
else localStorage.removeItem(KIOSK_LOCALE_STORAGE_KEY);

const variant = params.get('variant');

const isLang = (value: string | null): value is Lang => (LANGS as readonly string[]).includes(value ?? '');
/* The lobby's pins and the family's choice, both in the candidates' own
   language list rather than the provider's, so that Spanish can be either. */
const pins = params.get('pins')?.split(',').filter(isLang);
const speaks: Lang[] = [...LOCALES, ...(params.get('speaks')?.split(',').filter(isLang) ?? [])];
const chosenParam = params.get('chosen');
const chosen: Lang | null =
  chosenParam === '1' ? (isLang(lang) ? lang : null) : isLang(chosenParam) ? chosenParam : null;

/* The ground, worn the way `applyKioskTheme` wears it: `data-theme` on the
   root. A leader's first decision in the theme editor, and the ramp flips
   wholesale for it, so every plate and chip here has to be looked at on
   both. */
if (params.get('ground') === 'light') document.documentElement.dataset.theme = 'light';

const photoUrl = params.get('photo') === '1' ? '/uxr/kiosk-live/backdrop-demo.svg' : null;

/* A gathering in progress, anchored to the real clock — see kiosk-live. */
const NOW = Date.now();

const binding: KioskBinding = {
  eventId: 'uxr-event',
  seriesId: null,
  title: params.get('title') ?? 'Sunday Kids',
  startAtMs: NOW - 22 * 60_000,
  endAtMs: NOW + 68 * 60_000,
  checkInClosesAtMs: NOW + 98 * 60_000,
  boundAtMs: NOW - 45 * 60_000,
  requiresCheckOut: params.get('pickup') === '1',
  allergiesSupported: true,
  iconPath: findEventIcon(params.get('icon'))?.path,
};

/*
 * The kiosk-live roster, plus the two children this campaign is about.
 *
 * Planning Center writes a child with a Chinese name as `Benson “蔡秉洲” Tsai`
 * — the nickname composed into the first name, which is how the roster has
 * carried it since the beginning (`src/types/names.ts`). A frame of the typed
 * screen for a Chinese congregation that had no such row on it would be
 * photographing somebody else's church.
 */
const STUDENTS: KioskStudent[] = [
  { id: '1', firstName: 'Ramona', lastName: 'Alvarez', grade: 7 },
  { id: '2', firstName: 'Noah', lastName: 'Alvarez', grade: 9 },
  { id: '3', firstName: 'Priya', lastName: 'Alvarez-Bell', grade: 11 },
  { id: '4', firstName: 'Sam', lastName: 'Alvarado', grade: 6 },
  { id: '5', firstName: 'Jonah', lastName: 'Alvarado', grade: 12 },
  { id: '6', firstName: 'Alice', lastName: 'Alberts', grade: 6 },
  { id: '7', firstName: 'Benson “蔡秉洲”', lastName: 'Tsai', grade: 3 },
  { id: '8', firstName: 'Emily “陳恩慈”', lastName: 'Chen', grade: 1 },
  { id: '9', firstName: 'Alden', lastName: 'Aldridge', grade: 7 },
  { id: '10', firstName: 'Alethea', lastName: 'Alford', grade: 11 },
  { id: '11', firstName: 'Alonzo', lastName: 'Allred', grade: 9 },
] as KioskStudent[];

function outcomeFor(buffer: string, nobody: boolean): KioskSearchOutcome {
  const digits = /^\d+$/.test(buffer);
  const mode = !buffer
    ? 'idle'
    : digits
      ? buffer.length === 4
        ? 'phone'
        : 'phone-partial'
      : 'name';
  const needles = buffer.toLowerCase().trim().split(/\s+/).filter(Boolean);
  /* Four digits answer with the two families this campaign is about: the
     phone route is the one that needs no reading, so its frame has to exist. */
  const matched =
    nobody || needles.length === 0
      ? []
      : mode === 'phone'
        ? STUDENTS.filter((student) => student.id === '7' || student.id === '8')
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

export function Kiosk() {
  const [buffer, setBuffer] = useState(params.get('buffer') ?? '');
  const onKey = (key: KioskKey) => {
    if (key.kind === 'char') setBuffer((typed) => typed + key.value);
    else if (key.kind === 'backspace') setBuffer((typed) => typed.slice(0, -1));
    else if (key.kind === 'clear') setBuffer('');
  };

  const props = {
    binding,
    buffer,
    onKey,
    outcome: outcomeFor(buffer, params.get('nomatch') === '1'),
    presentIds: new Set(params.get('present')?.split(',').filter(Boolean) ?? []),
    checkedOutIds: new Set<string>(),
    tracksCheckOut: binding.requiresCheckOut ?? false,
    printerNeedsAttention: false,
    onPrinter: () => {},
    backdrop: photoUrl !== null,
    refresh: 'idle' as const,
    widening: false,
    onWiden: () => {},
    onPick: () => {},
    onRegister: () => {},
    onStaffGate: () => {},
  };

  return (
    <>
      {photoUrl && <Backdrop url={photoUrl} shown={buffer === ''} />}
      {variant && variant in VARIANTS ? (
        <SearchScreenVariant
          variant={variant}
          initialChosen={chosen}
          pins={pins}
          speaks={speaks}
          phase={params.has('phase') ? Number(params.get('phase')) : undefined}
          {...props}
        />
      ) : (
        <SearchScreen {...props} />
      )}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <KioskIntlProvider>
    <Kiosk />
  </KioskIntlProvider>,
);
