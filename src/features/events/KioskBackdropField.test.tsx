/**
 * The kiosk photo field, in a language other than English.
 *
 * Its summary and guidance were translated, and the controls a leader actually
 * presses were not: the disclosure's verb, the photo button and the line that
 * says what the photo was resized to all read English in every locale.
 */
import userEvent from '@testing-library/user-event';
import { render, screen } from '@/test/rtl';
import { describe, expect, it, vi } from 'vitest';
import { KioskBackdropField, type KioskBackdropChoice } from '@/features/events/KioskBackdropField';

vi.mock('@/services/kioskBackdrops', () => ({
  fetchKioskBackdrop: vi.fn(async () => null),
}));

function mount(value: KioskBackdropChoice) {
  const { container } = render(
    <KioskBackdropField value={value} theme={null} onChange={() => {}} />,
    { locale: 'zh-Hant' },
  );
  return container.querySelector('button[aria-expanded]') as HTMLButtonElement;
}

describe('KioskBackdropField, in another language', () => {
  it('offers a photo in the reader’s language', async () => {
    const user = userEvent.setup();
    const trigger = mount({ kind: 'none' });
    expect(trigger).not.toHaveTextContent('Change');
    expect(trigger).toHaveTextContent('變更');

    await user.click(trigger);

    expect(trigger).not.toHaveTextContent('Done');
    expect(screen.queryByRole('button', { name: 'Choose a photo' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '選擇照片' })).toBeInTheDocument();
  });

  it('says what a new photo was resized to in the reader’s language', async () => {
    const user = userEvent.setup();
    const trigger = mount({
      kind: 'new',
      prepared: {
        id: 'b0123456789',
        blob: new Blob(['x'.repeat(4096)]),
        contentType: 'image/jpeg',
        width: 1080,
        height: 1920,
      },
    });

    await user.click(trigger);

    expect(screen.queryByText(/^Resized to/)).not.toBeInTheDocument();
    expect(screen.getByText(/^已縮放為 1920 px/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '更換照片' })).toBeInTheDocument();
  });
});
