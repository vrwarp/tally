/**
 * The check-in screen, mounted from `src/` inside the app's own shell, on
 * Sunday morning in a gathering that tracks check-out.
 *
 * Routed exactly as `src/App.tsx` routes it — `event/:eventId` — so the screen
 * resolves tonight's gathering through the real `useActiveEvent`, loads its
 * chain through the real `useSeriesHistoryEvents`, and builds the roster with
 * the real `buildRoster`. See `fixture.ts` for the knobs.
 */
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/index.css';
import { IntlProvider } from 'use-intl';
import { AppShell } from '@/components/AppShell';
import { Scene } from './scene';
import { TONIGHT } from './fixture';
import messages from '../../messages/en.json';

createRoot(document.getElementById('root')!).render(
  <IntlProvider locale="en" messages={messages} timeZone="America/Los_Angeles">
    <MemoryRouter initialEntries={[`/event/${TONIGHT.id}`]}>
      <AppShell>
        <Routes>
          <Route path="event/:eventId" element={<Scene />} />
          <Route path="*" element={<Scene />} />
        </Routes>
      </AppShell>
    </MemoryRouter>
  </IntlProvider>,
);
