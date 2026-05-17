// packages/cli/src/autopilot/stash-guard.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface StashedItem {
  path: string;
  state: 'modified' | 'staged' | 'untracked' | 'untracked-gitignored';
  isSensitive: boolean;
}

const SENSITIVE_PATTERNS = [/\.env(\..+)?$/i, /\.pem$/i, /secret/i, /credential/i, /\bkey\b/i];

export function classifySensitive(path: string): boolean {
  return SENSITIVE_PATTERNS.some((p) => p.test(path));
}

export interface ProtectResult {
  stashed: boolean;
  stashRef?: string;
  items?: readonly StashedItem[];
  sensitiveCount?: number;
}

export interface ProtectOptions {
  /** Called when sensitive items are about to be stashed; return false to abort. */
  confirmSensitive: (items: readonly StashedItem[]) => Promise<boolean>;
}

export interface StashGuard {
  protect(opts: ProtectOptions): Promise<ProtectResult>;
  release(): Promise<void>;
}

async function checkDirtySubmodules(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await exec('git', ['submodule', 'status'], { cwd });
    const dirty: string[] = [];
    for (const line of stdout.split('\n').filter(Boolean)) {
      // Lines starting with '+' indicate dirty submodule.
      const m = /^[+\-U]\w+\s+(\S+)/.exec(line);
      if (m && m[1] && line.startsWith('+')) dirty.push(m[1]);
    }
    return dirty;
  } catch {
    return []; // no submodules or git error
  }
}

export function createStashGuard(cwd: string): StashGuard {
  let stashRef: string | undefined;
  let stashedItems: readonly StashedItem[] = [];

  async function enumerate(): Promise<StashedItem[]> {
    const items: StashedItem[] = [];

    // Tracked changes (modified or staged).
    const { stdout: porcelain } = await exec('git', ['status', '--porcelain=v1', '-uall'], { cwd });
    for (const line of porcelain.split('\n').filter(Boolean)) {
      const xy = line.slice(0, 2);
      const path = line.slice(3);
      let state: StashedItem['state'];
      if (xy.startsWith('??')) state = 'untracked';
      else if (xy[0] !== ' ' && xy[0] !== '?') state = 'staged';
      else state = 'modified';
      items.push({ path, state, isSensitive: classifySensitive(path) });
    }

    // Gitignored files — list them for visibility so user knows what is at risk.
    try {
      const { stdout: ignored } = await exec('git', ['ls-files', '--others', '--ignored', '--exclude-standard'], { cwd });
      for (const path of ignored.split('\n').filter(Boolean)) {
        items.push({ path, state: 'untracked-gitignored', isSensitive: classifySensitive(path) });
      }
    } catch {
      // ignored
    }

    return items;
  }

  return {
    async protect(opts) {
      const dirtySubmodules = await checkDirtySubmodules(cwd);
      if (dirtySubmodules.length > 0) {
        const ok = await opts.confirmSensitive(
          dirtySubmodules.map((path) => ({ path: `${path} (submodule)`, state: 'modified' as const, isSensitive: true })),
        );
        if (!ok) throw new Error('autopilot aborted by user (dirty submodules cannot be protected)');
      }
      const items = await enumerate();
      const trackedDirty = items.filter((i) => i.state !== 'untracked-gitignored');
      const sensitiveTracked = items
        .filter((i) => i.state !== 'untracked-gitignored' && i.isSensitive);
      if (sensitiveTracked.length > 0) {
        const ok = await opts.confirmSensitive(sensitiveTracked);
        if (!ok) throw new Error('autopilot aborted by user (sensitive files in stash scope)');
      }
      if (trackedDirty.length === 0) {
        return { stashed: false, items: [] };
      }
      const msg = `contractqa-autopilot-${new Date().toISOString()}`;
      // -u stashes untracked tracked files but NOT gitignored ones.
      await exec('git', ['stash', 'push', '-u', '-m', msg], { cwd });
      const { stdout: list } = await exec('git', ['stash', 'list'], { cwd });
      const ref = list.split('\n').find((l) => l.includes(msg))?.split(':')[0] ?? 'stash@{0}';
      stashRef = ref;
      stashedItems = trackedDirty;
      return {
        stashed: true,
        stashRef: ref,
        items: trackedDirty,
        sensitiveCount: trackedDirty.filter((i) => i.isSensitive).length,
      };
    },
    async release() {
      if (!stashRef) return;
      const sensitive = stashedItems.filter((i) => i.isSensitive);
      const lines = [
        `[autopilot] Your changes are preserved in ${stashRef} (${stashedItems.length} files).`,
        '            To restore: git stash apply --index ' + stashRef,
      ];
      if (sensitive.length > 0) {
        lines.push(`            WARNING: ${sensitive.length} sensitive files are in this stash:`);
        for (const i of sensitive) lines.push(`              - ${i.path}`);
        lines.push('            DO NOT run `git stash drop` — that will permanently delete them.');
      }
      // eslint-disable-next-line no-console
      console.log(lines.join('\n'));
    },
  };
}
