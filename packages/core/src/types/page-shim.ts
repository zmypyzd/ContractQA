export interface PageContext {
  cookies(): Promise<Array<{ name: string; domain?: string; path?: string }>>;
}

export interface Page {
  goto?(url: string): Promise<unknown>;
  evaluate<T>(fn: () => T): Promise<T>;
  context(): PageContext;
}
