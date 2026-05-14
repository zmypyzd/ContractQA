export interface Page {
  goto(url: string): Promise<unknown>;
  evaluate<T>(fn: () => T): Promise<T>;
  context(): unknown;
}
