import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findContractsTouchingFiles, extractTouchedFiles } from '../src/verify-scope.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'cqa-scope-')); });
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('findContractsTouchingFiles', () => {
  it('returns empty when no contracts mention any of the files', () => {
    mkdirSync(join(tmp, 'qa', 'contracts'), { recursive: true });
    writeFileSync(join(tmp, 'qa', 'contracts', 'a.yml'), 'id: A\ntitle: A\nactions:\n  - { type: goto, path: /home }\n');
    const r = findContractsTouchingFiles(join(tmp, 'qa', 'contracts'), ['app/orders.ts']);
    expect(r).toEqual([]);
  });

  it('returns contracts whose YAML mentions any touched file', () => {
    mkdirSync(join(tmp, 'qa', 'contracts'), { recursive: true });
    writeFileSync(join(tmp, 'qa', 'contracts', 'a.yml'), 'id: A\nactions:\n  - { type: goto, path: /home }\n# evidence: app/auth/actions.ts\n');
    writeFileSync(join(tmp, 'qa', 'contracts', 'b.yml'), 'id: B\nactions:\n  - { type: goto, path: /orders }\n# evidence: app/orders/page.tsx\n');
    const r = findContractsTouchingFiles(join(tmp, 'qa', 'contracts'), ['app/auth/actions.ts']);
    expect(r.map((p) => p.split('/').pop())).toEqual(['a.yml']);
  });

  it('walks subdirectories', () => {
    mkdirSync(join(tmp, 'qa', 'contracts', 'auth'), { recursive: true });
    writeFileSync(join(tmp, 'qa', 'contracts', 'auth', 'login.yml'), '# touches app/login.ts\n');
    const r = findContractsTouchingFiles(join(tmp, 'qa', 'contracts'), ['app/login.ts']);
    expect(r.length).toBe(1);
  });
});

describe('extractTouchedFiles', () => {
  it('returns empty array for empty diff', () => {
    expect(extractTouchedFiles('')).toEqual([]);
  });

  it('extracts file paths from +++ b/ lines', () => {
    const diff = `diff --git a/app/auth/actions.ts b/app/auth/actions.ts
--- a/app/auth/actions.ts
+++ b/app/auth/actions.ts
@@ -1,3 +1,4 @@
 const x = 1;
+const y = 2;
`;
    const files = extractTouchedFiles(diff);
    expect(files).toContain('app/auth/actions.ts');
  });

  it('deduplicates files mentioned in multiple diff hunks', () => {
    const diff = `--- a/app/auth.ts\n+++ b/app/auth.ts\n--- a/app/auth.ts\n+++ b/app/auth.ts\n`;
    const files = extractTouchedFiles(diff);
    expect(files.filter((f) => f === 'app/auth.ts').length).toBe(1);
  });

  it('handles multiple files in one diff', () => {
    const diff = `--- a/app/auth.ts\n+++ b/app/auth.ts\n--- a/app/orders.ts\n+++ b/app/orders.ts\n`;
    const files = extractTouchedFiles(diff);
    expect(files).toContain('app/auth.ts');
    expect(files).toContain('app/orders.ts');
  });

  it('handles quoted filename with space (git core.quotePath=true)', () => {
    const diff = `--- "a/src/My Component.tsx"\n+++ "b/src/My Component.tsx"\n`;
    const files = extractTouchedFiles(diff);
    expect(files).toContain('src/My Component.tsx');
    expect(files.filter((f) => f === 'src/My Component.tsx').length).toBe(1);
  });

  it('handles quoted filename with non-ASCII characters', () => {
    const diff = `--- "a/src/中文文件.ts"\n+++ "b/src/中文文件.ts"\n`;
    const files = extractTouchedFiles(diff);
    expect(files).toContain('src/中文文件.ts');
  });

  it('does not add spurious entry for --- /dev/null (new file)', () => {
    const diff = `--- /dev/null\n+++ b/src/new-file.ts\n`;
    const files = extractTouchedFiles(diff);
    expect(files).not.toContain('/dev/null');
    expect(files).toContain('src/new-file.ts');
  });

  it('does not add spurious entry for +++ /dev/null (deleted file)', () => {
    const diff = `--- a/src/old-file.ts\n+++ /dev/null\n`;
    const files = extractTouchedFiles(diff);
    expect(files).not.toContain('/dev/null');
    expect(files).toContain('src/old-file.ts');
  });
});
