import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

/* jsdom implements neither of these, and the roster relies on both. */
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
}
if (!HTMLDialogElement.prototype.close) {
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
}
if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = vi.fn();
}

/*
 * A do-nothing IntersectionObserver.
 *
 * jsdom has no layout, so nothing can genuinely intersect anything — a real
 * implementation would never fire. The history list at the foot of the check-in
 * screen constructs one, and it has a "Load older gatherings" button as its
 * fallback path, which is what the tests drive. This only has to exist.
 */
if (!('IntersectionObserver' in window)) {
  Object.defineProperty(window, 'IntersectionObserver', {
    writable: true,
    value: class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      takeRecords = vi.fn(() => []);
      readonly root = null;
      readonly rootMargin = '';
      readonly thresholds: readonly number[] = [];
    },
  });
}

if (!('vibrate' in navigator)) {
  Object.defineProperty(navigator, 'vibrate', { value: vi.fn(), writable: true });
}

if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}
