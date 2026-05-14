const DANGEROUS = [
  /\([^)]*[+*][^)]*\)[+*]/,
  /\([^)]*\|[^)]*\)[+*]/,
];

export function assertSafeRegex(source: string): void {
  if (DANGEROUS.some((d) => d.test(source))) {
    throw new Error(`unsafe regex: ${source}`);
  }
  try {
    new RegExp(source);
  } catch (e) {
    throw new Error(`invalid regex: ${source} (${(e as Error).message})`);
  }
}
