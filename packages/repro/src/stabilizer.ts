export interface RunOutcome {
  failed: boolean;
}

export async function assertReproducible(
  run: () => Promise<RunOutcome>,
  total: number,
  required: number,
): Promise<{ stable: boolean; failures: number }> {
  let failures = 0;
  for (let i = 0; i < total; i++) {
    const r = await run();
    if (r.failed) failures++;
  }
  return { stable: failures >= required, failures };
}
