/**
 * The kiosk entry point.
 *
 * Everything here is chosen for a weak device: no router, no providers, no
 * service worker, no theme machinery — kiosk.html pins dark. The Firebase SDK
 * is *not* imported from this graph; src/kiosk/services.ts is the one dynamic
 * boundary, loaded after first paint (see KioskApp).
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';
import { KioskApp } from './KioskApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <KioskApp />
  </StrictMode>,
);
