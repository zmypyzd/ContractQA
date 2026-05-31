// Generation experiment: does CONTRACTQA_GEN_PROMPT=priors-neg steer the agent to emit an
// OUTCOME-shaped negative contract (fill illegal -> commit -> assert illegal value NOT shown)
// for the app4 planning-modal budget/guests fields? A/B vs `priors` on the SAME interaction.
// Run: CONTRACTQA_GEN_PROMPT=<variant> node scripts/eval/_gen-experiment-app4-budget.mjs
import path from 'node:path';

const ROOT = '/Users/zmy/intership/5.10+/qa-agent';
const CWD = '/Users/zmy/intership/qa-eval-fixtures/WebTestBench/scratch/0004';

const { generateContractFor } = await import(path.join(ROOT, 'packages/cli/dist/src/autopilot/interaction-discovery.js'));
const { pickClient } = await import(path.join(ROOT, 'packages/orchestrator/dist/llm/pick-client.js'));

const llmClient = await pickClient();

// The gated planning-modal form (budget / guests / wedding date), reached via "Get Started".
const interaction = {
  id: 'planning-details-form',
  type: 'form',
  file: 'src/pages/Index.tsx',
  name: 'Wedding details form (budget, guests, wedding date) in the Get Started / Update Details modal',
  route: '/',
  module: 'pages/Index',
  rationale: 'Editable planning dashboard fields: budget ($), expected guests, wedding date — entered in a modal opened by the hero "Get Started"/"Update Details" button and saved to the dashboard.',
};

const ac = new AbortController();
const r = await generateContractFor({
  interaction,
  cwd: CWD,
  llmClient,
  signal: ac.signal,
  knownRoutes: ['/', '/venues', '/vendors', '/favorites', '/checklists'],
});

console.log('VARIANT:', process.env.CONTRACTQA_GEN_PROMPT || 'baseline');
console.log('error:', r.error || null);
console.log('proposals:', r.proposals?.length ?? 0);
for (const p of r.proposals ?? []) {
  console.log('\n--- ' + (p.title || p.id) + ' ---');
  console.log(JSON.stringify({ actions: p.actions, expected: p.expected }, null, 2));
}
