import type { Framework, AuthSignal } from '../detect-framework.js';
import { nextAppTemplate } from './next-app.js';
import { nextPagesTemplate } from './next-pages.js';
import { viteReactTemplate } from './vite-react.js';
import { viteVueTemplate } from './vite-vue.js';
import { astroTemplate } from './astro.js';
import { unknownTemplate } from './unknown.js';

export interface TemplateInput {
  framework: Framework;
  authSignals: readonly AuthSignal[];
  projectName: string;
}

export interface TemplateOutput {
  files: Record<string, string>;
}

export function renderTemplate(input: TemplateInput): TemplateOutput {
  switch (input.framework) {
    case 'next-app':   return nextAppTemplate(input);
    case 'next-pages': return nextPagesTemplate(input);
    case 'vite-react': return viteReactTemplate(input);
    case 'vite-vue':   return viteVueTemplate(input);
    case 'astro':      return astroTemplate(input);
    default:           return unknownTemplate(input);
  }
}

export function pickProvider(signals: readonly AuthSignal[]): string {
  if (signals.includes('next-auth')) return 'next-auth';
  if (signals.includes('supabase')) return 'supabase';
  if (signals.includes('clerk')) return 'clerk';
  if (signals.includes('auth0')) return 'auth0';
  return 'custom';
}
