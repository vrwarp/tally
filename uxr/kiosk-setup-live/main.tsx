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
import { IntlProvider } from 'use-intl';
import { AppShell } from '@/components/AppShell';
import { Scene } from './scene';
import messages from '../../messages/en.json';

/*
 * The provider the app mounts in `src/main.tsx`, mounted here too.
 *
 * It was missing, and its absence did not look like its absence: every screen
 * under `AppShell` calls `useTranslations`, so the whole tree died with "No
 * intl context found" and the harness rendered an empty page rather than an
 * error anybody could act on. `team-live/main.tsx` has carried this line all
 * along; this file predates the app's move to a compiled catalogue and was
 * never brought along.
 *
 * A fixed zone rather than the runner's, so a relative time in a frame resolves
 * the same way on a laptop in London and on CI — the same reason `team-live`
 * pins one.
 */
createRoot(document.getElementById('root')!).render(
  <IntlProvider locale="en" messages={messages} timeZone="America/Los_Angeles">
    <MemoryRouter initialEntries={['/kiosk']}>
      <AppShell>
        <Routes>
          <Route path="*" element={<Scene />} />
        </Routes>
      </AppShell>
    </MemoryRouter>
  </IntlProvider>,
);
