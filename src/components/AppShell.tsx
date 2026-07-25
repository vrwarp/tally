import { useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/authContext';
import { useData } from '@/context/dataContext';
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
 * The app frame.
 *
 * Navigation lives at the bottom because Tally is used one-handed on a phone;
 * a top tab bar would be out of thumb range. Counselors see a single tab and
 * effectively no chrome at all — the whole screen is the roster.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { profile, signOut, can } = useAuth();
  const { error } = useData();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const items = NAV.filter((item) => !item.core || can('core'));
  const showNav = items.length > 1;
  // The check-in screen manages its own scrolling and sticky chrome.
  const isCheckIn = location.pathname === '/' || location.pathname.startsWith('/event/');

  return (
    <div className="flex min-h-dvh flex-col bg-ink-950">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-ink-800 bg-ink-950/95 px-4 py-2 pt-safe backdrop-blur">
        <span className="text-sm font-bold uppercase tracking-widest text-brand-400">Tally</span>

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            className="flex items-center gap-2 rounded-full bg-ink-900 py-1 pl-3 pr-1 text-xs text-ink-300 ring-1 ring-ink-800"
          >
            <span className="max-w-32 truncate">
              {profile?.displayName || profile?.email || 'Signed in'}
            </span>
            <span className="flex size-6 items-center justify-center rounded-full bg-brand-500/20 text-brand-300">
              {(profile?.displayName || profile?.email || '?').charAt(0).toUpperCase()}
            </span>
          </button>

          {menuOpen ? (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setMenuOpen(false)}
                aria-hidden="true"
              />
              <div
                role="menu"
                className="absolute right-0 z-20 mt-2 w-52 overflow-hidden rounded-xl bg-ink-900 py-1 text-sm shadow-xl ring-1 ring-ink-700"
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
            </>
          ) : null}
        </div>
      </header>

      {error ? (
        <div className="px-4 pt-3">
          <ErrorBanner message={error} />
        </div>
      ) : null}

      <main className={cn('flex-1', isCheckIn ? 'flex min-h-0 flex-col' : 'pb-24')}>{children}</main>

      {showNav ? (
        <nav className="sticky bottom-0 z-30 border-t border-ink-800 bg-ink-950/95 pb-safe backdrop-blur">
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
  );
}
