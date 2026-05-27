import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { ContractSchema } from '/Users/zmy/intership/5.10+/qa-agent/packages/core/dist/schemas/contract.schema.js';
import { compileContract } from '/Users/zmy/intership/5.10+/qa-agent/packages/runner/dist/compile.js';

const f = '/Users/zmy/intership/5.10+/qa-agent/qa/eval/poker/ground-truth/api-werewolf-start-host-only-REPLACE.yml';
const raw = readFileSync(f, 'utf8');
const { category, provenance, review, ...contract } = parse(raw);
const v = ContractSchema.parse(contract);
compileContract(v, { baseUrl: 'http://x' });
console.log('Stream 3 REPLACE validated:', v.id);
