export { computeStateDiff } from './state-diff.js';
export type { StateSlice, StateDiff } from './state-diff.js';
export { classifyDiff, classifyHttp } from './declared-fields.js';
export type {
  Expected,
  HttpExpected,
  CapturedHttpResponse,
  DiffClassification,
} from './declared-fields.js';
export { classifyDom } from './dom-classifier.js';
export type { DomExpected, DomClassification } from './dom-classifier.js';
export { computeConfidence } from './confidence.js';
export type { ConfidenceInputs } from './confidence.js';
export { computeVerdict } from './verdict.js';
export type { RunResult, VerdictInput } from './verdict.js';
