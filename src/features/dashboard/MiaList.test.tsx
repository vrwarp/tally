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
   *
   * Sized rather than capped, and 68px rather than the 48 one pill line comes
   * to, because folded the block is the row's second column: inside 18rem the
   * phone number wraps onto a second line, and a block that finds that out
   * when Planning Center answers grows the row 12px and widens it 91 under
   * whoever is reading the list. Both dimensions are the settled ones from the
   * first frame, and both come off again at `2xl`. See `e2e/layout-shift`.
   */
  it('folds the row where a laptop column can hold it, without spending the name', () => {
    /*
     * The reservation is sized against what the block holds, and it is held to
     * that in both directions — as a floor so a row does not widen when its own
     * lookup lands, and as a ceiling so the width does not come out of the
     * student's name. It was 18rem when the block was two pills and a wrapped
     * number, and 13 when it was a button with the digits captioned under it.
     * It is the button, so it is 10, and each of those 128px went back to the
     * meta line a leader reads.
     */
    const { container } = mount([mia('Bree', 'Sandoval', 'pco:1')]);

    const row = container.querySelector('li');
    expect(row).toHaveClass('xl:flex');
    expect(screen.getByRole('group', { name: /Contact for Bree Sandoval/ })).toHaveClass(
      'xl:w-40',
    );
    /*
     * And nothing taller than the pill it holds. A `min-h` above `min-h-12`
     * here is a reservation for something stacked under the button, and a
     * stack is what lifted the button 10px off the line the avatar, the badge
     * and Resolve all sit on — on every row of the list.
     */
    expect(screen.getByRole('group', { name: /Contact for Bree Sandoval/ })).not.toHaveClass(
      'xl:min-h-14',
    );
    // The row's own floor is what keeps a released row exactly as tall as the
    // live one it replaces; see `ReleasedRow`.
    expect(row).toHaveClass('xl:min-h-18');
  });
});
