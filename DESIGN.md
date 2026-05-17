# Design System — ContractQA

> Diagnostic Modern · v0.1 · authored 2026-05-17 via `/design-consultation`
> Preview: `~/.gstack/projects/qa-agent/designs/design-system-20260517/preview.html`

## Product Context

- **What this is:** ContractQA — a Claude-Code-powered Product Invariant QA and Auto-Fix Platform that verifies product contracts (not just screenshots) and hands minimal repros to Claude Code for auto-fix.
- **Who it's for:** Developers running QA on Node web apps. Indie shops, small SaaS teams, and infra teams who already feel the pain of flaky screenshot tests.
- **Space/industry:** Developer tooling, web testing, QA automation. Peers: Playwright, Cypress, Datadog Synthetics. Differentiation: deterministic invariants, not LLM-as-judge.
- **Project type:** Developer dashboard (Next.js 15 + React 19, `apps/dashboard/`). Two primary surfaces: a runs viewer (exists, currently `system-ui`裸样式) and a launcher (`/launcher` route, planned — folder selection + autopilot trigger + live progress).
- **Memorable thing:** "登出之后，你确定真的登出了吗？" — the visual system exists to carry the paranoid-instrument energy of catching state-leak bugs users didn't know they had.

## Aesthetic Direction

- **Direction:** Diagnostic Modern
- **Decoration level:** Minimal — typography and a single signature color do the work. No decorative blobs, no gradients, no AI-slop hero shots.
- **Mood:** Bloomberg terminal meets a modernist publication. Precision instrument's control panel. Editorial weight via serif moments, technical credibility via Geist + tabular nums.
- **Reference posture (not visual clones):** Linear's data density / Vercel's typographic discipline / Stripe Press's editorial confidence. Explicit anti-references: Inter-everywhere SaaS dashboards, purple-gradient AI tools, 3-column feature-grid landing pages.

## Typography

- **Display/Hero:** **Instrument Serif** (italic permitted for accent words). Reserved for page titles ≥32px, punchline moments, the duck-CEO voice. Loaded from Google Fonts.
- **Body / UI / Tables:** **Geist** (weights 300/400/500/600/700, `font-feature-settings: "ss01", "cv11"`). Loaded from Google Fonts. Tabular nums via `font-variant-numeric: tabular-nums` on every data column.
- **UI labels / Eyebrows:** Geist Mono — 10.5–11px, `letter-spacing: 0.12em`, uppercase. Used for section eyebrows, table headers, status legends.
- **Data / Numbers / Identifiers:** **Geist Mono**, tabular-nums, 11–13px. Branches, run IDs, totals, timestamps.
- **Code samples:** **JetBrains Mono** (in state-diffs, evidence panels, error traces). Slightly more personality than Geist Mono, signals "this is actual code, not UI chrome".
- **Loading:** Google Fonts (`fonts.googleapis.com`) via `<link>` preconnect + `<link>` stylesheet in `app/layout.tsx`. Family CSS string:
  ```
  https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500;600&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&display=swap
  ```
- **Type scale** (px, line-height in parens):
  - 72 (1.05) — display / hero (serif)
  - 56 (1.05) — page title (serif)
  - 48 (1.05) — large title (serif)
  - 32 (1.10) — section title (serif)
  - 24 (1.20) — h3 / card title (Geist 500)
  - 18 (1.40) — lede (Geist 400, color: muted)
  - 14 (1.50) — body (Geist 400)
  - 13 (1.50) — table cell / mono
  - 12 (1.40) — caption / footnote
  - 11 (1.30, letter-spacing 0.12em, uppercase) — eyebrow / mono label

## Color

- **Approach:** Restrained. Warm neutrals carry 95% of the surface; one ownable signal color carries everything you must not miss.
- **Dark mode primary** (default). Light mode is a faithful inversion using warm off-whites (not pure `#FFF`).

### Dark mode tokens

