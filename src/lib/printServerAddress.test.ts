import { describe, expect, it } from 'vitest';
import {
  PRINT_SERVER_ADDRESS_MAX_LENGTH,
  browserAddressOf,
  normalisePrintServerAddress,
  printServerHostOf,
} from '@/lib/printServerAddress';

describe('normalising the print server address', () => {
  it('turns what the browser shows into the WebSocket endpoint', () => {
    expect(normalisePrintServerAddress('https://print.church.example')).toBe('wss://print.church.example/ws');
    expect(normalisePrintServerAddress('  https://print.church.example/  ')).toBe('wss://print.church.example/ws');
    expect(normalisePrintServerAddress('http://192.168.1.20:8080')).toBe('ws://192.168.1.20:8080/ws');
  });

  it('keeps an endpoint the administrator typed in full', () => {
    expect(normalisePrintServerAddress('wss://print.church.example/ws')).toBe('wss://print.church.example/ws');
    expect(normalisePrintServerAddress('https://nas.church.example/bridge')).toBe('wss://nas.church.example/bridge');
  });

  it('strips every trailing slash, and only trailing ones', () => {
    expect(normalisePrintServerAddress('https://nas.church.example/a/b/')).toBe('wss://nas.church.example/a/b');
    expect(normalisePrintServerAddress('https://nas.church.example//')).toBe('wss://nas.church.example/ws');
    expect(normalisePrintServerAddress('https://nas.church.example/bridge//')).toBe(
      'wss://nas.church.example/bridge',
    );
  });

  it('accepts an address exactly at the length bound and refuses one past it', () => {
    const host = `https://${'a'.repeat(PRINT_SERVER_ADDRESS_MAX_LENGTH - 'https://.example'.length)}.example`;
    expect(host.length).toBe(PRINT_SERVER_ADDRESS_MAX_LENGTH);
    expect(normalisePrintServerAddress(host)).toBe(`wss://${host.slice('https://'.length)}/ws`);
    expect(normalisePrintServerAddress(`${host}x`)).toBeNull();
    // Surrounding whitespace is not length.
    expect(normalisePrintServerAddress(`  ${host}  `)).not.toBeNull();
  });

  it('refuses anything that is not an address to a print server', () => {
    for (const bad of [
      '',
      'print.church.example',
      'ftp://print.church.example',
      'https://user:pw@print.church.example',
      'https://print.church.example/?token=x',
      'https://print.church.example/#admin',
      `https://${'a'.repeat(200)}.example`,
    ]) {
      expect(normalisePrintServerAddress(bad), bad).toBeNull();
    }
  });
});

describe('reading a saved address back', () => {
  it('shows the spelling a person typed', () => {
    expect(browserAddressOf('wss://print.church.example/ws')).toBe('https://print.church.example');
    expect(browserAddressOf('ws://192.168.1.20:8080/ws')).toBe('http://192.168.1.20:8080');
    expect(browserAddressOf('wss://nas.church.example/bridge')).toBe('https://nas.church.example/bridge');
  });

  it('round-trips through normalisation', () => {
    for (const typed of ['https://print.church.example', 'http://192.168.1.20:8080', 'https://nas.church.example/bridge']) {
      expect(browserAddressOf(normalisePrintServerAddress(typed)!)).toBe(typed);
    }
  });

  it('leaves something that is not a socket address alone, so it stays visible', () => {
    expect(browserAddressOf('not an address')).toBe('not an address');
    expect(browserAddressOf('https://already.example')).toBe('https://already.example');
  });

  it('names the host for the one-line summary', () => {
    expect(printServerHostOf('wss://print.church.example/ws')).toBe('print.church.example');
    expect(printServerHostOf('ws://192.168.1.20:8080/ws')).toBe('192.168.1.20:8080');
    expect(printServerHostOf('garbage')).toBe('garbage');
  });
});
