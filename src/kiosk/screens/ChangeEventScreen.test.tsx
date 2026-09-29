/**
 * **Leave**, said with its cost — and one more cost while the kiosk cannot
 * reach Tally: the chooser's list comes from Tally, so a kiosk that leaves then
 * cannot be set to anything until the internet is back.
 */
import { render, screen } from '@/test/rtl';
import { describe, expect, it } from 'vitest';
import { ChangeEventScreen } from '@/kiosk/screens/ChangeEventScreen';

const OFFLINE = /can’t pick another gathering until it’s back online/;

describe('ChangeEventScreen', () => {
  it('warns only about the queue at the door while the kiosk is in touch', () => {
    render(<ChangeEventScreen title="Sunday Kids" onStay={() => {}} onLeave={() => {}} />);
    expect(screen.getByText(/Nobody can check in here/)).toBeTruthy();
    expect(screen.queryByText(OFFLINE)).toBeNull();
  });

  it('says what leaving costs while the kiosk cannot reach Tally', () => {
    render(<ChangeEventScreen title="Sunday Kids" outOfTouch onStay={() => {}} onLeave={() => {}} />);
    expect(screen.getByText(OFFLINE)).toBeTruthy();
  });
});
