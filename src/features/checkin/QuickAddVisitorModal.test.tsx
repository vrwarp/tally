/**
 * The door form, and the one thing that was allowed to grow on it.
 *
 * Journey 3 is a promise about a queue: three fields, one button, and nothing
 * between a thumb and Save. The parent contact is the exception, and the whole
 * of what these assert is that it stays an exception — closed until asked for,
 * skippable once open, and never able to turn a check-in into a failure.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/context/ToastProvider';
import { QuickAddVisitorModal } from '@/features/checkin/QuickAddVisitorModal';
import { makeEvent } from '../../../tests/factories';

const quickAddAndCheckIn = vi.fn();
const recordVisitorParent = vi.fn();

vi.mock('@/services/attendance', () => ({
  quickAddAndCheckIn: (...args: unknown[]) => quickAddAndCheckIn(...args),
}));

vi.mock('@/services/functions', () => ({
  recordVisitorParent: (...args: unknown[]) => recordVisitorParent(...args),
}));

const EVENT = makeEvent({ id: 'friday-today' });

function open() {
  render(
    <ToastProvider>
      <QuickAddVisitorModal open onClose={() => {}} event={EVENT} uid="counselor-uid" />
    </ToastProvider>,
  );
}

async function typeVisitor(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^first name/i), 'Robin');
  await user.type(screen.getByLabelText(/^last name/i), 'Fields');
}

beforeEach(() => {
  quickAddAndCheckIn.mockResolvedValue('student-1');
  recordVisitorParent.mockResolvedValue({ data: { status: 'recorded', last4: '3344' } });
});

describe('the door form', () => {
  it('opens on three fields and nothing about a parent', () => {
    open();
    expect(screen.getByLabelText(/^first name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^last name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/grade/i)).toBeInTheDocument();
    // The section exists as an offer, not as fields: a counselor with six people
    // waiting reads three boxes.
    expect(screen.queryByLabelText(/parent/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add parent contact/i })).toBeInTheDocument();
  });

  it('saves and checks in with no parent, exactly as it always did', async () => {
    const user = userEvent.setup();
    open();
    await typeVisitor(user);
    await user.click(screen.getByRole('button', { name: /save & check in/i }));

    await waitFor(() => expect(quickAddAndCheckIn).toHaveBeenCalledTimes(1));
    expect(quickAddAndCheckIn.mock.calls[0]![0]).toMatchObject({
      draft: { firstName: 'Robin', lastName: 'Fields' },
    });
    expect(recordVisitorParent).not.toHaveBeenCalled();
  });
});

describe('the parent contact', () => {
  it('opens with the surname already carried across', async () => {
    const user = userEvent.setup();
    open();
    await typeVisitor(user);
    await user.click(screen.getByRole('button', { name: /add parent contact/i }));

    expect(screen.getByLabelText(/parent last name/i)).toHaveValue('Fields');
    expect(screen.getByLabelText(/parent first name/i)).toHaveValue('');
  });

  it('lets a counselor open it, type nothing, and still save', async () => {
    // The parent walked off. Opening a section is not answering it, and a
    // required field nobody asked for would strand somebody at a door.
    const user = userEvent.setup();
    open();
    await typeVisitor(user);
    await user.click(screen.getByRole('button', { name: /add parent contact/i }));
    await user.clear(screen.getByLabelText(/parent last name/i));
    await user.click(screen.getByRole('button', { name: /save & check in/i }));

    await waitFor(() => expect(quickAddAndCheckIn).toHaveBeenCalledTimes(1));
    expect(recordVisitorParent).not.toHaveBeenCalled();
  });

  it('refuses a name with no number behind it', async () => {
    const user = userEvent.setup();
    open();
    await typeVisitor(user);
    await user.click(screen.getByRole('button', { name: /add parent contact/i }));
    await user.type(screen.getByLabelText(/parent first name/i), 'Dana');
    await user.click(screen.getByRole('button', { name: /save & check in/i }));

    expect(await screen.findByText(/10-digit number/i)).toBeInTheDocument();
    // Nothing was written: a half-answered parent must not cost the child their
    // check-in, and it must not be silently dropped either.
    expect(quickAddAndCheckIn).not.toHaveBeenCalled();
  });

  it('sends the parent after the child, and only after', async () => {
    const user = userEvent.setup();
    open();
    await typeVisitor(user);
    await user.click(screen.getByRole('button', { name: /add parent contact/i }));
    await user.type(screen.getByLabelText(/parent first name/i), 'Dana');
    await user.type(screen.getByLabelText(/parent phone/i), '5550103344');
    await user.click(screen.getByRole('button', { name: /save & check in/i }));

    await waitFor(() => expect(recordVisitorParent).toHaveBeenCalledTimes(1));
    expect(recordVisitorParent.mock.calls[0]![0]).toMatchObject({
      // The id the quick-add came back with — the record has to name a student
      // that exists, which is why this cannot be fired alongside the write.
      studentId: 'student-1',
      eventId: 'friday-today',
      guardian: { firstName: 'Dana', lastName: 'Fields', phone: '5550103344' },
    });
    expect(recordVisitorParent.mock.calls[0]![0].registrationId).toMatch(/^[A-Za-z0-9-]{20,64}$/);
  });

  it('says the parent failed without saying the check-in did', async () => {
    recordVisitorParent.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    open();
    await typeVisitor(user);
    await user.click(screen.getByRole('button', { name: /add parent contact/i }));
    await user.type(screen.getByLabelText(/parent first name/i), 'Dana');
    await user.type(screen.getByLabelText(/parent phone/i), '5550103344');
    await user.click(screen.getByRole('button', { name: /save & check in/i }));

    // The child is on the roster whatever happens next, so the sentence names
    // what actually did not land. "Could not save Robin" would send a counselor
    // back to add a student who is already there.
    expect(await screen.findByText(/parent contact did not save/i)).toBeInTheDocument();
    expect(screen.queryByText(/could not save Robin/i)).not.toBeInTheDocument();
  });

  it('drops what was typed when the section is removed', async () => {
    const user = userEvent.setup();
    open();
    await typeVisitor(user);
    await user.click(screen.getByRole('button', { name: /add parent contact/i }));
    await user.type(screen.getByLabelText(/parent first name/i), 'Dana');
    await user.type(screen.getByLabelText(/parent phone/i), '5550103344');
    await user.click(screen.getByRole('button', { name: /remove/i }));
    await user.click(screen.getByRole('button', { name: /save & check in/i }));

    await waitFor(() => expect(quickAddAndCheckIn).toHaveBeenCalledTimes(1));
    // What is on screen is what will be sent. A number behind a closed panel
    // reaching the server would be the worst kind of surprise on this screen.
    expect(recordVisitorParent).not.toHaveBeenCalled();
  });
});
