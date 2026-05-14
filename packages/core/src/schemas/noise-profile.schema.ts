import { z } from 'zod';
import { assertSafeRegex } from './safe-regex.js';

const SafeRegex = z.string().superRefine((v, ctx) => {
  try {
    assertSafeRegex(v);
  } catch (e) {
    ctx.addIssue({ code: 'custom', message: (e as Error).message });
  }
});

export const NoiseProfileSchema = z.object({
  project: z.string().min(1),
  generated_at: z.string().datetime(),
  ignore: z
    .object({
      localStorage_keys: z.array(SafeRegex).default([]),
      sessionStorage_keys: z.array(SafeRegex).default([]),
      cookies: z.array(SafeRegex).default([]),
      network_url_patterns: z.array(SafeRegex).default([]),
      console_patterns: z.array(SafeRegex).default([]),
    })
    .default({}),
});

export type NoiseProfile = z.infer<typeof NoiseProfileSchema>;
