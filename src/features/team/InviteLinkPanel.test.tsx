/**
 * The panel that shows a token once, and the three things it has to say
 * correctly about it.
 *
 * A link lasts a fortnight and goes into a text message. A QR lasts ten
 * minutes and is held up to somebody standing in the room. They arrive at this
 * component as the same shape with a different `life`, and what follows from
 * that is worth pinning:
 *
 *   - The sentence beside the square is a claim about how long the thing on
 *     screen works. Printing the ten-minute one for a fortnight-long link
 *     would be a security claim the token does not honour.
 *   - A ten-minute token draws itself. Its clock started at the mint, so
 *     asking the inviter to press again spends what they were given.
 *   - What the link *grants* is said here. The form says it too, in a line
 *     that on a phone sits under the keyboard while the form's one field has
 *     focus — and the keyboard's Go key is that form's submit.
 *
 * `@/lib/qr` is the real encoder: it is pure, it is fast, and stubbing it here
 * would leave the dynamic import — the part that actually has a failure mode —
 * untested.
 */
import { render, screen, waitFor } from '@/test/rtl';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { InviteLinkPanel, type MintedLink } from '@/features/team/InviteLinkPanel';

const TOKEN = 'dgA7w5zi2j72CUpYv-kQ3Zr1sTbN9xLmPq4WvE6yHc8';

function minted(overrides: Partial<MintedLink> = {}): MintedLink {
  return {
    id: 'link_abc',
    token: TOKEN,
    expiresAt: Date.now() + 14 * 86_400_000,
    label: 'Jo, nursery, Marie’s daughter',
    life: 'link',
    gatherings: ['Sunday School'],
    ...overrides,
  };
}

describe('a fortnight-long link', () => {
  it('draws no code until it is asked to, and then says what that code is', async () => {
    const user = userEvent.setup();
    render(<InviteLinkPanel minted={minted()} onDismiss={() => {}} />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show QR' }));

    expect(await screen.findByRole('img')).toBeInTheDocument();
    expect(screen.getByText(/lasts exactly as long as the link does/)).toBeInTheDocument();
    // The ten-minute promise belongs to the other lifetime and to nothing else.
    expect(screen.queryByText(/ten minutes/)).not.toBeInTheDocument();
  });
});

describe('a ten-minute code', () => {
  it('is already on screen, because the clock did not wait for the press', async () => {
    render(
      <InviteLinkPanel
        minted={minted({ life: 'qr', expiresAt: Date.now() + 600_000 })}
        onDismiss={() => {}}
      />,
    );

    expect(await screen.findByRole('img')).toBeInTheDocument();
    expect(screen.getByText(/It stops working in ten minutes/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide QR' })).toBeInTheDocument();
  });
});

describe('what the link grants', () => {
  it('says what it puts them on', () => {
    render(<InviteLinkPanel minted={minted()} onDismiss={() => {}} />);
    expect(screen.getByText('Puts them on Sunday School.')).toBeInTheDocument();
  });

  it('says plainly when it puts them on nothing in particular', () => {
    render(<InviteLinkPanel minted={minted({ gatherings: [] })} onDismiss={() => {}} />);
    expect(screen.getByText(/every gathering nobody has limited/)).toBeInTheDocument();
  });
});

describe('the link itself', () => {
  it('is readable and selectable even where the clipboard refuses', async () => {
    const user = userEvent.setup();
    // Some in-app browsers and every http origin: the token must still be
    // takeable by hand rather than stranded behind a button that did nothing.
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('denied'));
    render(<InviteLinkPanel minted={minted()} onDismiss={() => {}} />);

    const field = screen.getByLabelText('Invitation link');
    expect(field).toHaveValue(`${window.location.origin}/join/${TOKEN}`);

    await user.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
  });
});
