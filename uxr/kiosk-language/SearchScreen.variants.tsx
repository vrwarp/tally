/**
 * The kiosk's home screen with its idle panel and language control up for
 * argument — the language campaign's prototype.
 *
 * This is `src/kiosk/screens/SearchScreen.tsx` copied whole, with two slots
 * cut into it and everything else kept byte-for-byte where it could be: the
 * pinned geometry, the memoized header and console, the scroll reset, the
 * fade, the keyboard. A candidate is a row of `VARIANTS` below — an idle panel
 * to draw in the results region instead of the shipped one, and a language
 * control to stand in the readout band instead of the shipped quiet chips —
 * chosen by `?variant=<id>` in `uxr/kiosk-language/main.tsx`. A candidate that
 * leaves a slot empty gets the shipped part, so every frame of every candidate
 * is the real screen around exactly the thing being argued about. Round 7
 * added a language the kiosk does not speak yet — see `Lang`, below the
 * imports — a per-lobby list of the languages pinned at rest (`pins`), and
 * the list of languages the kiosk can speak all the way down (`speaks`),
 * which decides whether a pin is a door or lines.
 *
 * Working file: this is what the loop edits between rounds. What it settles is
 * ported into `SearchScreen.tsx` and the catalogues; this stays as the record
 * of what else was on the table.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { haptic } from '@/lib/utils';
import { gradeDescription, type GradeStrings } from '@/lib/grades';
import { tallyRender } from '@/kiosk/renderTally';
import { EventName } from '@/kiosk/components/EventName';
import { Keyboard, type KioskKey } from '@/kiosk/components/Keyboard';
import { LanguagePicker } from '@/kiosk/components/LanguagePicker';
import { useTap, useTapGuard, type TapHandlers } from '@/kiosk/components/tapGuard';
import type { KioskRefresh } from '@/kiosk/KioskApp';
import {
  eventWindow,
  opensAtLabel,
  windowHasClosed,
  windowHasOpened,
  type KioskBinding,
} from '@/kiosk/binding';
import { MAX_RESULTS, type KioskSearchOutcome, type KioskStudent } from '@/kiosk/search';
import { useGrades } from '@/hooks/usePureStrings';
import { useLocale, useTranslations } from 'use-intl';
import { useLocaleControl } from '@/i18n/localeContext';
import { LOCALES, LOCALE_LABELS, LOCALE_SHORT_LABELS, isLocale, type Locale } from '@/lib/locales';

/**
 * The languages this round argues over: the three the kiosk speaks, and
 * Spanish, which it is about to.
 *
 * Spanish has no catalogue yet. The owner asked for the bare minimum the
 * prototypes need, so it lives only in this file: a name, a badge, and the
 * words of the panels under argument. Choosing it changes those words and
 * nothing else — the keyboard, the rows and the doors stay English, as they
 * will until `messages/kiosk/es.json` exists — and `isLocale` is the seam:
 * a choice the provider knows is set on the provider, one it does not is
 * kept here.
 */
export type Lang = Locale | 'es';
// eslint-disable-next-line react-refresh/only-export-components
export const LANGS: readonly Lang[] = [...LOCALES, 'es'];
const LABELS: Record<Lang, string> = { ...LOCALE_LABELS, es: 'Español' };
const SHORT: Record<Lang, string> = { ...LOCALE_SHORT_LABELS, es: 'ES' };
/** The languages typed on this keyboard as they are spelled — no door needed to type a name. */
const LATIN: readonly Lang[] = ['en', 'es'];
/** What this lobby pins beside English at rest, until `?pins=` says otherwise. */
const DEFAULT_PINS: Lang[] = ['zh-Hant', 'es'];
/**
 * The languages the kiosk can speak all the way down — the catalogues it
 * has. Round 7's rule: a pinned language the kiosk speaks is a door (a
 * plate on the resting screen, a chip once something is typed, a place on
 * the bar); one it cannot speak yet is lines — its instruction on the
 * resting screen and its words on the failure panel, and no promise beyond
 * them. Every reader who took the Spanish door landed in a half-English
 * room and said so; the lines make no promise a chip would have to cash.
 * `?speaks=es` in the harness photographs the day `es.json` lands.
 */
const DEFAULT_SPEAKS: readonly Lang[] = LOCALES;

function gradeLabel(grades: GradeStrings, grade: number | null): string {
  return grade === null ? '' : gradeDescription(grades, grade);
}


/**
 * **Search everyone**, in the two places it has to be.
 *
 * One component rather than two copies, because the pair must not drift: a
 * parent meets whichever of them their search happens to produce, and a
 * spinner that only one of them wore would make the other look broken.
 *
 * The spinner sits *over* the label rather than instead of it, and the label
 * goes invisible rather than away. The button then has exactly one width in
 * both states, set by its own words rather than by a guess at how wide they
 * are — and a control that changed size under the finger still resting on it
 * is a control that reads as pressed by accident.
 *
 * `aria-label` rather than the label alone, so it keeps its name while its
 * face is a spinner: the button a parent is waiting on is still the same
 * button.
 */
function WidenButton({
  widening,
  onWiden,
  quiet,
  label,
}: {
  widening: boolean;
  onWiden: () => void;
  /** The standing row's weight, beside a keyboard somebody is aiming at. */
  quiet?: boolean;
  /** The words for a language the catalogue does not carry yet; absent, the catalogue's. */
  label?: string;
}) {
  const t = useTranslations('Search');
  const tap = useTap();

  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={(label ?? t('searchEveryone'))}
      aria-busy={widening}
      {...tap(() => {
        haptic(quiet ? 8 : undefined);
        onWiden();
      })}
      className={
        quiet
          ? /* No ring on the standing one. Rows became `ink-800` so a child's
               name would read as a button, and this button carries the same
               fill — so the ring made the *widen* control the strongest edge on
               a screen whose primary targets are the names beside it. */
            'flex h-11 min-w-0 shrink items-center justify-center truncate rounded-xl bg-ink-800/70 px-3 text-sm font-semibold whitespace-nowrap text-ink-300 active:bg-ink-700 tall:h-14 tall:px-5 kiosk:text-base'
          : 'flex h-14 w-full items-center justify-center rounded-xl bg-ink-800 px-8 text-lg font-semibold text-ink-100 active:bg-ink-700 tall:h-16 kiosk:text-xl lg:flex-1'
      }
      style={{ touchAction: 'manipulation' }}
    >
      <span className="relative flex items-center justify-center">
        <span className={widening ? 'invisible' : undefined}>{(label ?? t('searchEveryone'))}</span>
        {widening && (
          <span
            className={`absolute block animate-spin rounded-full border-2 border-ink-600 border-t-ink-100 ${
              quiet ? 'h-5 w-5' : 'h-6 w-6'
            }`}
          />
        )}
      </span>
    </button>
  );
}

/**
 * The header, memoized out of the keystroke.
 *
 * Everything up here answers *where and when* — the gathering's name wearing
 * its mark, the hours under it, the printer's amber dot — and none of it
 * depends on what has been typed. It re-rendered per letter anyway, because
 * the screen it sits on does; on a Raspberry-Pi-class throttle the render
 * counts said so and the profile priced it. The second line arrives as a
 * finished string and the rest are primitives, so the memo compares values:
 * a minute crossing the opens-at boundary still repaints on the next render,
 * exactly as it did when this was inline.
 */
const SearchHeader = memo(function SearchHeader({
  iconPath,
  title,
  line,
  printerNeedsAttention,
  onPrinter,
}: {
  iconPath: string | null | undefined;
  title: string;
  /** The line under the title, already decided: the hours, opens-at, or closed. */
  line: string;
  printerNeedsAttention: boolean;
  /**
   * Open the printer screen. Reached only through the dot, so it is only ever
   * called on a kiosk whose printer is in trouble — and it has to be stable,
   * because this memo is what keeps the header out of every keystroke.
   */
  onPrinter: () => void;
}) {
  /*
   * The hours line's photograph step (ink-500 → ink-300 while the picture is
   * up) arrives as CSS through the root's `kiosk-photo-idle` class rather
   * than as a prop, so this memo's identity survives every keystroke — and
   * so the step follows the picture being *visible*, not merely mounted: at
   * ink-300 on a photo-less typed screen the time range outshone the grade
   * labels beside the names. The photo-less kiosk keeps its shipped ink-500
   * exactly.
   */
  tallyRender('SearchHeader');
  const t = useTranslations('Search');
  const tap = useTap();
  return (
    /* The staff gate used to be an invisible square over this corner; it is a
       hold on **Clear** now — see `onStaffGate`. */
    <div className="relative px-6 pt-[max(1rem,var(--spacing-safe-top))] pb-2 text-center">
      {/*
        * The printer, when it has stopped working.
        *
        * A dot, absolutely positioned, and only ever in the corner: a parent
        * cannot fix a printer and telling them about it beside a green tick
        * reads as "your check-in failed". Absolute because this file promises
        * that a keystroke changes text and never geometry, and a warning that
        * appears mid-evening must not push the results down by a line.
        *
        * It is also the way in. The dot is the only thing on the kiosk that
        * knows the printer has stopped, and until now a volunteer who saw it
        * had to hold **Clear** for two seconds and then find **Label printer**
        * behind the gate — three deliberate acts to answer a question the
        * corner of the screen had already asked. Tapping it opens the printer
        * screen, and **Done** there comes straight back here rather than
        * leaving somebody on a staff screen they never asked for.
        *
        * The dot stays 12px because it is the same warning it was; the button
        * around it is 44 and reaches the corner, so the target is a thumb's
        * worth of glass while the mark on it is still a mark. Geometry is
        * unchanged either way — it is absolute, and the button is drawn
        * concentric with the dot it replaced.
        */}
      {printerNeedsAttention && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={t('printerNeedsAttention')}
          {...tap(() => {
            // The quiet buzz the standing chips wear, not the door's: this is a
            // mark in a corner, and it answers like one.
            haptic(8);
            onPrinter();
          })}
          className="absolute top-[calc(max(1rem,var(--spacing-safe-top))-1rem)] right-0 flex h-11 w-11 items-center justify-center rounded-full active:bg-ink-800"
          style={{ touchAction: 'manipulation' }}
        >
          <span className="block h-3 w-3 rounded-full bg-warn-500" />
        </button>
      )}
      {/*
        * The header answers *where and when*, and nothing else.
        *
        * It used to answer "what do I do" as well — "Welcome! Check in
        * below." — which put the one instruction a parent needs in the
        * smallest type on the screen, four hundred pixels above the keys, in
        * a line they read after the title and forget before the keyboard.
        * That sentence has moved into the body, where a parent's eye
        * actually goes and where the results will replace it (see the idle
        * panel below).
        *
        * What is left is identity. A parent walking up wants to know they
        * are at the right screen for the right evening — a church can run
        * two gatherings in two rooms on one night — so the title carries
        * real weight, and the window under it is the fact that settles it.
        * Not a display size: the loudest thing on this screen has to stay
        * what the parent is doing, not the label on the room they are
        * standing in.
        */}
      {/*
        * The gathering's own mark, set in its name rather than beside it.
        *
        * Inside the title's own line, which is the whole of what keeps this
        * header the header that shipped: cap-height and in `em`, so it adds
        * no line and no pixel of height — and the landscape kiosk pays for
        * header height out of a results track already under three hundred
        * pixels. It also cannot pull the title off the centre the hours line
        * and everything below it share, because it is *in* the line being
        * centred rather than a sibling of it. See EventName, which was a
        * tile beside the title for exactly one round of critique — and hung
        * this mark in the margin for one round after that, until the room a
        * hung mark needs turned out to cost the longest gathering names a
        * line of the title.
        *
        * `text-balance` is here because the mark is: one character of measure
        * lands entirely on the wrap decision, and on the portrait kiosk it
        * was enough to buy a second line and orphan one word on it. Balanced,
        * the break comes off the whole string, and a long name breaks the
        * same way whether or not the gathering wears a mark — which is also
        * what the registration flow's header has always done.
        */}
      <div className="text-2xl font-semibold text-balance text-ink-100 kiosk:text-3xl">
        <EventName path={iconPath} title={title} />
      </div>
      <div className="kiosk-hours-line text-base text-ink-500 kiosk:text-lg">
        {line}
      </div>
    </div>
  );
});

/**
 * The console row — the standing offers — memoized out of the keystroke.
 *
 * The row's whole design is that a keystroke never moves it, and it turns out
 * a keystroke never *changes* it either: what it renders hangs off whether the
 * search found anybody, not off what was typed. So its props are three
 * booleans, a sentence, and two handlers the parent hands over behind stable
 * identities (see the trampolines in SearchScreen), and typing leaves the
 * whole subtree alone. It still re-renders at the moments it exists to mark —
 * the first letter that finds somebody, the search that empties — which is a
 * handful of times per family rather than once per letter.
 */
