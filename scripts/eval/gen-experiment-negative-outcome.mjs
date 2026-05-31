// Generation experiment / generalization test: does CONTRACTQA_GEN_PROMPT=<variant>
// steer the agent to emit OUTCOME-shaped negative contracts on a given interaction?
// Usage: CONTRACTQA_GEN_PROMPT=priors-neg node scripts/eval/gen-experiment-negative-outcome.mjs <case>
//   <case> in: app4-budget (tuned, control) | app5-experience | app6-transaction (un-tuned)
import path from 'node:path';

const ROOT = '/Users/zmy/intership/5.10+/qa-agent';
const SCRATCH = '/Users/zmy/intership/qa-eval-fixtures/WebTestBench/scratch';

const CASES = {
  'app4-budget': {
    cwd: `${SCRATCH}/0004`,
    knownRoutes: ['/', '/venues', '/vendors', '/favorites', '/checklists'],
    interaction: { id: 'planning-details-form', type: 'form', file: 'src/pages/Index.tsx', name: 'Wedding details form (budget, guests, wedding date) in the Get Started / Update Details modal', route: '/', module: 'pages/Index', rationale: 'Editable planning dashboard: budget ($), expected guests, wedding date — entered in a modal opened by the hero "Get Started"/"Update Details" button and saved to the dashboard.' },
  },
  'app5-experience': {
    cwd: `${SCRATCH}/0005`,
    knownRoutes: ['/', '/editor', '/dashboard'],
    interaction: { id: 'experience-form', type: 'form', file: 'src/components/editor/ExperienceForm.tsx', name: 'Work experience form with Start Date and End Date inputs', route: '/editor', module: 'components/editor/ExperienceForm', rationale: 'Users add work experience entries with a startDate and endDate (date inputs) and a "current" checkbox; saved into the resume.' },
  },
  'app6-transaction': {
    cwd: `${SCRATCH}/0006`,
    knownRoutes: ['/', '/transactions', '/reports', '/categories'],
    interaction: { id: 'transaction-dialog', type: 'form', file: 'src/components/transactions/TransactionDialog.tsx', name: 'Add/Edit transaction dialog with a Date input and an amount', route: '/transactions', module: 'components/transactions/TransactionDialog', rationale: 'Users create a financial transaction with a date and amount; opened via an Add Transaction button (dialog) and saved to the ledger.' },
  },
};

const caseName = process.argv[2] || 'app4-budget';
const c = CASES[caseName];
if (!c) { console.error('unknown case:', caseName, '— choose:', Object.keys(CASES).join(', ')); process.exit(1); }

const { generateContractFor } = await import(path.join(ROOT, 'packages/cli/dist/src/autopilot/interaction-discovery.js'));
const { pickClient } = await import(path.join(ROOT, 'packages/orchestrator/dist/llm/pick-client.js'));
const llmClient = await pickClient();

const r = await generateContractFor({ interaction: c.interaction, cwd: c.cwd, llmClient, signal: new AbortController().signal, knownRoutes: c.knownRoutes });

console.log('CASE:', caseName, '| VARIANT:', process.env.CONTRACTQA_GEN_PROMPT || 'baseline', '| proposals:', r.proposals?.length ?? 0, '| error:', r.error || null);
for (const p of r.proposals ?? []) console.log('\n' + (p.yaml || JSON.stringify(p, null, 2)));
