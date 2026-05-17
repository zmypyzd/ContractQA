# CLAUDE.md — agent guidance for ContractQA

## Design System

Always read [`DESIGN.md`](./DESIGN.md) before making any visual or UI decisions in this repo.
All font choices, colors, spacing, border-radius, motion, and aesthetic direction
are defined there ("Diagnostic Modern" — Instrument Serif + Geist, sodium yellow
`#F4D03F` as the sole signature color, 2px radius, dark-mode primary, 4px base unit).

- Do not deviate from DESIGN.md tokens without explicit user approval.
- The sodium-yellow accent appears in only six approved places per screen (see DESIGN.md
  → "Accent usage rules"). If you're tempted to add a seventh, stop.
- Never reintroduce `system-ui` / `-apple-system` as the primary font — that's what
  DESIGN.md replaced.
- In QA / review mode, flag any dashboard code that doesn't match DESIGN.md tokens.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