const SearchConsole = memo(function SearchConsole({
  offeredAbove,
  canWiden,
  widening,
  hasResults,
  onWiden,
  onRegister,
  offerWords,
  offerSecond,
}: {
  offeredAbove: boolean;
  canWiden: boolean;
  widening: boolean;
  /**
   * The offer's two sentences for a language the catalogue does not carry
   * yet — the prototype's stand-in for `es.json`, so that the frames of the
   * day it lands show the console row as that day will have it. Absent, the
   * catalogue's own.
   */
  offerWords?: { firstTime: string; notYours: string; widen: string };
  /**
   * A second line on the register door, in a pinned language the kiosk
   * cannot speak yet: the first-time family's own door, which at rest was
   * the one thing on the glass they could not read (round 9).
   */
  offerSecond?: { firstTime: string; notYours: string };
  /**
   * Whether a search found anybody, which is what the offer's wording turns on.
   *
   * The boolean rather than the finished sentence, now the sentence comes out
   * of the catalogue: a `t` call inside a memoized component is as stable as a
   * string prop, and passing the words in would have the parent build them
   * twice for the two widths below.
   */
  hasResults: boolean;
  onWiden: () => void;
  onRegister: () => void;
}) {
  tallyRender('SearchConsole');
  const t = useTranslations('Search');
  const tap = useTap();

  return (
    /* `overflow-hidden` is load-bearing, not tidiness: two nowrap labels
        side by side have a min-content width, and a grid track will widen
        past the screen to honour it rather than let them shrink — which took
        the header, the results and the keyboard sideways with it on a narrow
        phone. Hidden overflow lets the track fall back to zero, so a screen
        too narrow for both labels crops them instead of scrolling the whole
        kiosk. */
    /*
      * The exit sits on the left, and the gap between the two is wider than
      * the gap between two name rows.
      *
      * These are not a matched pair. **Search everyone** is a retry: press it
      * by accident and the search runs wider, which is a second of waiting.
      * **Register your child** is an exit, and completed it makes a duplicate
      * of a child the church already has, for the review queue to judge. They
      * used to sit six pixels apart — less than the space between two rows on
      * the same screen — with the exit the wider of the two and on the right,
      * which on a phone held one-handed is exactly where a thumb travels.
      * The air comes out of the row's own side margins, which were doing
      * nothing.
      */
    /* `pt-2` is the console's interior. The rule and this row's first
            pixel were two apart while every other gap inside the console was
            40 or more, so the edge separated without containing — it read as
            the button's own top border run out to the screen. */
    <div className="mx-auto flex h-14 w-full max-w-2xl flex-row-reverse items-center justify-center gap-4 overflow-hidden px-2 pt-2 tall:h-20 tall:gap-6 lg:max-w-5xl">
      {/*
        * The way out of the scope, standing beside the way out of the search.
        *
        * It used to live only on the no-match panel, which meant it appeared
        * for exactly the family who did not need it and was missing for the
        * one who did. A scoped search that returns *somebody* — the other
        * Noah, the Ramirez who is not theirs — is the commonest way a parent
        * is shown confident, wrong rows, and until now the only door open to
        * them was the one that registers a child the church already has.
        *
        * Hidden only while the no-match panel is up, because that panel is
        * showing this same control in its primary weight a hand's width
        * higher: the standing pair steps aside rather than appearing twice.
        */}
      {!offeredAbove && canWiden && (
        <WidenButton widening={widening} onWiden={onWiden} quiet label={offerWords?.widen} />
      )}
      {!offeredAbove && (
        <button
          type="button"
          tabIndex={-1}
          {...tap(() => {
            haptic(8);
            onRegister();
          })}
          /* The `tall:` step every other control got. Quiet in weight — a
             tinted chip beside a keyboard — is a different lever from quiet
             in legibility, and on a portrait tablet this was simultaneously
             the only accented object on the glass and the smallest type on
             it, read at arm's length. */
          /* `kiosk-chip-ground` is the shipped brand tint over a page-token
             underlay (index.css): identical to the old bg-brand-600/15 over a
             bare page, and what keeps this text readable when the gathering's
             photograph is bright behind it. Its :active lives in the class,
             because a plain class here would outrank the utility. */
          className="kiosk-chip-ground flex h-11 min-w-0 shrink items-center justify-center truncate rounded-xl px-3 text-sm font-semibold whitespace-nowrap text-brand-300 ring-1 ring-brand-500/40 tall:h-14 tall:px-5 kiosk:text-base"
        >
          {/*
            * The question goes first and, on a narrow screen standing beside
            * **Search everyone**, goes away.
            *
            * Both controls and the question do not fit across a phone held
            * upright: what they did instead was wrap the button onto three
            * lines, which overran this row's fixed height and painted over
            * the last row of the results. Dropping the question there rather
            * than truncating the label keeps the half that says what the
            * button does — and it is only ever dropped where the other
            * button is crowding it, so the wider screens, where the pair fits
            * with room to spare, still get the sentence.
            *
            * On width, never on state: this row's height is fixed and its
            * contents must not reflow because a keystroke found somebody.
            */}
          {canWiden ? (
            <>
              <span className="sm:hidden">{t('offerShort')}</span>
              <span className="hidden flex-col items-center leading-tight sm:flex">
                <span>{hasResults ? (offerWords?.notYours ?? t('offerNotYours')) : (offerWords?.firstTime ?? t('offerFirstTime'))}</span>
                {offerSecond && (
                  <span className="text-xs font-medium opacity-80 kiosk:text-sm">
                    {hasResults ? offerSecond.notYours : offerSecond.firstTime}
                  </span>
                )}
              </span>
            </>
          ) : (
            <span className="flex flex-col items-center leading-tight">
              <span>{hasResults ? (offerWords?.notYours ?? t('offerNotYours')) : (offerWords?.firstTime ?? t('offerFirstTime'))}</span>
              {offerSecond && (
                <span className="text-xs font-medium opacity-80 kiosk:text-sm">
                  {hasResults ? offerSecond.notYours : offerSecond.firstTime}
                </span>
              )}
            </span>
          )}
        </button>
      )}
    </div>
  );
});

/**
 * One result row, memoized on the child it names.
 *
 * A keystroke that narrows a search usually keeps its best matches: typing the
 * next letter of a name re-ranks the same handful of children more often than
 * it replaces them. The students themselves are stable objects — the roster
 * array is replaced wholesale, its rows are not — and `rowTap` is the guard
 * hook's stable factory, so a row whose child and register state are unchanged
 * is skipped entirely. The rows that do change are the ones the parent is
 * watching change, which is the one part of a keystroke's work that cannot be
 * declined.
 */
const ResultRow = memo(function ResultRow({
  student,
  present,
  checkedOut,
  tracksCheckOut,
  rowTap,
}: {
  student: KioskStudent;
  present: boolean;
  /** Present, and handed back — only ever true where check-out is tracked. */
  checkedOut: boolean;
  tracksCheckOut: boolean;
  rowTap: (student: KioskStudent) => TapHandlers;
}) {
  const grades = useGrades();
  tallyRender('ResultRow');
  const t = useTranslations('Search');
  const inert = present && !tracksCheckOut;
  return (
    <button
      type="button"
      tabIndex={-1}
      {...rowTap(student)}
      /*
       * `ink-800`, not `ink-900`: a row is a button and has to look
       * like one in a dim lobby. Against `ink-950` a 900 card is
       * 1.24:1 — not a shape, just a bright name floating in the
       * dark — and the only object on the screen that unmistakably
       * read as pressable was the register offer, which is the wrong
       * door. It is the same fill the quiet **Search everyone**
       * carries, so nothing new enters the palette.
       */
      /* `lg:w-full` is not decoration. Multi-column flow drops these out of
         the flex column that was stretching them, and a `button` in
         normal flow is shrink-to-fit — so every card became as wide as
         its own name, the grade stopped being a right-hand column, and
         checking a child in *resized their row*, which is the one thing
         this list promises never to do. */
      className={`flex h-16 w-full shrink-0 items-center justify-between rounded-xl px-5 text-left tall:h-20 lg:break-inside-avoid lg:not-first:mt-2 ${
        checkedOut
          ? 'bg-ink-800/50 opacity-60'
          : present
            ? 'bg-present-600/20'
            : 'bg-ink-800 active:bg-ink-600'
      } ${inert || checkedOut ? '' : 'active:bg-ink-600'}`}
    >
      <span className="truncate text-xl font-semibold text-ink-100 kiosk:text-2xl">
        {student.firstName} {student.lastName}
      </span>
      <span className="pl-3 text-base whitespace-nowrap text-ink-400 kiosk:text-lg">
        {checkedOut ? (
          <span className="font-semibold text-ink-400">{t('checkedOut')}</span>
        ) : present && tracksCheckOut ? (
          <span className="font-semibold text-brand-300">{t('tapToCheckOut')}</span>
        ) : present ? (
          <span className="font-semibold text-present-400">{t('checkedIn')}</span>
        ) : (
          gradeLabel(grades, student.grade)
        )}
      </span>
    </button>
  );
});