| Token | Hex | Usage |
|---|---|---|
| `--bg` | `#0A0A0B` | Page background (near-black, slight warm undertone) |
| `--surface` | `#141416` | Cards, table hover, secondary surfaces |
| `--surface-2` | `#1B1B1F` | Inline code background, nested surfaces |
| `--border` | `#26262B` | Default border, dividers |
| `--border-2` | `#34343A` | Input border, button border |
| `--text` | `#FAFAF9` | Primary text (warm white) |
| `--muted` | `#9A9A95` | Secondary text, eyebrows |
| `--muted-2` | `#6E6E6A` | Tertiary text, idle dots |
| `--accent` | `#F4D03F` | **Sodium yellow** — duck-bowtie, single signature color |
| `--accent-d` | `#C9A82F` | Accent hover/pressed |
| `--success` | `#3B9E5B` | Passing contracts, success state |
| `--warning` | `#F4D03F` | Same as accent — the product's job IS flagging things |
| `--error` | `#D4453A` | Failed contracts, error state |
| `--info` | `#7A8A9B` | Info badges, neutral metadata |

### Light mode tokens

| Token | Hex |
|---|---|
| `--bg` | `#FAFAF9` |
| `--surface` | `#FFFFFF` |
| `--surface-2` | `#F5F5F2` |
| `--border` | `#E5E5E1` |
| `--border-2` | `#D4D4CD` |
| `--text` | `#0A0A0B` |
| `--muted` | `#6E6E6A` |
| `--muted-2` | `#9A9A95` |
| `--accent` | `#C9A82F` (darkened for AA contrast on light) |
| `--success` | `#2D7D45` |
| `--warning` | `#B8842A` |
| `--error` | `#B6362C` |

### Accent usage rules

The sodium-yellow accent appears in ONLY these places per screen:
1. Brand mark (duck silhouette + wordmark) in the toolbar
2. The single primary CTA button (one per screen)
3. Active row keyline (left-side 2px stroke) on the currently-selected/running item
4. Focus rings (`box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 20%, transparent)`)
5. "Running" status dot, with a soft glow
6. Hyperlink color on the run-detail page (links to traces, repros, screenshots)

**If you find yourself adding a 7th use, you're diluting the signal. Stop.**

## Spacing

- **Base unit:** 4px (denser than typical SaaS — this is a developer tool).
- **Density:** Comfortable for monitoring screens (24–32px section spacing), compact for data tables (8–12px row padding).
- **Scale:** `2 / 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96`. CSS custom properties:
  ```css
  --s-0: 2px;  --s-1: 4px;  --s-2: 8px;  --s-3: 12px; --s-4: 16px;
  --s-5: 24px; --s-6: 32px; --s-7: 48px; --s-8: 64px; --s-9: 96px;
  ```

## Layout

- **Approach:** Hybrid. Grid-disciplined for app surfaces (runs viewer, run detail), more editorial for marketing/launcher (asymmetric heroes, serif titles with deliberate wordspacing).
- **Grid:** 12-column on desktop (≥1024px), 8-column on tablet, 4-column on mobile. Column gap = `--s-3` (12px). Outer page padding = `--s-5` (24px) on mobile, `--s-7` (48px) on desktop.
- **Max content width:** 1200px on marketing/launcher pages. Full-width minus padding on data-dense views (runs table, evidence panels) — let the data breathe.
- **Border radius:**
  - `2px` (`--radius-sm`) — buttons, inputs, badges, cards, table cells
  - `4px` (`--radius-md`) — screen wrappers, modals, large containers
  - `0px` — data table cells (let the borders carry the rhythm)
  - `9999px` (`--radius-pill`) — status dots only

## Motion

- **Approach:** Minimal-functional. No decorative animation, no parallax, no scroll-driven flourishes.
- **Easing:**
  - Enter: `ease-out`
  - Exit: `ease-in`
  - Move/state change: `ease-out` (80–120ms)
  - Loading shimmer: `ease-in-out` (1.4s loop)
