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

type HistoryState = Record<string, unknown> | null;

/** The router's state with the marker set or taken off, the rest kept. */
function stateWith(state: unknown, marked: boolean): Record<string, unknown> {
  const rest = { ...(state as HistoryState) };
  if (marked) return { ...rest, [MARK]: true };
  delete rest[MARK];
  return rest;
}

/**
 * `setQuery` rather than a callback that clears: a state setter keeps its
 * identity across renders, so the effect below re-runs on transitions and not
 * on every keystroke.
 */
export function useBackClearsSearch(query: string, setQuery: (query: string) => void): void {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();

  const searching = query !== '';
  const marked = (location.state as HistoryState)?.[MARK] === true;

  const wasMarked = useRef(marked);
  /** This mount pushed the marked entry, so stepping back over it is safe. */
  const pushed = useRef(false);
  /** A back this hook asked for is on its way; its pop is not the reader's. */
  const unwinding = useRef(false);

  useEffect(() => {
    // A PUSH that drops the marker is somewhere new — another event on the
    // same screen — and the query goes with the reader rather than being lost.
    const popped = wasMarked.current && !marked && navigationType === 'POP';
    wasMarked.current = marked;

    if (popped) {
      pushed.current = false;
      if (!unwinding.current) {
        setQuery('');
        return;
      }
      unwinding.current = false;
    }
    // Waiting on that back. Anything typed meanwhile is marked once it lands,
    // and a second emptying must not send a second back after the first.
    if (unwinding.current) return;

    const here = { pathname: location.pathname, search: location.search, hash: location.hash };
    if (searching && !marked) {
      pushed.current = true;
      navigate(here, { state: stateWith(location.state, true) });
    } else if (!searching && marked) {
      if (pushed.current) {
        unwinding.current = true;
        navigate(-1);
      } else {
        navigate(here, { replace: true, state: stateWith(location.state, false) });
      }
    }
  }, [searching, marked, navigationType, navigate, location, setQuery]);
}
