/**
 * The kiosk that used to wait forever without saying so.
 *
 * With the runtime signing grant missing, every poll throws and pairing can
 * never complete — but the screen kept showing its code as though the approval
 * simply had not happened yet. These tests are about the difference between
 * patience and silence: a blip still says nothing, a persistent stall
 * eventually does.
 *
 * They also pin the thing that is deliberately *not* claimed. The screen never
 * says why it stalled, because it cannot tell: the Functions SDK reports a
 * failed fetch with the same `internal` code as a server-side throw. What it
 * knows for certain is where it got to, and that is all it reports.
 *
 * Time is driven rather than waited through, so the poll interval can grow
 * without these getting slower.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PairingScreen, POLL_MS, TROUBLE_AFTER_FAILURES } from '@/kiosk/screens/PairingScreen';
import type { KioskServices } from '@/kiosk/KioskApp';

function servicesWith(poll: KioskServices['pollPairing']): KioskServices {
  return {
    beginPairing: vi.fn(async () => ({ code: 'HJ4K2P', secret: 's3cret', expiresInSeconds: 600 })),
    pollPairing: poll,
  } as unknown as KioskServices;
}

/** What the Functions SDK throws for both a dead network and a server 500. */
function callableFailure(): Error {
  const error = new Error('internal');
  (error as { code?: string }).code = 'functions/internal';
  return error;
}

/** Let pending promises settle, and optionally run the clock forward. */
async function tick(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Run `count` poll cycles. */
async function polls(count: number): Promise<void> {
  await tick(POLL_MS * count);
}

const STUCK = /pairing isn’t completing/;
const NO_CODE = /Can’t reach Tally right now/;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PairingScreen', () => {
  it('shows the code it was given', async () => {
    const poll = vi.fn(async () => 'pending' as const);
    render(<PairingScreen services={servicesWith(poll)} onPaired={vi.fn()} />);
    await tick();

    expect(screen.getByText('HJ4K2P')).toBeInTheDocument();
  });

  it('says nothing about a single dropped poll', async () => {
    let count = 0;
    const poll = vi.fn(async () => {
      count += 1;
      if (count === 1) throw callableFailure();
      return 'pending' as const;
    });

    render(<PairingScreen services={servicesWith(poll)} onPaired={vi.fn()} />);
    await tick();
    await polls(TROUBLE_AFTER_FAILURES + 2);

    expect(screen.queryByText(STUCK)).not.toBeInTheDocument();
    expect(screen.queryByText(NO_CODE)).not.toBeInTheDocument();
  });

  it('stays quiet until the failures stop looking like a blip', async () => {
    const poll = vi.fn(async () => {
      throw callableFailure();
    });

    render(<PairingScreen services={servicesWith(poll)} onPaired={vi.fn()} />);
    await tick();
    await polls(TROUBLE_AFTER_FAILURES - 1);

    expect(screen.queryByText(STUCK)).not.toBeInTheDocument();

    await polls(1);
    expect(screen.getByText(STUCK)).toBeInTheDocument();
  });

  it('points a leader at Settings once the pairing will not complete', async () => {
    // What a missing token-signing grant produces, on every poll, forever.
    const poll = vi.fn(async () => {
      throw callableFailure();
    });

    render(<PairingScreen services={servicesWith(poll)} onPaired={vi.fn()} />);
    await tick();
    await polls(TROUBLE_AFTER_FAILURES);

    expect(screen.getByText(STUCK).textContent).toContain('Check-in kiosk');
    // The code stays up: it is still the right code, and a leader may be
    // mid-approval.
    expect(screen.getByText('HJ4K2P')).toBeInTheDocument();
  });

  it('does not claim to know why it stalled', async () => {
    const poll = vi.fn(async () => {
      throw callableFailure();
    });

    render(<PairingScreen services={servicesWith(poll)} onPaired={vi.fn()} />);
    await tick();
    await polls(TROUBLE_AFTER_FAILURES);

    // An `internal` code means either a dead network or a broken deployment,
    // so the screen must not blame Tally — nor the lobby wifi.
    const text = screen.getByText(STUCK).textContent ?? '';
    expect(text).not.toMatch(/can’t reach|offline|network/i);
    expect(text).not.toMatch(/permission|IAM|broken/i);
  });

  it('goes quiet again once polling recovers', async () => {
    let count = 0;
    const poll = vi.fn(async () => {
      count += 1;
      if (count <= TROUBLE_AFTER_FAILURES) throw callableFailure();
      return 'pending' as const;
    });

    render(<PairingScreen services={servicesWith(poll)} onPaired={vi.fn()} />);
    await tick();
    await polls(TROUBLE_AFTER_FAILURES);
    expect(screen.getByText(STUCK)).toBeInTheDocument();

    await polls(1);
    expect(screen.queryByText(STUCK)).not.toBeInTheDocument();
  });

  it('hands the uid up once the pairing is approved', async () => {
    const onPaired = vi.fn();
    const poll = vi.fn(async () => ({ uid: 'kiosk-uid' }));

    render(<PairingScreen services={servicesWith(poll)} onPaired={onPaired} />);
    await tick();
    await polls(1);

    expect(onPaired).toHaveBeenCalledWith('kiosk-uid');
  });

  it('says something different when it cannot even get a code', async () => {
    const services = {
      beginPairing: vi.fn(async () => {
        throw callableFailure();
      }),
      pollPairing: vi.fn(),
    } as unknown as KioskServices;

    render(<PairingScreen services={services} onPaired={vi.fn()} />);
    await tick();

    // Nothing has been handed to a leader yet, so there is nothing to go and
    // check — this one really is just "try again".
    expect(screen.getByText(NO_CODE)).toBeInTheDocument();
    expect(screen.queryByText('HJ4K2P')).not.toBeInTheDocument();
  });
});
