import { describe, it, expect, vi } from 'vitest';
import { uploadBundleToS3 } from '../src/s3-upload.js';

describe('uploadBundleToS3', () => {
  it('uploads each file with correct key prefix + manifest', async () => {
    const put = vi.fn().mockResolvedValue({});
    const client = { send: put } as unknown as Parameters<typeof uploadBundleToS3>[0]['client'];
    const result = await uploadBundleToS3({
      client,
      bucket: 'contractqa',
      keyPrefix: 'projects/demo/runs/r1',
      localDir: '/tmp/nonexistent',
      manifest: {
        bundle_id: 'b1',
        created_at: '2026-05-14T00:00:00Z',
        contract_id: 'INV-A2',
        run_id: 'r1',
        files: [
          { path: 'issue.json', sha256: 'a', bytes: 2, kind: 'issue' },
          { path: 'screenshots/x.png', sha256: 'b', bytes: 3, kind: 'screenshot' },
        ],
        redaction_applied: true,
      },
      readFile: async (p: string) => Buffer.from('FAKE:' + p),
    });
    expect(put).toHaveBeenCalledTimes(3);
    expect(result.uploaded).toBe(3);
    expect(result.keys).toContain('projects/demo/runs/r1/issue.json');
    expect(result.keys).toContain('projects/demo/runs/r1/manifest.json');
  });
});
