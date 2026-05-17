/**
 * PATCH /api/runs/[id]
 *
 * Updates a runs row at completion time. Mirrors what the SSE route does
 * inline at run-end, packaged as an HTTP endpoint so external processes
 * (`contractqa autopilot --watch` in a user terminal) can finalize their
 * run records too.
 *
 * Body: {
 *   status: 'passed' | 'failed' | 'interrupted' | 'error',
 *   endedAt?: string,           // ISO; defaults to now()
 *   totals?: Record<string, number>,
 *   issuesWritten?: string[],   // absolute paths to issue.json files;
 *                               // each is read + INSERTed as an issue row
 *                               // (de-duped by issue_json_path)
 * }
 * Response: { ok: true, registeredIssues: N }
 *           { error } on failure
 */

import { readFile } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '../../../../lib/db';
import { runs, issues } from '../../../../drizzle/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Status = 'passed' | 'failed' | 'interrupted' | 'error' | 'running';

interface UpdateRunBody {
  status?: Status;
  endedAt?: string;
  totals?: Record<string, number> | null;
  issuesWritten?: string[];
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  let body: UpdateRunBody;
  try {
    body = (await req.json()) as UpdateRunBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    // Update the run row (best-effort — partial updates are allowed).
    await db
      .update(runs)
      .set({
        status: body.status ?? undefined,
        endedAt: body.endedAt ? new Date(body.endedAt) : new Date(),
        totals: body.totals ?? null,
      })
      .where(eq(runs.id, id));

    // Register any issue evidence the caller wrote.
    let registered = 0;
    if (body.issuesWritten && body.issuesWritten.length > 0) {
      registered = await registerIssuesFromPaths(id, body.issuesWritten);
    }

    return NextResponse.json({ ok: true, registeredIssues: registered });
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Database unreachable',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 503 },
    );
  }
}

async function registerIssuesFromPaths(runId: string, paths: string[]): Promise<number> {
  let inserted = 0;
  for (const issueJsonPath of paths) {
    try {
      // De-dupe by path so a CLI watch loop re-emitting the same orphans
      // every iteration doesn't bloat the issues table.
      const existing = await db
        .select({ id: issues.id })
        .from(issues)
        .where(eq(issues.issueJsonPath, issueJsonPath))
        .limit(1);
      if (existing.length > 0) continue;

      const raw = await readFile(issueJsonPath, 'utf8');
      const parsed = JSON.parse(raw) as {
        title?: string;
        severity?: string;
        confidence?: number;
        status?: string;
      };
      await db.insert(issues).values({
        runId,
        title: parsed.title ?? null,
        severity: parsed.severity ?? null,
        confidence: parsed.confidence != null ? String(parsed.confidence) : null,
        status: parsed.status ?? 'open',
        issueJsonPath,
      });
      inserted++;
    } catch {
      // malformed / unreadable — skip
    }
  }
  return inserted;
}
