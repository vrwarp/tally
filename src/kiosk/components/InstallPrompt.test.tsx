/**
 * What the kiosk offers, and to whom, about installing itself.
 *
 * Every branch here is a device somebody is standing in front of: a tablet that
 * can install and should be asked to, an iPad that can only be told how, and an
 * already-installed kiosk that must be shown nothing at all — a lobby screen
 * inviting a parent to install an app is a bug.
 *
 * The `beforeinstallprompt` event is Chromium-only and jsdom has none of it, so
 * these fake it exactly the way kiosk.html does in production: park the event on
 * `window`, then dispatch. If that inline script ever stops doing so, these tests
 * still pass and the button never appears — which is why the postbuild check
 * asserts the script is in the built page.
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstallPrompt } from '@/kiosk/components/InstallPrompt';

/** A stand-in for the event Chrome parks on `window`. */
function stashPrompt(): { prompt: ReturnType<typeof vi.fn> } {
  const event = { prompt: vi.fn(async () => {}), userChoice: Promise.resolve({ outcome: 'accepted' }) };
  window.__tallyKioskInstall = event as unknown as Window['__tallyKioskInstall'];
  return event;
}

/** What kiosk.html's inline handler does when the browser fires late. */
function fireInstallAvailable(): void {
  stashPrompt();
  window.dispatchEvent(new Event('beforeinstallprompt'));
}

/** iOS Safari, which defines this and nothing else useful. */
function asIosSafari(installed = false): void {
  Object.defineProperty(window.navigator, 'standalone', { value: installed, configurable: true });
}

const BUTTON = /install the kiosk app/i;
const INSTRUCTIONS = /add to home screen/i;

afterEach(() => {
  window.__tallyKioskInstall = null;
  Reflect.deleteProperty(window.navigator as object, 'standalone');
});

describe('InstallPrompt', () => {
  it('says nothing in a browser that cannot install', () => {
    render(<InstallPrompt />);

    expect(screen.queryByText(BUTTON)).not.toBeInTheDocument();
    expect(screen.queryByText(INSTRUCTIONS)).not.toBeInTheDocument();
  });

  it('offers the install once the browser has a prompt to give', async () => {
    const event = stashPrompt();
    render(<InstallPrompt />);

    await userEvent.click(screen.getByText(BUTTON));

    expect(event.prompt).toHaveBeenCalled();
  });

  /*
   * Chrome decides a page is installable on its own schedule, and a kiosk left
   * on the pairing screen is exactly where that happens — no rerender from
   * above, so the subscription is the only thing that can reveal the button.
   */
  it('appears when the browser only decides later', () => {
    render(<InstallPrompt />);
    expect(screen.queryByText(BUTTON)).not.toBeInTheDocument();

    act(() => fireInstallAvailable());

    expect(screen.getByText(BUTTON)).toBeInTheDocument();
  });

  /*
   * The event is single-use. Leaving the button up after it is spent would give
   * a leader a control that does nothing — worse at a shelf than no control,
   * because they will tap it twice and conclude the kiosk is broken.
   */
  it('withdraws the offer once the prompt has been used', async () => {
    stashPrompt();
    render(<InstallPrompt />);

    await userEvent.click(screen.getByText(BUTTON));

    expect(screen.queryByText(BUTTON)).not.toBeInTheDocument();
  });

  it('tells an iPad how, since WebKit will never offer', () => {
    asIosSafari();
    render(<InstallPrompt />);

    expect(screen.getByText(INSTRUCTIONS)).toBeInTheDocument();
  });

  it('says nothing to a kiosk already installed on iOS', () => {
    asIosSafari(true);
    render(<InstallPrompt />);

    expect(screen.queryByText(INSTRUCTIONS)).not.toBeInTheDocument();
  });

  it('says nothing to a kiosk already running standalone', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => ({ matches: query.includes('standalone') }) as MediaQueryList,
    );
    stashPrompt();

    render(<InstallPrompt />);

    expect(screen.queryByText(BUTTON)).not.toBeInTheDocument();
  });
});
