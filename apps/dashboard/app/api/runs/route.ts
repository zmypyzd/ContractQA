/**
 * POST /api/runs
 *
 * Creates a runs row from an external process (typically `contractqa
 * autopilot --watch --dashboard-url <this-host>`). The dashboard's own SSE
 * route writes runs in-process; this endpoint exists so the CLI's own watch
 * loop can also persist run metadata into the same DB without taking a
 * direct dependency on drizzle / pg.
 *
 * Body: { cwd, branch?, fixEnabled?, triggerType?, watchSessionId?, startedAt? }
 * Response: { id }   on success
 *           { error } on failure (4xx for bad input, 503 for DB unreachable)
 */

import { NextResponse } from 'next/server';
import { db } from '../../../lib/db';
import { runs } from '../../../drizzle/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CreateRunBody {
  cwd?: string;
  branch?: string | null;
  fixEnabled?: boolean;
  triggerType?: string;
  watchSessionId?: string | null;
  startedAt?: string; // ISO; defaults to now()
}

export async function POST(req: Request): Promise<Response> {
  let body: CreateRunBody;
  try {
    body = (await req.json()) as CreateRunBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.cwd?.trim()) {
    return NextResponse.json({ error: 'cwd is required' }, { status: 400 });
  }

  try {
    const startedAt = body.startedAt ? new Date(body.startedAt) : new Date();
    const [row] = await db
      .insert(runs)
      .values({
        triggerType: body.triggerType ?? (body.watchSessionId ? 'cli-watch' : 'cli'),
        branch: body.branch ?? null,
        cwd: body.cwd,
        status: 'running',
        startedAt,
        watchSessionId: body.watchSessionId ?? null,
      })
      .returning({ id: runs.id });
    return NextResponse.json({ id: row?.id });
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
