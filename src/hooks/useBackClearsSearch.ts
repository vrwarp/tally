/**
 * Lets the browser's back button clear a search box that has something in it.
 *
 * A counselor who has typed a name and found the student reaches for back to
 * get the whole roster again — that is what back does on every phone app with
 * a search field. Without this it did something else entirely: it left the
 * screen, or on the home screen it left Tally, and the query they meant to
 * throw away was the only thing that survived.
 *
 * So a search that starts puts one entry on the history stack — same URL, a
 * marker in its state — and back pops it. The pop is the signal: the marker is
 * gone, the query is not, so the query goes. A second back then does what back
 * always did.
 *
 * The entry has to come off again when the box is emptied some other way (the
 * clear button, Escape, backspace, a check-in that resets the field), or the
 * next back would land on the same screen and do nothing visible. When this
 * screen put the entry there it steps back over it; when it did not — a reload,
 * or a forward press, brought it back with an empty box — it rewrites the entry
 * in place instead, because stepping back from somewhere this screen did not
 * arrive by could leave it.
 *
 * Through the router rather than `history.pushState` directly, so the router's
 * own idea of where it is never disagrees with the browser's.
 */
import { useEffect, useRef } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';

const MARK = 'searching';

function stateWith(state: unknown, marked: boolean): Record<string, unknown> {
  const rest = typeof state === 'object' && state !== null ? { ...state } : {};
  if (marked) return { ...rest, [MARK]: true };
  delete (rest as Record<string, unknown>)[MARK];
  return rest;
}

function isMarked(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as Record<string, unknown>)[MARK] === true;
}

export function useBackClearsSearch(query: string, clear: () => void): void {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();

  const searching = query !== '';
  const marked = isMarked(location.state);

  // Read inside the effect without making every keystroke or route render
  // re-run it: the effect answers to *transitions*, not to values.
  const latest = useRef({ location, clear });
  latest.current = { location, clear };

  const wasMarked = useRef(marked);
  /** This mount pushed the marked entry, so stepping back over it is safe. */
  const pushed = useRef(false);
  /** A back this hook asked for is on its way; its pop is not the reader's. */
  const unwinding = useRef(false);

  useEffect(() => {
    const { location: here, clear: clearQuery } = latest.current;
    const popped = wasMarked.current && !marked && navigationType === 'POP';
    wasMarked.current = marked;

    if (popped) {
      pushed.current = false;
      if (unwinding.current) {
        unwinding.current = false;
      } else if (searching) {
        clearQuery();
        return;
      }
    }
    if (unwinding.current) return;

    const to = { pathname: here.pathname, search: here.search, hash: here.hash };
    if (searching && !marked) {
      pushed.current = true;
      navigate(to, { state: stateWith(here.state, true) });
    } else if (!searching && marked) {
      if (pushed.current) {
        pushed.current = false;
        unwinding.current = true;
        navigate(-1);
      } else {
        navigate(to, { replace: true, state: stateWith(here.state, false) });
      }
    }
  }, [searching, marked, navigationType, navigate]);
}
