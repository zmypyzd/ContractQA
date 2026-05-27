export type Redacted = { __redacted: true };

export interface ConsoleEntry {
  type: 'log' | 'warn' | 'error' | 'info' | 'debug';
  text: string;
  timestamp: string;
  location?: { url: string; lineNumber: number };
}

export interface NetworkEntry {
  url: string;
  method: string;
  status?: number;
  requestHeaders: Record<string, string | Redacted>;
  responseHeaders?: Record<string, string | Redacted>;
  timing: { startedAt: string; durationMs: number };
}

export interface WebSocketEntry {
  url: string;
  events: Array<{ kind: 'open' | 'message' | 'close'; payload?: string | Redacted; at: string }>;
}

export interface CookieSummary {
  name: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
  valueRedacted: true;
}

// Phase 2 schema: dom-shaped invariants. Populated by snapshotBrowser when
// `captureDom: true` is set. Keys in roleCounts are normalized as
// `<role>:<accessible name>`; counts include every match (not just first).
//
// Stream 5: `elements` carries per-interactive-element attribute snapshots
// so the oracle can evaluate dom.attribute_equals / input_value /
// class_contains / element_text_equals without re-querying the live DOM.
// Optional for back-compat with snapshots written before Stream 5; absent
// elements produces a single "snapshot missing elements" failure if any
// new dom assertion is set.
export interface DomElementSnapshot {
  role: string;
  name: string;                       // accessible name (aria-label || textContent)
  attributes: Record<string, string>; // includes disabled, aria-*, data-*, type, role, name
  value?: string;                     // input/select/textarea .value
  classes: string[];                  // tokenized class list
  text: string;                       // textContent.trim()
}

export interface DomShape {
  roleCounts: Record<string, number>;
  visibleText: string;
  elements?: DomElementSnapshot[];
}

export interface BrowserSnapshot {
  timestamp: string;
  url: string;
  title: string;
  viewport: { width: number; height: number };
  screenshotPath: string;
  domTextHash: string;
  accessibilityTree?: unknown;
  localStorage: Record<string, string | Redacted>;
  sessionStorage: Record<string, string | Redacted>;
  cookies: CookieSummary[];
  console: ConsoleEntry[];
  network: NetworkEntry[];
  websocket: WebSocketEntry[];
  dom?: DomShape;
}

export interface AuthStateAssertion {
  fullyLoggedOut: boolean;
  reasons: string[];
}
