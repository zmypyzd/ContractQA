import type { AppAdapter, SeedProfile } from '@contractqa/core';

export interface DefaultAppAdapterOptions {
  baseUrl: string;
  startCommand?: string;
  healthCheckUrl: string;
  onReset?: () => Promise<void>;
  onSeed?: (profile: SeedProfile) => Promise<void>;
}

export class DefaultAppAdapter implements AppAdapter {
  readonly baseUrl: string;
  readonly startCommand?: string;
  readonly healthCheckUrl: string;
  private readonly opts: DefaultAppAdapterOptions;
  constructor(opts: DefaultAppAdapterOptions) {
    this.opts = opts;
    this.baseUrl = opts.baseUrl;
    this.startCommand = opts.startCommand;
    this.healthCheckUrl = opts.healthCheckUrl;
  }
  async resetState(): Promise<void> {
    if (this.opts.onReset) await this.opts.onReset();
  }
  async seed(profile: SeedProfile): Promise<void> {
    if (this.opts.onSeed) await this.opts.onSeed(profile);
  }
}
