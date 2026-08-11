/**
 * The student profile, the student list and the editor, mounted from `src/`.
 *
 * Same argument as `team-live/`: these screens are a roster, one person's
 * details and a year of attendance, so the real components render in a dev
 * server against a fixture in milliseconds, and what the critics look at cannot
 * drift from what ships — they are the files `src/App.tsx` routes to.
 *
 * The knobs are query parameters, because the shooter addresses states by URL:
 *
 *   ?scene=profile|students|editor   which screen                (default profile)
 *   ?writable=no                     write-back is not `full`    (default full)
 */
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/index.css';
import { StudentDetailPage } from '@/features/students/StudentDetailPage';
import { StudentsPage } from '@/features/students/StudentsPage';
import { StudentEditorModal } from '@/features/students/StudentEditorModal';
import { SUBJECT } from './fixture';

const params = new URLSearchParams(location.search);
const scene = params.get('scene') ?? 'profile';

const NAV = [
  ['✓', 'Check in'],
  ['◎', 'Insights'],
  ['▤', 'Events'],
  ['☰', 'Students'],
  ['▣', 'Review'],
] as const;

/*
 * The app frame, minus everything on it that needs Firebase — copied from
 * `team-live/main.tsx` for the same reason it exists there. `PageFrame` anchors
 * itself to the sidebar rather than centring, so a page mounted bare would be
 * centred here and left-aligned in the app, and every desktop critique of where
 * the column starts would be a critique of this file.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div data-rail="" className="group/shell flex min-h-dvh flex-col bg-ink-950 lg:flex-row">
      <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-56 lg:shrink-0 lg:flex-col lg:gap-1 lg:self-start lg:border-r lg:border-ink-800 lg:px-3 lg:py-4">
        <span className="px-2 pb-4 text-sm font-bold uppercase tracking-widest text-brand-400">
          Tally
        </span>
        <nav className="flex min-h-0 flex-col gap-1 overflow-y-auto">
          {NAV.map(([icon, label]) => (
            <span
              key={label}
              className={
                label === 'Students'
                  ? 'flex min-h-11 items-center gap-3 rounded-xl bg-ink-900 px-3 text-sm font-medium text-ink-100'
                  : 'flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-ink-400'
              }
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

        <main className="flex-1 pb-24 lg:pb-8">{children}</main>

        <nav className="sticky bottom-0 z-30 border-t border-ink-800 bg-ink-950/95 pb-safe backdrop-blur lg:hidden">
          <ul className="mx-auto flex max-w-lg">
            {NAV.map(([icon, label]) => (
              <li key={label} className="flex-1">
                <span
                  className={
                    label === 'Students'
                      ? 'flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-brand-300'
                      : 'flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-ink-500'
                  }
                >
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
  );
}

const body =
  scene === 'students' ? (
    <StudentsPage />
  ) : (
    <Routes>
      <Route path="/students/:studentId" element={<StudentDetailPage />} />
    </Routes>
  );

createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={[`/students/${SUBJECT.id}`]}>
    <Shell>{body}</Shell>
    {scene === 'editor' ? (
      <StudentEditorModal open student={SUBJECT} onClose={() => {}} />
    ) : null}
  </MemoryRouter>,
);
