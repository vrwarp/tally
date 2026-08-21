/**
 * The one thing the shell has to get right for the lobby kiosk.
 *
 * Pairing a kiosk is open to any active member — the callable says so, and the
 * person who arrives first on a Friday and finds the iPad asking to be claimed
 * is usually a counselor. For a long time nothing in the app linked them to it:
 * `/pair-kiosk` existed, but the only route to it was a text link on Settings,
 * which is `RequireRole core`. The kiosk's own screen told them to go there.
 *
 * So these assert the route out of a counselor's account menu, and that the two
 * genuinely core-team destinations are still not in it.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/types';

let role: Role = 'counselor';
/** Whatever `DataProvider` is currently saying about its streams. */
let dataError: string | null = null;
const RANK: Record<Role, number> = { counselor: 0, core: 1, admin: 2 };

vi.mock('@/context/authContext', () => ({
  useAuth: () => ({
    profile: { email: 'sam.whitfield@example.org', displayName: 'Sam Whitfield', role },
    signOut: vi.fn(),
    can: (needed: Role) => RANK[role] >= RANK[needed],
  }),
}));

vi.mock('@/context/dataContext', () => ({
  useData: () => ({ error: dataError }),
}));

const { AppShell } = await import('@/components/AppShell');

beforeEach(() => {
  dataError = null;
});

function renderShell(who: Role) {
  role = who;
  return render(
    <MemoryRouter>
      <AppShell>
        <p>a screen</p>
      </AppShell>
    </MemoryRouter>,
  );
}

async function openAccountMenu(who: Role) {
  renderShell(who);
  // Both shell slots carry the same control; either opens the same surface.
  await userEvent.click(screen.getAllByRole('button', { name: /Sam Whitfield/ })[0]!);
}

describe('the account menu', () => {
  it('offers a counselor the kiosk, and nothing they cannot open', async () => {
    await openAccountMenu('counselor');

    const kiosk = screen.getAllByRole('menuitem', { name: 'Kiosk' })[0]!;
    expect(kiosk).toHaveAttribute('href', '/pair-kiosk');
    // Settings is core-only and Team with it. A menu that listed them would be
    // listing two screens that redirect.
    expect(screen.queryByRole('menuitem', { name: 'Team' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('keeps Kiosk for the core team, beside Team and Settings', async () => {
    await openAccountMenu('admin');

    for (const label of ['Kiosk', 'Team', 'Settings']) {
      expect(screen.getAllByRole('menuitem', { name: label }).length).toBeGreaterThan(0);
    }
  });

  it('keeps sign out attached to the account rather than under the thumb', async () => {
    await openAccountMenu('counselor');

    /*
     * A counselor's menu holds one destination and one irreversible act. As the
     * last row of a bottom sheet, Sign out would be the nearest thing on the
     * screen to a thumb and one aiming error from the row they came for — and
     * the cost is a sign-in while a pairing code expires. It belongs to the
     * identity block, which is the same subject.
     */
    const sheet = screen.getAllByRole('menu').at(-1)!;
    const items = within(sheet).getAllByRole('menuitem');
    expect(items[0]).toHaveTextContent('Sign out');
    expect(items.at(-1)).toHaveTextContent('Kiosk');
  });
});

describe('the shell with one destination', () => {
  it('gives a counselor a way back to check-in', async () => {
    role = 'counselor';
    render(
      <MemoryRouter initialEntries={['/pair-kiosk']}>
        <AppShell>
          <p>a screen</p>
        </AppShell>
      </MemoryRouter>,
    );

    // No rail, no tab bar: the wordmark is the only chrome left, so it has to
    // be the way home rather than a label.
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tally' })).toHaveAttribute('href', '/');
  });
});

/**
 * The banner over a dead Firestore listener.
 *
 * `onSnapshot`'s error handler is terminal — the listener is gone and nothing
 * re-opens it — and `DataProvider` marks the stream ready anyway so the app is
 * not wedged behind a spinner. What that leaves is every screen's cheerful
 * empty state painted over a read that never happened: "Nothing scheduled yet"
 * for a calendar nobody could load. The banner was the only thing saying
 * otherwise, and it offered nothing to do about it — not a retry, not a
 * dismissal, not the reload that is the actual recovery.
 */
describe('the shell over a broken stream', () => {
  it('offers the reload the failure can actually be fixed by', () => {
    dataError = 'Could not load events: Missing or insufficient permissions.';
    renderShell('core');

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Could not load events');
    // In the alert rather than beside it: a recovery somebody has to already
    // know about is not a recovery the product ships.
    expect(within(alert).getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });

  it('says nothing at all while every stream is alive', () => {
    renderShell('core');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