export function SearchScreenVariant({
  variant,
  initialChosen = null,
  pins = DEFAULT_PINS,
  speaks = DEFAULT_SPEAKS,
  phase,
  binding,
  buffer,
  onKey,
  outcome,
  presentIds,
  checkedOutIds,
  tracksCheckOut,
  printerNeedsAttention,
  onPrinter,
  backdrop,
  refresh,
  widening,
  onWiden,
  onPick,
  onRegister,
  onStaffGate,
}: {
  /** Which candidate to draw — a key of `VARIANTS`. */
  variant: string;
  /** The harness's `?chosen=`: photograph the screen after a family has chosen this language. */
  initialChosen?: Lang | null;
  /**
   * The languages this lobby speaks at rest beside English — a per-kiosk
   * setting made at pairing (the round-5 staff condition), `?pins=` in the
   * harness. What a candidate does with the list is the candidate.
   */
  pins?: Lang[];
  /** The languages the kiosk has a catalogue for; `?speaks=` adds one it will have. */
  speaks?: readonly Lang[];
  /** The harness's `?phase=`: pin a cycling greeting to one of its moments. */
  phase?: number;
  binding: KioskBinding;
  buffer: string;
  onKey: (key: KioskKey) => void;
  /** The search, already run — over the scoped pool, or everybody once widened. */
  outcome: KioskSearchOutcome;
  presentIds: ReadonlySet<string>;
  checkedOutIds: ReadonlySet<string>;
  tracksCheckOut: boolean;
  printerNeedsAttention: boolean;
  /** What the dot opens — the printer screen. See SearchHeader. */
  onPrinter: () => void;
  /** The gathering's photograph is mounted behind this screen. See SearchHeader. */
  backdrop: boolean;
  /**
   * How the silent church-wide sweep behind an empty result is doing. No
   * button drives it any more; what remains on screen is its headline ("Still
   * no match" once it has landed) and its failure line.
   */
  refresh: KioskRefresh;
  /**
   * Whether the **Search everyone** press is still working. It is the button's
   * only feedback, so it is the button's face while it is true.
   */
  widening: boolean;
  /**
   * Widens this one search to all of Tally *and* re-reads the church. Both
   * halves are wanted: the first finds a child who belongs to another
   * gathering, the second finds one who was added since this kiosk last
   * looked. Resets when the buffer clears.
   */
  onWiden: () => void;
  onPick: (student: KioskStudent) => void;
  /** Opens the registration offer — the other door off this screen. */
  onRegister: () => void;
  /**
   * The staff gate fired — **Clear**, held for two seconds.
   *
   * Named for the gesture rather than for unbinding, because this screen no
   * longer decides what it means: it opens a prompt, and the prompt is what
   * leaves the gathering. A screen that unbound on a hold could not ask first.
   */
  onStaffGate: () => void;
}) {
  tallyRender('SearchScreen');
  const t = useTranslations('Search');
  const tDoor = useTranslations('Door');
  /*
   * Which language a family has chosen this visit, or null — its own fact,
   * not inferred from the locale, which for Spanish cannot hold it (see
   * `Lang`). Inferred (`locale !== RESTING`) the English
   * door was a no-op: pressing it set the locale it already had and changed
   * not one pixel, which is the round-1 grandmother failure handed to the
   * English parent, who is most of the queue. In the app this flag lives in
   * `KioskApp` beside the locale and clears with it on `cameHome` — but it
   * needs its own arming of the idle clock: the `LANGUAGE_RESET_MS` effect
   * returns early while `locale === RESTING_LOCALE`, so a family who took
   * the English door and walked off would never be reset by it and the next
   * family would meet the chosen screen, not the three welcomes. Arm the
   * timer whenever `chosen` is true, whatever the locale; clear both
   * together.
   */
  const [chosen, setChosen] = useState<Lang | null>(initialChosen);
  /* The first pinned language the kiosk cannot speak yet — the sign's
     second language, whose words ride along on the register door at rest. */
  const unspoken = pins.find((candidate) => candidate !== RESTING && !speaks.includes(candidate));
  const { setLocale } = useLocaleControl();
  const onChoose = useCallback(
    (candidate: Lang) => {
      if (isLocale(candidate)) setLocale(candidate);
      setChosen(candidate);
    },
    [setLocale],
  );
  // The kiosk's language, which the hours and the opens-at line are formatted
  // against — `Intl` would otherwise answer with the tablet's. See binding.ts.
  const locale = useLocale();
  const dayAtTime = useCallback(
    (values: { day: string; time: string }) => tDoor('dayAtTime', values),
    [tDoor],
  );
  const now = Date.now();
  const closed = windowHasClosed(binding, now);
  /*
   * Bound, but not yet taking arrivals.
   *
   * Said in the header rather than left to the refusal a tap would meet,
   * because the person who can act on it is a volunteer walking past — the
   * parent this line is under cannot rebind a tablet. See `windowHasOpened`.
   */
  const notOpenYet = !windowHasOpened(binding, now);

  /*
   * The gathering's hours, worked out once per gathering rather than once per
   * keystroke.
   *
   * This screen re-renders on every letter typed, and `eventWindow` formats two
   * times through `Intl` — a string that cannot change until the kiosk is bound
   * to something else. It was among the ten most expensive functions on the
   * lobby screen; on a Raspberry Pi it was seven milliseconds of every letter.
   * See docs/kiosk-performance.md.
   */
  const hours = useMemo(() => eventWindow(locale, binding), [locale, binding]);

  /*
   * The header's second line, finished here so the header can be memoized on
   * values. The compares behind it are two number comparisons per render;
   * `opensAtLabel` formats through `Intl` only on the rare screen that is
   * bound before its gathering opens. The header itself re-renders only when
   * one of these strings actually changes — see SearchHeader.
   */
  const headerLine = notOpenYet
    ? t('opensWhen', { when: opensAtLabel(locale, dayAtTime, binding, now) })
    : closed
      ? t('windowClosed')
      : hours;

  /*
   * The no-match panel is showing this same offer, in the same words, as its
   * primary button — so the standing one steps aside rather than appearing
   * twice on one screen a hand's width apart.
   *
   * Its *row* stays, empty. This file promises that a keystroke changes text
   * and never geometry, and a row that vanished the moment a search matched
   * nobody would move the keyboard under a thumb already on its way down.
   */
  const offeredAbove =
    (outcome.mode === 'phone' || outcome.mode === 'name') && outcome.results.length === 0;

  /*
   * Whether there is a search here to widen at all.
   *
   * Rows on screen means a finished search that found somebody, which is
   * exactly the state the standing button exists for. An empty buffer has
   * nothing to widen, and a half-typed number is not a question yet — the same
   * reason that state gets none of the other doors either.
   */
  const canWiden = outcome.results.length > 0;

  /*
   * A match is not proof, and this is the sentence that says so.
   *
   * Four digits are a weak credential and a small keyspace: a family nobody has
   * met can type theirs and be shown somebody else's children, sorted, spelled
   * correctly, and looking exactly like the answer. A name search is looser
   * still. Nothing on the screen distinguishes that from a hit, so the door out
   * has to be open while the rows are up — not only after a search fails, which
   * is the one state a coincidence guarantees will never happen.
   *
   * Only the words change, never the geometry. "First time here?" beside a list
   * of strangers asks the wrong question: the parent is not wondering whether
   * they are new, they are wondering what to do about a Ramirez who is not
   * theirs. And it stays the quiet weight, because most matches are real and a
   * screen that doubted itself loudly would make a correct answer feel wrong.
   */
  const hasResults = outcome.results.length > 0;

  /*
   * A row commits on lift, not on contact, because this list scrolls — see
   * components/tapGuard.ts for why that has to be, and what counts as a tap.
   */
  const rowTap = useTapGuard(onPick);
  const tap = useTap();

  /*
   * The latest handlers behind stable identities — the same trick the keyboard
   * plays with `onKey`, for the same reason. `onWiden` is rebuilt by the app on
   * every keystroke (its closure reads the buffer), and a memoized console
   * whose props change per letter is a memo in name only. The refs carry the
   * freshest closure; the identities the console compares never change.
   */
  const widenRef = useRef(onWiden);
  widenRef.current = onWiden;
  const registerRef = useRef(onRegister);
  registerRef.current = onRegister;
  const steadyWiden = useCallback(() => widenRef.current(), []);
  const steadyRegister = useCallback(() => registerRef.current(), []);

  /*
   * Whether this state has rows in it, which decides where its content sits in
   * the track.
   *
   * A list is top-anchored and has to be: a parent typing one more letter must
   * not have Ramona Alvarez slide down under the thumb already moving toward
   * her. The row-less states have no such promise to keep — nothing in an idle
   * prompt or a no-match panel survives the next keystroke — so they hang from
   * the bottom of the track instead, near the hand.
   *
   * That matters most where it is least obvious. The no-match panel is the one
   * state on this screen where a parent has to decide and press something, and
   * top-anchored on a phone its two buttons sat in the upper third with a
   * hundred and eighty pixels of nothing beneath them.
   */
  const rowless = outcome.results.length === 0;
  /** A finished search that matched nobody — the state with two doors in it. */
  const nobody = (outcome.mode === 'phone' || outcome.mode === 'name') && rowless;

  /*
   * Where a row-less state sits in the track.
   *
   * Sinking all of them put the idle prompt hard against the console on a
   * portrait tablet with the whole void above it, so the emptiness swapped ends
   * the instant somebody typed — the geometry did not move, but the composition
   * did. The idle prompt is text with nothing in it to press, so it takes the
   * middle and the void splits either side of it.
   *
   * The states that ask for a press do not take the middle. No match, and the
   * four-digit prompt that is one keystroke away from becoming one, hang from
   * the bottom where the hand is. That is the whole distinction: a decision a
   * parent has to reach for belongs near the keys; a sentence they only read
   * does not.
   *
   * And all of it is a short-track behaviour, which is what `tall:` undoes.
   * Moving a block toward the hand is worth a few dozen pixels on a phone,
   * where the track is about three hundred tall and the whole screen is within
   * a thumb's sweep. On a tablet stood on end the same rule moves it six
   * hundred, so a parent reads the instruction at the bottom of the glass,
   * types two letters, and the answer appears at the top — the geometry never
   * moved, but everything they were looking at did. Up there the block stays
   * where the rows will be.
   */
  /*
   * What the search found, and whether the list is all of it.
   *
   * `outcome.total` is the count before `MAX_RESULTS` cut the array — the
   * screen used to read the sliced length, so a search matching twenty-three
   * said "8 names", which is a complete-looking number for an incomplete list.
   * At that point a parent has scrolled everything on offer, found nobody
   * theirs, and the doors left to them include the one that makes a duplicate.
   */
  const matchCount = outcome.total ?? outcome.results.length;
  const truncated = matchCount > outcome.results.length;
  /*
   * Whether the landscape kiosk splits the list in two.
   *
   * Not simply "are there rows". A two-column frame with one name in it puts a
   * half-width card against the left margin with the whole right half of the
   * page empty beside it — and strands the count, which hangs off the rows'
   * right edge and would be pointing at an edge no row is flush to. That is the
   * state a parent most wants to reach: enough letters typed, one child left.
   * Four is where both columns have something in them.
   */
  const wraps = outcome.results.length >= 4;

  /*
   * The no-match panel spans the region rather than sitting in it: its heading
   * is pinned to the top and its doors to the bottom, so the column has to fill
   * the track for either end to mean anything.
   *
   * Everything else is top-anchored, at every shape. The idle prompt used to
   * centre itself on short screens to sit nearer the hand, which made one
   * component behave as two: on a phone the first keystroke jumped the reading
   * position a row and a half, because the prompt was not where the rows were
   * going to be. Nothing in that block is pressable, so the reach it was
   * buying was worth nothing, and the rule it was breaking — idle and typed
   * share a top edge — is worth keeping.
   */
  const station = nobody ? 'min-h-full' : '';
  const rows = outcome.results.length > 0;

  /*
   * Every keystroke starts the list again from the top. Without this, a parent
   * who scrolled down a broad match and then typed one more letter would be
   * looking at the bottom of a list short enough to have no bottom — an empty
   * box, under a buffer that says their name is being searched for.
   *
   * Behind a flag, and the flag is the finding. Writing `scrollTop` makes the
   * engine bring layout up to date first — the write has to clamp against the
   * scrollable extent — and this effect runs off a keystroke that has just
   * dirtied that layout, so the reset was a forced synchronous reflow inside
   * every letter typed. The profiler priced it at more per keystroke than the
   * search itself, at every throttle (see docs/kiosk-performance.md). Almost
   * nobody scrolls mid-word, so the write now happens only when there is a
   * scroll to undo: the listener is one ref write on an event that fires only
   * while somebody is actually dragging the list.
   */
  const resultsRef = useRef<HTMLDivElement>(null);
  const scrolledRef = useRef(false);
  const onResultsScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    // The programmatic reset below lands here too, with scrollTop back at 0 —
    // one handler keeps the flag honest in both directions.
    scrolledRef.current = event.currentTarget.scrollTop > 0;
  }, []);
  useEffect(() => {
    if (!scrolledRef.current) return;
    const region = resultsRef.current;
    if (region) {
      region.scrollTop = 0;
      scrolledRef.current = false;
    }
  }, [buffer]);

  return (
    /*
     * `kiosk-has-backdrop` rides the root exactly while the photograph is
     * mounted: it is what turns the keys to glass and fades the console
     * rule's ends (index.css). A class on the root rather than props into
     * the keyboard, so the memoized subtrees stay memoized and the wizard's
     * keyboard — which never has a photograph — stays untouched.
     */
    /*
     * `grid-cols-[minmax(0,1fr)]` is the width of the glass, stated.
     *
     * An implicit grid column is `auto`, and an auto track is never narrower
     * than the widest thing in it: each item's minimum is its min-content
     * size unless the item is itself a scroll container. Two items here can
     * ask for more than the screen. A name row's `truncate` clips the name
     * but does not shrink its minimum — nowrap text is as wide as itself —
     * and the results region is a plain block around the scroller, so a
     * child named to the register's forty-character limits (a family typed
     * a sentence where a first name goes) put the region's minimum at the
     * column cap plus its gutters: 720px. The readout is the same shape
     * with the typed buffer in it. On any glass under 720px the track grew
     * to that, and *every* row in this grid is laid out on that one track:
     * the header centred off-screen, the count lost its last letter, and
     * the keyboard's right-hand keys went past the bezel — while the row
     * that caused it looked perfectly truncated. `minmax(0, 1fr)` takes
     * the content-based minimum away, so the column is the container and a
     * name that is too long overflows the box that owns it, which is the
     * one with `truncate` on it. Not `min-w-0` on the two items, because the
     * next item added would have to remember it; the rule belongs to the
     * track.
     */
    <div
      className={`grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr_auto_auto_auto_auto] ${
        backdrop ? 'kiosk-has-backdrop' : ''
      } ${backdrop && buffer === '' ? 'kiosk-photo-idle' : ''}`}
    >
      {/* Everything above the results, memoized so a keystroke leaves it
          alone — the header's own reasoning lives on SearchHeader. */}
      <SearchHeader
        iconPath={binding.iconPath}
        title={binding.title}
        line={headerLine}
        printerNeedsAttention={printerNeedsAttention}
        onPrinter={onPrinter}
      />

      {/*
        * Results — fixed-height rows in a fixed region that scrolls past them.
        *
        * Two things stop a clipped row from bleeding into the console below
        * it. The margin is a dead gutter rather than padding, because padding
        * *inside* a scroll container is scrolled through: at rest the last row
        * was cut flush against buttons nine pixels below it, and nine pixels
        * is what separates two name rows — so the boundary between "more
        * names" and "doors out of the search" was signalled by one pixel.
        *
        * The mask is the other half, and it is the half that matters. A gutter
        * separates the *clip line* from the buttons, but a thumb aims at the
        * letters, and on a clipped row the letters are flush with the clip.
        * Fading the last few pixels of the region leaves a strip of card with
        * no ink in it: a peek that says there is more below without offering
        * anything to press. Written twice because the kiosk runs on whatever
        * tablet the church owns and WebKit still wants the prefix.
        */}
      {/* The ramp is a painted overlay rather than a mask on the scroller —
          same pixels over a solid ground, without the per-keystroke cost of
          rastering the whole region through a mask on the hardware this
          targets. See `.kiosk-list-fade-overlay` in index.css. The wrapper
          carries the grid track's min-height and the gutter; the scroller
          fills it. */}
      <div className="relative mb-4 min-h-0">
      <div
        ref={resultsRef}
        onScroll={onResultsScroll}
        className="flex h-full flex-col overflow-y-auto overscroll-contain scroll-touch px-6"
        style={{ touchAction: 'pan-y' }}
      >
        {/* The bottom padding rides on the column, not the scroller: end
            padding on a scroll container is not reliably scrollable to.
            `mt-auto` sinks the row-less states toward the hand and collapses
            to nothing the moment the content is taller than the box. */}
        {/*
          * Two columns on a landscape kiosk, one everywhere else.
          *
          * A 1280×800 tablet is the worst of the three shapes for the only
          * thing this screen does. The fixed chrome — header, offer row,
          * readout, keyboard — leaves the track under three hundred pixels, so
          * it showed three matches out of a possible eight, against four on a
          * phone and all eight on the same tablet stood on end. None of that
          * height is recoverable: the keys and the rows are already at the
          * sizes a standing adult needs.
          *
          * The axis nobody was using is the one that is free. The rows sat in a
          * capped column with three hundred pixels of dead page on either side.
          * `columns` rather than a grid because CSS multi-column fills
          * column-major — down the first, then the second — so an A–Z list
          * still reads downward, which a two-column grid would have broken by
          * laying it out in rows.
          *
          * Above `lg` only, which the phone never reaches and the portrait
          * kiosk (800px wide) does not either. Row height, row fill and the
          * promise that a tap never moves a row are all untouched; only the
          * wrap changes.
          */}
        <div
          className={`mx-auto w-full max-w-2xl ${station} ${
            /* A candidate idle panel gets the landscape measure the wrapped
               list gets: three doors across 672px are three narrow columns. */
            outcome.mode === 'idle' && VARIANTS[variant]?.Idle ? 'lg:max-w-5xl' : ''
          } ${
            rowless ? 'pb-6' : truncated ? 'pb-2' : ''
          } ${
            /*
             * The ramp's own depth, so the last row clears it at maximum
             * scroll.
             *
             * This clearance used to ride on the truncation sentence, which
             * only renders when the search matched more than the list can show
             * — so a list that overflows the region without being capped (five
             * or six matches on a phone, which is what a common surname
             * prefix produces) had none of it. A parent did exactly what the
             * readout asked: the count said five names, they could see four,
             * they swiped. The list stopped moving and the fifth name was a
             * ghost, with nowhere further to scroll and no state of the screen
             * in which it became readable.
             *
             * Where the sentence does render it carries its own copy of this,
             * because it is a sibling below this column rather than inside it.
             */
            rows && !truncated ? 'pb-16 tall:pb-20' : ''
          } flex flex-col gap-2 ${
            wraps ? 'lg:block lg:columns-2 lg:gap-x-8 lg:max-w-5xl' : ''
          }`}
        >
          {/*
            * The screen a parent actually walks up to.
            *
            * The instruction lives here — at the top of the region the results
            * will fill — rather than in the readout above the keys, and both
            * critics of this screen arrived at that from opposite directions.
            * A parent reads top-down: they used to cross four hundred pixels
            * of nothing and meet **Register your child** as the first lit
            * object on the glass, which is the door for the minority and the
            * one that makes a duplicate of a child the church already has.
            * The instruction for everybody else was below it, and dimmer.
            *
            * And it gives the empty screen an edge. That gap was not
            * whitespace, it was whatever the flexible track had left over, so
            * the idle screen was a title stranded above a cluster sunk to the
            * bottom with nothing saying the two were one screen. Now idle and
            * typed share a top edge: what a keystroke does is replace this
            * with rows, in the place the rows were always going to be.
            *
            * Inside the scrolling region on purpose — the one part of this
            * layout allowed to change with what has been typed. The keyboard
            * cannot move.
            */}
          {outcome.mode === 'idle' && VARIANTS[variant]?.Idle && (
            <VariantIdle
              variant={variant}
              backdrop={backdrop}
              onRegister={steadyRegister}
              chosen={chosen}
              onChoose={onChoose}
              pins={pins}
              speaks={speaks}
              phase={phase}
            />
          )}
          {outcome.mode === 'idle' && !VARIANTS[variant]?.Idle && (
            <div className="flex flex-col items-center pt-6 text-center">
              {/*
                * The words, on the veil's own ground.
                *
                * On portrait shapes the photograph's canopy — the veil's head
                * grade, extended to hold the console and these lines as one
                * mass — is the instruction's whole contrast, so the plate and
                * halo below paint nothing there; they are the landscape
                * shelf's card, where the photograph frames it on every side
                * (numbers and reasoning on `.kiosk-backdrop-veil` and
                * `.kiosk-idle-plate` in index.css). The ground lives in the
                * backdrop layer rather than here on purpose: it fades with
                * the image, so no keystroke can catch the title over an
                * unveiled photograph. Paint only: negative insets, so the
                * three lines keep their exact shipped positions — and pure
                * page token, so a kiosk with no photograph composites all of
                * it back to the bare page. `isolate` keeps the negative
                * z-indices inside this block rather than racing the backdrop
                * layer for the same layer order.
                */}
              <div className="relative isolate flex flex-col items-center">
                <div aria-hidden="true" className="kiosk-idle-halo absolute -inset-x-24 -inset-y-14 -z-20" />
                <div aria-hidden="true" className="kiosk-idle-plate absolute -inset-x-10 -inset-y-7 -z-10 rounded-2xl" />
              {/* Two voices, not three. The instruction and its alternative are
                  one unit, set tight; what happens next is separated by air
                  rather than by a third size, which at a 2px step read as one
                  paragraph fading out. */}
              <div className="text-4xl font-semibold text-ink-100 kiosk:text-5xl">
                {t('typeAName')}
              </div>
              <div className={`pt-1 text-lg kiosk:text-xl ${backdrop ? 'text-ink-300' : 'text-ink-400'}`}>{t('orLastFour')}</div>
              {/*
                * What happens next, said before it has to be guessed.
                *
                * A name row is a button and does not look like one — no ring,
                * no chevron, a card a fraction off the page it sits on — and
                * the only unmistakably pressable thing on the screen is the
                * register offer. A parent who finds their child and then hunts
                * for the button to press is a parent one tap from the wrong
                * door. This is the sentence that stops that, and it is free
                * here: the space is empty and the eye is already on it.
                */}
              {/*
                * One sentence, in both modes.
                *
                * It carried "…to check in or check out" at a pickup gathering,
                * which said the mode twice on one screen — the header had it
                * too — and wrapped this line onto two, ending in a one-word
                * orphan. Neither copy was where the answer actually is: the
                * row itself says "Tap to check out", "✓ Checked in" or a dimmed
                * "Checked out", and that is a thing a parent acts on rather than
                * files.
                *
                * `ink-400`, the same step as the line above it. At `ink-500`
                * the one sentence that tells a parent a name row is pressable
                * was the dimmest text on the glass — below AA on a
                * fingerprinted lobby screen — and skipping it is exactly what
                * sends somebody hunting for a button and finding the register
                * offer.
                */}
              <div
                className={`pt-4 text-lg kiosk:text-xl ${backdrop ? 'text-ink-300' : 'text-ink-400'}`}
              >
                {t('thenTapName')}
              </div>
              </div>
            </div>
          )}
          {outcome.mode === 'phone-partial' && (
            <div className="pt-6 text-center text-lg text-ink-400">
              {t('enterAllFour')}
            </div>
          )}
          {nobody && VARIANTS[variant]?.NoMatch && (
            <VariantNoMatch
              variant={variant}
              mode={outcome.mode}
              refresh={refresh}
              widening={widening}
              onWiden={steadyWiden}
              onRegister={steadyRegister}
              chosen={chosen}
              onChoose={onChoose}
              pins={pins}
              speaks={speaks}
            />
          )}
          {nobody && !VARIANTS[variant]?.NoMatch && (
            /*
             * Nothing matched, and the answer is three different doors.
             *
             * The commonest reason is being new, so the register door leads —
             * straight into the wizard now, one tap. The second is a child who
             * belongs to a *different* gathering — the search is scoped to the
             * children who have been to this one, and "Search everyone" is
             * that scope's honest way out. The third reason — somebody added
             * the family minutes ago, at the welcome desk or in the main app —
             * needs no door of its own: the pulse delivers additions within a
             * minute, and the church-wide sweep runs silently the moment a
             * finished search comes up empty. "Search everyone" is also how a
             * greeter asks for that read by hand, which is what its spinner is
             * spinning about; the sweep's other surfaces are the headline's
             * "Still" and the network-failure line below.
             *
             * Inside the scrolling results region on purpose: this file
             * promises that typing never moves the keyboard, and a block that
             * appeared the moment a name matched nobody would be the one thing
             * that did.
             */
            /* One width for the stacked pair. Auto-width buttons stacked and
               centred missed each other's edges by 11px a side, which nothing
               in the frame explained — because nothing did: it was the length
               of two labels. */
            /*
             * The heading sits where the rows were, because that is where a
             * parent is looking. The doors do not travel with it: they fall to
             * the foot of the region, a hand's width above the console, which
             * is where the standing pair lives in every other state.
             *
             * Without that split, the keystroke that turns one match into none
             * teleported "Search everyone" — the commonest correct move when a
             * scoped search misses a child who is in the directory but not this
             * gathering's pool — from just under the rule to the top third of
             * the screen, seven hundred pixels from the keys the parent was
             * pressing a moment ago.
             */
            <div className="mx-auto flex h-full w-full max-w-xs flex-col items-stretch gap-3 pt-6 text-center tall:max-w-md tall:justify-end tall:gap-4 lg:max-w-2xl">
              {/* The state's own sentence holds the top of the ramp. Set at the
                  bottom of it, the loudest thing in the frame was the query
                  that did not work, echoed in bold white above the keys, and
                  the fact explaining the empty screen read as fine print over
                  two buttons. One thing at the top of a ramp, and here it is
                  the outcome rather than the input. */}
              {/* Its own measure, wider than the doors under it, and balanced.
                  Inheriting the button column broke the sentence inside its own
                  phrase on a phone — "No match — first / time here?" — with the
                  em dash sitting right there unused. */}
              <div className="mx-auto max-w-sm text-center text-3xl font-semibold text-balance text-ink-100 tall:max-w-md kiosk:text-4xl">
                {refresh === 'done' ? (
                  <>
                    {/*
                      * The one word that carries the whole answer, and the one
                      * a parent watching their own finger did not see change.
                      * It brightens three times and stops: long enough to
                      * catch an eye coming back up from the button, short
                      * enough that a lobby screen is not blinking at anybody.
                      * The word is what changed, so the word is what moves —
                      * animating the sentence would say the sentence is new.
                      */}
                    {t.rich('stillNoMatch', {
                      pulse: (chunks) => (
                        <span className="animate-word-pulse text-ink-100">{chunks}</span>
                      ),
                    })}
                  </>
                ) : (
                  t('noMatch')
                )}
              </div>
              {/*
                * Stacked, until the screen is wide and short.
                *
                * On a 1280×800 kiosk the fixed chrome leaves this track 259px
                * and the stack needed about 300, so the closing line — "or see
                * a leader.", the door that costs the church nothing — was cut
                * through its x-height and faded out by the region's mask. A
                * parent deciding whether they have to create a record was
                * reading what looked like a broken screen. That shape has
                * width and no height, so the doors spend the axis it has.
                */}
              {/*
                * The doors hang from the foot of the region — except on a
                * screen stood on end, where the whole block travels down
                * together instead. Anchoring the two ends independently put a
                * third of a portrait tablet between a question and its own two
                * answers, so they stopped reading as one statement and started
                * reading as two blocks sharing a screen. The other shapes hold
                * it together at fifty to ninety pixels; this is the one where
                * the family broke.
                */}
              <div className="mt-auto flex flex-col items-stretch gap-3 pt-6 tall:mt-0 tall:gap-4 lg:flex-row lg:justify-center lg:gap-4">
                <button
                  type="button"
                  tabIndex={-1}
                  {...tap(() => {
                    haptic();
                    onRegister();
                  })}
                  className="flex h-14 items-center justify-center rounded-xl bg-brand-600 px-8 text-lg font-semibold text-white active:bg-brand-500 tall:h-16 kiosk:text-xl lg:flex-1"
                >
                  {t('registerYourChild')}
                </button>
                <WidenButton widening={widening} onWiden={onWiden} />
              </div>
              {refresh === 'failed' && (
                <div className="text-base text-ink-500 kiosk:text-lg">
                  {t('networkFailed')}
                </div>
              )}
              {/*
                * "Search everyone" stays, and reports — it used to remove
                * itself the moment it was pressed, which left a parent looking
                * at the place a button had been with no more evidence of the
                * press than one word changing in the line above. And it left
                * the family it had failed with nothing to press: four digits
                * are a small keyspace and names collide, so "widened and still
                * not mine" is a real state, and the answer to it — look again,
                * the church may have added them since — is that control.
                */}
              <div className="text-base text-ink-400 kiosk:text-lg">{t('orSeeALeader')}</div>
            </div>
          )}
          {outcome.results.slice(0, MAX_RESULTS).map((student) => (
            <ResultRow
              key={student.id}
              student={student}
              present={presentIds.has(student.id)}
              /*
               * Three states where check-out is tracked, two everywhere else.
               *
               * A present child stops being an inert "already done" row and
               * becomes the check-out target — which is the whole pickup flow.
               * A checked-out one goes inert again, dimmed, so a parent cannot
               * hand the same child back twice.
               */
              checkedOut={tracksCheckOut && checkedOutIds.has(student.id)}
              tracksCheckOut={tracksCheckOut}
              rowTap={rowTap}
            />
          ))}
        </div>

        {/*
          * After the rows, and outside the column block.
          *
          * The count in the readout says eleven names over a list of eight, and
          * a parent who reads it still has to find where the list stops; the
          * bottom of the last row is the one place somebody who has run out of
          * names is guaranteed to be looking. A sibling of the list rather than
          * its last child, because the landscape shape lays the rows out in
          * multi-column flow, where source order is column order and `order`
          * does nothing — as the list's last child this sentence became the
          * first thing in the left column, a heading over the names that
          * matched best, and it pushed that column out of register with the
          * other one.
          */}
        {truncated && (
          <div className="mx-auto w-full max-w-2xl pt-2 pb-16 text-center text-base text-ink-400 kiosk:text-lg tall:pb-20 lg:max-w-5xl">
            {t('moreNames')}
          </div>
        )}
      </div>

      {/* Only where there is a list to run past. The panel that fills the
          region on a failed search ends with "or see a leader." — the door
          that costs the church nothing — and an unconditional ramp dimmed it
          below legible, so the state read as a block that had been cut off
          rather than one that finished. */}
      {rows && (
        <div className="kiosk-list-fade-overlay pointer-events-none absolute inset-x-0 bottom-0" />
      )}
      </div>

      {/*
        * The console: the standing offer, the readout and the keys, declared as
        * one object by the rule along its top.
        *
        * They were three things that had ended up adjacent. The offer row
        * floated in the middle of an idle screen carrying the only accent and
        * the only ring on the glass, with a two-hundred-pixel void above it and
        * a seventy-eight-pixel one below — so it belonged to nothing, and the
        * reserved height under it read as a second hole rather than as the
        * readout's own space. Below one edge, that band is interior; the dead
        * gutter above it is a boundary a clipped row cannot bleed across; and
        * whatever slack the screen has left collects in exactly one field,
        * above the rule and below the content.
        *
        * A hairline rather than a fill. `ink-900` under the page would have
        * flattened the keys, which are `ink-800` and need the page's distance
        * to stay shapes in a dim room.
        */}
      {/* While the photograph is up the rule separated nothing from nothing
          and read as a stray line drawn on the picture — the newcomer
          consultation's finding. It dissolves by paint (index.css) rather
          than by mount, and in sequence with the photograph rather than in
          step with it: gone inside the picture's delay after Clear, back
          only once the picture has left on the first keystroke. Unmounting
          put the line over a full-strength image for a frame; fading it on
          the picture's own clock drew it across the arriving picture for a
          second, because a line that is invisible against the page is not
          invisible against a photograph at half strength. */}
      {backdrop ? (
        <div className="kiosk-rule-faded" />
      ) : (
        <div className="border-t border-ink-800/70" />
      )}

      {/*
        * The standing offer: the one door off this screen that is never closed.
        *
        * A parent who has been told "just put your name in" types their child's
        * name and gets a list — the no-match state above never fires for them,
        * because somebody else's Noah is on the roster. Nor does it fire for the
        * newcomer whose last four digits happen to belong to a family the church
        * already has. Both meet a screen full of confident, wrong rows, and for
        * both the way out is here.
        *
        * Tapping it opens the registration wizard directly — one tap from the
        * question to the first question.
        *
        * It used to be a line of text with a coloured phrase in it, which read
        * as a footnote next to the same offer's *button* two hundred pixels
        * higher up. A family meets whichever of the two happens to fire first,
        * so they have to be the same object: same shape, same words, one step
        * quieter here because this one is standing next to a keyboard somebody
        * is aiming at.
        *
        * Still exactly one grid row and still a fixed height, which is the
        * promise this file makes about geometry: present from the first paint,
        * so it cannot be the thing that moves when a keystroke lands.
        */}
      {/* The row itself is SearchConsole, memoized out of the keystroke: its
          contents hang off whether the search found anybody, never off what
          was typed, and the handlers cross behind the stable identities made
          above. Its layout reasoning rides with it. */}
      <SearchConsole
        offeredAbove={offeredAbove}
        canWiden={canWiden}
        widening={widening}
        hasResults={hasResults}
        onWiden={steadyWiden}
        onRegister={steadyRegister}
        offerWords={
          chosen && !isLocale(chosen)
            ? {
                firstTime: COPY[chosen].offerFirstTime,
                notYours: COPY[chosen].offerNotYours,
                widen: COPY[chosen].widen,
              }
            : undefined
        }
        offerSecond={
          chosen === null && unspoken
            ? { firstTime: COPY[unspoken].offerFirstTime, notYours: COPY[unspoken].offerNotYours }
            : undefined
        }
      />

      {/*
        * The buffer. A div, never an input — the native keyboard must not rise.
        *
        * And, deliberately, not a box either: no fill, no border, no rounded
        * corners. Everything that looks like a text field on a touchscreen is
        * a text field, and a parent meeting one taps it before typing —
        * waiting for a caret and a keyboard that are already there. The tap
        * does nothing, because there is nothing here to focus, and the second
        * of confusion it buys is spent at the front of a queue. Bare text on
        * the background instead: the keys are lit, the readout is where the
        * letters appear, and nothing on the screen invites a press that has no
        * answer.
        *
        * Empty on an untouched screen, and that is the point of the row
        * rather than a gap in it. The instruction used to live here, and it
        * was the loudest thing on the glass for as long as nobody had typed —
        * which put the sentence a parent reads *first* at the bottom of the
        * screen, beneath the register offer, four hundred pixels below where
        * their eye lands. It is at the top of the results now. This row keeps
        * its height either way, because a keystroke must not move the
        * keyboard, and the empty band it leaves is doing a second job: it is
        * the one place a thumb reaching for the top row of keys could
        * otherwise commit the register offer by accident.
        */}
      <div className="px-6 pb-1">
        {/* The same measure as the results column, so the count below hangs off
            the edge the rows are flush to rather than off this band's own
            padding — it is the list's caption, and it was missing the strongest
            vertical line in the frame by sixteen pixels. */}
        {/* `px-24` is the clearance the two corner objects need. Both are
            absolutely positioned, so neither can move a row or push the
            letters off centre — but a long enough buffer is centred *through*
            them, and "Bartholomew" under the language chips is the readout
            failing at the one thing it does. Padding insets the flex content
            only: an absolute child is placed against the padding box, so the
            corners stay in the corners. */}
        <div className="relative mx-auto flex h-16 max-w-2xl items-center justify-center px-24 text-center tall:h-20 lg:max-w-5xl">
          {/*
            * The way out of a language a parent cannot read.
            *
            * Here rather than in the header because this band is the one place
            * on the screen that is empty until somebody types, it is a hand's
            * width from the keys the reader is already looking at, and it
            * costs no geometry — the promise this file makes is that a
            * keystroke never moves anything, and an absolute child of a
            * fixed-height row cannot. The lobby's own language is set once, on
            * the pairing screen; this is for the family the room's default is
            * not for, and it changes the words without taking their place in
            * the queue away from them.
            */}
          {VARIANTS[variant]?.Picker ? (
            <VariantPicker variant={variant} chosen={chosen} onChoose={onChoose} pins={pins} speaks={speaks} idle={outcome.mode === 'idle'} />
          ) : (
            <span className="absolute left-0">
              <LanguagePicker quiet />
            </span>
          )}
          {buffer && (
            <span className="truncate text-3xl font-semibold tracking-wide text-ink-50 kiosk:text-4xl">
              {buffer}
            </span>
          )}
          {/*
            * How many names the search found, beside the letters that found
            * them.
            *
            * The list clips, and the peek that says so is a strip of card
            * faded to nothing — `ink-800` on `ink-950` is barely a shape at
            * full strength, so a few pixels of it ramping to the page is not a
            * signal anybody catches in a lobby. A phone fits four rows and
            * MAX_RESULTS is eight, so a family whose name sorts fifth met four
            * confident wrong rows and nothing at all to say a fifth existed —
            * and the doors available to them from there include the one that
            * registers a child the church already has.
            *
            * Here rather than on the list because this band is where a parent
            * is already looking while they type, and because it costs no
            * geometry: absolutely positioned, so the count cannot push the
            * letters off centre or move a row.
            */}
          {/* No count (round 9's cut): while every row fits, the eye has
              counted; past the cap the body's own sentence says the useful
              thing, and "8 names" over a list cut from twenty-three was a
              complete-looking answer to an incomplete search. */}
        </div>
      </div>

      <Keyboard onKey={onKey} onClearHeld={onStaffGate} />
    </div>
  );
}


