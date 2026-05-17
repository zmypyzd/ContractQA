# Autopilot — Zero-YAML Onboarding

`contractqa autopilot` generates and runs product invariants for your Node project, no YAML required.

## Quick start

```bash
cd my-project
export OPENAI_API_KEY=sk-...
export OPENAI_BASE_URL=https://api.minimax.chat/v1  # or any OpenAI-compatible endpoint
contractqa autopilot
```

In ~30s–5min, autopilot will:

1. Run 6 universal smoke patterns (root not 5xx, 404 works, no password-in-URL, ...).
2. Read your source code and generate per-module contracts to `qa/contracts/`.
3. Ask Y/N questions for inferences it isn't sure about.
4. Auto-fix failing contracts (default; disable with `--no-fix`).
5. Apply fix diffs to your working directory (you `git add && git commit` yourself).

## LLM provider configuration

Autopilot uses one of three LLM clients, picked in this order:

| Env var set | Client used | Use case |
|---|---|---|
| `OPENAI_API_KEY` (+ optional `OPENAI_BASE_URL`) | OpenAI-compatible | MiniMax, OpenAI, OpenRouter, DeepSeek |
| `ANTHROPIC_API_KEY` | Anthropic SDK | direct Claude API |
| none of the above, but Claude Code installed and logged in | Claude Agent SDK | uses your Claude Code subscription |

## Flags

- `--time-budget <ms>` — default 30 minutes (`1800000`).
- `--no-fix` — report only; do not run auto-fix.
- `--yes` — accept LLM default answers for uncertain proposals.
- `--regenerate` — force re-discovery, ignoring existing `qa/contracts/`.
- `--regression-scope <one|touched-files|all>` — default `touched-files`.

## What gets written

```
qa/contracts/
├── _smoke/           ← Phase A universal patterns
├── _quarantine/      ← LLM outputs that failed validation
└── <module>/         ← Phase B per-module contracts
qa/AUTOPILOT_REPORT.md
qa/AUTOPILOT_REPORT.json
```

## Stability

Autopilot's CLI surface (command name, flag names) is **`@stable`** at v1.1.
The underlying `@contractqa/orchestrator/llm` subpath is **`@experimental`** — its API may change in any v1.x minor release. See [STABILITY.md](../STABILITY.md).
