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
}

export interface AuthStateAssertion {
  fullyLoggedOut: boolean;
  reasons: string[];
}
