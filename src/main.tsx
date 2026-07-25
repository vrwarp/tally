import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from '@/App';
import '@/index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element.');

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

/**
 * Update immediately rather than prompting.
 *
 * Counselors install Tally once and never think about it again; a "new version
 * available" dialog during a check-in queue is worse than a silent refresh on
 * the next load.
 */
registerSW({ immediate: true });
