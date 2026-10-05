import { Link, useLocation, type LinkProps } from 'react-router-dom';
import { profileLinkState, type RestoreState } from '@/lib/profileBack';

/**
 * A link into a student profile that remembers the screen it was tapped on,
 * so the profile's back link returns there. See `src/lib/profileBack.ts`.
 */
export function ProfileLink({
  restore,
  ...props
}: Omit<LinkProps, 'state'> & { restore?: RestoreState }) {
  const { pathname, search } = useLocation();
  return <Link {...props} state={profileLinkState(pathname, search, restore)} />;
}
