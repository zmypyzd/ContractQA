export { renderInvariantsMd } from './commands/invariants-gen.js';
export { selectChangedContracts, runContracts } from './commands/run.js';
export { initProject } from './commands/init.js';
export { runAutopilot } from './commands/autopilot.js';
export type {
  AutopilotOptions,
  AutopilotProgressEvent,
  AutopilotPhaseCounters,
} from './commands/autopilot.js';

// Night-shift auto-PR — exported for the Dashboard launcher's stream route
// (and any future programmatic caller that wants the same coordinator setup
// as `contractqa autopilot --watch --auto-pr`).
export {
  runAutoPrPreflight,
  AutoPrPreflightError,
  createNightShiftCoordinator,
} from './commands/autopilot-watch.js';
export type { AutoPrPreflightResult } from './commands/autopilot-watch.js';
export type { ShadowFixCoordinator } from './autopilot/shadow-fix-coordinator.js';
