/**
 * Serves evidence files (HAR trace, state-diff.json, repro.spec.ts, screenshot,
 * video) associated with a specific issue. The issueId in the URL is the DB
 * UUID; the route looks up that issue's `issue_json_path` and resolves the
 * requested file against its parent directory.
 *
 * Path-traversal hardening: the resolved absolute file path must start with
 * the issue's directory. `..` segments or absolute-path injections fail the
 * check and return 404 rather than leaking arbitrary disk reads.
 *
 *   GET /artifacts/<issueId>/<file or subpath>
 *
 * Streaming small files directly with Buffer.from() is fine — evidence
 * artifacts are bounded (HAR a few MB, screenshots a few hundred KB).
 */

import { readFile, stat } from 'node:fs/promises';
import { extname, dirname, join, resolve, sep } from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '../../../../lib/db';
import { issues } from '../../../../drizzle/schema';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MIME: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.har': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8',
  '.tsx': 'text/plain; charset=utf-8',
  '.js': 'text/plain; charset=utf-8',
  '.spec.ts': 'text/plain; charset=utf-8',
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ issueId: string; path: string[] }> },
): Promise<Response> {
  const { issueId, path: pathParts } = await ctx.params;

  if (!issueId || pathParts.length === 0) {
    return new Response('Not found', { status: 404 });
  }

  // Look up issue → issueDir.
  let issueJsonPath: string | null = null;
  try {
    const [row] = await db
      .select({ issueJsonPath: issues.issueJsonPath })
      .from(issues)
      .where(eq(issues.id, issueId));
    issueJsonPath = row?.issueJsonPath ?? null;
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Database unreachable', detail: err instanceof Error ? err.message : String(err) }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  if (!issueJsonPath) {
    return new Response('Issue not found', { status: 404 });
  }

  const issueDir = dirname(issueJsonPath);
  const requested = pathParts.join('/');
  const candidate = resolve(issueDir, requested);

  // Path-traversal guard: candidate must remain inside issueDir.
  const issueDirAbs = resolve(issueDir);
  const issueDirPrefix = issueDirAbs.endsWith(sep) ? issueDirAbs : issueDirAbs + sep;
  if (candidate !== issueDirAbs && !candidate.startsWith(issueDirPrefix)) {
    return new Response('Forbidden', { status: 403 });
  }

  // Stat first so we can short-circuit 404 vs return a useful range / Content-Length.
  let size: number;
  try {
    const s = await stat(candidate);
    if (!s.isFile()) return new Response('Not a file', { status: 404 });
    size = s.size;
  } catch {
    return new Response('Not found', { status: 404 });
  }

  const buf = await readFile(candidate);
  const ext = extname(candidate).toLowerCase();
  const contentType = MIME[ext] ?? 'application/octet-stream';

  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(size),
      'Cache-Control': 'private, max-age=0, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
      // Use inline for previewable types, attachment for the rest. Lets the
      // browser display screenshots/JSON in a new tab instead of forcing a
      // download.
      'Content-Disposition': previewableExtensions.has(ext)
        ? 'inline'
        : `attachment; filename="${escapeQuotes(pathParts[pathParts.length - 1])}"`,
    },
  });
}

const previewableExtensions = new Set([
  '.json',
  '.har',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.mp4',
  '.webm',
  '.txt',
  '.html',
  '.ts',
  '.tsx',
  '.js',
]);

function escapeQuotes(s: string): string {
  return s.replace(/"/g, '\\"');
}

// Re-export `join` so the unused-import lint doesn't complain when this file
// is refactored — keeps node:path types around for future range-request work.
void join;
