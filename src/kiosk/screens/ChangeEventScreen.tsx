/**
 * The one question the kiosk asks a member of staff.
 *
 * A screen rather than a dialog, which is the shape every other interruption on
 * this device takes — the confirm, the sibling search and the success tick all
 * replace the search screen outright. A kiosk is one thing at a time, and a
 * card floating over a dimmed lobby screen would be the only place that is not.
 *
 * It exists because the gesture behind it is no longer invisible. The staff gate
 * used to be a transparent sixteen-pixel square in the corner of the header,
 * which needed no confirmation because nobody could find it — the same sentence
 * as "the volunteer who needs it cannot find it either". Holding **Clear** is a
 * labelled key in a fixed place that can be described over the phone, so it is
 * discoverable by staff, therefore reachable by accident, and therefore asks.
 *
 * Nothing here is destructive: no attendance is touched, and the chooser is one
 * tap from putting the kiosk back. It is *disruptive*, though, and the warning
 * says which — the door shuts for everybody standing at it, and they cannot
 * reopen it themselves. So carrying on is the loud answer and leaving is the
 * quiet one, which is the way round this codebase puts every control whose cost
 * lands on somebody other than the person pressing it.
 */
import { haptic } from '@/lib/utils';
import { EventName } from '../components/EventName';
import { useTap } from '../components/tapGuard';

export function ChangeEventScreen({
  title,
  iconPath,
  onStay,
  onLeave,
}: {
  /** The gathering this kiosk is on, named so nobody leaves the wrong one. */
  title: string;
  /**
   * Its mark, for the same reason the name is here. Not hung on either of the
   * lines below: both are sentences the name sits *inside*, so the mark is a
   * word in a line rather than the start of one, and there is no axis for it to
   * take anything off.
   */
  iconPath?: string | null;
  onStay: () => void;
  onLeave: () => void;
}) {
  const tap = useTap();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 p-8 text-center">
      <div className="flex flex-col gap-4">
        <div className="text-4xl font-semibold text-ink-100">Change event?</div>
        <p className="mx-auto max-w-xl text-xl text-ink-400">
          This kiosk is checking in to{' '}
          {/* No `whitespace-nowrap` here, whatever the mark's presence
              suggests: this is a sentence, and the longest gathering name a
              church types has to be allowed to wrap inside it. Held on one
              line it took the whole screen sideways. */}
          <span className="text-ink-200">
            <EventName path={iconPath} title={title} />
          </span>
          .
        </p>

        {/*
          * The consequence, in the one colour on this screen that is not the
          * page. It is not that data is lost — none is — it is that the door
          * shuts: a family walking up to this tablet in the next minute finds
          * an event list instead of a search box, and cannot do anything about
          * it themselves. That is worth a warning even though it is undoable,
          * because the person it costs is not the person tapping.
          */}
        <div className="mx-auto flex max-w-xl items-start gap-3 rounded-xl bg-warn-500/10 px-5 py-4 text-left ring-1 ring-warn-500/30">
          <span aria-hidden className="text-2xl leading-none text-warn-400">
            ⚠
          </span>
          <p className="text-lg text-warn-400">
            Nobody can check in here until somebody picks an event again. If there is a queue at
            this kiosk, it stops.
          </p>
        </div>

        <p className="mx-auto max-w-xl text-base text-ink-500">
          Children already checked in stay checked in, and the register is not changed.
        </p>
      </div>

      <div className="flex w-full max-w-md flex-col gap-3">
        <button
          type="button"
          tabIndex={-1}
          {...tap(() => {
            haptic();
            onStay();
          })}
          className="flex h-16 w-full items-center justify-center rounded-xl bg-brand-600 text-xl font-semibold text-white active:bg-brand-500"
        >
          Keep checking in
        </button>
        <button
          type="button"
          tabIndex={-1}
          {...tap(() => {
            haptic();
            onLeave();
          })}
          /*
           * `px-5`, because this label is the one on the screen that truncates:
           * without it a long gathering name ran to the plate's corner radius
           * and the ellipsis sat against the right edge, which reads as a
           * button clipping its label rather than a label being shortened.
           *
           * `mt-3` on top of the stack's own `gap-3`. These two answers are not
           * peers — one keeps the door open and one shuts it on everybody
           * standing at it, with no second confirmation — and twelve pixels is
           * inside the overshoot a hurried thumb makes. Nothing here is
           * destructive, so the answer is air rather than another hold.
           */
          className="mt-3 flex h-14 w-full items-center justify-center rounded-xl bg-ink-800 px-5 text-lg font-semibold text-ink-200 active:bg-ink-700"
        >
          {/*
            * `min-w-0`, or the truncation is decorative.
            *
            * A flex item's floor is its content, so a long gathering name made
            * this span wider than the button that holds it: the ellipsis never
            * arrived and the whole screen scrolled sideways instead — which the
            * kiosk shooter asserts against, and which is how this was found.
            */}
          <span className="min-w-0 truncate">
            Leave <EventName path={iconPath} title={title} />
          </span>
        </button>
      </div>
    </div>
  );
}