/* ------------------------------------------------------------------------ */
/* The candidates                                                            */
/* ------------------------------------------------------------------------ */

/** What the idle slot is handed: the same facts the shipped panel reads. */
/** A family's language choice this visit, and the way to make one. */
export interface ChoiceProps {
  /** The language a family chose this visit; null while nobody has. */
  chosen: Lang | null;
  onChoose: (candidate: Lang) => void;
  /** The languages pinned beside the resting one at rest, in the order they stand. */
  pins: Lang[];
  /** The languages the kiosk can speak all the way down; a pin outside it is lines, not a door. */
  speaks: readonly Lang[];
}

export interface IdleProps extends ChoiceProps {
  /** The gathering's photograph is mounted behind the screen. */
  backdrop: boolean;
  /** A cycling greeting pinned to one moment, for the shooter; live otherwise. */
  phase?: number;
  /** Opens the registration wizard — the standing offer's own handler. */
  onRegister: () => void;
}

export interface NoMatchProps extends ChoiceProps {
  mode: KioskSearchOutcome['mode'];
  refresh: KioskRefresh;
  widening: boolean;
  onWiden: () => void;
  onRegister: () => void;
}

export interface VariantSpec {
  /** One line for the contact sheet and the write-up. */
  summary: string;
  /** The no-match panel. Absent: the shipped one. */
  NoMatch?: (props: NoMatchProps) => React.ReactElement | null;
  /** The idle panel, drawn in the results region. Absent: the shipped one. */
  Idle?: (props: IdleProps) => React.ReactElement | null;
  /**
   * The language control in the readout band, drawn inside the band's own
   * `relative` box. Absent: the shipped quiet chips at its left edge. A
   * candidate that moves the control elsewhere returns `null` here.
   */
  Picker?: (props: ChoiceProps & { idle: boolean }) => React.ReactElement | null;
}

