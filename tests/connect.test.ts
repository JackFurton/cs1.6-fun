import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { connect, serverUrl } from '../src/client/netclient';

class Socket {
  static CLOSING = 2;
  static last: Socket;
  readyState = 0;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  close = vi.fn(() => { this.readyState = 3; });
  constructor(readonly url: string) { Socket.last = this; }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:27015' });
  vi.stubGlobal('WebSocket', Socket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test.each([
  ['', 'ws://localhost:27015/'],
  [' 192.168.1.20 ', 'ws://192.168.1.20:27015/'],
  ['192.168.1.20:27099', 'ws://192.168.1.20:27099/'],
  ['http://192.168.1.20:27015/?connect', 'ws://192.168.1.20:27015/'],
  ['https://example.trycloudflare.com/?connect#game', 'wss://example.trycloudflare.com/'],
  ['wss://example.com/game', 'wss://example.com/game'],
  ['[::1]:27015', 'ws://[::1]:27015/'],
])('resolves server address %s', (input, expected) => {
  expect(serverUrl(input)).toBe(expected);
});

test('a tunnel page connects back to its own secure server', () => {
  vi.stubGlobal('location', { protocol: 'https:', host: 'example.trycloudflare.com' });
  expect(serverUrl('')).toBe('wss://example.trycloudflare.com/');
  expect(() => serverUrl('ftp://example.com')).toThrow('server address');
});

test.each(['defuse', 'dm'])('%s server info completes the handshake and clears its timeout', async (mode) => {
  const result = connect('ws://example.com:27015/');
  const ws = Socket.last;
  const info = { map: 'de_dust2', mode, difficulty: 'normal' };
  ws.readyState = 1;
  ws.onmessage?.({ data: JSON.stringify({ t: 'info', info }) });
  await expect(result).resolves.toEqual({ ws, info });
  expect(vi.getTimerCount()).toBe(0);
  expect(ws.close).not.toHaveBeenCalled();
  expect(ws.onmessage).toBeNull();
});

test.each([0, 1])('a silent server times out and closes a socket in state %i', async (state) => {
  const result = connect('ws://example.com:27015/');
  Socket.last.readyState = state;
  const rejected = expect(result).rejects.toThrow('timed out after 10 seconds');
  await vi.advanceTimersByTimeAsync(10000);
  await rejected;
  expect(Socket.last.close).toHaveBeenCalledOnce();
  expect(Socket.last.onmessage).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

test('connection errors reject promptly and release the timer', async () => {
  const result = connect('ws://example.com:27015/');
  Socket.last.onerror?.();
  await expect(result).rejects.toThrow("Couldn't reach the game server");
  expect(vi.getTimerCount()).toBe(0);
});

test('malformed responses become a visible connection error', async () => {
  const result = connect('ws://example.com:27015/');
  Socket.last.onmessage?.({ data: '<html>wrong server</html>' });
  await expect(result).rejects.toThrow('valid game message');
  expect(vi.getTimerCount()).toBe(0);
});
