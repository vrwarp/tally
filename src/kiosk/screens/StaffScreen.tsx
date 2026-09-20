/**
 * What the staff gate opens onto.
 *
 * The two-second hold on **Clear** used to open `ChangeEventScreen` directly, so
 * the only door behind the gate was the one that shuts the kiosk. Everything
 * else a volunteer might want was *through* that door: leave the gathering,
 * meet the chooser, open the printer, come back, hold a row to re-point the
 * kiosk at the event it was already on. A reprint cost the queue at the door.
 *
 * So the gate opens onto the doors instead, and leaving the gathering is one of
 * them rather than all of them. The warning that used to greet the hold goes
 * with it: it belongs to that choice, not to the act of looking.
 *
 * ## A row is a row
 *
 * This screen is a menu of destinations, and it spent a round reading as
 * a mess because it was written as if it were three different kinds of thing.
 * The first two rows were one object; **Change event** was demoted on four axes
 * at once — 64px against 80, 20px against 24, `ink-200` against `ink-100`, and
 * shorter than its siblings — and the middle row was composed differently from
 * both, a left-aligned label with a right-aligned status. So the group had no
 * common left edge, the eye's path down it went centre, far-left, centre, and
 * the composition claimed a kinship (reprint + printer) that is the opposite of
 * the real one: the reprint is the only thing anybody does mid-evening, and the
 * other two are setup doors touched once.
 *
 * The demotion was inherited. `h-14 text-lg text-ink-200` is `ChangeEventScreen`'s
 * *quiet answer to a yes-or-no question*, which means something there and
 * nothing on a menu.
 *
 * The rule now, and the one a sixth row added next year should follow: **inside
 * this group a row is a row.** One height, one label size, one label ink, the
 * label on the group's shared left inset, and an optional trailing status. The
 * author chooses where a row goes in the order and nothing else — order is what
 * carries rank, which is why the mid-evening errand is first. Only the header
 * may be larger than a row label, and only the terminal button is a different
 * shape.
 *
 * The type is set for the distance rather than one Tailwind step up from the
 * phone's. A label at 24px is about ten arcmin of x-height at the seventy
 * centimetres a lobby tablet on a stand is read from — half of comfortable —
 * and the budget for the extra came off the word `Staff`, which nobody walked
 * over here to read.
 *
 * ## The type is a distance question; the box is a height one
 *
 * Which is why they are on different variants, and the split is the fix for a
 * real measurement rather than a preference. `kiosk:` matches *either* axis —
 * `min-height: 1000px` or `min-width: 1024px` — because it answers "is anybody
 * holding this", and the answer is no on a tablet stood on end and no on one
 * laid on its side. `tall:` answers "has this glass the room", and only the
 * first of those two clears it.
 *
 * Hanging the row's *height* on `kiosk:` therefore gave a 1280×800 landscape
 * shelf the 96px rows meant for a screen with 1280px to spend them in. With a
 * printer fault (whose warning wraps to two lines), a photograph and the
 * languages row, the menu came to 928px of content in 800px of glass and
 * **Keep checking in** — the one control that gives the kiosk back to the
 * queue — sat 96px below the fold, on a screen whose reader has no reason to
 * suspect it scrolls.
 *
 * So the labels keep `kiosk:`, because the volunteer is at seventy centimetres
 * either way and legibility is not the thing in short supply. The boxes move
 * to `tall:`: 64px is still half again the 44px a thumb needs, and six of them
 * at 30px labels fit the shelf with room over.
 */
import { useTranslations } from 'use-intl';
import { haptic } from '@/lib/utils';
import { LOCALE_LABELS, type Locale } from '@/lib/locales';
import { usePrinterNote } from '../printerNote';
import type { PrinterNote } from '../printing';
import { EventName } from '../components/EventName';
import { useTap } from '../components/tapGuard';

/**
 * The one row class. See the note above: the whole screen's legibility rests on
 * these three rows being indistinguishable except for their words.
 *
 * `justify-between` with a single child leaves that child on the left, which is
 * what gives the group its shared edge whether or not a row carries a status.
 */
const ROW =
  'flex h-16 w-full items-center justify-between gap-3 rounded-xl px-5 text-left ' +
  'text-xl font-semibold kiosk:px-6 kiosk:text-3xl tall:h-24';

