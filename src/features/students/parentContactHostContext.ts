/**
 * The handle a row uses to open the parent-contact form it does not own.
 *
 * Split from the provider because the provider is a component, and a file that
 * exports both stops being hot-reloadable — the same reason `dataContext` and
 * `toastContext` sit beside their providers rather than inside them.
 */
import { createContext, useContext } from 'react';
import type { Student } from '@/types';

export interface ParentContactHostValue {
  /**
   * Opens the form for one student, above whatever is on screen.
   *
   * `onAdded` is taken here and held until the form closes, rather than read
   * back off the row afterwards: the row that pressed this is very often gone
   * by then — that is the whole point of hosting the dialog elsewhere — and the
   * list it belonged to still wants telling that the answer it was drawn from
   * has changed.
   */
  open: (student: Student, onAdded?: () => void) => void;
}

export const ParentContactHostContext = createContext<ParentContactHostValue | null>(null);

export function useParentContactHost(): ParentContactHostValue {
  const value = useContext(ParentContactHostContext);
  if (!value) throw new Error('Parent contact controls must be used inside <ParentContactHost>.');
  return value;
}
