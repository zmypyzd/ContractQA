import type { Redacted } from '@contractqa/core';

export interface RedactionRules {
  redactLocalStorageValues: boolean;
  redactSessionStorageValues: boolean;
  redactCookieValues: boolean;
  headers: string[];
  bodyFields: string[];
}

export const defaultRedactionRules: RedactionRules = {
  redactLocalStorageValues: true,
  redactSessionStorageValues: true,
  redactCookieValues: true,
  headers: ['authorization', 'cookie', 'x-api-key', 'proxy-authorization'],
  bodyFields: [
    'password',
    'token',
    'secret',
    'privatekey',
    'apikey',
    'access_token',
    'refresh_token',
  ],
};

export function redactValue(_v: unknown): Redacted {
  return { __redacted: true };
}

export function redactHeaders(
  headers: Record<string, string>,
  rules: RedactionRules,
): Record<string, string | Redacted> {
  const out: Record<string, string | Redacted> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = rules.headers.includes(k.toLowerCase()) ? redactValue(v) : v;
  }
  return out;
}

export function redactBody(body: unknown, rules: RedactionRules): unknown {
  if (body === null || typeof body !== 'object') return body;
  if (Array.isArray(body)) return body.map((x) => redactBody(x, rules));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (rules.bodyFields.includes(k.toLowerCase())) {
      out[k] = redactValue(v);
    } else {
      out[k] = redactBody(v, rules);
    }
  }
  return out;
}

export function redactStorageMap(
  m: Record<string, string>,
  enabled: boolean,
): Record<string, string | Redacted> {
  const out: Record<string, string | Redacted> = {};
  for (const k of Object.keys(m)) out[k] = enabled ? redactValue(m[k]) : (m[k] as string);
  return out;
}
