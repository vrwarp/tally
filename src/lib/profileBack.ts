/**
 * Where a student profile's back link goes, and what it is called.
 *
 * The profile is opened from six screens — check-in, Insights, an event, the
 * review queue, the roster — and its back link used to say "All students"
 * whichever one it was. A counselor who tapped Profile on a checked-out row at
 * the door was sent to a list they had never been on, and had to find the
 * check-in screen again from the rail with a family waiting.
 *
 * So every link into a profile carries the screen it was tapped on, in the
 * history entry's state, and the back link returns there under that screen's
 * own name from the rail. State rather than a query string: it survives a
 * reload and the browser's own back and forward, and a profile URL somebody
 * pastes into a message stays the clean one. Arriving with no state — a pasted
 * link, a bookmark — falls back to the roster, which is what the link always
 * said.
 *
 * A screen whose view the reader shaped — the check-in roster's filter, say —
 * can send that along as `restore`, and the back link hands it back as the
 * origin's own history state, so "Checked out" is still the list on screen
 * when they return to it.
 */

/** A key into `Nav.*` — the rail already names every screen once. */
export type BackLabel = 'checkIn' | 'insights' | 'events' | 'review' | 'students';

/** View state a screen hands to the profile, to be given back on return. */
export type RestoreState = Record<string, unknown>;

export interface ProfileBack {
  to: string;
  label: BackLabel;
  /** The origin's state to return with — the `restore` it sent, if any. */
  state?: RestoreState;
}

export interface ProfileLinkState {
  from: string;
  restore?: RestoreState;
}

const ROSTER: ProfileBack = { to: '/students', label: 'students' };

/** The state a link into a profile carries: the screen it was tapped on. */
export function profileLinkState(
  pathname: string,
  search = '',
  restore?: RestoreState,
): ProfileLinkState {
  return restore ? { from: `${pathname}${search}`, restore } : { from: `${pathname}${search}` };
}

/**
 * The back link for a profile reached with `state`.
 *
 * Only a path this app routes to is honoured — the state is whatever the
 * history entry holds, and a back link must never be an open redirect or a
 * loop onto another profile.
 */
export function profileBack(state: unknown): ProfileBack {
  const from =
    typeof state === 'object' && state !== null && 'from' in state ? state.from : undefined;
  if (typeof from !== 'string' || !from.startsWith('/') || from.startsWith('//')) return ROSTER;
  const restore = (state as { restore?: unknown }).restore;
  const back = (label: BackLabel): ProfileBack =>
    typeof restore === 'object' && restore !== null && !Array.isArray(restore)
      ? { to: from, label, state: restore as RestoreState }
      : { to: from, label };
  const path = from.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/';

  if (path === '/' || /^\/event\/[^/]+$/.test(path)) return back('checkIn');
  if (path === '/dashboard') return back('insights');
  if (path === '/events' || /^\/events\/[^/]+$/.test(path)) return back('events');
  if (path === '/review') return back('review');
  if (path === '/students') return back('students');
  return ROSTER;
}
