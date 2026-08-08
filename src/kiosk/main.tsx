/**
 * The kiosk entry point.
 *
 * Everything here is chosen for a weak device: no router, no providers, and no
 * theme *machinery* — kiosk.html pins dark, and a gathering that lends the
 * screen its own colours sends them down as finished hex, so wearing them is a
 * loop over `setProperty`. The Firebase SDK is *not* imported from this graph;
 * src/kiosk/services.ts is the one dynamic boundary, loaded after first paint
 * (see KioskApp).
 *
 * The binding is read and applied *before* the first render rather than from an
 * effect inside it. It is a synchronous localStorage read either way, and doing
 * it here is what stops a themed kiosk booting navy and repainting a frame
 * later — the same argument the inline script in index.html makes for the main
 * app. An expired binding is left alone: that kiosk is on its way to the
 * chooser, which is not at any gathering yet.
 *
 * There *is* a service worker, but not from here: kiosk.html registers
 * public/kiosk-sw.js after `load`, so nothing about installing the kiosk as an
 * app costs this bundle a byte or first paint a millisecond.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';
import { KioskApp } from './KioskApp';
import { bindingIsLive, readBinding } from './binding';
import { applyKioskTheme } from './theme';

const bound = readBinding();
if (bound && bindingIsLive(bound, Date.now())) {
  applyKioskTheme(bound.kioskGround, bound.kioskPalette);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <KioskApp />
  </StrictMode>,
);
