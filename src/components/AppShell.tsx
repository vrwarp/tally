import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/authContext';
import { useData } from '@/context/dataContext';
import { useHeightVar } from '@/hooks/useHeightVar';
import { cn } from '@/lib/utils';
import { ErrorBanner } from '@/components/ui';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  /** Core-team only. */
  core?: boolean;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Check in', icon: '✓' },
  { to: '/dashboard', label: 'Insights', icon: '◎', core: true },
  { to: '/events', label: 'Events', icon: '▤', core: true },
  { to: '/students', label: 'Students', icon: '☰', core: true },
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

  const accountMenu = (
    <div
      role="menu"
      className="absolute right-0 z-20 mt-2 w-52 overflow-hidden rounded-xl bg-ink-900 py-1 text-sm shadow-xl ring-1 ring-ink-700 lg:bottom-full lg:right-auto lg:left-0 lg:mb-2 lg:mt-0 lg:w-full"
    >
      <div className="px-3 py-2 text-xs text-ink-500">
        Signed in as
        <span className="block truncate text-ink-300">{profile?.email}</span>
        <span className="mt-1 inline-block rounded bg-ink-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-400">
          {profile?.role}
        </span>
      </div>
      {can('core') ? (
        <NavLink
          to="/settings"
          role="menuitem"
          onClick={() => setMenuOpen(false)}
          className="block px-3 py-2 text-ink-200 hover:bg-ink-800"
        >
          Settings &amp; team
        </NavLink>
      ) : null}
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          setMenuOpen(false);
          void signOut();
        }}
        className="block w-full px-3 py-2 text-left text-danger-400 hover:bg-ink-800"
      >
        Sign out
      </button>
    </div>
  );

  const accountButton = (
    <div className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-full bg-ink-900 py-1 pl-3 pr-1 text-xs text-ink-300 ring-1 ring-ink-800 lg:w-full lg:justify-start lg:rounded-xl lg:py-2"
      >
        <span className="max-w-32 truncate lg:order-2 lg:max-w-none lg:flex-1 lg:text-left">
          {displayName}
        </span>
        <span className="flex size-6 items-center justify-center rounded-full bg-brand-500/20 text-brand-300 lg:order-1">
          {initial}
        </span>
      </button>
      {menuOpen ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden="true" />
          {accountMenu}
        </>
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
      {/* Desktop: a persistent sidebar. */}
      {showNav ? (
        <aside className="hidden lg:flex lg:w-56 lg:shrink-0 lg:flex-col lg:gap-1 lg:border-r lg:border-ink-800 lg:px-3 lg:py-4">
          <span className="px-2 pb-4 text-sm font-bold uppercase tracking-widest text-brand-400">
            Tally
          </span>
          <nav className="flex flex-col gap-1">
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
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="mt-auto pt-4">{accountButton}</div>
        </aside>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Phone: a top bar for identity, since navigation lives at the bottom.
            Also the only chrome a counselor with one tab ever sees. */}
        <header
          ref={header}
          className={cn(
            'sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-ink-800 bg-ink-950/95 px-4 py-2 pt-safe backdrop-blur',
            showNav && 'lg:hidden',
          )}
        >
          <span className="text-sm font-bold uppercase tracking-widest text-brand-400">Tally</span>
          {accountButton}
        </header>

        {error ? (
          <div className="px-4 pt-3">
            <ErrorBanner message={error} />
          </div>
        ) : null}

        <main className="flex-1 pb-24 lg:pb-8">{children}</main>

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
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>
    </div>
  );
}