function VariantIdle({ variant, ...props }: IdleProps & { variant: string }) {
  const Idle = VARIANTS[variant]?.Idle;
  return Idle ? <Idle {...props} /> : null;
}

function VariantPicker({ variant, ...props }: ChoiceProps & { variant: string; idle: boolean }) {
  const Picker = VARIANTS[variant]?.Picker;
  return Picker ? <Picker {...props} /> : null;
}


function VariantNoMatch({ variant, ...props }: NoMatchProps & { variant: string }) {
  const NoMatch = VARIANTS[variant]?.NoMatch;
  return NoMatch ? <NoMatch {...props} /> : null;
}

/* ------------------------------------------------------------------------ */
/* The words                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * The campaign's copy, as literals rather than catalogue keys.
 *
 * Round 4 turned the instruction round: the product owner reports that the
 * phone-number association in the church's data is not good, so the
 * four-digit route cannot lead — a family sent to it first lands on "no
 * match" more often than not, which for a reader who cannot read the
 * screen is the worst place to land. The child's name is the reliable
 * route and is said first; the digits are the second line.
 *
 * Round 7 added Spanish and took "English" out of the English and Spanish
 * lines: a reader of either types a Latin-alphabet name without being told
 * to, so the word was a cost with no reader. It stays in the Chinese lines,
 * 英文名字, where it is the instruction — the roster holds the child's
 * English name and the keyboard has no other way in. The rest is as the
 * earlier rounds settled it: "the child's name" rather than 姓名 (whose
 * name?), and a no-match panel whose first answer is a route rather than
 * "are you new?".
 *
 * Round 7's panel rewrote the failure panel's advice to whoever can act on
 * it: a Latin-alphabet reader can check what they typed, so that comes
 * first for them and the phone digits — the route the church's data cannot
 * carry — drop out of their line; a Chinese reader cannot check a spelling
 * they never knew, so a person comes first and the digits stay as the
 * second try. The register door carries its own question ("First time
 * here?") so nobody registered presses it, and the Spanish names the whole
 * church as what it searches. The Spanish readers' own changes: "su niño o
 * niña" (both Spanish-speaking parents have daughters), "Inscriba" (the
 * church's own signage), a person's voice for the failure heading, a
 * volunteer rather than a "líder" nobody can pick out of a lobby, and one
 * line saying the accents the keyboard lacks do not matter, where the
 * doubt arises. The Chinese lines gain the 您 the rest of the Chinese has.
 *
 * Literals because the prototype is thrown away; what ships goes through
 * `messages/kiosk/*.json` and the drafting pipeline, and the Chinese and
 * Spanish below are drafts for the congregations' own reviewers. The
 * Spanish is the usted register, as church signage is. Vocabulary follows
 * `messages/GLOSSARY.md` and the shipped catalogue.
 */
const COPY: Record<
  Lang,
  {
    name: string;
    orDigits: string;
    thenTap: string;
    tapHere: string;
    noMatch: string;
    /** After a failed name search: what to do, said to whoever can act on it. */
    routeDigits: string;
    /** The same, with room for one more sentence, on a panel that speaks one language. */
    routeDigitsAlone?: string;
    /** After a failed phone search. */
    routeName: string;
    offerFirstTime: string;
    offerNotYours: string;
    widen: string;
  }
> = {
  en: {
    name: 'Type your child’s name',
    orDigits: 'or the last 4 digits of your phone',
    thenTap: 'Then tap your child’s name.',
    tapHere: 'Tap here',
    noMatch: 'No match',
    routeDigits: 'Try the last 4 digits of your phone, or ask a leader.',
    routeName: 'Try typing your child’s name, or ask a leader.',
    offerFirstTime: 'First time here? Register your child',
    offerNotYours: 'Not your family? Register your child',
    widen: 'Search everyone',
  },
  'zh-Hans': {
    name: '输入您孩子的英文名字',
    orDigits: '或电话后 4 位',
    thenTap: '然后点一下您孩子的名字。',
    tapHere: '按这里',
    noMatch: '找不到',
    routeDigits: '找同工帮忙，或试试电话后 4 位。',
    routeName: '试试输入您孩子的英文名字，或找同工帮忙。',
    offerFirstTime: '第一次来？为您的孩子登记',
    offerNotYours: '不是您家的孩子吗？为您的孩子登记',
    widen: '搜索所有人',
  },
  'zh-Hant': {
    name: '輸入您孩子的英文名字',
    orDigits: '或電話後 4 碼',
    thenTap: '然後點一下您孩子的名字。',
    tapHere: '按這裡',
    noMatch: '找不到',
    routeDigits: '找同工幫忙，或試試電話後 4 碼。',
    routeName: '試試輸入您孩子的英文名字，或找同工幫忙。',
    offerFirstTime: '第一次來？為您的孩子登記',
    offerNotYours: '不是您家的孩子嗎？為您的孩子登記',
    widen: '搜尋所有人',
  },
  es: {
    name: 'Escriba el nombre de su hijo o hija',
    orDigits: 'o los últimos 4 dígitos de su teléfono',
    thenTap: 'Luego toque el nombre de su hijo o hija.',
    tapHere: 'Toque aquí',
    noMatch: 'No encontramos ese nombre',
    routeDigits: 'Los acentos no importan. Pruebe los últimos 4 dígitos de su teléfono, o pida ayuda a un voluntario.',
    routeName: 'Pruebe escribiendo el nombre de su hijo o hija, o pida ayuda a un voluntario.',
    offerFirstTime: '¿Primera vez? Inscríbalos aquí',
    offerNotYours: '¿No es su familia? Inscríbalos aquí',
    widen: 'Buscar en toda la iglesia',
  },
};

/**
 * The language the panels speak: the family's choice this visit, else the
 * kiosk's. The choice is read first because Spanish can be chosen and
 * cannot be the locale.
 */
function usePanelLang(chosen: Lang | null): Lang {
  const locale = useLocale() as Lang;
  return chosen ?? locale;
}

/**
 * What the kiosk rests in — `RESTING_LOCALE` in `src/kiosk/KioskApp.tsx`.
 *
 * A locale that differs from it is a family's choice for their visit; equal
 * to it, nobody has chosen anything yet and the screen cannot know who is
 * standing there.
 */
const RESTING: Lang = 'en';

/** Every language, resting language first — what round 4's cycling candidates ran through. */
const ORDER: Lang[] = [RESTING, ...LANGS.filter((candidate) => candidate !== RESTING)];

/** The languages a lobby speaks at rest: the resting one, then its pins. */
const voicesOf = (pins: Lang[]): Lang[] => [RESTING, ...pins.filter((candidate) => candidate !== RESTING)];

/**
 * One Chinese script, the first pinned. Two near-identical sentences stacked
 * on the failure panel read as a fault to every reader (round 7), and the
 * other script is one chip away.
 */
const oneScriptEach = (voices: Lang[]): Lang[] =>
  voices.filter(
    (candidate, index) =>
      !candidate.startsWith('zh') || voices.findIndex((other) => other.startsWith('zh')) === index,
  );

/* ------------------------------------------------------------------------ */
/* Shared parts                                                              */
/* ------------------------------------------------------------------------ */

/** The photograph's plate and halo, exactly as the shipped panel wears them. */
function IdleGround() {
  return (
    <>
      <div aria-hidden="true" className="kiosk-idle-halo absolute -inset-x-24 -inset-y-14 -z-20" />
      <div aria-hidden="true" className="kiosk-idle-plate absolute -inset-x-10 -inset-y-7 -z-10 rounded-2xl" />
    </>
  );
}

