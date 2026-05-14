export interface ProposedContractRevision {
  invariant_id: string;
  current_assertion: string;
  proposed_assertion: string;
  rationale: string;
  evidence: string[];
}

export interface IssueJson {
  issue_id: string;
  title: string;
  severity: 'P0' | 'P1' | 'P2' | 'P3';
  confidence: number;
  invariants: string[];
  environment: {
    branch: string;
    commit: string;
    base_url: string;
    browser: 'chromium' | 'firefox' | 'webkit';
  };
  steps: string[];
  expected: string[];
  actual: string[];
  artifacts: {
    trace: string;
    state_diff: string;
    repro: string;
    screenshot?: string;
    video?: string;
    console?: string;
    network?: string;
  };
  suggested_owner: string;
  fix_allowed: boolean;
  needs_human_contract_review?: boolean;
  proposed_contract_revision?: ProposedContractRevision;
}

export interface EvidenceBundleManifest {
  bundle_id: string;
  created_at: string;
  contract_id: string;
  run_id: string;
  files: Array<{ path: string; sha256: string; bytes: number; kind: string }>;
  redaction_applied: boolean;
}
