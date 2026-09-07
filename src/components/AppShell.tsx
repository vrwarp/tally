import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslations } from 'use-intl';
import { useAuth } from '@/context/authContext';
import { useData } from '@/context/dataContext';
import { useHeightVar } from '@/hooks/useHeightVar';
import { cn } from '@/lib/utils';
import { pageFrameWidth } from '@/components/pageFrameWidth';
import { Button, ErrorBanner } from '@/components/ui';

/**
 * The bar's own measure, in the shape that has no rail.
 *
 * The same call the bands beneath it make — check-in's `BAND` — rather than a
 * pair of caps copied across and then left behind. Copied, they were
 * `max-w-lg`/`lg:max-w-2xl` against a page on `max-w-3xl`: the wordmark started
 * 48px right of the heading above `lg` and 128px right of it between `md` and
 * `lg`, which is the exact defect the comment at the call site claimed to have
 * fixed. Sharing the function is what stops the two drifting apart again — and
 * has already earned itself once, since check-in has since taken the window
 * above `lg` and this followed it there without being touched.
 */
const BAR = pageFrameWidth({ width: '3xl' });

/**
 * One destination in the account surface.
 *
 * 48px on touch, because the surface it sits in is a sheet in the thumb's band
 * and these are the only rows in the app a person navigates by from a standing
 * start; back to the popover's own 36px wherever there is a pointer.
 */
const MENU_ITEM =
  'flex min-h-12 items-center px-4 text-base text-ink-100 hover:bg-ink-800 pointer-fine:min-h-9 pointer-fine:px-3 pointer-fine:text-sm';

interface NavItem {
  to: string;
  /**
   * A key into `Nav.*`, not a word.
   *
   * This list is module-level — it is the same on every render and must not be
   * rebuilt per paint — so it cannot call a hook. The label is looked up where
   * it is drawn instead.
   */
  labelKey: 'checkIn' | 'insights' | 'events' | 'students' | 'review';
  icon: string;
  /** Core-team only. */
  core?: boolean;
}

const NAV: NavItem[] = [
  { to: '/', labelKey: 'checkIn', icon: '✓' },
  { to: '/dashboard', labelKey: 'insights', icon: '◎', core: true },
  { to: '/events', labelKey: 'events', icon: '▤', core: true },
  { to: '/students', labelKey: 'students', icon: '☰', core: true },
  /*
   * Review used to live only inside the account menu, on the argument that the
   * thumb bar is for the four things somebody does at a door. That argument
   * does not survive the bar's own contents: Insights, Events and Students are
   * all weekday core-team screens and all three are in it. Review was the only
   * core screen left out — and the only one with a clock running against it,
   * since a registration nobody looks at loses the family's phone number after
   * thirty days whether or not anyone knew it was waiting.
   */
  { to: '/review', labelKey: 'review', icon: '▣', core: true },
];

