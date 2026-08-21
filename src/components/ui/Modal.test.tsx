/**
 * The one gesture that must never throw work away.
 *
 * On a phone the dialog's backdrop is the empty band above the sheet, and
 * tapping empty space is how everybody puts a software keyboard away. While the
 * quick-add sheet is half filled in, that tap used to close it and drop the
 * visitor silently. Everything here is about the split: the backdrop still
 * dismisses a modal nobody has touched, and never dismisses one somebody has.
 */
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from '@/components/ui/Modal';

function VisitorForm() {
  const [first, setFirst] = useState('');
  const [grade, setGrade] = useState('');
  return (
    <form>
      <label htmlFor="first-name">First name</label>
      <input id="first-name" value={first} onChange={(event) => setFirst(event.target.value)} />
      <label htmlFor="grade">Grade</label>
      <select id="grade" value={grade} onChange={(event) => setGrade(event.target.value)}>
        <option value="">Pick one</option>
        <option value="9">9th</option>
      </select>
    </form>
  );
}

/** The `<dialog>` itself is the backdrop; the panel is the div inside it. */
function backdrop() {
  return screen.getByRole('dialog');
}

describe('Modal backdrop dismissal', () => {
  it('dismisses while nothing has been filled in', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Add a visitor">
        <VisitorForm />
      </Modal>,
    );

    fireEvent.click(backdrop());

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dismisses a modal that holds no fields at all', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Who is this?">
        <p>Nothing to type.</p>
      </Modal>,
    );

    fireEvent.click(backdrop());

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('goes inert once a name has been typed', async () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Add a visitor">
        <VisitorForm />
      </Modal>,
    );

    await userEvent.type(screen.getByLabelText('First name'), 'Dara');
    fireEvent.click(backdrop());

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('First name')).toHaveValue('Dara');
  });

  it('goes inert on a control nobody typed into', async () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Add a visitor">
        <VisitorForm />
      </Modal>,
    );

    await userEvent.selectOptions(screen.getByLabelText('Grade'), '9');
    fireEvent.click(backdrop());

    expect(onClose).not.toHaveBeenCalled();
  });

  it('still closes on Escape and on the close button while dirty', async () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Add a visitor">
        <VisitorForm />
      </Modal>,
    );
    await userEvent.type(screen.getByLabelText('First name'), 'Dara');

    // What Escape does to an open `<dialog>`; jsdom's `showModal` does not.
    fireEvent(backdrop(), new Event('cancel', { bubbles: false, cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('forgets the edit when the same modal is opened again', async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Modal open onClose={onClose} title="Add a visitor">
        <VisitorForm />
      </Modal>,
    );
    await userEvent.type(screen.getByLabelText('First name'), 'Dara');

    rerender(
      <Modal open={false} onClose={onClose} title="Add a visitor">
        <VisitorForm />
      </Modal>,
    );
    rerender(
      <Modal open onClose={onClose} title="Add a visitor">
        <VisitorForm />
      </Modal>,
    );

    fireEvent.click(backdrop());

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
