import { describe, expect, it } from 'vitest';
import { profileBack, profileLinkState } from '@/lib/profileBack';

describe('profileBack', () => {
  it('falls back to the roster with nothing to go on', () => {
    expect(profileBack(null)).toEqual({ to: '/students', label: 'students' });
    expect(profileBack(undefined)).toEqual({ to: '/students', label: 'students' });
    expect(profileBack({ searching: true })).toEqual({ to: '/students', label: 'students' });
  });

  it('returns to the screen the profile was opened from, under its rail name', () => {
    expect(profileBack(profileLinkState('/'))).toEqual({ to: '/', label: 'checkIn' });
    expect(profileBack(profileLinkState('/event/e1'))).toEqual({ to: '/event/e1', label: 'checkIn' });
    expect(profileBack(profileLinkState('/dashboard'))).toEqual({ to: '/dashboard', label: 'insights' });
    expect(profileBack(profileLinkState('/events/e1'))).toEqual({ to: '/events/e1', label: 'events' });
    expect(profileBack(profileLinkState('/review'))).toEqual({ to: '/review', label: 'review' });
    expect(profileBack(profileLinkState('/students', '?q=ann'))).toEqual({
      to: '/students?q=ann',
      label: 'students',
    });
  });

  it('hands back the view the origin sent along', () => {
    expect(profileBack(profileLinkState('/event/e1', '', { focus: 'checkedOut' }))).toEqual({
      to: '/event/e1',
      label: 'checkIn',
      state: { focus: 'checkedOut' },
    });
  });

  it('never leaves the app or loops onto another profile', () => {
    const roster = { to: '/students', label: 'students' };
    expect(profileBack({ from: 'https://evil.example' })).toEqual(roster);
    expect(profileBack({ from: '//evil.example/' })).toEqual(roster);
    expect(profileBack({ from: '/students/s2' })).toEqual(roster);
    expect(profileBack({ from: '/settings' })).toEqual(roster);
    expect(profileBack({ from: 42 })).toEqual(roster);
    expect(profileBack({ from: 'dashboard' })).toEqual(roster);
    expect(profileBack({ from: '//dashboard' })).toEqual(roster);
    expect(profileBack({ from: '/x/event/e1' })).toEqual(roster);
    expect(profileBack({ from: '/event/e1/more' })).toEqual(roster);
    expect(profileBack({ from: '/x/events/e1' })).toEqual(roster);
    expect(profileBack({ from: '/events/e1/more' })).toEqual(roster);
  });

  it('reads a path the same with a trailing slash, query or hash', () => {
    expect(profileBack({ from: '/events' })).toEqual({ to: '/events', label: 'events' });
    expect(profileBack({ from: '/dashboard//' })).toEqual({ to: '/dashboard//', label: 'insights' });
    expect(profileBack({ from: '/review#kiosk' })).toEqual({ to: '/review#kiosk', label: 'review' });
  });

  it('hands back only a view it can return with', () => {
    for (const restore of [null, ['checkedOut'], 'checkedOut', 3]) {
      expect(profileBack({ from: '/', restore })).toEqual({ to: '/', label: 'checkIn' });
    }
  });
});