- **Duration:**
  - Micro (80–120ms): hover, focus, button press, badge appear
  - Short (150–250ms): tab switch, dropdown open, status transition
  - Medium (250–400ms): page transition, modal enter
- **Signature motion:** The autopilot progress strip reveals each phase's elapsed-time counter character-by-character (typewriter cadence, ~30ms/char) when that phase becomes active. Diagnostic, slightly nostalgic, instrument-coded. Used in exactly one place — the `/launcher` progress strip.

## Component primitives

These are the building blocks. Specific React components in `apps/dashboard/components/` should be built from these.

- **Button** — variants: `primary` (sodium yellow bg, near-black text, weight 600), `default` (surface bg, text fg, border-2 outline), `ghost` (transparent until hover), `mono` (Geist Mono for command-line-style actions). All 2px radius, padding `--s-2 --s-4`.
- **Badge** — small mono uppercase label, 2px radius. Variants: `default` (muted), `accent` (sodium with matching border), `success`, `error`. Padding `2px 6px`, font-size 11px.
- **Status dot** — 8px circle. Variants: `success`, `warning` (with glow), `error`, `idle` (muted-2 background). Pair with a mono label for accessibility.
- **Input** — Geist Mono 13px, 2px radius, dark bg with border-2 border. Focus = accent border + accent-tinted shadow ring. No floating labels — use eyebrow mono label above.
- **Table** — header row: mono uppercase 10.5px muted with bottom border; data rows: border-bottom, padding `--s-3`, hover surface bg, active row gets sodium-yellow 2px left inset shadow.
- **Screen frame** — used when previewing browser content (mockups in docs, design board). Traffic-light circles + URL bar + screen body with `--s-7` padding.

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-17 | Initial design system created | Created by `/design-consultation`. Current dashboard was `system-ui` 裸样式; needed coherent visual system to express product's paranoid-instrument personality (launch event voice: "登出之后真的登出了吗"). |
| 2026-05-17 | Instrument Serif + Geist over all-sans | Pairing creates editorial weight that separates ContractQA from the Vercel/Linear/PostHog all-sans devtool convergence. Geist handles 95% of UI; serif for poster moments. |
| 2026-05-17 | Sodium yellow #F4D03F as sole signature color | Every devtool is blue/green/purple. Yellow + near-black reads instrument/lab, not SaaS. Pairs with duck mascot (bowtie color). Used sparingly to preserve signal value. |
| 2026-05-17 | 2px border radius, 4px base unit | Sharper than SaaS norm; data-density-friendly. Reads "instrument" not "toy". |
| 2026-05-17 | Dark mode primary, light mode as faithful inversion | Devtool category convention; pairs with sodium yellow's contrast story. |
| 2026-05-17 | Direction ratified against alternatives | Ran `/design-shotgun` with three alternatives: Brutalist Workshop (JetBrains Mono + signal red + zero-radius), Editorial Print (Fraunces + cream + burgundy + light mode), Terminal Phosphor (phosphor green + CRT scanlines). User reaffirmed Diagnostic Modern after side-by-side comparison. Reasoning: lowest performative dimension → best fit for daily-use dev tool. Board archived at `~/.gstack/projects/qa-agent/designs/shotgun-20260517/board.html`. |

## Implementation notes (out of scope for this doc — handled by `/design-html` or implementation tasks)

The current `apps/dashboard/app/layout.tsx` is one line of inline-style `system-ui` — the next implementation step is to:
1. Add a `globals.css` that defines the CSS custom properties above and the `[data-theme]` switcher
2. Import the Google Fonts stylesheet from `app/layout.tsx`
3. Migrate inline styles in `runs/page.tsx`, `StateDiffViewer.tsx`, `EvidenceLinks.tsx` to use tokens
4. Build the `/launcher` route per the Mockup·01 preview

That work is not part of `/design-consultation` — invoke `/design-html` or a normal implementation task when ready to ship the code.
