import { describe, it, expect } from 'vitest';
import net from 'node:net';
import { allocatePort } from '../../src/lib/port-pool.js';

describe('allocatePort', () => {
  it('returns a port that can be bound', async () => {
    const port = await allocatePort(3700);
    expect(port).toBeGreaterThanOrEqual(3700);
    await new Promise<void>((res, rej) => {
      const s = net.createServer();
      s.once('error', rej);
      s.listen(port, '127.0.0.1', () => s.close(() => res()));
    });
  });

  it('skips an already-bound port', async () => {
    const occupied = await new Promise<{ port: number; close: () => Promise<void> }>((res) => {
      const s = net.createServer().listen(0, '127.0.0.1', () => {
        const port = (s.address() as net.AddressInfo).port;
        res({
          port,
          close: () => new Promise<void>((r) => s.close(() => r())),
        });
      });
    });
    try {
      const port = await allocatePort(occupied.port);
      expect(port).not.toBe(occupied.port);
    } finally {
      await occupied.close();
    }
  });
});
