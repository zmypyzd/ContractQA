const { pickClient } = await import('./packages/orchestrator/dist/llm/pick-client.js');
const c = await pickClient();
for (let i = 0; i < 3; i++) {
  const r = await c.generate({ system: 'Reply with exactly: pong', messages: [{ role: 'user', content: 'ping' }] });
  if (!String(r.content).toLowerCase().includes('pong')) process.exit(1);
}
process.exit(0);