/**
 * The app frame, in two genuinely different shapes.
 *
 * On a phone, navigation sits at the bottom: Tally is used one-handed and a top
 * tab bar is out of thumb range.
 *
 * On a desktop that same bar is wrong — a row of tabs pinned to the bottom of a
 * 27-inch monitor is a phone control that happens to still render. Above `lg`
 * it becomes a persistent left sidebar, which is where a pointer user expects
 * navigation and which costs no vertical space.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { profile, signOut, can } = useAuth();
  const { error } = useData();
  const location = useLocation();
  const t = useTranslations();
  const [menuOpen, setMenuOpen] = useState(false);

  /*
   * Every screen scrolls the document, so every screen shares one scroller —
   * and a browser does not reset it on a client-side route change. Without
   * this, a counselor who worked to the bottom of the roster and then tapped
   * "Students" arrived halfway down the student list.
   *
   * Keyed on the path alone: `/event/:eventId` re-renders check-in from the
   * event picker, and landing at the top of the new event is right there too.
   */
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  // Measured, not assumed: the bar carries a safe-area inset on a notched
  // phone and vanishes at `lg`. Check-in's search box sticks below whatever
  // this comes out to.
  const header = useHeightVar<HTMLElement>('--app-header-h');

  const items = NAV.filter((item) => !item.core || can('core'));
  const showNav = items.length > 1;

  const displayName = profile?.displayName || profile?.email || 'Signed in';
  const initial = displayName.charAt(0).toUpperCase();

  /*
   * What the account surface holds, in one place, because it is drawn twice:
   * as a popover beside the control that opens it on a pointer, and as a sheet
   * at the bottom of the phone.
   *
   * The identity block is a caption, not a destination: it lost "Signed in as"
   * and its role chip so that it stops outweighing the list it introduces, and
   * the role now sits beside the email as a label rather than as a filled box
   * that reads as pressable.
   *
   * Sign out belongs to the identity rather than to the list. On a phone the
   * items sit in the thumb's band, and the counselor's menu holds exactly one
   * destination — so as the last row of a bottom sheet, the irreversible act
   * would be nearer the thumb than the wanted one, with a mis-tap costing an
   * email sign-in while a pairing code expires. `w-fit` is what keeps it from
   * stretching back into the thumb's column.
   */
  const accountItems = (
    <>
      <div className="border-b border-ink-800 px-4 pb-2 pt-1 pointer-fine:px-3">
        <div className="flex items-baseline gap-2">
          <p className="truncate text-xs text-ink-400">{profile?.email}</p>
          <span className="shrink-0 text-[11px] uppercase tracking-wide text-ink-500">
            {profile?.role}
          </span>
        </div>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setMenuOpen(false);
            void signOut();
          }}
          className="-ml-2 mt-1 flex min-h-11 w-fit items-center rounded-lg px-2 text-sm font-medium text-danger-400 hover:bg-ink-800 pointer-fine:min-h-8"
        >
          Sign out
        </button>
      </div>
      {/* Every active member, unlike the two below it.
          Pairing a kiosk is open to anybody the attendance rules already trust
          — the person who arrives first on a Friday and finds the lobby iPad
          asking to be claimed is usually a counselor — and until this item
          existed there was no link to that screen for one. The kiosk's own
          screen sent them to Settings, which a counselor cannot open. */}
      <NavLink to="/pair-kiosk" role="menuitem" onClick={() => setMenuOpen(false)} className={MENU_ITEM}>
        {t('Nav.kiosk')}
      </NavLink>
      {can('core') ? (
        <>
          {/* Review moved into the nav itself; these two stay here, because
              they are things somebody does a few times a year rather than every
              week. Team is listed first and separately from Settings: it used
              to be the last card on that page, which put "who can see a roster
              of minors" below a colour picker and an API connection. */}
          <NavLink to="/team" role="menuitem" onClick={() => setMenuOpen(false)} className={MENU_ITEM}>
            {t('Nav.team')}
          </NavLink>
          <NavLink
            to="/settings"
            role="menuitem"
            onClick={() => setMenuOpen(false)}
            className={MENU_ITEM}
          >
            {t('Nav.settings')}
          </NavLink>
        </>
      ) : null}
    </>
  );

  /**
   * The chip, and the popover it opens on a pointer.
   *
   * `anchored` is the rail's copy, which opens upward and takes the rail's
   * width; the bar's copy opens downward at its own. Only one of the two is on
   * screen above `lg` — the rail when there is one, the bar when there is not —
   * so only that one draws a popover, and below `lg` neither does: the sheet
   * at the foot of the shell is the phone's surface.
   */
  const accountButton = (anchored: boolean) => (
    <div className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        // 44px on touch. It is the first of the two taps on the only route to
        // the kiosk screen, and it is in the corner a thumb reaches worst.
        className="flex min-h-11 items-center gap-2 rounded-full bg-ink-900 py-1 pl-3 pr-1 text-xs text-ink-300 ring-1 ring-ink-800 pointer-fine:min-h-8 lg:w-full lg:justify-start lg:rounded-xl lg:py-2"
      >
        <span className="max-w-32 truncate lg:order-2 lg:max-w-none lg:flex-1 lg:text-left">
          {displayName}
        </span>
        <span className="flex size-6 items-center justify-center rounded-full bg-brand-500/20 text-brand-300 lg:order-1">
          {initial}
        </span>
      </button>
      {menuOpen && (anchored || !showNav) ? (
        <div className="hidden lg:block">
          <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden="true" />
          <div
            role="menu"
            className={cn(
              'absolute right-0 z-20 mt-2 w-52 overflow-hidden rounded-xl bg-ink-900 py-1 text-sm shadow-xl ring-1 ring-ink-700',
              anchored && 'lg:bottom-full lg:right-auto lg:left-0 lg:mb-2 lg:mt-0 lg:w-full',
            )}
          >
            {accountItems}
          </div>
        </div>
      ) : null}
    </div>
  );

  /*
   * One scroller for the whole app: every screen, check-in included, is an
   * ordinary document that scrolls as a whole.
   *
   * Check-in used to be framed instead — the viewport capped at `h-dvh` and the
   * roster scrolling inside its own box, so the event header, the search box
   * and the scope chips stayed put. It kept everything under the thumb at the
   * cost of about a third of a phone screen, permanently, including the parts a
   * counselor reads once and never looks at again. Now the header scrolls away
   * and only the search box stays, by sticking to the top on its way past — see
   * `CheckInPage`.
   */
  return (
    /*
     * `data-rail` is how a page frame knows whether it has a sidebar to sit
     * beside — see `pageFrameWidth`. It is published here rather than derived
     * per page so there is one answer to "is navigation on screen", and it is
     * this one.
     */
    <div
      data-rail={showNav ? '' : undefined}
      className="group/shell flex min-h-dvh flex-col bg-ink-950 lg:flex-row"
    >
      {/*
       * Desktop: a persistent sidebar — window-height and pinned, not
       * page-height. The shell is one document scroller, so a sidebar left to
       * stretch takes the height of whatever page it sits beside, and `mt-auto`
       * then parks the account button at the bottom of a student's four screens
       * of attendance rather than at the bottom of the monitor, which is the one
       * place it is worth having. Five nav items never come close to filling a
       * window, so nothing is lost by capping it; `overflow-y-auto` is only
       * there so a sixth on a short laptop scrolls rather than disappears.
       */}
      {showNav ? (
        <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-56 lg:shrink-0 lg:flex-col lg:gap-1 lg:self-start lg:border-r lg:border-ink-800 lg:px-3 lg:py-4">
          <span className="px-2 pb-4 text-sm font-bold uppercase tracking-widest text-brand-400">
            Tally
          </span>
          <nav className="flex min-h-0 flex-col gap-1 overflow-y-auto">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium',
                    isActive
                      ? 'bg-brand-500/15 text-brand-300'
                      : 'text-ink-400 hover:bg-ink-900 hover:text-ink-200',
                  )
                }
              >
                <span aria-hidden="true" className="text-base leading-none">
                  {item.icon}
                </span>
                {t(`Nav.${item.labelKey}`)}
              </NavLink>
            ))}
          </nav>
          <div className="mt-auto pt-4">{accountButton(true)}</div>
        </aside>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Phone: a top bar for identity, since navigation lives at the bottom.
            Also the only chrome a counselor with one tab ever sees — and at that
            width, with no rail to anchor to, its contents take the page's own
            measure rather than the window's, so the wordmark and the heading
            below it start on the same edge.

            "The page's own measure" is now literally the page's own function —
            see `BAR`. The bar keeps its rule and its background full-bleed and
            hands the horizontal inset to that frame, which is why the padding
            comes off here in the same breath. */}
        <header
          ref={header}
          className={cn(
            'sticky top-0 z-30 border-b border-ink-800 bg-ink-950/95 px-4 py-2 pt-safe backdrop-blur',
            showNav ? 'flex items-center justify-between gap-3 lg:hidden' : 'px-0',
          )}
        >
          {showNav ? (
            <>
              <Wordmark />
              {accountButton(false)}
            </>
          ) : (
            <div className={cn(BAR, 'flex items-center justify-between gap-3')}>
              <Wordmark />
              {accountButton(false)}
            </div>
          )}
        </header>

        {/*
         * A dead stream, and the only recovery the app actually has.
         *
         * `onSnapshot`'s error handler is terminal: the listener is gone and
         * nothing re-opens it, so "Try again" would be a lie and dismissing it
         * would leave a confident, wrong page with nothing to explain it. A
         * reload re-runs every subscription from nothing, which is what a person
         * reading this needs — and until now it was a recovery the product knew
         * about and never mentioned.
         *
         * The banner takes itself down when the offending stream delivers again
         * — see `DataProvider` — so this is a permanent fault or nothing.
         */}
        {error ? (
          <div className="px-4 pt-3">
            <ErrorBanner
              message={error}
              action={
                <Button variant="secondary" onClick={() => window.location.reload()}>
                  Reload
                </Button>
              }
            />
          </div>
        ) : null}

        {/* The 96px is the tab bar's, and only the tab bar's. A role with one
            destination gets no bar and was still paying for it — a fifth of a
            phone screen of nothing, on the shortest screens in the app. */}
        <main className={cn('flex-1', showNav ? 'pb-24 lg:pb-8' : 'pb-8')}>{children}</main>

        {/* Phone: bottom tabs, within thumb reach. */}
        {showNav ? (
          <nav className="sticky bottom-0 z-30 border-t border-ink-800 bg-ink-950/95 pb-safe backdrop-blur lg:hidden">
            <ul className="mx-auto flex max-w-lg">
              {items.map((item) => (
                <li key={item.to} className="flex-1">
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) =>
                      cn(
                        'flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium',
                        isActive ? 'text-brand-400' : 'text-ink-500',
                      )
                    }
                  >
                    <span aria-hidden="true" className="text-base leading-none">
                      {item.icon}
                    </span>
                    {t(`Nav.${item.labelKey}`)}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        {/*
         * Phone: the account surface as a sheet at the foot of the screen.
         *
         * A panel hanging off a chip in the top-right corner put the only route
         * to this app's non-tab destinations in the one place a thumb does not
         * reach, at 36px a row. It is a sheet below `lg` and the popover it
         * always was above it, and it sits here — outside the header — because
         * the header carries `backdrop-blur`, which makes it a containing block
         * for `position: fixed` and would trap the sheet inside a 44px bar.
         */}
        {menuOpen ? (
          <>
            <div
              className="fixed inset-0 z-40 bg-ink-950/60 lg:hidden"
              onClick={() => setMenuOpen(false)}
              aria-hidden="true"
            />
            <div
              role="menu"
              className="fixed inset-x-0 bottom-0 z-50 overflow-hidden rounded-t-2xl bg-ink-900 pb-safe pt-2 text-sm shadow-xl ring-1 ring-ink-700 lg:hidden"
            >
              {accountItems}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** The app's name, and — since it is the only thing in the bar that is not the
 *  account chip — the way back to check-in when the shell draws no navigation. */
function Wordmark() {
  return (
    <NavLink to="/" className="text-sm font-bold uppercase tracking-widest text-brand-400">
      Tally
    </NavLink>
  );
}
