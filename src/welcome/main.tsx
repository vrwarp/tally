/**
 * The welcome page's entry point.
 *
 * Same posture as the kiosk's: no router, no providers, no service worker. The
 * difference is that this one has no Firestore either — one form and two
 * callables is the whole application, so `./services` imports `firebase/app`
 * and `firebase/functions` and nothing else.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';
import { WelcomeApp } from './WelcomeApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WelcomeApp />
  </StrictMode>,
);
