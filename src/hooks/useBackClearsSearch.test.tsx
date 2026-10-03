/**
 * Back clears a filled search box before it leaves the screen.
 *
 * What has to hold: typing adds exactly one history entry, back takes the query
 * away and leaves the reader where they were, the next back leaves as it always
 * did, and a box emptied any other way takes its entry with it so no back press
 * is spent on nothing.
 */
import { act, fireEvent, render, screen } from '@/test/rtl';
import { useState } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { useBackClearsSearch } from '@/hooks/useBackClearsSearch';

function Search() {
  const [query, setQuery] = useState('');
  useBackClearsSearch(query, () => setQuery(''));
  return (
    <>
      <input aria-label="search" value={query} onChange={(event) => setQuery(event.target.value)} />
      <button type="button" onClick={() => setQuery('')}>
        clear
      </button>
    </>
  );
}

function setup(roster: { pathname: string; state?: unknown } = { pathname: '/roster' }) {
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>home</p> },
      { path: '/roster', element: <Search /> },
    ],
    { initialEntries: ['/', roster], initialIndex: 1 },
  );
  render(<RouterProvider router={router} />);
  const back = () => act(() => router.navigate(-1));
  const type = (value: string) =>
    fireEvent.change(screen.getByLabelText('search'), { target: { value } });
  const box = () => screen.queryByLabelText<HTMLInputElement>('search');
  return { router, back, type, box };
}

describe('useBackClearsSearch', () => {
  it('clears the query on back, then leaves on the next back', async () => {
    const { router, back, type, box } = setup();

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
    const { back, type, box } = setup();

    type('m');
    type('ma');
    type('mar');
    await back();
    expect(box()?.value).toBe('');

    await back();
    expect(screen.getByText('home')).toBeInTheDocument();
  });

  it('takes its entry away when the box is cleared another way', async () => {
    const { router, back, type } = setup();

    type('mar');
    fireEvent.click(screen.getByText('clear'));
    // Back on the entry the search started from, not a copy of it.
    expect(router.state.location.pathname).toBe('/roster');
    expect(router.state.location.state).toBeNull();

    await back();
    expect(screen.getByText('home')).toBeInTheDocument();
  });

  it('starts over when the box is filled again after being cleared', async () => {
    const { back, type, box } = setup();

    type('mar');
    fireEvent.click(screen.getByText('clear'));
    type('jo');
    await back();
    expect(box()?.value).toBe('');

    await back();
    expect(screen.getByText('home')).toBeInTheDocument();
  });

  it('unmarks an entry it finds with an empty box rather than stepping back from it', () => {
    const { router, box } = setup({ pathname: '/roster', state: { searching: true } });

    expect(box()).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/roster');
    expect(router.state.location.state).toEqual({});
  });
});
