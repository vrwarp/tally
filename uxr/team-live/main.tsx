/**
 * The Team screen, mounted from `src/` for the critique loop.
 *
 * Same argument as `kiosk-live/`: freezing exists because most of Tally's
 * scenes sit behind a sign-in, an emulator suite and a seeded ministry, and
 * reaching one costs more than copying it. This screen does not. It is two
 * subscriptions and a profile, so the real component renders in a dev server in
 * milliseconds against a fixture, and what the critics look at cannot drift
 * from what ships — it is the same file `src/App.tsx` routes to.
 *
 * The knobs are query parameters, because the shooter addresses states by URL:
 *
 *   ?role=admin|core    who is looking            (default admin)
 *   ?users=N            how many profiles exist   (default all eleven)
 *   ?invites=N          how many are waiting      (default four)
 */
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '@/index.css';
import { TeamPage } from '@/features/team/TeamPage';

/*
 * The app frame, minus everything on it that needs Firebase.
 *
 * Not decoration. `PageFrame` anchors itself to the sidebar rather than
 * centring — `data-rail` on the element carrying `group/shell` is how it knows
 * the rail is up — so a page mounted bare would be centred in the window here
 * and left-aligned in the app, and every desktop critique of where the column
 * starts would be a critique of this file. The header and the thumb bar are the
 * same story vertically: they are what a phone frame's fold is measured
 * against.
 */
createRoot(document.getElementById('root')!).render(
  <MemoryRouter>
    <div data-rail="" className="group/shell flex min-h-dvh flex-col bg-ink-950 lg:flex-row">
      <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-56 lg:shrink-0 lg:flex-col lg:gap-1 lg:self-start lg:border-r lg:border-ink-800 lg:px-3 lg:py-4">
        <span className="px-2 pb-4 text-sm font-bold uppercase tracking-widest text-brand-400">
          Tally
        </span>
        <nav className="flex min-h-0 flex-col gap-1 overflow-y-auto">
          {[
            ['✓', 'Check in'],
            ['◎', 'Insights'],
            ['▤', 'Events'],
            ['☰', 'Students'],
            ['▣', 'Review'],
          ].map(([icon, label]) => (
            <span
              key={label}
              className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-ink-400"
            >
              <span aria-hidden="true" className="text-base leading-none">
                {icon}
              </span>
              {label}
            </span>
          ))}
        </nav>
        <div className="mt-auto pt-4">
          <span className="flex w-full items-center gap-2 rounded-xl bg-ink-900 px-3 py-2 text-xs text-ink-300 ring-1 ring-ink-800">
            <span className="flex size-6 items-center justify-center rounded-full bg-brand-500/20 text-brand-300">
              D
            </span>
            <span className="flex-1 truncate text-left">Dana Ruiz</span>
          </span>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-ink-800 bg-ink-950/95 px-4 py-2 pt-safe backdrop-blur lg:hidden">
          <span className="text-sm font-bold uppercase tracking-widest text-brand-400">Tally</span>
          <span className="flex items-center gap-2 rounded-full bg-ink-900 py-1 pl-3 pr-1 text-xs text-ink-300 ring-1 ring-ink-800">
            <span className="max-w-32 truncate">Dana Ruiz</span>
            <span className="flex size-6 items-center justify-center rounded-full bg-brand-500/20 text-brand-300">
              D
            </span>
          </span>
        </header>

        <main className="flex-1 pb-24 lg:pb-8">
          <TeamPage />
        </main>

        <nav className="sticky bottom-0 z-30 border-t border-ink-800 bg-ink-950/95 pb-safe backdrop-blur lg:hidden">
          <ul className="mx-auto flex max-w-lg">
            {[
              ['✓', 'Check in'],
              ['◎', 'Insights'],
              ['▤', 'Events'],
              ['☰', 'Students'],
              ['▣', 'Review'],
            ].map(([icon, label]) => (
              <li key={label} className="flex-1">
                <span className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-ink-500">
                  <span aria-hidden="true" className="text-base leading-none">
                    {icon}
                  </span>
                  {label}
                </span>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  </MemoryRouter>,
);