/**
 * One slot, several languages over time.
 *
 * The greeting says the same thing once per language; the question this
 * round asks is whether it has to say all of them at once. A cycle keeps one
 * sentence on the glass at any moment and reaches every reader within the
 * period. Items stack in one grid cell so the slot is as tall as its tallest
 * language and nothing under it ever moves — the screen's rule about
 * keystrokes, kept for the clock as well. The crossfade is opacity only:
 * composited, no layout, no paint of anything but the words.
 *
 * `phase` pins one moment, for a frame: a photograph is a moment, and a
 * critic has to know which one. Under `prefers-reduced-motion` the cycle
 * does not run and the resting language stands alone (`.uxr-cycle` in the
 * injected rules) — the bar beside it carries the other two.
 *
 * `onChoose`, when given, makes the slot a door: a tap takes whichever
 * language is showing. What is showing is arithmetic on the clock the
 * animation started on, which is the same clock the CSS runs on.
 */
const SLOT_MS = 4000;
const FADE_MS = 500;

function ensureCycleStyles() {
  if (typeof document === 'undefined' || document.getElementById('uxr-cycle-styles')) return;
  const style = document.createElement('style');
  style.id = 'uxr-cycle-styles';
  /* Visible for one slot of the period, faded out for the rest. Delays are
     negative multiples of a slot so item i shows i slots after item 0. */
  const frames = (n: number) => {
    const on = 100 / n;
    const fade = (FADE_MS / (n * SLOT_MS)) * 100;
    return `@keyframes uxr-cycle-${n} { 0%, ${(on - fade).toFixed(2)}% { opacity: 1 } ${on.toFixed(2)}%, ${(100 - fade).toFixed(2)}% { opacity: 0 } 100% { opacity: 1 } }`;
  };
  style.textContent = `
${frames(2)}
${frames(3)}
.uxr-cycle { animation-timing-function: ease-in-out; animation-iteration-count: infinite; }
@media (prefers-reduced-motion: reduce) {
  .uxr-cycle { animation: none !important; }
  .uxr-cycle:not(:first-child) { opacity: 0 !important; }
}`;
  document.head.appendChild(style);
}

function Cycle({
  items,
  phase,
  className,
  onChoose,
}: {
  items: { locale: Lang; text: string }[];
  phase?: number;
  className?: string;
  onChoose?: (candidate: Lang) => void;
}) {
  const tap = useTap();
  const startedAt = useRef(Date.now());
  useEffect(ensureCycleStyles, []);
  const n = items.length;
  const showing = () =>
    phase !== undefined ? items[phase % n]! : items[Math.floor((Date.now() - startedAt.current) / SLOT_MS) % n]!;
  const body =
    phase !== undefined ? (
      <span lang={items[phase % n]!.locale} className={className}>
        {items[phase % n]!.text}
      </span>
    ) : (
      <span className={`grid ${className ?? ''}`}>
        {items.map((item, index) => (
          <span
            key={item.locale}
            lang={item.locale}
            className="uxr-cycle col-start-1 row-start-1"
            style={{
              animationName: `uxr-cycle-${n}`,
              animationDuration: `${n * SLOT_MS}ms`,
              animationDelay: `${-(((n - index) % n) * SLOT_MS)}ms`,
            }}
          >
            {item.text}
          </span>
        ))}
      </span>
    );
  if (!onChoose) return body;
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={LABELS[showing().locale]}
      {...tap(() => {
        haptic(8);
        onChoose(showing().locale);
      })}
      className="block w-full rounded-xl px-3 py-1 active:bg-ink-800"
      style={{ touchAction: 'manipulation' }}
    >
      {body}
    </button>
  );
}

/**
 * The no-match panel every candidate shares.
 *
 * Both Chinese-reading parents pressed the blue button on a failed name
 * search because it was the only thing that looked pressable, and landed in
 * a registration form for children the church already has. So the heading
 * is the outcome, the next line is what to do about it — check the spelling,
 * or the digits as a second try, now that the digits are the second route —
 * and the doors go quiet under the caption that used to be the heading.
 * While nobody has chosen a language the route is said in every language
 * the lobby speaks at rest — the resting one and its pins: the father
 * reached exactly this screen, in English, before he had tapped
 * anything. Chosen, it is single-language. "Check the spelling" went in
 * round 4 — advice a parent cannot take, since they do not know how the
 * church spelled it — and the leader moved up into the route line, in every
 * language, because with the phone data unreliable a person is often the
 * right answer and it was the dimmest line on the panel. Round 7 turned the
 * advice to whoever can act on it, gave the register door its own question,
 * put the wider search first, and made the chosen panel speak the chosen
 * language from this table rather than the catalogue. Repetition is spent
 * here on purpose — it is the failure state, and a sentence that changed
 * while a stuck parent was reading it would be the wrong kind of help.
 */
function NoMatchPanel({ mode, onWiden, onRegister, chosen, pins }: NoMatchProps) {
  const lang = usePanelLang(chosen);
  /* Unchosen, every voice the lobby speaks at rest; chosen, the one chosen —
     from the same table, so a family that chose a language the catalogue
     does not carry yet keeps its words on the two doors (round 7's blocker:
     choosing Spanish took the Spanish off the only buttons that mattered). */
  const spoken = chosen === null ? oneScriptEach(voicesOf(pins)) : [lang];
  const route = (candidate: Lang) =>
    mode === 'phone'
      ? COPY[candidate].routeName
      : (chosen !== null && COPY[candidate].routeDigitsAlone) || COPY[candidate].routeDigits;
  const distinct = (pick: (candidate: Lang) => string) =>
    spoken.filter((candidate, index) => spoken.findIndex((other) => pick(other) === pick(candidate)) === index);
  /* One size step down while the panel speaks for more than one reader:
     three headings and three routes at the single-language size overran the
     region's top on portrait, and a panel whose first line is off the glass
     has failed at its one job. */
  const many = spoken.length > 1;
  return (
    <div className={`mx-auto flex h-full w-full max-w-xs flex-col items-stretch text-center tall:max-w-md tall:justify-end lg:max-w-2xl ${many ? 'gap-2 pt-4 tall:gap-3' : 'gap-3 pt-6 tall:gap-4'}`}>
      <div className={`mx-auto flex max-w-sm flex-col items-center gap-1 text-center leading-tight font-semibold text-ink-100 tall:max-w-md ${many ? 'text-2xl' : 'text-3xl kiosk:text-4xl'}`}>
        {distinct((candidate) => COPY[candidate].noMatch).map((candidate) => (
          <span key={candidate} lang={candidate}>
            {COPY[candidate].noMatch}
          </span>
        ))}
      </div>
      {/* One route line per voice, always. Round 9 cut them while nobody had
          chosen a language, and four of five parents asked for theirs back:
          the two doors are somebody else's door for a family the church
          already has, and the line is the one that says a person will help
          and the phone's four digits will do. Repetition is spent here on
          purpose — it is the failure state. */}
      <div className={`mx-auto flex max-w-sm flex-col gap-1 text-center leading-snug text-balance text-ink-100 tall:max-w-md ${many ? 'text-lg kiosk:text-xl' : 'text-xl kiosk:text-2xl'}`}>
        {distinct(route).map((candidate) => (
          <span key={candidate} lang={candidate}>
            {route(candidate)}
            {/* The four digits once, after the first line: the one screen where
                reading has already failed is the one that had no wordless route
                (staff, round 10). */}
            {candidate === spoken[0] && mode !== 'phone' && <DigitsCue />}
          </span>
        ))}
      </div>
      {/* The wider search first — the door most of the queue wants — and the
          register door second, carrying its own question so that nobody
          already registered presses it; both at the quiet weight, every
          parent having pressed the bright one. The "first time here?"
          caption no longer floats over both. */}
      <div className={`mt-auto flex flex-col items-stretch tall:mt-0 ${many ? 'gap-2 pt-4 tall:gap-3' : 'gap-3 pt-6 tall:gap-4'}`}>
        <Door voices={spoken} onPress={onWiden} pick={(candidate) => COPY[candidate].widen} primary />
        <Door voices={spoken} onPress={onRegister} pick={(candidate) => COPY[candidate].offerFirstTime} />
      </div>
    </div>
  );
}

/** A quiet door labelled in every language the lobby speaks at rest, for the panel nobody has chosen a language on. */
function Door({
  onPress,
  pick,
  voices,
  primary = false,
}: {
  onPress: () => void;
  pick: (candidate: Lang) => string;
  voices: Lang[];
  /** The door most of the queue wants, a step brighter than the one that makes duplicates (staff, round 9). */
  primary?: boolean;
}) {
  const tap = useTap();
  const distinct = voices.filter(
    (candidate, index) => voices.findIndex((other) => pick(other) === pick(candidate)) === index,
  );
  return (
    <button
      type="button"
      tabIndex={-1}
      {...tap(() => {
        haptic();
        onPress();
      })}
      className={`flex min-h-14 w-full flex-col items-center justify-center rounded-xl px-6 py-2 text-ink-100 tall:min-h-16 lg:flex-1 ${
        primary ? 'bg-ink-700 ring-1 ring-ink-500 active:bg-ink-600' : 'bg-ink-800 active:bg-ink-700'
      }`}
    >
      {distinct.map((candidate, index) => (
        <span
          key={candidate}
          lang={candidate}
          className={
            index === 0
              ? distinct.length > 1
                ? 'text-base leading-tight font-semibold kiosk:text-lg'
                : 'text-lg leading-tight font-semibold kiosk:text-xl'
              : 'text-sm leading-tight text-ink-300 kiosk:text-base'
          }
        >
          {pick(candidate)}
        </span>
      ))}
    </button>
  );
}

/**
 * The language bar: the pairing screen's picker at its full weight, with
 * one responsive difference — the languages' whole names where three fit
 * across the glass (`sm:` and up), the one-glyph badges on a phone. The
 * implementation is a label prop on `LanguagePicker`.
 */
