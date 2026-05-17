// packages/cli/src/autopilot/llm-discovery.ts (stub — will be replaced in B7)
export interface UncertainQuestion {
  text: string;
  type: 'yes-no' | 'multiple-choice';
  choices?: string[];
  defaultAnswer: string;
  appliesTo: 'whole-contract' | { jsonPath: string };
}

export interface ContractProposal {
  yaml: string;
  confidence: 'high' | 'medium' | 'low';
  module: string;
  uncertainQuestions?: UncertainQuestion[];
  evidence: { sourceFiles: string[]; rationale: string };
}