/**
 * A fact, set as prose on the group's shared inset.
 *
 * Deliberately *not* the row class. The first attempt at this was the row's own
 * slab with a dimmer fill and a dimmer label, which is the conventional signal
 * for a control that is switched off — so the copy said *there is nothing here*
 * while the shape said *there is a button here and it is off*, and a volunteer
 * pressed it and got nothing, which is the frozen-tablet reading the slab was
 * replaced to avoid. Dimming alone can only ever mean unavailable; absent has to
 * be a different shape.
 *
 * `ink-200`, not `ink-400`: at 400 it tied with the status word it exists to
 * excuse *and* with the time range in the header, so the one sentence that is
 * the whole point of the state sat at the bottom of the value ladder and
 * dropped out of a squint. The ladder is doors, then this, then status and time.
 */
const STATEMENT = 'px-5 text-left text-lg text-ink-200 kiosk:px-6 kiosk:text-2xl';

const DOOR = `${ROW} bg-ink-800 text-ink-100 active:bg-ink-700`;

export function StaffScreen({
  title,
  iconPath,
  window: eventWindow,
  printer,
  owed = 0,
  trouble,
  backdrop,
  onReprint,
  onPrinter,
  onChangeEvent,
  onHideBackdrop,
  pins,
  onLanguages,
  onStay,
}: {
  title: string;
  /** The gathering's mark, drawn wherever the kiosk says its name. */
  iconPath?: string | null;
  window: string;
  /**
   * What the printer is doing. `none` means *nothing here to print* — no
   * printing module, no printer ever configured, or a gathering with no label
   * template — and is the one state in which the reprint door is not drawn at
   * all. Anything configured and not ready is `trouble`: a door that opens, and
   * says what it knows first.
   */
  printer: 'ready' | 'trouble' | 'none';
  /**
   * How many name tags the printer owes — see `owed.ts`. Zero on an ordinary
   * evening, which is every evening nothing went wrong.
   *
   * It rides the row that already carries a status rather than arriving as a
   * row of its own above *Reprint a name tag*. Order carries rank on this
   * menu, and the reprint is the errand somebody walks over for mid-service;
   * a row that appears above it on the evenings a volunteer is most likely to
   * be hurrying would demote the trained first press exactly then.
   */
  owed?: number;
  /**
   * Whether this binding is wearing a photograph — the row below is drawn
   * only while there is one to take off. False again after the hold's own
   * door has been used: the row removes itself with the photo, which is the
   * confirmation.
   */
  backdrop: boolean;
  /**
   * What is actually wrong, when something is — `PrinterState`'s own sentence,
   * the one the printer screen has always shown.
   *
   * "Out of labels", "cover open" and "unplugged" are three different next
   * moves, and a warning that says only *something is wrong* sends a volunteer
   * through the printer door to find out which. The fault costs nothing to say
   * here and can save the trip.
   */
  trouble?: PrinterNote | null;
  onReprint: () => void;
  onPrinter: () => void;
  onChangeEvent: () => void;
  /** Takes the photograph off this device for the rest of the binding. */
  onHideBackdrop: () => void;
  /**
   * The languages this lobby offers beside English, in the order the switch
   * stands in. Named on the row below, which is the only place a kiosk says
   * out loud what it is offering.
   */
  pins: readonly Locale[];
  /** Opens the screen that sets them — see `LanguagesScreen`. */
  onLanguages: () => void;
  onStay: () => void;
}) {
  const t = useTranslations('Staff');
  const printerNote = usePrinterNote();
  const tap = useTap();

  /*
   * One or two words, never a sentence — the full sentence lives on the printer
   * screen, which is where somebody who cares is going.
   *
   * Set at the row label's own size, and separated from it by colour and weight
   * rather than by size as well. This is the only thing on the screen that ever
   * changes, and it had been demoted three times over: the smallest type in the
   * frame, the only text in the group that was not semibold, *and* tinted. Two
   * of those were doing the same job twice and the third made the one varying
   * fact the lightest object on the glass.
   */
  const printerLine =
    /*
     * The waiting count outranks the printer's own state, and it is the only
     * thing here that ever does. "Ready" is the answer to a question nobody
     * walked over to ask; four name tags waiting is a reason to press this row.
     */
    owed > 0
      ? { text: t('statusWaiting', { count: owed }), tone: 'text-warn-400' }
      : printer === 'ready'
      ? /*
         * Settled, so it recedes. It was `present-400`, which made the one
         * chromatic object on the calm screen a word confirming that nothing had
         * happened — on the setup door nobody walked over for. An accent that
         * marks *where the status lives* rather than *that something changed* is
         * decoration wearing hierarchy's clothes.
         */
        { text: t('statusReady'), tone: 'text-ink-400' }
      : printer === 'trouble'
        ? { text: t('statusTrouble'), tone: 'text-warn-400' }
        : /* The statement above this row is carrying the news in this state. */
          { text: t('statusNotSetUp'), tone: 'text-ink-400' };

  return (
    /*
     * Centred while it fits, scrolled when it does not.
     *
     * This menu grows: the trouble sentence under the reprint door wraps to
     * two lines, the photograph adds a row, the languages row is always drawn.
     * All three at once on a 1280×800 shelf came to 832px in a frame that did
     * not scroll — the word `Staff` clipped off the top and half of **Keep
     * checking in** off the bottom, which is the one control here that gives
     * the kiosk back to the queue. A volunteer would have waited out the
     * forty-five-second return with a family in front of them.
     *
     * `min-h-full` on the inner column rather than `h-full`, with the scroll
     * on the wrapper: `justify-center` against a fixed height centres by
     * overflowing equally in both directions, and the half above the top of a
     * scroll container cannot be reached by scrolling. Same shape as
     * `PrinterScreen` and `SearchScreen`.
     */
    <div className="h-full overflow-y-auto overscroll-contain scroll-touch">
      <div className="flex min-h-full flex-col items-center justify-center gap-8 p-8 text-center kiosk:gap-10">
        <div className="flex flex-col gap-2">
          {/* `Staff` is a label on the screen, not the reason anybody is on it,
              and at 48px it was the largest thing in the frame by half again. The
              ladder is title, then label, then the line you read once. */}
          <div className="text-4xl font-semibold text-ink-100">Staff</div>
          <p className="mx-auto max-w-xl text-lg text-ink-400 kiosk:text-2xl">
            <span className="text-ink-200">
              <EventName path={iconPath} title={title} />
            </span>
            {/*
              * The same rule the chooser row keeps: the middot is drawn only
              * where the two facts share a line, so a wrap can never leave a
              * separator hanging at the end of one. This line is 98% of the
              * phone's measure before the mark is on it, so it wraps there
              * whether or not the gathering wears one — and now it wraps the
              * same way both times.
              */}
            <span className="hidden sm:inline"> · </span>
            <span className="block whitespace-nowrap sm:inline">{eventWindow}</span>
          </p>
        </div>

        <div className="flex w-full max-w-md flex-col gap-3 kiosk:max-w-xl kiosk:gap-4">
          {printer === 'none' ? (
            /*
             * No printer, so no door — a statement in its place.
             *
             * This used to be the reprint row rendered `disabled`: the biggest,
             * first, most obviously-the-thing-I-came-for control on the screen,
             * greyed out, answering a press with nothing at all — no haptic, no
             * `active:` flash, no change — which on a lobby tablet is
             * indistinguishable from a device that has frozen. The predictable
             * next move is to press it again, then fetch somebody. What the
             * volunteer actually needs is the sentence.
             */
            <p className={STATEMENT}>
              {t('noPrinterHere')}
            </p>
          ) : (
            <div className="flex flex-col">
              <button
                type="button"
                tabIndex={-1}
                {...tap(() => {
                  haptic();
                  onReprint();
                })}
                className={DOOR}
              >
                {t('reprint')}
              </button>
              {/* One slot in the group's rhythm, not two. */}
              {printer === 'trouble' && (
                /*
                 * The condition, on the door it gates.
                 *
                 * It was reported only on the row beside this one, in the
                 * smallest type on the screen: between the ready and the trouble
                 * frames, 0.068% of the glass changed and this button was
                 * byte-identical in both. So a volunteer who came *because* a
                 * sticker failed pressed a control that looked equally willing in
                 * both worlds, walked through a search and a confirm, and met the
                 * warning three screens later. This is staff glass; it can say so
                 * in a sentence.
                 */
                /* No top padding: the line box's own half-leading is the only gap
                   wanted here. At `pt-2` the sentence sat 14px under its door and
                   20px above the next one, and a 1.3x differential is inside the
                   noise of the leading — so the pair was held together by colour
                   and a shared left edge rather than by proximity, and the row
                   below wears the same amber. */
                <p className="px-5 text-left text-lg text-warn-400 kiosk:px-6 kiosk:text-2xl">
                  {t('troubleLine', {
                    trouble: (printerNote(trouble) || t('printerNeedsAttention')).replace(/\.$/, ''),
                  })}
                </p>
              )}
            </div>
          )}

          <button
            type="button"
            tabIndex={-1}
            {...tap(() => {
              haptic();
              onPrinter();
            })}
            className={DOOR}
          >
            <span className="min-w-0 truncate">{t('labelPrinter')}</span>
            <span className={`shrink-0 font-normal whitespace-nowrap ${printerLine.tone}`}>
              {printerLine.text}
            </span>
          </button>

          {/*
            * The photograph's off switch, for the Sunday it is wrong on the
            * shelf: device-local, no network, no editor rights — see
            * `hideBackdrop` in KioskApp. A row like the others (the rule at the
            * top of this file), drawn only while there is a photograph to take
            * off, and last because it is the rarest errand here. "The photo" and
            * not "the background", because it is described over the phone to
            * whoever is standing at the kiosk, and the photo is what they see.
            */}
          {backdrop && (
            <button
              type="button"
              tabIndex={-1}
              {...tap(() => {
                haptic();
                onHideBackdrop();
              })}
              className={DOOR}
            >
              {t('hideThePhoto')}
            </button>
          )}

          {/*
            * What this lobby speaks, for the Sunday it turns out to be something
            * else — a tablet moved between rooms, a congregation that started
            * meeting in the next hall, or a switch nobody in this lobby needs.
            *
            * This row used to be **English only**: one press, permanent, and
            * undoable only by an administrator retiring the device and a second
            * person re-pairing at the tablet. It sat beside *Hide the photo*,
            * which looks identical and heals itself at the next rebind, so a
            * volunteer told about one reasonably assumed the other. The delete
            * lives on the screen behind this row now, which can also undo it.
            *
            * Drawn always, unlike the photograph's row, and that is the point
            * rather than an inconsistency: a kiosk with nothing pinned is
            * exactly the kiosk that cannot be given a language any other way —
            * a tablet staged with a pairing link in its start URL never draws
            * the pairing screen at all. A row that appeared only once there was
            * something to take off would be missing from the one state it is
            * needed in.
            */}
          <button
            type="button"
            tabIndex={-1}
            {...tap(() => {
              haptic();
              onLanguages();
            })}
            className={DOOR}
          >
            {/* The label keeps its width and the names give way — three of
                them at the row's size took the old label down to "Eng…", and a
                door that cannot be read is a door pressed blind.

                One step under the row's label rather than two. The status is
                the fact this row exists to report — *is Spanish already on* —
                and at 20px in CJK it was the second-smallest thing on a
                screen set for seventy centimetres, so the answer usually cost
                the tap it was meant to save. Two names is the common case and
                there is slack for it; three still give way, which is what the
                rule above is for. */}
            <span className="shrink-0">{t('languages')}</span>
            <span className="min-w-0 truncate text-base font-normal text-ink-400 kiosk:text-2xl">
              {/* The status the printer row's grammar asks for: what is set, and
                  never a count. With nothing pinned the true answer is the
                  sentence the old row's label was — English, and only English —
                  which also keeps the words a volunteer was trained on somewhere
                  on this screen. */}
              {pins.length > 0
                ? pins.map((pin) => LOCALE_LABELS[pin]).join(' · ')
                : t('englishOnly')}
            </span>
          </button>
        </div>

        {/*
          * The two answers to *what is this kiosk on*, as a pair.
          *
          * They were three rows apart — **Change gathering** sat third among
          * the errands and **Keep checking in** was alone at the foot of the
          * screen — which composed them as unrelated when they are the same
          * question answered two ways: stay on this gathering, or leave it.
          * Read together they are a choice; read apart, the quiet one was a
          * row in a list of chores and the loud one was the only way out.
          *
          * They keep the group's own rhythm between them and inherit the
          * parent's `gap-8` above, so the errands stay one object and this
          * stays another. Order within the pair is the codebase's usual:
          * the answer that costs somebody else — the door shuts on everyone
          * standing at it — is the quiet one, and it goes first, so the thumb
          * travelling up from the bottom of the glass meets *Keep checking
          * in* before it meets the one that empties the lobby.
          */}
        <div className="flex w-full max-w-md flex-col gap-3 kiosk:max-w-xl kiosk:gap-4">
          <button
            type="button"
            tabIndex={-1}
            {...tap(() => {
              haptic();
              onChangeEvent();
            })}
            className={DOOR}
          >
            {t('changeEvent')}
          </button>

          {/* Centred and filled, which on this screen is what marks the
              terminal button — every door above it is a left-aligned row. */}
          <button
            type="button"
            tabIndex={-1}
            {...tap(() => {
              haptic();
              onStay();
            })}
            className="flex h-16 w-full items-center justify-center rounded-xl bg-brand-600 text-xl font-semibold text-white active:bg-brand-500 kiosk:text-3xl tall:h-24"
          >
            {t('keepCheckingIn')}
          </button>
        </div>
      </div>
    </div>
  );
}
