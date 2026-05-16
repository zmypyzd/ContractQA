// packages/orchestrator/src/llm/recording-client.ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { LLMClient, GenerateOptions, GenerateResult, ProviderName } from './index.js';

interface CassetteEntry {
  request: GenerateOptions;
  response: GenerateResult;
}

interface CassetteMeta {
  provider: ProviderName;
  providerBaseUrl?: string;
  model: string;
  capturedAt: string;
  promptHash: string;
}

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export class RecordingLLMClient implements LLMClient {
  readonly providerName: ProviderName;
  readonly modelHint: string;

  constructor(
    private readonly upstream: LLMClient,
    private readonly cassettePath: string,
    private readonly opts: { promptHash: string; baseUrl?: string },
  ) {
    this.providerName = upstream.providerName;
    this.modelHint = upstream.modelHint;
  }

  private metaPath(): string {
    return this.cassettePath.replace(/\.json$/, '.meta.json');
  }

  private readCassette(): CassetteEntry[] | null {
    if (!existsSync(this.cassettePath)) return null;
    return JSON.parse(readFileSync(this.cassettePath, 'utf8')) as CassetteEntry[];
  }

  private readMeta(): CassetteMeta | null {
    if (!existsSync(this.metaPath())) return null;
    return JSON.parse(readFileSync(this.metaPath(), 'utf8')) as CassetteMeta;
  }

  private writeMeta(meta: CassetteMeta): void {
    mkdirSync(dirname(this.metaPath()), { recursive: true });
    writeFileSync(this.metaPath(), JSON.stringify(meta, null, 2));
  }

  private keyOf(o: GenerateOptions): string {
    return JSON.stringify({
      system: o.system ?? null,
      messages: o.messages,
    });
  }

  async generate(opts: GenerateOptions): Promise<GenerateResult> {
    const updating = process.env.UPDATE_CASSETTES === '1';
    const meta = this.readMeta();
    const cassette = this.readCassette();

    if (!updating && cassette) {
      if (meta && meta.promptHash !== this.opts.promptHash) {
        throw new Error(
          `Cassette promptHash drift: meta=${meta.promptHash} expected=${this.opts.promptHash}. ` +
            `Re-run with UPDATE_CASSETTES=1 and review the diff.`,
        );
      }
      if (meta && (Date.now() - new Date(meta.capturedAt).getTime() > NINETY_DAYS_MS)) {
        console.warn(`Cassette ${this.cassettePath} is >90 days old (capturedAt: ${meta.capturedAt}). Consider refreshing with UPDATE_CASSETTES=1.`);
      }
      // Match on JSON-stringified system + messages.
      const wantedKey = this.keyOf(opts);
      const hit = cassette.find((e) => this.keyOf(e.request) === wantedKey);
      if (!hit) throw new Error(`Cassette miss for cassette ${this.cassettePath}. Re-record with UPDATE_CASSETTES=1.`);
      return hit.response;
    }

    // Recording mode (or cassette missing).
    const response = await this.upstream.generate(opts);
    const entries: CassetteEntry[] = cassette ?? [];
    // Upsert: replace existing entry with same key to avoid unbounded accumulation on re-runs.
    const idx = entries.findIndex((e) => this.keyOf(e.request) === this.keyOf(opts));
    if (idx >= 0) entries[idx] = { request: opts, response };
    else entries.push({ request: opts, response });
    mkdirSync(dirname(this.cassettePath), { recursive: true });
    writeFileSync(this.cassettePath, JSON.stringify(entries, null, 2));
    this.writeMeta({
      provider: this.upstream.providerName,
      providerBaseUrl: this.opts.baseUrl,
      model: this.upstream.modelHint,
      capturedAt: new Date().toISOString(),
      promptHash: this.opts.promptHash,
    });
    return response;
  }
}
