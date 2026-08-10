/**
 * The kiosk screen, mounted from `src/` inside the app's own shell.
 *
 * `uxr/team-live/main.tsx` re-draws the shell by hand, because the screen it
 * photographs is reached the way every other core screen is and the frame only
 * has to be the right size. This one cannot: the finding that started this
 * refinement is that *the path to the screen* is the problem, and the path is
 * the account menu in the shell. So the real `AppShell` is mounted, with the
 * four modules it reads from Firebase aliased to the fixture, and the menu is
 * opened by a click before the freeze.
 *
 * The knobs are query parameters, because the shooter addresses states by URL:
 *
 *   ?role=admin|core|counselor   who is looking    (default admin)
 *   ?state=ok|denied|unknown     what the deployment says about signing
 */
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/index.css';
import { AppShell } from '@/components/AppShell';
import { Scene } from './scene';

createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={['/kiosk']}>
    <AppShell>
      <Routes>
        <Route path="*" element={<Scene />} />
      </Routes>
    </AppShell>
  </MemoryRouter>,
);