function LanguageBar({
  onChoose,
  chosen,
  pins,
  speaks,
}: {
  onChoose: (candidate: Lang) => void;
  chosen: Lang | null;
  pins: Lang[];
  speaks: readonly Lang[];
}) {
  const t = useTranslations('Common');
  const lang = usePanelLang(chosen);
  const tap = useTap();
  return (
    <div role="group" aria-label={t('language')} className="flex items-center gap-2">
      {switchOf(pins, speaks).map((candidate: Lang) => {
        const current = candidate === lang;
        return (
          <button
            key={candidate}
            type="button"
            tabIndex={-1}
            lang={candidate}
            aria-label={LABELS[candidate]}
            aria-pressed={current}
            {...tap(() => {
              haptic();
              onChoose(candidate);
            })}
            className={`flex h-14 min-w-14 items-center justify-center rounded-xl px-4 text-lg font-semibold sm:min-w-24 sm:px-5 tall:h-16 tall:text-xl ${
              current
                ? 'bg-ink-700 text-ink-50 ring-2 ring-ink-400'
                : 'bg-ink-800 text-ink-300 ring-1 ring-ink-600 active:bg-ink-700 active:text-ink-100'
            }`}
            style={{ touchAction: 'manipulation' }}
          >
            <span className="sm:hidden">{SHORT[candidate]}</span>
            <span className="hidden sm:inline">{LABELS[candidate]}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The chosen screen, and B's resting screen: the bar, then the instruction
 * in the current language — the name first, the digits second — and, while
 * nobody has chosen, one line per pinned language the kiosk cannot speak
 * yet. Nothing else.
 *
 * Round 9 made this a resting candidate again, at the owner's word: of
 * everything shown, the screen with a pronounced switcher was the one that
 * did not look cluttered. One instruction and one switch is the least a
 * multilingual sign can say, and a bar of language names at full weight is
 * the switch nobody misses — the shipped chips were the same control at a
 * size nobody found. At rest English is lit; a tap makes the same screen
 * another language's, so the kiosk has one shape for every state. The
 * next-step line is gone: the keyboard and the rows say it.
 */
function LanguageBarIdle({ backdrop, onChoose, chosen, pins, speaks }: IdleProps) {
  const copy = COPY[usePanelLang(chosen)];
  const dim = backdrop ? 'text-ink-300' : 'text-ink-400';
  const { lines } = partition(pins, speaks);
  return (
    <div className="flex flex-col items-center pt-4 text-center tall:pt-6 lg:pt-2">
      <div className={`relative isolate flex flex-col items-center ${backdrop ? 'max-lg:rounded-2xl max-lg:bg-ink-950/70 max-lg:px-6 max-lg:py-5' : ''}`}>
        <IdleGround />
        <LanguageBar onChoose={onChoose} chosen={chosen} pins={pins} speaks={speaks} />
        <div className="mt-6 text-4xl leading-tight font-semibold text-balance text-ink-100 tall:mt-8 tall:text-5xl lg:mt-3">
          {copy.name}
        </div>
        <div className={`pt-1 text-lg kiosk:text-xl ${dim}`}>
          {copy.orDigits}
          <DigitsCue />
        </div>
        {chosen === null && lines.map((candidate) => <Line key={candidate} candidate={candidate} dim={dim} />)}
      </div>
    </div>
  );
}

/**
 * The band's chips at 44px, every one legible, plated — but only once there
 * is something typed, and only for the languages the kiosk can speak: a lit
 * chip is an assertion (staff, round 7). At rest and on the chosen screen the idle panel is
 * the language control (plates, a bar, or a door that cycles), and two
 * controls on one screen was the repetition every parent noticed: "it looks
 * like the screen is asking me twice". One control per state: the panel's
 * while the panel is up, the band's once rows have replaced it.
 *
 * Placement is stated against what the console row holds. With rows on
 * screen that row is two buttons — the register door on the left, Search
 * everyone on the right — so the chips take the right edge, under the
 * retry; the count swaps to the left. On tablets they sit at the band's
 * top, 44px (on end) or 28px (on its side) above the number row; on a
 * phone they centre in the band at the shipped width.
 */
function PromotedChips({ onChoose, chosen, speaks, idle }: ChoiceProps & { idle: boolean }) {
  const t = useTranslations('Common');
  const lang = usePanelLang(chosen);
  const tap = useTap();
  if (idle) return null;
  /* The band's left end, centred in its height (round 9): the English
     parent's thumb crosses the right end of this strip between Search
     everyone and the 9 and 0 keys, and twice found the chips in its lane.
     The left end is where the shipped chips live and where no thumb
     travels; the count that used to stand there is gone. A brushed chip
     changes the words and never what was typed. */
  return (
    <span role="group" aria-label={t('language')} className="absolute left-0 flex items-center gap-1">
      {speaks.map((candidate: Lang) => {
        const current = candidate === lang;
        return (
          <button
            key={candidate}
            type="button"
            tabIndex={-1}
            lang={candidate}
            aria-label={LABELS[candidate]}
            aria-pressed={current}
            {...tap(() => {
              haptic(8);
              onChoose(candidate);
            })}
            className={`flex h-11 min-w-9 items-center justify-center rounded-lg px-1.5 text-base font-semibold sm:min-w-11 sm:px-2 ${
              current
                ? 'bg-ink-700 text-ink-50'
                : 'bg-ink-800/70 text-ink-300 active:bg-ink-700 active:text-ink-100'
            }`}
            style={{ touchAction: 'manipulation' }}
          >
            {SHORT[candidate]}
          </button>
        );
      })}
    </span>
  );
}

/* ------------------------------------------------------------------------ */
/* A — Welcomes: every voice an equal plate                                 */
/* ------------------------------------------------------------------------ */

/**
 * The instruction in every language the lobby speaks at rest, each an equal
 * plate and a door — each language saying its two lines once, and nothing
 * said twice in any one. Round 7 made the set the lobby's pins rather than
 * the kiosk's whole list: with Spanish the list is four, and four equal
 * plates is the ceiling this candidate is shot at.
 *
 * Rounds 1–3 settled the shape: three equal plates at rest, resting
 * language first, nothing highlighted; a tap turns the panel into the
 * chosen language's screen. Round 4 tried plates of one line each with the
 * digits and the next step said once beneath, in the resting language, and
 * both Chinese-reading parents found the digits route had gone missing for
 * them — "my rescue route is written in the one language I cannot read" —
 * while the English reader found the two Chinese headlines identical (they
 * differ in one glyph, 输/輸) and read the screen as glitched. So each plate
 * carries its own name line and its own digits line: the digits lines
 * (后 4 位 / 後 4 碼) are what tell the two Chinese plates apart, and no
 * language repeats what another said. The next step is said once, in the
 * resting language, and steps aside on a portrait photo Sunday, where the
 * canopy stops above it and the plate it wore read as a button.
 */
function Welcomes(props: IdleProps) {
  const { backdrop, chosen, onChoose, pins } = props;
  const voices = voicesOf(pins);
  if (chosen) return <LanguageBarIdle {...props} />;
  return (
    <div className="flex flex-col items-center pt-4 text-center tall:pt-6 lg:pt-2">
      {/* One ground for every line while a photograph is up. The shipped plate
          paints only on the landscape shelf; on the portrait shapes the
          canopy stops above the panel's last lines, and a plate on one line
          alone read as a button. Page token at 70%, framed by the picture. */}
      <div className={`relative isolate flex w-full max-w-xl flex-col items-center lg:max-w-3xl ${backdrop ? 'max-lg:rounded-2xl max-lg:bg-ink-950/70 max-lg:px-6 max-lg:py-5' : ''}`}>
        <IdleGround />
        <div className="flex w-full flex-col gap-2 lg:flex-row lg:gap-3">
          {voices.map((candidate: Lang) => (
            <Plate key={candidate} candidate={candidate} onChoose={onChoose} named />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* J — Voices: the resting language leads; a plate per spoken pin, lines    */
/*     per pin the kiosk cannot speak yet                                   */
/* ------------------------------------------------------------------------ */

/**
 * One pinned language's plate: the language's own name, its name route and
 * its digits route in its own script, and the door to its screen.
 *
 * What round 4's moving line taught, kept: the second voice is on the glass
 * from the first second, it does not move, and the thing a thumb presses is
 * never the thing that changes. The ring is the edge that keeps the plate a
 * pressable object on the light ground, where ink-800 inverts to a pale tint
 * inside a pale card.
 *
 * The name on top is round 7's: the corner badge did nothing for either
 * Chinese reader ("the same little grey mark as the chip I never found"),
 * and two Chinese plates at the ceiling read as a double print. Round 9 cut
 * it back to where it earns its line — two Han plates, or a screen where
 * every voice is a plate — because on the lobby's own screen, with one
 * Chinese plate, it was a fourth object on a box that needed two.
 */
function Plate({
  candidate,
  onChoose,
  named,
}: {
  candidate: Lang;
  onChoose: (candidate: Lang) => void;
  /** The language's own name on top — asked for only where two Han plates stand, or where every voice is a plate. */
  named: boolean;
}) {
  const tap = useTap();
  /* Han glyphs need more size than Latin at the same distance (round 5), and
     the same rule is what keeps a Latin headline on one line in the plate's
     width instead of orphaning its last word. */
  const han = !LATIN.includes(candidate);
  return (
    <button
      type="button"
      tabIndex={-1}
      lang={candidate}
      aria-label={LABELS[candidate]}
      {...tap(() => {
        haptic(8);
        onChoose(candidate);
      })}
      className="relative flex min-h-14 w-full flex-col items-center justify-center rounded-xl bg-ink-800 px-4 py-2 text-center text-ink-100 ring-1 ring-ink-600 active:bg-ink-600 tall:min-h-16"
      style={{ touchAction: 'manipulation' }}
    >
      {named && <span className="text-sm leading-tight text-ink-300 tall:text-base">{LABELS[candidate]}</span>}
      <span className={`leading-tight font-semibold ${han ? 'text-xl tall:text-3xl' : 'text-lg tall:text-2xl'}`}>
        {COPY[candidate].name}
      </span>
      <span className="text-base leading-tight text-ink-300 tall:text-lg">{COPY[candidate].orDigits}</span>
    </button>
  );
}

/**
 * A pinned language the kiosk cannot speak yet, as the sign's second
 * language: its name route a step under the resting language's, and its
 * digits route small beneath with the cue. Round 9 cut the digits line;
 * round 10's Spanish mother asked for it back — "the one thing they are told
 * at rest that I am not" — and the cue crosses languages. No plate, no
 * door, no badge: it promises nothing beyond the words on the glass.
 */
function Line({ candidate, dim }: { candidate: Lang; dim: string }) {
  return (
    <div className="flex flex-col items-center pt-3" lang={candidate}>
      <div className="text-2xl leading-tight font-semibold text-balance text-ink-200 tall:text-3xl">
        {COPY[candidate].name}
      </div>
      <div className={`pt-1 text-base kiosk:text-lg ${dim}`}>
        {COPY[candidate].orDigits}
        <DigitsCue />
      </div>
    </div>
  );
}

/**
 * Four faint digits in key-shaped boxes after a digits line: the route that
 * needs no reading, shown without one. The grandmother, who reads no English
 * and cannot spell "Benson", asked for exactly this once the switcher
 * candidates put 或電話後 4 碼 behind a press — "even just the four numbers
 * shown as an example under the English line would do it". Round 10 filled
 * the boxes: empty, both she and the Spanish mother read them as characters
 * that failed to print (豆腐字). After every digits line the switcher
 * candidates show, in any language (the father: "four squares means four
 * numbers, in any language").
 */
function DigitsCue() {
  return (
    <span aria-hidden="true" className="ml-2 inline-flex items-center gap-1 align-middle">
      {['1', '2', '3', '4'].map((digit) => (
        <span
          key={digit}
          className="inline-flex h-5 w-4 items-center justify-center rounded-sm bg-ink-800 text-xs leading-none font-semibold text-ink-500 ring-1 ring-ink-600 tall:h-6 tall:w-5 tall:text-sm"
        >
          {digit}
        </span>
      ))}
    </span>
  );
}

/**
 * The lobby's switch: the resting language, then the pinned languages the
 * kiosk can speak, in pin order. Never the app's whole list (staff, round
 * 9): a language Tally adds later must not land on a lobby's glass until
 * somebody there pins it, and a lobby with no pins keeps today's screen.
 */
const switchOf = (pins: Lang[], speaks: readonly Lang[]): Lang[] => [
  RESTING,
  ...pins.filter((candidate) => candidate !== RESTING && speaks.includes(candidate)),
];

/** Two Han plates on one screen need their names; one does not. */
const twoHan = (plates: Lang[]): boolean => plates.filter((candidate) => !LATIN.includes(candidate)).length > 1;

/** The resting screen's partition of the pins: doors for what the kiosk speaks, lines for what it cannot yet. */
function partition(pins: Lang[], speaks: readonly Lang[]) {
  const pinned = pins.filter((candidate) => candidate !== RESTING);
  return {
    lines: pinned.filter((candidate) => !speaks.includes(candidate)),
    plates: pinned.filter((candidate) => speaks.includes(candidate)),
  };
}

/**
 * The resting language leads, as today. Under it, the pinned languages the
 * kiosk cannot speak yet as lines, in one block with the English; then one
 * still plate per pinned language it can speak, in the order staff pinned
 * them; then the next step, once.
 *
 * Round 5 settled this shape with one plate, the congregation's Chinese
 * script. Round 7 asked what it becomes when the lobby has a second second
 * language, and one the kiosk does not speak yet, and the answer is one
 * rule rather than two shapes: a plate is a door, and a door is only made
 * to a room that exists. Today that puts Spanish in the text block — which
 * both Spanish-speaking readers ranked first, as "one screen written in two
 * languages instead of one with a translation clipped on" — and the day
 * `es.json` lands it becomes a plate under the Chinese one, the shape the
 * staff want to be walking towards. The text block keeps the English pair
 * together and the Spanish pair together, never interleaved (the English
 * parent), and the Chinese plate stays the only box on the glass, which is
 * where the grandmother's eye goes.
 */
function Voices(props: IdleProps) {
  const { backdrop, chosen, onChoose, pins, speaks } = props;
  if (chosen) return <LanguageBarIdle {...props} />;
  const dim = backdrop ? 'text-ink-300' : 'text-ink-400';
  const { lines, plates } = partition(pins, speaks);
  return (
    <div className="flex flex-col items-center pt-6 text-center lg:pt-2">
      <div className={`relative isolate flex w-full max-w-xl flex-col items-center ${backdrop ? 'max-lg:rounded-2xl max-lg:bg-ink-950/70 max-lg:px-6 max-lg:py-5' : ''}`}>
        <IdleGround />
        <div className="text-4xl leading-tight font-semibold text-balance text-ink-100 tall:text-5xl" lang={RESTING}>
          {COPY[RESTING].name}
        </div>
        {/* The resting language's two lines stay together as one thought —
            the English parent's route is the digits, and it had slipped under
            a plate she cannot read. */}
        <div className={`pt-1 text-lg kiosk:text-xl ${dim}`} lang={RESTING}>
          {COPY[RESTING].orDigits}
        </div>
        {lines.map((candidate) => (
          <Line key={candidate} candidate={candidate} dim={dim} />
        ))}
        {plates.length > 0 && (
          <div className="mt-4 flex w-full max-w-xl flex-col gap-2 lg:mt-3">
            {plates.map((candidate) => (
              <Plate key={candidate} candidate={candidate} onChoose={onChoose} named={twoHan(plates)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* N — The sign: the Latin voices side by side, the plates beneath          */
/* ------------------------------------------------------------------------ */

/**
 * The same rule as J with one difference of layout: the resting language
 * and the pinned languages the kiosk cannot speak yet stand side by side as
 * columns — the bilingual sign every American lobby already has — rather
 * than stacked. Two things this buys, both from round 7: the Spanish family
 * is beside the English rather than under it, and the Chinese plate sits as
 * high as it did with one pin, because the Latin voices share their height
 * instead of adding it. What it costs: the English instruction steps down
 * one size to fit its column, and a Latin reader has two headlines at the
 * top of the screen to tell apart rather than one. With every pin spoken it
 * is J exactly.
 */
function Sign(props: IdleProps) {
  const { backdrop, chosen, onChoose, pins, speaks } = props;
  if (chosen) return <LanguageBarIdle {...props} />;
  const dim = backdrop ? 'text-ink-300' : 'text-ink-400';
  const { lines, plates } = partition(pins, speaks);
  const columns = [RESTING, ...lines];
  return (
    <div className="flex flex-col items-center pt-6 text-center lg:pt-2">
      <div className={`relative isolate flex w-full max-w-2xl flex-col items-center ${backdrop ? 'max-lg:rounded-2xl max-lg:bg-ink-950/70 max-lg:px-6 max-lg:py-5' : ''}`}>
        <IdleGround />
        <div className="flex w-full flex-row items-start justify-center gap-6">
          {columns.map((candidate) => (
            <div key={candidate} className="flex flex-1 flex-col items-center" lang={candidate}>
              <div
                className={`leading-tight font-semibold text-balance ${
                  columns.length === 1
                    ? 'text-4xl text-ink-100 tall:text-5xl'
                    : candidate === RESTING
                      ? 'text-3xl text-ink-100 tall:text-4xl'
                      : 'text-2xl text-ink-200 tall:text-3xl'
                }`}
              >
                {COPY[candidate].name}
              </div>
              <div className={`pt-1 text-base kiosk:text-lg ${dim}`}>{COPY[candidate].orDigits}</div>
            </div>
          ))}
        </div>
        {plates.length > 0 && (
          <div className="mt-4 flex w-full max-w-xl flex-col gap-2 lg:mt-3">
            {plates.map((candidate) => (
              <Plate key={candidate} candidate={candidate} onChoose={onChoose} named={twoHan(plates)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* G — The grid: a pronounced two-by-two of language names at the top       */
/* ------------------------------------------------------------------------ */

/**
 * The owner's idea, round 9: a prominent two-by-two of the four languages
 * at the top of the panel — English beside Simplified on the first row,
 * Spanish beside Traditional on the second — each cell a button nearly the
 * size of the instruction itself, the current language lit, and the
 * instruction beneath in the current language. One shape for every state,
 * as the bar; twice the bar's height. The names are the lobby's switch
 * (staff, round 9): English and the pinned languages the kiosk speaks, two
 * across when there are four of them and one row when fewer — so today the
 * grid is a row of three with the Spanish line beneath, and the day
 * `es.json` lands it is the two-by-two as drawn.
 *
 * Three sizes, to find the one that is pronounced without shouting: the
 * cells step from the bar's own type to the instruction's.
 */
/** Columns for the number of names: two across from four, one row below it. */
const GRID_COLS: Record<number, string> = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-2' };

const GRID_CELL = {
  1: 'h-16 text-2xl tall:h-20 tall:text-3xl',
  2: 'h-20 text-3xl tall:h-24 tall:text-4xl',
  3: 'h-24 text-4xl tall:h-28 tall:text-5xl',
} as const;

function Grid({ backdrop, onChoose, chosen, pins, speaks, size }: IdleProps & { size: keyof typeof GRID_CELL }) {
  const t = useTranslations('Common');
  const lang = usePanelLang(chosen);
  const copy = COPY[lang];
  const tap = useTap();
  const dim = backdrop ? 'text-ink-300' : 'text-ink-400';
  const { lines } = partition(pins, speaks);
  const names = switchOf(pins, speaks);
  /* The glass's width rather than the sign's measure: three Han names at
     the instruction's size need it, and the headline then sets on one row
     (the clutter critic's orphan rows, round 9). */
  return (
    <div className="flex flex-col items-center pt-4 text-center tall:pt-6 lg:pt-2">
      <div className={`relative isolate flex w-full max-w-2xl flex-col items-center ${backdrop ? 'max-lg:rounded-2xl max-lg:bg-ink-950/70 max-lg:px-6 max-lg:py-5' : ''}`}>
        <IdleGround />
        <div role="group" aria-label={t('language')} className={`grid w-full gap-3 ${GRID_COLS[Math.min(names.length, 4)] ?? 'grid-cols-2'}`}>
          {names.map((candidate) => {
            const current = candidate === lang;
            return (
              <button
                key={candidate}
                type="button"
                tabIndex={-1}
                lang={candidate}
                aria-pressed={current}
                {...tap(() => {
                  haptic();
                  onChoose(candidate);
                })}
                /* `whitespace-nowrap`: a language's name never comes apart
                   (every reader, round 10 — a word snapped in half is what a
                   broken machine looks like). If a size cannot hold the names
                   whole, the frame scrolls sideways and the shooter says so:
                   that size is not the size. The unlit tokens are the bar's,
                   one switch, one palette (staff). */
                className={`flex items-center justify-center rounded-xl px-2 leading-none font-semibold whitespace-nowrap ${GRID_CELL[size]} ${
                  current
                    ? 'bg-ink-700 text-ink-50 ring-2 ring-ink-400'
                    : 'bg-ink-800 text-ink-300 ring-1 ring-ink-600 active:bg-ink-600'
                }`}
                style={{ touchAction: 'manipulation' }}
              >
                {LABELS[candidate]}
              </button>
            );
          })}
        </div>
        <div className="mt-6 text-4xl leading-tight font-semibold text-balance text-ink-100 tall:mt-8 tall:text-5xl" lang={lang}>
          {copy.name}
        </div>
        <div className={`pt-1 text-lg kiosk:text-xl ${dim}`} lang={lang}>
          {copy.orDigits}
          <DigitsCue />
        </div>
        {/* The sign's second language while the kiosk cannot speak it: both
            Spanish-speaking readers asked for a sentence they can read at
            rest, and the grid's Español cell is a door to a room that is
            half built until `es.json` lands. */}
        {chosen === null && lines.map((candidate) => <Line key={candidate} candidate={candidate} dim={dim} />)}
      </div>
    </div>
  );
}

const GridSmall = (props: IdleProps) => <Grid {...props} size={1} />;
const GridMedium = (props: IdleProps) => <Grid {...props} size={2} />;
const GridLarge = (props: IdleProps) => <Grid {...props} size={3} />;

/* ------------------------------------------------------------------------ */
/* K — Doors: the instruction once, and a named door per pin                */
/* ------------------------------------------------------------------------ */

/**
 * The instruction said once, in the resting language; under it a row of
 * doors, one per pinned language, each carrying only that language's own
 * name and the two words "tap here" in it.
 *
 * The least said of any candidate: nothing on the glass is repeated, and
 * the doors are what every bilingual sign in the world already teaches — a
 * language's name, in that language, is the one string its reader finds
 * without reading anything else. The cost is a tap before the first
 * instruction: the grandmother reads nothing about her child until she has
 * pressed 繁體中文. Rounds 1–3 set the bar-first candidate aside for exactly
 * that, with three languages; with four the arithmetic changes, which is
 * why it stands again. Round 9 cut the "tap here" whisper: a language's
 * name at this size on a plate is a button, and the whisper was a second
 * line on an object that needed one. The pinned languages the kiosk cannot
 * speak yet are one line each above the doors, as everywhere.
 */
function Doors(props: IdleProps) {
  const { backdrop, chosen, onChoose, pins, speaks } = props;
  const tap = useTap();
  if (chosen) return <LanguageBarIdle {...props} />;
  const dim = backdrop ? 'text-ink-300' : 'text-ink-400';
  const { lines, plates: doors } = partition(pins, speaks);
  return (
    <div className="flex flex-col items-center pt-6 text-center lg:pt-2">
      <div className={`relative isolate flex w-full max-w-xl flex-col items-center ${backdrop ? 'max-lg:rounded-2xl max-lg:bg-ink-950/70 max-lg:px-6 max-lg:py-5' : ''}`}>
        <IdleGround />
        <div className="text-4xl leading-tight font-semibold text-balance text-ink-100 tall:text-5xl" lang={RESTING}>
          {COPY[RESTING].name}
        </div>
        <div className={`pt-1 text-lg kiosk:text-xl ${dim}`} lang={RESTING}>
          {COPY[RESTING].orDigits}
        </div>
        {lines.map((candidate) => (
          <Line key={candidate} candidate={candidate} dim={dim} />
        ))}
        {doors.length > 0 && (
          <div className="mt-5 flex w-full max-w-md flex-row gap-3 lg:mt-3">
            {doors.map((candidate) => (
              <button
                key={candidate}
                type="button"
                tabIndex={-1}
                lang={candidate}
                aria-label={LABELS[candidate]}
                {...tap(() => {
                  haptic(8);
                  onChoose(candidate);
                })}
                className="flex min-h-14 flex-1 items-center justify-center rounded-xl bg-ink-800 px-3 py-2 text-center text-xl leading-tight font-semibold text-ink-100 ring-1 ring-ink-600 active:bg-ink-600 tall:min-h-16 tall:text-2xl"
                style={{ touchAction: 'manipulation' }}
              >
                {LABELS[candidate]}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* D — One welcome at a time                                                 */
/* ------------------------------------------------------------------------ */

/**
 * One instruction on the glass at any moment, and every language over
 * twelve seconds.
 *
 * The bar stands where the eye lands and is the control: a tap pins a
 * language, and the panel becomes that language's screen. Under it, one
 * sentence — the name route, the digits under it, the next step — that
 * crossfades through the three languages, four seconds each. Nothing is
 * said twice on the glass, and nothing moves but the words. The cost is
 * time: a reader whose language is not up waits up to eight seconds, or
 * reads the bar, which names their language in its own script from the
 * first frame.
 */
function OneAtATime({ backdrop, onChoose, chosen, pins, speaks, phase, ...rest }: IdleProps) {
  const dim = backdrop ? 'text-ink-300' : 'text-ink-400';
  if (chosen)
    return <LanguageBarIdle backdrop={backdrop} onChoose={onChoose} chosen={chosen} pins={pins} speaks={speaks} {...rest} />;
  const items = (pick: (candidate: Lang) => string) =>
    ORDER.map((candidate) => ({ locale: candidate, text: pick(candidate) }));
  return (
    <div className="flex flex-col items-center pt-4 text-center tall:pt-6 lg:pt-2">
      <div className="relative isolate flex w-full flex-col items-center">
        <IdleGround />
        <LanguageBar onChoose={onChoose} chosen={chosen} pins={pins} speaks={speaks} />
        <div className="mt-6 w-full max-w-xl tall:mt-8 lg:mt-3">
          <Cycle
            items={items((candidate) => COPY[candidate].name)}
            phase={phase}
            className="text-4xl leading-tight font-semibold text-balance text-ink-100 tall:text-5xl"
          />
        </div>
        <div className={`w-full max-w-xl pt-1 text-lg kiosk:text-xl ${dim}`}>
          <Cycle items={items((candidate) => COPY[candidate].orDigits)} phase={phase} />
        </div>
        <div className={`w-full max-w-xl pt-4 text-lg kiosk:text-xl lg:pt-2 ${dim}`}>
          <Cycle items={items((candidate) => COPY[candidate].thenTap)} phase={phase} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* H — A second voice                                                        */
/* ------------------------------------------------------------------------ */

/**
 * The resting language leads, still; one Chinese line breathes under it.
 *
 * The English instruction stands as it does today — big, static, the thing
 * the English parent never reads and the thing that tells a newcomer the
 * tablet is for them. Under it, one line in Chinese, alternating between
 * the two scripts every four seconds, and that line is a door: a tap takes
 * whichever script is showing, and the panel becomes that language's
 * screen. The two scripts read each other well enough that a tap on the
 * other one costs nothing (the father: "either is fine"). The digits and
 * the next step stay in the resting language. No bar at rest, no chips at
 * rest: one big sentence, one moving line, one way in.
 */
function SecondVoice(props: IdleProps) {
  const { backdrop, chosen, onChoose, phase } = props;
  const dim = backdrop ? 'text-ink-300' : 'text-ink-400';
  if (chosen) return <LanguageBarIdle {...props} />;
  const voices = ORDER.filter((candidate) => candidate !== RESTING).map((candidate) => ({
    locale: candidate,
    text: COPY[candidate].name,
  }));
  return (
    <div className="flex flex-col items-center pt-6 text-center lg:pt-2">
      <div className="relative isolate flex w-full max-w-xl flex-col items-center">
        <IdleGround />
        <div
          className="text-4xl leading-tight font-semibold text-balance text-ink-100 tall:text-5xl"
          lang={RESTING}
        >
          {COPY[RESTING].name}
        </div>
        <div className="mt-3 w-full">
          <Cycle
            items={voices}
            phase={phase}
            onChoose={onChoose}
            className="text-2xl leading-tight font-semibold text-ink-200 tall:text-3xl"
          />
        </div>
        <div className={`pt-2 text-lg kiosk:text-xl ${dim}`} lang={RESTING}>
          {COPY[RESTING].orDigits}
        </div>
        <div className={`mt-4 text-lg kiosk:text-xl lg:mt-2 ${dim} ${backdrop ? 'hidden lg:block' : ''}`} lang={RESTING}>
          {COPY[RESTING].thenTap}
        </div>
      </div>
    </div>
  );
}

/* The table is the file's subject; the harness reads it beside the components it names. */
// eslint-disable-next-line react-refresh/only-export-components
export const VARIANTS: Record<string, VariantSpec> = {
  voices: {
    summary:
      'J: the resting language leads as today; a pinned language the kiosk cannot speak yet is one line in the same block, one it can speak is a still plate under it carrying its own name route and digits route, and the door. Nothing else. Chips only once something is typed, only for languages the kiosk speaks.',
    Idle: Voices,
    Picker: PromotedChips,
    NoMatch: NoMatchPanel,
  },
  sign: {
    summary:
      'N: J’s rule with the Latin voices side by side as columns, the bilingual sign, and the plates beneath; the Chinese plate as high as with one pin.',
    Idle: Sign,
    Picker: PromotedChips,
    NoMatch: NoMatchPanel,
  },
  welcomes: {
    summary:
      'A: every language the lobby speaks at rest as an equal, named plate, the resting one first, each the name route and the digits route, each a door; the next step once beneath.',
    Idle: Welcomes,
    Picker: PromotedChips,
    NoMatch: NoMatchPanel,
  },
  'grid-1': {
    summary:
      'G, small: a two-by-two of the four language names at the top — English · 简体中文 / Español · 繁體中文 — at the bar’s type, the current one lit; the instruction beneath in the current language. Every language a door.',
    Idle: GridSmall,
    Picker: PromotedChips,
    NoMatch: NoMatchPanel,
  },
  'grid-2': {
    summary: 'G, medium: the grid one step up, cells 96px tall at 36px.',
    Idle: GridMedium,
    Picker: PromotedChips,
    NoMatch: NoMatchPanel,
  },
  'grid-3': {
    summary: 'G, large: the grid at the instruction’s own size, cells 112px tall at 48px.',
    Idle: GridLarge,
    Picker: PromotedChips,
    NoMatch: NoMatchPanel,
  },
  'language-bar': {
    summary:
      'B: one instruction under one pronounced switcher — the bar of language names at full weight, English lit at rest — and one line per pinned language the kiosk cannot speak yet. The screen every candidate becomes once a language is chosen, made the resting screen too: one shape for every state.',
    Idle: LanguageBarIdle,
    Picker: PromotedChips,
    NoMatch: NoMatchPanel,
  },
  /* Round 7's `latin-together` (Spanish as lines, no door) became J's rule
     rather than a candidate. */
  doors: {
    summary:
      'K: the instruction once, in the resting language; one line per pinned language the kiosk cannot speak yet; under them a door per language it can, carrying only that language’s own name. Nothing else.',
    Idle: Doors,
    Picker: PromotedChips,
    NoMatch: NoMatchPanel,
  },
  /* Round 4's two moving candidates, kept for the record: every parent
     rejected the cycling instruction, and the alternating line's lesson —
     a second voice, present from the first second, still, and not the
     thing you press — is `voices`. */
  'one-at-a-time': {
    summary:
      'D (round 4): the bar as the control; under it one instruction that crossfades through every language, four seconds each.',
    Idle: OneAtATime,
    Picker: PromotedChips,
    NoMatch: NoMatchPanel,
  },
  'second-voice': {
    summary:
      'H (round 4): the resting language leads; one Chinese line alternates between the two scripts beneath it and is the door.',
    Idle: SecondVoice,
    Picker: PromotedChips,
    NoMatch: NoMatchPanel,
  },
};
