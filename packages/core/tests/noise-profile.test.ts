import { describe, it, expect } from 'vitest';
import { NoiseProfileSchema } from '../src/schemas/noise-profile.schema.js';

describe('NoiseProfileSchema', () => {
  it('parses §8.5.2 example', () => {
    const parsed = NoiseProfileSchema.parse({
      project: 'my-app',
      generated_at: '2026-05-14T10:00:00Z',
      ignore: {
        localStorage_keys: ['^posthog-', '^sentry-'],
        cookies: ['^_ga', '^_gid'],
        network_url_patterns: ['/api/telemetry'],
        console_patterns: ['Download the React DevTools.*'],
      },
    });
    expect(parsed.ignore.localStorage_keys).toHaveLength(2);
  });

  it('rejects ReDoS-dangerous patterns', () => {
    expect(() =>
      NoiseProfileSchema.parse({
        project: 'x',
        generated_at: '2026-05-14T10:00:00Z',
        ignore: { localStorage_keys: ['(a+)+$'] },
      }),
    ).toThrow(/unsafe regex/i);
  });

  it('defaults empty arrays when ignore omitted', () => {
    const parsed = NoiseProfileSchema.parse({
      project: 'x',
      generated_at: '2026-05-14T10:00:00Z',
    });
    expect(parsed.ignore.localStorage_keys).toEqual([]);
    expect(parsed.ignore.cookies).toEqual([]);
  });
});
