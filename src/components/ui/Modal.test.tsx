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
import { fireEvent, render, screen } from '@/test/rtl';
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

/**
 * A dismissal is not over when the dialog goes away.
 *
 * The press that closed the dialog still owes the page a `click`, and the
 * browser hit-tests that click against whatever the DOM holds by the time it
 * dispatches it. On Insights the release dialog's × sits almost exactly over
 * the `Export CSV` beside "Missing in action", so on iPadOS — where the click
 * is a compatibility event synthesised after `touchend` — closing the dialog
 * downloaded the follow-up list. See `trailingClick.ts`.
 */
describe('Modal dismissal', () => {
  /** Whatever the dialog was covering. */
  function Underneath({ onClick }: { onClick: () => void }) {
    return (
      <button type="button" onClick={onClick}>
        Export CSV
      </button>
    );
  }

  function pressAt(x: number, y: number) {
    window.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }));
  }

  function releaseAt(x: number, y: number) {
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: x, clientY: y }));
  }

  function trailingClickAt(node: HTMLElement, x: number, y: number) {
    fireEvent(
      node,
      new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }),
    );
  }

  it('closes the dialog when the caller unmounts it rather than passing open={false}', () => {
    const { unmount } = render(
      <Modal open onClose={vi.fn()} title="No longer expected here">
        <p>Why this student is no longer expected.</p>
      </Modal>,
    );
    const dialog = backdrop() as HTMLDialogElement;
    expect(dialog.open).toBe(true);

    // How most callers dismiss: `ReleaseDialog` returns null, so the <dialog>
    // leaves the document. Without the close it goes with the browser still
    // holding it in the top layer.
    unmount();

    expect(dialog.open).toBe(false);
  });

  it('swallows the click the dismissing press leaves behind', () => {
    const exported = vi.fn();

    function Screen() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <Underneath onClick={exported} />
          {open ? (
            <Modal open onClose={() => setOpen(false)} title="No longer expected here">
              <p>Why this student is no longer expected.</p>
            </Modal>
          ) : null}
        </>
      );
    }

    render(<Screen />);

    // The press lands on the ×, and the click that closes the dialog with it.
    pressAt(640, 560);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    // iPadOS then delivers the same gesture's trailing click, hit-tested afresh
    // against the button the dialog was covering.
    trailingClickAt(screen.getByRole('button', { name: 'Export CSV' }), 640, 560);

    expect(exported).not.toHaveBeenCalled();
  });

  it('still lets a deliberate press through straight after the dialog closes', () => {
    const exported = vi.fn();

    function Screen() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <Underneath onClick={exported} />
          {open ? (
            <Modal open onClose={() => setOpen(false)} title="No longer expected here">
              <p>Why this student is no longer expected.</p>
            </Modal>
          ) : null}
        </>
      );
    }

    render(<Screen />);

    pressAt(640, 560);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    // Somebody who really did mean to export presses again — and a real press
    // brings its own `pointerdown`, which is what tells it apart from the ghost.
    pressAt(640, 560);
    trailingClickAt(screen.getByRole('button', { name: 'Export CSV' }), 640, 560);

    expect(exported).toHaveBeenCalledTimes(1);
  });

  it('arms nothing when the dialog was dismissed from the keyboard', () => {
    const exported = vi.fn();

    function Screen() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <Underneath onClick={exported} />
          {open ? (
            <Modal open onClose={() => setOpen(false)} title="No longer expected here">
              <p>Why this student is no longer expected.</p>
            </Modal>
          ) : null}
        </>
      );
    }

    render(<Screen />);

    // No press behind this dismissal, so there is no gesture for a later click
    // to be orphaned from.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    trailingClickAt(screen.getByRole('button', { name: 'Export CSV' }), 640, 560);

    expect(exported).toHaveBeenCalledTimes(1);
  });

  /**
   * A hand that rests before it lifts is still a hand.
   *
   * The window is measured from the lift, not from the moment of contact —
   * measured from contact, holding the × for a second put the press beyond the
   * guard's reach and let the trailing click through, which is the one case it
   * exists for.
   */
  it('guards a press that was held a while before it was released', () => {
    const exported = vi.fn();
    const clock = vi.spyOn(Date, 'now');
    let now = 1_700_000_000_000;
    clock.mockImplementation(() => now);

    function Screen() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <Underneath onClick={exported} />
          {open ? (
            <Modal open onClose={() => setOpen(false)} title="No longer expected here">
              <p>Why this student is no longer expected.</p>
            </Modal>
          ) : null}
        </>
      );
    }

    render(<Screen />);

    pressAt(640, 560);
    now += 1_500; // held well past the window before letting go
    releaseAt(640, 560);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    trailingClickAt(screen.getByRole('button', { name: 'Export CSV' }), 640, 560);

    expect(exported).not.toHaveBeenCalled();
  });

  /**
   * The staleness the window is actually for: a dialog that goes away long
   * after anybody touched it — a save completing, a caller changing its mind —
   * owes nobody a click.
   */
  it('arms nothing when the dialog closes long after the last press', () => {
    const exported = vi.fn();
    const clock = vi.spyOn(Date, 'now');
    let now = 1_700_000_000_000;
    clock.mockImplementation(() => now);

    function Screen() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <Underneath onClick={exported} />
          {open ? (
            <Modal open onClose={() => setOpen(false)} title="No longer expected here">
              <button type="button" onClick={() => undefined}>
                Something in the dialog
              </button>
            </Modal>
          ) : null}
        </>
      );
    }

    const { rerender } = render(<Screen />);

    pressAt(640, 560);
    releaseAt(640, 560);
    now += 60_000; // a minute of nothing, then the dialog closes by itself
    rerender(<Screen />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    trailingClickAt(screen.getByRole('button', { name: 'Export CSV' }), 640, 560);

    expect(exported).toHaveBeenCalledTimes(1);
  });
});
