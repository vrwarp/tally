/**
 * Back clears a filled search box before it leaves the screen.
 *
 * What has to hold: typing adds exactly one history entry, back takes the query
 * away and leaves the reader where they were, the next back leaves as it always
 * did, and a box emptied any other way takes its entry with it so no back press
 * is spent on nothing.
 *
 * Most of these run on a memory router, where a step back lands at once. The
 * last block runs on the real `window.history`, because in a browser — and in
 * jsdom — a step back lands a task later, and a counselor can type into that
 * gap.
 */
import { act, fireEvent, render, screen, waitFor } from '@/test/rtl';
import { useState } from 'react';
import {
  BrowserRouter,
  createMemoryRouter,
  Route,
  RouterProvider,
  Routes,
  type InitialEntry,
} from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { useBackClearsSearch } from '@/hooks/useBackClearsSearch';

function Search() {
  const [query, setQuery] = useState('');
  useBackClearsSearch(query, setQuery);
  return (
    <>
      <input aria-label="search" value={query} onChange={(event) => setQuery(event.target.value)} />
      <button type="button" onClick={() => setQuery('')}>
        clear
      </button>
    </>
  );
}

const type = (value: string) =>
  fireEvent.change(screen.getByLabelText('search'), { target: { value } });
const box = () => screen.queryByLabelText<HTMLInputElement>('search');

function setup(roster: InitialEntry = '/roster') {
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>home</p> },
      // One route for every group, so moving between groups keeps the screen
      // mounted — the way check-in stays mounted moving between events.
      { path: '/roster/:group?', element: <Search /> },
    ],
    { initialEntries: ['/', roster], initialIndex: 1 },
  );
  render(<RouterProvider router={router} />);
  const go = (delta: number) => act(() => router.navigate(delta));
  return { router, back: () => go(-1), forward: () => go(1) };
}

describe('useBackClearsSearch', () => {
  it('clears the query on back, then leaves on the next back', async () => {
    const { router, back } = setup();

    type('ma');
    type('mar');
    expect(router.state.location.state).toEqual({ searching: true });

    await back();
    expect(box()?.value).toBe('');
    expect(router.state.location.pathname).toBe('/roster');

    await back();
    expect(screen.getByText('home')).toBeInTheDocument();
  });

  it('pushes one entry per search, not one per keystroke', async () => {
    const { back } = setup();

    type('m');
    type('ma');
    type('mar');
    await back();
    expect(box()?.value).toBe('');

    await back();
    expect(screen.getByText('home')).toBeInTheDocument();
  });

  it('keeps the address it was searching on, query string and fragment included', () => {
    const { router } = setup('/roster?grade=3#top');

    type('mar');
    expect(router.state.location).toMatchObject({
      pathname: '/roster',
      search: '?grade=3',
      hash: '#top',
      state: { searching: true },
    });
  });

  it('takes its entry away when the box is cleared another way', async () => {
    const { router, back } = setup();

    type('mar');
    fireEvent.click(screen.getByText('clear'));
    // Back on the entry the search started from, not a copy of it.
    expect(router.state.location.pathname).toBe('/roster');
    expect(router.state.location.state).toBeNull();

    await back();
    expect(screen.getByText('home')).toBeInTheDocument();
  });

  it('starts over when the box is filled again after being cleared', async () => {
    const { back } = setup();

    type('mar');
    fireEvent.click(screen.getByText('clear'));
    type('jo');
    await back();
    expect(box()?.value).toBe('');

    await back();
    expect(screen.getByText('home')).toBeInTheDocument();
  });

  it('carries the query to somewhere new on the same screen rather than clearing it', async () => {
    const { router, back } = setup('/roster/a');

    type('mar');
    await act(() => router.navigate('/roster/b'));
    expect(box()?.value).toBe('mar');
    expect(router.state.location).toMatchObject({
      pathname: '/roster/b',
      state: { searching: true },
    });

    await back();
    expect(box()?.value).toBe('');
    expect(router.state.location.pathname).toBe('/roster/b');
  });

  it('unmarks an entry it finds with an empty box rather than stepping back from it', () => {
    const { router } = setup({ pathname: '/roster', state: { searching: true, from: 'menu' } });

    expect(box()).toBeInTheDocument();
    expect(router.state.historyAction).toBe('REPLACE');
    expect(router.state.location.pathname).toBe('/roster');
    // The marker goes; whatever else the entry carried stays.
    expect(router.state.location.state).toEqual({ from: 'menu' });
  });

  it('unmarks rather than steps back from an entry a forward press returns to', async () => {
    const { router, back, forward } = setup();

    type('mar');
    await back();
    await forward();

    expect(box()?.value).toBe('');
    expect(router.state.historyAction).toBe('REPLACE');
    expect(router.state.location.state).toEqual({});
  });
});

describe('useBackClearsSearch, with a back that lands a task later', () => {
  function setupBrowser() {
    window.history.replaceState(null, '', '/');
    window.history.pushState(null, '', '/roster');
    render(
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<p>home</p>} />
          <Route path="/roster" element={<Search />} />
        </Routes>
      </BrowserRouter>,
    );
    const entry = () =>
      window.history.state as { key?: string; usr?: { searching?: boolean } } | null;
    const marked = () => entry()?.usr?.searching === true;
    return { entry, marked };
  }

  it('keeps what was typed while its own back was on the way, and marks it once it lands', async () => {
    const { entry, marked } = setupBrowser();

    type('mar');
    const first = entry()?.key;
    fireEvent.click(screen.getByText('clear'));
    type('jo');
    // Still on the first search's entry until the back lands.
    expect(entry()?.key).toBe(first);
    await waitFor(() => expect(marked() && entry()?.key !== first).toBe(true));
    expect(box()?.value).toBe('jo');

    act(() => window.history.back());
    await waitFor(() => expect(box()?.value).toBe(''));
    expect(window.location.pathname).toBe('/roster');
  });

  it('sends one back, not two, when the box is emptied twice before the first lands', async () => {
    const { marked } = setupBrowser();

    type('mar');
    fireEvent.click(screen.getByText('clear'));
    type('jo');
    fireEvent.click(screen.getByText('clear'));

    await waitFor(() => expect(marked()).toBe(false));
    // Give a second, wrong, back the time it would need to land.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(window.location.pathname).toBe('/roster');
    expect(box()?.value).toBe('');
  });
});
