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
 * is the real screen around exactly the thing being argued about.
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
import { LOCALES, LOCALE_LABELS, LOCALE_SHORT_LABELS, type Locale } from '@/lib/locales';

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
}: {
  widening: boolean;
  onWiden: () => void;
  /** The standing row's weight, beside a keyboard somebody is aiming at. */
  quiet?: boolean;
}) {
  const t = useTranslations('Search');
  const tap = useTap();

  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={t('searchEveryone')}
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
        <span className={widening ? 'invisible' : undefined}>{t('searchEveryone')}</span>
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
}: {
  offeredAbove: boolean;
  canWiden: boolean;
  widening: boolean;
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
      {!offeredAbove && canWiden && <WidenButton widening={widening} onWiden={onWiden} quiet />}
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
              <span className="hidden sm:inline">
                {hasResults ? t('offerNotYours') : t('offerFirstTime')}
              </span>
            </>
          ) : (
            <>{hasResults ? t('offerNotYours') : t('offerFirstTime')}</>
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
  initialChosen = false,
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
  /** The harness's `?chosen=1`: photograph the screen after a family has chosen. */
  initialChosen?: boolean;
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
   * Whether a family has chosen a language this visit — its own fact, not
   * inferred from the locale. Inferred (`locale !== RESTING`) the English
   * door was a no-op: pressing it set the locale it already had and changed
   * not one pixel, which is the round-1 grandmother failure handed to the
   * English parent, who is most of the queue. In the app this flag lives in
   * `KioskApp` beside the locale and resets on the same two clocks the
   * locale does — `cameHome` and `LANGUAGE_RESET_MS`.
   */
  const [chosen, setChosen] = useState(initialChosen);
  const { setLocale } = useLocaleControl();
  const onChoose = useCallback(
    (candidate: Locale) => {
      setLocale(candidate);
      setChosen(true);
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
            <VariantIdle variant={variant} backdrop={backdrop} onRegister={steadyRegister} chosen={chosen} onChoose={onChoose} />
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
            <VariantPicker variant={variant} chosen={chosen} onChoose={onChoose} />
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
          {matchCount > 0 && (
            <span className="absolute right-0 text-sm text-ink-400 kiosk:text-base">
              {/*
                * A number while the list is all of it, a sentence when it is
                * not. `MAX_RESULTS` is eight, and "8 names" over a list that
                * was cut from twenty-three is a complete-looking answer to an
                * incomplete search — the parent scrolls all eight, finds
                * nobody, and the doors left to them include the one that
                * registers a child the church already has. Past the cap the
                * only useful thing to say is the thing that works.
                */}
              {t('matchCount', { count: matchCount })}
            </span>
          )}
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
  chosen: boolean;
  onChoose: (candidate: Locale) => void;
}

export interface IdleProps extends ChoiceProps {
  /** The gathering's photograph is mounted behind the screen. */
  backdrop: boolean;
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
  Picker?: (props: ChoiceProps) => React.ReactElement | null;
}

function VariantIdle({ variant, ...props }: IdleProps & { variant: string }) {
  const Idle = VARIANTS[variant]?.Idle;
  return Idle ? <Idle {...props} /> : null;
}

function VariantPicker({ variant, ...props }: ChoiceProps & { variant: string }) {
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
 * What the round-0 panel asked for, in every language: the four-digit route
 * first and biggest, because it needs no spelling and no script; "the child's
 * English name" rather than 姓名, which two readers paused on (whose name?);
 * and a no-match panel whose first answer is "try the digits" rather than
 * "are you new?". Literals here because the prototype is thrown away; what
 * ships goes through `messages/kiosk/*.json` and the drafting pipeline, and
 * the Chinese below is a draft for the congregation's own reviewers, not a
 * translation to be trusted as is. Vocabulary follows `messages/GLOSSARY.md`
 * and the shipped catalogue (電話後四碼 / 后 4 位, 英文名字, 同工).
 */
const COPY: Record<
  Locale,
  {
    digits: string;
    orName: string;
    thenTap: string;
    noMatch: string;
    tryDigits: string;
    tryAnother: string;
    firstTime: string;
  }
> = {
  en: {
    digits: 'Last 4 digits of your phone',
    orName: 'or type your child’s name',
    thenTap: 'Then tap your child’s name.',
    noMatch: 'No match',
    tryDigits: 'Try the last 4 digits of your phone.',
    tryAnother: 'Try another phone number in your family, or type a name.',
    firstTime: 'First time here?',
  },
  'zh-Hans': {
    digits: '输入电话后 4 位',
    orName: '或输入孩子的英文名字',
    thenTap: '然后点一下您孩子的名字。',
    noMatch: '找不到',
    tryDigits: '试试输入电话后 4 位。',
    tryAnother: '试试家里另一个电话的后 4 位，或输入英文名字。',
    firstTime: '第一次来吗？',
  },
  'zh-Hant': {
    digits: '輸入電話後 4 碼',
    orName: '或輸入孩子的英文名字',
    thenTap: '然後點一下您孩子的名字。',
    noMatch: '找不到',
    tryDigits: '試試輸入電話後 4 碼。',
    tryAnother: '試試家中另一支電話的後 4 碼，或輸入英文名字。',
    firstTime: '第一次來嗎？',
  },
};

function useCopy() {
  return COPY[useLocale() as Locale] ?? COPY.en;
}

/**
 * What the kiosk rests in — `RESTING_LOCALE` in `src/kiosk/KioskApp.tsx`.
 *
 * A locale that differs from it is a family's choice for their visit; equal
 * to it, nobody has chosen anything yet and the screen cannot know who is
 * standing there. The panels below say the route in every language in that
 * state and in the chosen language once there is one.
 */
const RESTING: Locale = 'en';

/** The languages, resting language first. */
const ORDER: Locale[] = [RESTING, ...LOCALES.filter((candidate) => candidate !== RESTING)];

/* ------------------------------------------------------------------------ */
/* Shared parts                                                              */
/* ------------------------------------------------------------------------ */

/**
 * Four empty boxes: the phone route said without a word.
 *
 * The grandmother's own direction — "four empty boxes and 電話後四碼, I would
 * have understood it from the shape alone". Drawn, not an icon: the kiosk has
 * no icon library, and a ring on a rounded box is the same material as the
 * keys under it. `aria-hidden`, because the sentence beside it says the same
 * thing to a screen reader.
 */
function FourBoxes({ size = 'md', plain = false }: { size?: 'md' | 'lg'; plain?: boolean }) {
  /* Filled, like an empty key, rather than outlined: over a photograph a
     thin ring against a pale sky was the first thing to go, and the boxes
     are the one part of this panel that has to read with no words at all. */
  /* `plain` is the no-match panel's: no photograph can be behind that
     state, and filled there the boxes read as four empty keys waiting for a
     finger — the grandmother would have poked one. Outlined, they are a
     picture beside the sentence. */
  const fill = plain ? 'ring-2 ring-ink-600 ring-inset' : 'bg-ink-800 ring-2 ring-ink-600 ring-inset';
  const box =
    size === 'lg'
      ? `h-14 w-11 rounded-lg ${fill} kiosk:h-16 kiosk:w-12`
      : `h-10 w-8 rounded-md ${fill} kiosk:h-12 kiosk:w-9`;
  return (
    <div aria-hidden="true" className={`flex ${size === 'lg' ? 'gap-3' : 'gap-2.5'}`}>
      {[0, 1, 2, 3].map((index) => (
        <span key={index} className={box} />
      ))}
    </div>
  );
}

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
 * The no-match panel every candidate shares.
 *
 * Both Chinese-reading parents pressed the blue button on a failed name
 * search because it was the only thing that looked pressable, and landed in a
 * registration form for children the church already has. The father's ask,
 * verbatim: "when it can't find a name, the first and biggest thing should be
 * 'try the last four digits of your phone'". So the heading is the outcome,
 * the next line is the route that needs no spelling, and the doors keep
 * their weights — register still leads, because it is still the newcomer's
 * door — with the question that used to be the heading now captioning them.
 * Mode-aware: a four-digit search that found nobody is told to try another
 * number in the family, not the digits it just typed.
 */
function NoMatchPanel({ mode, widening, onWiden, onRegister, chosen }: NoMatchProps) {
  const t = useTranslations('Search');
  const { locale } = useLocaleControl();
  const copy = COPY[locale] ?? COPY.en;
  const tap = useTap();
  const route = (candidate: Locale) =>
    mode === 'phone' ? COPY[candidate].tryAnother : COPY[candidate].tryDigits;
  /*
   * Nobody has chosen a language, so the panel cannot know who typed the
   * name that found nobody — and the round-1 father reached exactly this
   * screen, in English, before he had tapped anything: "word for word what
   * defeated me". So while the kiosk is at rest the route is said in every
   * language, with the boxes, and the doors stay quiet under it.
   */
  const unchosen = !chosen;
  /* 找不到 is the same string in both scripts, and printed twice it read as
     a stutter. One line per distinct sentence, the first language to say it
     keeping the credit. */
  const distinct = (pick: (candidate: Locale) => string) =>
    ORDER.filter((candidate, index) => ORDER.findIndex((other) => pick(other) === pick(candidate)) === index);
  return (
    <div className="mx-auto flex h-full w-full max-w-xs flex-col items-stretch gap-3 pt-6 text-center tall:max-w-md tall:justify-end tall:gap-4 lg:max-w-2xl">
      <div className="mx-auto max-w-sm text-center text-3xl leading-tight font-semibold text-balance text-ink-100 tall:max-w-md kiosk:text-4xl">
        {unchosen ? (
          <span className="flex flex-col items-center gap-1">
            {distinct((candidate) => COPY[candidate].noMatch).map((candidate) => (
              <span key={candidate} lang={candidate}>
                {COPY[candidate].noMatch}
              </span>
            ))}
          </span>
        ) : (
          copy.noMatch
        )}
      </div>
      {/* The boxes in both states: the father found the panel gave him less
          once he had tapped 简 — the boxes are what his thumb aims at. */}
      <div className="flex justify-center pt-1">
        <FourBoxes plain />
      </div>
      {/* The route, at the heading's own brightness: every parent on the
          panel said the blue button was still the loudest thing on the
          screen, and pressing bright blue things is what a rushed thumb
          does. So the advice carries the weight and the doors go quiet. */}
      <div className="mx-auto flex max-w-sm flex-col gap-1 text-center text-xl leading-snug text-balance text-ink-100 tall:max-w-md kiosk:text-2xl">
        {unchosen ? (
          distinct(route).map((candidate) => (
            <span key={candidate} lang={candidate}>
              {route(candidate)}
            </span>
          ))
        ) : (
          <span className="text-2xl kiosk:text-3xl">{route(locale)}</span>
        )}
      </div>
      <div className="mt-auto flex flex-col items-stretch gap-3 pt-6 tall:mt-0 tall:gap-4">
        <div className="text-base text-ink-400 kiosk:text-lg">{copy.firstTime}</div>
        <div className="flex flex-col items-stretch gap-3 tall:gap-4 lg:flex-row lg:justify-center lg:gap-4">
          <button
            type="button"
            tabIndex={-1}
            {...tap(() => {
              haptic();
              onRegister();
            })}
            /* The widen button's own weight — a door, not the answer. It
               stays first, because it is still the newcomer's door and the
               order is what the shipped screen taught. */
            className="flex h-14 w-full items-center justify-center rounded-xl bg-ink-800 px-8 text-lg font-semibold text-ink-100 active:bg-ink-700 tall:h-16 kiosk:text-xl lg:flex-1"
          >
            {t('registerYourChild')}
          </button>
          <WidenButton widening={widening} onWiden={onWiden} />
        </div>
      </div>
      <div className="text-base text-ink-400 kiosk:text-lg">{t('orSeeALeader')}</div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* A — Three welcomes                                                        */
/* ------------------------------------------------------------------------ */

/**
 * The instruction in all three languages at once, each line a door — and,
 * once a door is taken, the chosen language leading.
 *
 * Round 1 settled the shape. At rest the three doors are three short signs
 * at one weight: the Traditional reader "finds her script by its shape", the
 * English reader never reads the top of the screen, and a highlighted door
 * at rest asked a question nobody had answered yet. After a tap the panel
 * becomes the language-bar screen — the chosen language big and alone, the
 * next step under it, the other two languages one tap away in the bar —
 * because a tap that only brightened one plate "barely changed the screen"
 * and the grandmother pressed it again with people waiting. The English
 * parent meets the same bar when the family ahead walked off mid-search:
 * a whole-word English button they can hit without aiming.
 *
 * "Chosen" is the app's own distinction — `RESTING_LOCALE` in KioskApp.tsx
 * is what the kiosk rests in, and a locale that differs from it is a family's
 * choice for their visit. The doors stand in the resting language's order,
 * resting language first, so a lobby that rests in Chinese (the staff ask)
 * would lead with Chinese and offer English the same way.
 *
 * Opaque plates: a 70% plate over the page had the renderer fringing the
 * Traditional glyphs in colour, and three plates at one fill read as one
 * object rather than a busy one. Non-blocking, which is the English parent's
 * one condition — the keys work whatever is or is not pressed here. On the
 * landscape tablet the three stand side by side, because that shape has
 * width and no height.
 */
function ThreeWelcomes(props: IdleProps) {
  const { backdrop, chosen, onChoose } = props;
  const tap = useTap();
  if (chosen) return <LanguageBarIdle {...props} />;
  const dim = backdrop ? 'text-ink-300' : 'text-ink-400';
  return (
    <div className="flex flex-col items-center pt-4 text-center tall:pt-6 lg:pt-2">
      <div className="relative isolate flex w-full max-w-xl flex-col items-center lg:max-w-5xl">
        <IdleGround />
        <FourBoxes />
        {/* Each plate carries its own name-route line. Round 1 found the two
            Chinese sub-lines near-identical and dropped them; round 2 found
            that the one sentence that would have stopped the father typing
            pinyin — 英文名字, the child's *English* name — was then only on
            the glass after a tap, for exactly the reader who cannot read the
            English line. The plates are told apart by their headlines
            (后 4 位 / 後 4 碼), not by these, so the sub-lines can match. */}
        <div className="mt-4 flex w-full flex-col gap-2 lg:mt-3 lg:flex-row lg:gap-3">
          {ORDER.map((candidate: Locale) => {
            const copy = COPY[candidate];
            return (
              <button
                key={candidate}
                type="button"
                tabIndex={-1}
                lang={candidate}
                aria-label={LOCALE_LABELS[candidate]}
                {...tap(() => {
                  haptic(8);
                  onChoose(candidate);
                })}
                className="flex min-h-14 w-full flex-col items-center justify-center rounded-xl bg-ink-800 px-4 py-2 text-center text-ink-100 active:bg-ink-600 tall:min-h-16 lg:flex-1"
                style={{ touchAction: 'manipulation' }}
              >
                <span className="text-xl leading-tight font-semibold tall:text-3xl">{copy.digits}</span>
                <span className="text-sm leading-tight text-ink-400 tall:text-lg">{copy.orName}</span>
              </button>
            );
          })}
        </div>
        {/* The next step, kept: a name row is a button that does not look
            like one, and this is the sentence that stops a parent hunting
            for a button and finding the register door — the staff's review
            queue. In the resting language; the chosen screen says it in the
            chosen one. */}
        {/* On the tablet on end the photograph's canopy stops above this
            line, and at ink-300 over the picture's brightest patch it was a
            ghost — the one sentence the round added was the one nobody could
            read. Its own page-token plate while the picture is up (the
            register chip's own trick); nothing on a plain kiosk. */}
        <div
          className={`mt-3 text-base kiosk:text-lg ${dim} ${backdrop ? 'rounded-lg bg-ink-950/75 px-3 py-1' : ''}`}
          lang={RESTING}
        >
          {COPY[RESTING].thenTap}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* B — Language bar                                                          */
/* ------------------------------------------------------------------------ */

/**
 * One language leads; the other two are one tap away, at full weight, where
 * the eye already is.
 *
 * The staff consultant's "answerable version": not three of everything, but
 * a legible door. The control is the pairing screen's own picker — the same
 * component at its full weight (56px, the languages' own names) — standing at
 * the top of the results region on the idle screen, so it is the first thing
 * under the header and the words 繁體中文 / 简体中文 are on the resting glass
 * for the reader who needs them. Under it, the instruction in the current
 * language, phone-first. The band's quiet chips stay for the typed states.
 */
function LanguageBarIdle({ backdrop, onChoose }: IdleProps) {
  const copy = useCopy();
  const dim = backdrop ? 'text-ink-300' : 'text-ink-400';
  return (
    <div className="flex flex-col items-center pt-4 text-center tall:pt-6 lg:pt-2">
      {/* The bar stands inside the plate-and-halo block: as a sibling above
          it, the halo's negative inset reached up behind the bar on the
          landscape shelf and drew dark tails under the buttons. One mass,
          one ground.
          The landscape tablet's track is under 300px: the bar, the boxes and
          a one-line heading fit it at 4xl; the 5xl the portrait shelf wears
          wraps the phone-first sentence onto two lines and past the rule. */}
      <div className="relative isolate flex flex-col items-center">
        <IdleGround />
        <LanguageBar onChoose={onChoose} />
        <div className="mt-6 tall:mt-8 lg:mt-3">
          <FourBoxes />
        </div>
        <div className="mt-3 text-4xl leading-tight font-semibold text-balance text-ink-100 tall:text-5xl lg:mt-2">
          {copy.digits}
        </div>
        <div className={`pt-1 text-lg kiosk:text-xl ${dim}`}>{copy.orName}</div>
        <div className={`pt-4 text-lg kiosk:text-xl lg:pt-2 ${dim}`}>{copy.thenTap}</div>
      </div>
    </div>
  );
}

/**
 * The pairing screen's picker, with one responsive difference: the
 * languages' whole names where three of them fit across the glass (`sm:`
 * and up — every tablet), the one-glyph badges on a phone, where 繁體中文
 * broke across two lines inside its own button. The implementation is a
 * label prop on `LanguagePicker`, not a second component.
 */
function LanguageBar({ onChoose }: { onChoose: (candidate: Locale) => void }) {
  const t = useTranslations('Common');
  const { locale } = useLocaleControl();
  const tap = useTap();
  return (
    <div role="group" aria-label={t('language')} className="flex items-center gap-2">
      {LOCALES.map((candidate: Locale) => {
        const current = candidate === locale;
        return (
          <button
            key={candidate}
            type="button"
            tabIndex={-1}
            lang={candidate}
            aria-label={LOCALE_LABELS[candidate]}
            aria-pressed={current}
            {...tap(() => {
              haptic();
              onChoose(candidate);
            })}
            className={`flex h-14 min-w-14 items-center justify-center rounded-xl px-4 text-lg font-semibold sm:min-w-24 sm:px-5 ${
              current
                ? 'bg-ink-700 text-ink-50'
                : 'bg-ink-800/70 text-ink-400 active:bg-ink-700 active:text-ink-100'
            }`}
            style={{ touchAction: 'manipulation' }}
          >
            <span className="sm:hidden">{LOCALE_SHORT_LABELS[candidate]}</span>
            <span className="hidden sm:inline">{LOCALE_LABELS[candidate]}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* C — Digits first                                                          */
/* ------------------------------------------------------------------------ */

/**
 * The route that needs no language, drawn so it needs no reading.
 *
 * Four big boxes and a telephone, the captions in all three languages at one
 * quiet weight, and the name route as a footnote. The bet is the father's:
 * "half of this whole language problem disappears if the fastest route stops
 * needing words". The language control stays in the band where it was, but
 * at the size and weight the staff consultant asked for — 44px, every chip
 * legible, plated — so it survives a photograph and a thumb.
 */
function DigitsFirstIdle({ backdrop }: IdleProps) {
  const { locale } = useLocaleControl();
  const dim = backdrop ? 'text-ink-300' : 'text-ink-400';
  /* The current language first and at full weight, the other two under it
     at the quiet weight: round 1 found the block did not answer a tap at
     all — English stayed first and bold whatever was chosen — and that the
     scripts stood in a different order here than in the chips. One order,
     one constant, current language first. */
  const lead = locale in COPY ? locale : RESTING;
  const rest = ORDER.filter((candidate) => candidate !== lead);
  return (
    <div className="flex flex-col items-center pt-6 text-center lg:pt-3">
      <div className="relative isolate flex flex-col items-center">
        <IdleGround />
        <FourBoxes size="lg" />
        <div className="mt-4 flex flex-col items-center gap-1">
          <span lang={lead} className="text-3xl leading-tight font-semibold text-ink-100 kiosk:text-4xl">
            {COPY[lead].digits}
          </span>
          {rest.map((candidate) => (
            <span key={candidate} lang={candidate} className={`text-lg leading-snug kiosk:text-xl ${dim}`}>
              {COPY[candidate].digits}
            </span>
          ))}
        </div>
        {/* Said once, in the current language: the trilingual footnote ran
            wider than the plate that was meant to ground it and washed into
            the photograph, and the name route is the slow one. */}
        <div className={`pt-4 text-base leading-snug kiosk:text-lg ${dim}`} lang={lead}>
          {COPY[lead].orName}
        </div>
        <div className={`pt-3 text-base leading-snug kiosk:text-lg ${dim}`} lang={lead}>
          {COPY[lead].thenTap}
        </div>
      </div>
    </div>
  );
}

/** The band's chips at 44px, every one legible, plated — the same glyphs. */
function PromotedChips({ onChoose }: ChoiceProps) {
  const t = useTranslations('Common');
  const { locale } = useLocaleControl();
  const tap = useTap();
  return (
    /* Where in the band, stated as a rule for both neighbours. On a tablet
       the register offer is centred and narrower than the glass, so the
       chips at the left edge are horizontally clear of it, and they sit at
       the band's top: the dead zone above the keys is then 44px on the
       tablet on end and 28px on its side — wider than any gutter on the
       board — which is what answered the English parent's brushed-thumb
       finding. On a phone the offer spans the glass and the chips sit under
       it, so an upward miss would open the wizard; there they centre in the
       band instead, 10px clear of the offer and 18px clear of the keys. */
    <span
      role="group"
      aria-label={t('language')}
      className="absolute left-0 flex items-center gap-1 sm:top-0"
    >
      {LOCALES.map((candidate: Locale) => {
        const current = candidate === locale;
        return (
          <button
            key={candidate}
            type="button"
            tabIndex={-1}
            lang={candidate}
            aria-label={LOCALE_LABELS[candidate]}
            aria-pressed={current}
            {...tap(() => {
              haptic(8);
              onChoose(candidate);
            })}
            /* 44px tall everywhere; 36px wide on a phone, as the shipped chips
               are, because the band's buffer inset (px-24) is measured for
               that width and a 44px third chip ran into the typed word.
               Tablets have the room and get the full 44. */
            className={`flex h-11 min-w-9 items-center justify-center rounded-lg px-1.5 text-base font-semibold sm:min-w-11 sm:px-2 ${
              current
                ? 'bg-ink-700 text-ink-50'
                : 'bg-ink-800/70 text-ink-300 active:bg-ink-700 active:text-ink-100'
            }`}
            style={{ touchAction: 'manipulation' }}
          >
            {LOCALE_SHORT_LABELS[candidate]}
          </button>
        );
      })}
    </span>
  );
}

/* The table is the file's subject; the harness reads it beside the components it names. */
// eslint-disable-next-line react-refresh/only-export-components
export const VARIANTS: Record<string, VariantSpec> = {
  'three-welcomes': {
    summary:
      'A: at rest, the phone-first instruction in all three languages as three equal doors; once a door is taken, the chosen language leads under the language bar (B). Band chips promoted.',
    Idle: ThreeWelcomes,
    Picker: PromotedChips,
    NoMatch: NoMatchPanel,
  },
  'language-bar': {
    summary:
      'B: one language leads; the pairing screen’s full-weight picker at the top of the idle region; phone-first instruction under it. Band chips promoted.',
    Idle: LanguageBarIdle,
    Picker: PromotedChips,
    NoMatch: NoMatchPanel,
  },
  'digits-first': {
    summary:
      'C: four big boxes, the instruction led by the current language with the other two quiet under it, the name route said once; no language doors; band chips promoted to 44px and plated.',
    Idle: DigitsFirstIdle,
    Picker: PromotedChips,
    NoMatch: NoMatchPanel,
  },
};
