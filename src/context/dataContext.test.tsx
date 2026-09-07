/**
 * The one guard on the app-wide data context.
 *
 * A silent `null` here is not a null — it is a crash three components down, in
 * whichever one first reads `.students`, with a stack that points at the
 * consumer rather than at the missing provider. Saying so at the boundary is
 * the difference between a five-second fix and a hunt.
 */
import { render } from '@/test/rtl';
import { describe, expect, it, vi } from 'vitest';
import { DataContext, useData, type DataContextValue } from '@/context/dataContext';
import { makeSettings } from '../../tests/factories';

function Probe() {
  useData();
  return null;
}

describe('useData', () => {
  it('hands back whatever the provider is publishing', () => {
    const value = {
      students: [],
      events: [],
      series: [],
      settings: makeSettings(),
      loading: false,
      error: null,
    } as unknown as DataContextValue;

    let seen: DataContextValue | null = null;
    function Reader() {
      seen = useData();
      return null;
    }

    render(
      <DataContext.Provider value={value}>
        <Reader />
      </DataContext.Provider>,
    );

    expect(seen).toBe(value);
  });

  it('says what is missing rather than handing back nothing', () => {
    const noisy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow('useData must be used inside <DataProvider>.');
    noisy.mockRestore();
  });
});
