// packages/cli/src/autopilot/format-progress.ts
//
// Render an AutopilotProgressEvent as one terminal-friendly line. Used by the
// CLI (`bin/contractqa.ts`) so non-watch autopilot runs aren't silent.
// Output shape is stable; downstream tools may grep it.

import type { AutopilotProgressEvent } from '../commands/autopilot.js';

function elapsedSeconds(ms: number): string {
  return `[${(ms / 1000).toFixed(2)}s]`;
}

function formatCounters(counters: Record<string, unknown> | undefined): string {
  if (!counters) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(counters)) {
    if (value === undefined) continue;
    if (typeof value === 'boolean') {
      // Booleans show only when true — keeps the line compact for the common
      // "no fallback triggered" path. Set explicitly to false elsewhere if
      // that signal becomes relevant.
      if (value) parts.push(`${key}=true`);
      continue;
    }
    if (typeof value === 'number') {
      // Numeric zeros ARE real signal ("we ran but nothing matched") — keep.
      parts.push(`${key}=${value}`);
      continue;
    }
    if (typeof value === 'string') {
      // Quote so spaces in the value don't fuse with the next field.
      parts.push(`${key}=${JSON.stringify(value).replace(/^"|"$/g, "'")}`);
      continue;
    }
    // Fallback for shapes we don't expect — render via JSON.
    parts.push(`${key}=${JSON.stringify(value)}`);
  }
  return parts.length > 0 ? ' ' + parts.join(' ') : '';
}

export function formatProgressEvent(event: AutopilotProgressEvent): string {
  const prefix = elapsedSeconds(event.elapsedMs);
  if (event.type === 'phase') {
    const counters = formatCounters(event.counters as Record<string, unknown> | undefined);
    return `${prefix} phase=${event.phase} status=${event.status}${counters}`;
  }
  // type === 'log'
  return `${prefix} ${event.level}: ${event.message}`;
}
