import net from 'node:net';

export async function isFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, host, () => s.close(() => resolve(true)));
  });
}

export async function allocatePort(
  startFrom: number,
  host = '127.0.0.1',
  maxAttempts = 100,
): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const candidate = startFrom + i;
    if (await isFree(candidate, host)) return candidate;
  }
  throw new Error(`no free port in [${startFrom}, ${startFrom + maxAttempts})`);
}
