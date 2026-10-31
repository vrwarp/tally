/**
 * The print server card: shows the half a person may see, tests before it
 * saves, and never asks for a token it already holds.
 */
import { fireEvent, render, screen, waitFor } from '@/test/rtl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrintServerCard } from '@/features/settings/PrintServerCard';

const readPrintServerConfig = vi.hoisted(() => vi.fn());
const probePrintServer = vi.hoisted(() => vi.fn());
const setPrintServer = vi.hoisted(() => vi.fn());
const show = vi.hoisted(() => vi.fn());

vi.mock('@/services/printServer', () => ({ readPrintServerConfig, probePrintServer }));
vi.mock('@/services/functions', () => ({ setPrintServer }));
vi.mock('@/context/toastContext', () => ({ useToast: () => ({ show }) }));

const NONE = { exists: false, url: '', updatedAt: null, updatedBy: null };
const SAVED = {
  exists: true,
  url: 'wss://print.church.example/ws',
  updatedAt: new Date(Date.now() - 3 * 86_400_000),
  updatedBy: 'uid-core',
};

beforeEach(() => {
  vi.clearAllMocks();
  readPrintServerConfig.mockResolvedValue(NONE);
  setPrintServer.mockResolvedValue({ data: { status: 'saved' } });
});

async function openForm() {
  render(<PrintServerCard />);
  const button = await screen.findByRole('button', { name: /set up|change/i });
  fireEvent.click(button);
}

describe('PrintServerCard', () => {
  it('says there is no print server, and offers to set one up', async () => {
    render(<PrintServerCard />);

    expect(await screen.findByText('No print server')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove print server' })).not.toBeInTheDocument();
  });

  it('names the host kiosks print through, never the token', async () => {
    readPrintServerConfig.mockResolvedValue(SAVED);
    render(<PrintServerCard />);

    expect(await screen.findByText('Kiosks print through print.church.example')).toBeInTheDocument();
    expect(screen.getByText(/^Saved .+\.$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove print server' })).toBeInTheDocument();
  });

  it('saves the address as typed with the token, and reports it', async () => {
    await openForm();

    fireEvent.change(screen.getByLabelText('Server address'), {
      target: { value: 'https://print.church.example' },
    });
    fireEvent.change(screen.getByLabelText('Token'), { target: { value: ' bql_abc123 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save print server' }));

    await waitFor(() =>
      expect(setPrintServer).toHaveBeenCalledWith({ url: 'https://print.church.example', token: 'bql_abc123' }),
    );
    expect(show).toHaveBeenCalledWith('Print server saved. Kiosks pick it up within a minute.', { tone: 'success' });
    // Read back rather than trusted: the server normalises and stamps it.
    expect(readPrintServerConfig).toHaveBeenCalledTimes(2);
  });

  it('will not save or test an address that is not one', async () => {
    await openForm();

    fireEvent.change(screen.getByLabelText('Server address'), { target: { value: 'print.church.example' } });
    fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'bql_abc' } });

    expect(screen.getByText('The print server needs an address like https://print.example.org.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save print server' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Test' })).toBeDisabled();
  });

  it('keeps the saved token when the field is left blank', async () => {
    readPrintServerConfig.mockResolvedValue(SAVED);
    await openForm();

    // The address comes back in the spelling a person typed, and the token
    // field is empty: it is write-only.
    const address = screen.getByLabelText<HTMLInputElement>('Server address');
    expect(address.value).toBe('https://print.church.example');
    expect(screen.getByLabelText<HTMLInputElement>('Token').value).toBe('');
    expect(screen.getByText(/Leave blank to keep the token already saved\./)).toBeInTheDocument();

    fireEvent.change(address, { target: { value: 'https://print2.church.example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save print server' }));

    await waitFor(() => expect(setPrintServer).toHaveBeenCalledWith({ url: 'https://print2.church.example' }));
  });

  it('cannot test without a token, and lists what the server offers when it can', async () => {
    probePrintServer.mockResolvedValue([
      { id: 'p1', name: 'Shipping desk', statusMode: 'snmp' },
      { id: 'p2', name: 'Old QL-700', statusMode: 'none' },
    ]);
    await openForm();

    fireEvent.change(screen.getByLabelText('Server address'), {
      target: { value: 'https://print.church.example' },
    });
    expect(screen.getByRole('button', { name: 'Test' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'bql_abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    // Tested with the address the kiosk will dial, not the one typed.
    await waitFor(() => expect(probePrintServer).toHaveBeenCalledWith('wss://print.church.example/ws', 'bql_abc'));
    expect(await screen.findByText('The print server answered. 2 printers are registered:')).toBeInTheDocument();
    expect(screen.getByText('Shipping desk')).toBeInTheDocument();
    expect(screen.getByText(/Old QL-700/)).toHaveTextContent('no status path — kiosks will not offer it');
    expect(setPrintServer).not.toHaveBeenCalled();
  });

  it('words a failed test without guessing which half failed', async () => {
    probePrintServer.mockRejectedValue(new Error('unauthorized'));
    await openForm();

    fireEvent.change(screen.getByLabelText('Server address'), {
      target: { value: 'https://print.church.example' },
    });
    fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'bql_abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    expect(await screen.findByText(/Could not reach the print server with these details/)).toBeInTheDocument();
  });

  it('says what the server refused, in the reader’s words', async () => {
    setPrintServer.mockRejectedValue({
      message: 'Paste the token the print server created, with nothing around it.',
      details: { code: 'printServer.badToken' },
    });
    await openForm();

    fireEvent.change(screen.getByLabelText('Server address'), {
      target: { value: 'https://print.church.example' },
    });
    fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'bql_abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save print server' }));

    expect(
      await screen.findByText('Paste the token the print server created, with nothing around it.'),
    ).toBeInTheDocument();
    expect(show).not.toHaveBeenCalled();
  });

  it('removes only after a second press, and tells the kiosks go back to USB', async () => {
    readPrintServerConfig.mockResolvedValue(SAVED);
    setPrintServer.mockResolvedValue({ data: { status: 'cleared' } });
    render(<PrintServerCard />);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove print server' }));
    expect(setPrintServer).not.toHaveBeenCalled();
    expect(screen.getByText(/Remove the print server\?/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove it' }));

    await waitFor(() => expect(setPrintServer).toHaveBeenCalledWith(null));
    expect(show).toHaveBeenCalledWith('Print server removed. Kiosks go back to USB printing.', { tone: 'success' });
  });
});
