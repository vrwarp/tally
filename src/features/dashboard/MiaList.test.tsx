/**
 * What the MIA list hands to a leader who is about to start phoning.
 *
 * The bug pinned here left the app: the clipboard copy goes into the team
 * group chat, and with one student on the list it pasted "Follow-up — 1
 * students we have not seen" — while the toast fired by the same press said
 * "Copied 1 name". Two strings about the same press, disagreeing, one of them
 * in front of the whole team.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MiaList } from '@/features/dashboard/MiaList';
import { ParentContactHost } from '@/features/students/ParentContactHost';
import { invalidatePersonDetails } from '@/hooks/usePersonDetails';
import { makeStudent } from '../../../tests/factories';
import type { MiaStudent } from '@/types';

const getPersonDetails = vi.hoisted(() => vi.fn());
const setParentContact = vi.hoisted(() => vi.fn());
const addParent = vi.hoisted(() => vi.fn());

vi.mock('@/services/functions', () => ({ getPersonDetails, setParentContact, addParent }));
vi.mock('@/context/toastContext', () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock('@/context/dataContext', () => ({ useData: () => ({ refreshRoster: vi.fn() }) }));

const writeText = vi.hoisted(() => vi.fn());

function mia(first: string, last: string, id: string): MiaStudent {
  return {
    student: makeStudent({ id, firstName: first, lastName: last, grade: 8 }),
    consecutiveMisses: 3,
    lastAttendedAt: new Date('2026-01-09T19:30:00'),
    lastAttendedEventTitle: 'Friday Fellowship',
    gatheringKey: 'friday',
    gatheringTitle: 'Friday Fellowship',
    alsoMissingCount: 0,
  };
}

function mount(items: MiaStudent[]) {
  return render(
    <MemoryRouter>
      <ParentContactHost>
        <MiaList items={items} threshold={3} gatheringTitle="Friday Fellowship" />
      </ParentContactHost>
    </MemoryRouter>,
  );
}

describe('MiaList', () => {
  beforeEach(() => {
    invalidatePersonDetails();
    getPersonDetails.mockResolvedValue({ data: null });
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true,
    });
  });

  it('counts one student as a student in the text it puts on the clipboard', async () => {
    mount([mia('Bree', 'Sandoval', 'pco:1')]);

    await userEvent.click(screen.getByRole('button', { name: 'Copy list' }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const pasted = writeText.mock.calls[0]![0] as string;
    expect(pasted).toContain('Follow-up — 1 student we have not seen:');
    expect(pasted).not.toContain('1 students');
  });

  it('still says students when there is more than one', async () => {
    mount([mia('Bree', 'Sandoval', 'pco:1'), mia('Hana', 'Yamamoto', 'pco:2')]);

    await userEvent.click(screen.getByRole('button', { name: 'Copy list' }));

    expect(writeText.mock.calls[0]![0]).toContain('Follow-up — 2 students we have not seen:');
  });

  /*
   * The density decision, pinned because it is a number rather than a taste:
   * the row folds onto one line where the column can hold it, and the contact
   * block is what gives way there rather than the student's name. At 1280 the
   * left column is 584px and the block's natural 378 would leave the name 38.
   */
  it('folds the row where a laptop column can hold it, without spending the name', () => {
    const { container } = mount([mia('Bree', 'Sandoval', 'pco:1')]);

    const row = container.querySelector('li');
    expect(row).toHaveClass('xl:flex');
    expect(screen.getByRole('group', { name: /Parent contact for Bree Sandoval/ })).toHaveClass(
      'xl:max-w-72',
      '2xl:max-w-none',
    );
  });
});
