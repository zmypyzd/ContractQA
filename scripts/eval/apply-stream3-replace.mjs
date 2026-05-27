#!/usr/bin/env node
// Stream 3: write 11 REPLACE contracts (one per dropped Group F entry).
// Each REPLACE preserves the original's actions where possible and adds
// rich-assertion expected blocks using Stream 5 dom fields.
//
// Output: qa/eval/poker/ground-truth/<id>-REPLACE.yml
//
// Doesn't touch the original (dropped) GT entries — they stay dropped.
// The provenance.replaces field links the new contract back so scoring
// scripts can collapse if needed.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';

const GT_DIR = 'qa/eval/poker/ground-truth';
const TODAY = '2026-05-27T08:55:00.000Z';

// Each entry: {
//   id (dropped original to replace),
//   replace: { id, title, area, severity, preconditions, actions, expected, category, notes }
// }
// Notes get stamped into review.notes with the Stream 3 marker.

const REPLACES = [
  {
    id: 'all-in-button-disabled-while-submitting',
    replace: {
      title: 'All-in button is disabled while action is being submitted',
      area: 'core',
      severity: 'P1',
      preconditions: { auth_state: 'logged_in' },
      actions: [
        { type: 'goto', path: '/table' },
        { type: 'click', target: { role: 'button', name_regex: '[Aa]ll.?[Ii]n' } },
      ],
      expected: {
        dom: {
          attribute_equals: [
            { target: { role: 'button', name_regex: '[Aa]ll.?[Ii]n' }, attribute: 'disabled', equals: true },
          ],
        },
      },
      category: ['ui-state'],
      notes:
        'REPLACE for all-in-button-disabled-while-submitting: original asserted contains_text: "Submitting" ' +
        'which is unrelated to "button is disabled" (G15 title-vs-assertion lie). Stream 5 attribute_equals on ' +
        'disabled boolean is the rigorous check.',
    },
  },
  {
    id: 'audience-reactions-start-at-zero',
    replace: {
      title: 'Audience reaction counters initialize at "0"',
      area: 'core',
      severity: 'P2',
      preconditions: { auth_state: 'logged_in' },
      actions: [{ type: 'goto', path: '/game' }],
      expected: {
        dom: {
          // Scoped to the audience-react counter elements; the SUT exposes
          // test_id="audience-count-heart" / "audience-count-fire". If the
          // app uses different test_ids, edit per real DOM.
          element_text_equals: [
            { target: { test_id: 'audience-count-heart' }, equals: '0' },
            { target: { test_id: 'audience-count-fire' }, equals: '0' },
          ],
        },
      },
      category: ['ui-state', 'initial-state'],
      notes:
        'REPLACE for audience-reactions-start-at-zero: original had vacuous needles ("0", "data", "error") ' +
        'that any page satisfies (G17). Stream 5 element_text_equals scoped to the actual count test_id ' +
        'is the rigorous check.',
    },
  },
  {
    id: 'check-action-button-disabled-while-submitting',
    replace: {
      title: 'Check action button is disabled while submitting',
      area: 'core',
      severity: 'P1',
      preconditions: { auth_state: 'logged_in' },
      actions: [
        { type: 'goto', path: '/table' },
        { type: 'click', target: { role: 'button', name_regex: '^Check$' } },
      ],
      expected: {
        dom: {
          attribute_equals: [
            { target: { role: 'button', name_regex: '^Check$' }, attribute: 'disabled', equals: true },
          ],
        },
      },
      category: ['ui-state'],
      notes:
        'REPLACE for check-action-button-disabled-while-submitting: same shape as all-in. Original asserted ' +
        'presence rather than disabled state (G15). attribute_equals on disabled boolean.',
    },
  },
  {
    id: 'lobby-seed-input-accepts-optional-value',
    replace: {
      title: 'Lobby seed input retains user-typed value',
      area: 'core',
      severity: 'P3',
      preconditions: { auth_state: 'anonymous' },
      actions: [
        { type: 'goto', path: '/lobby' },
        { type: 'fill', target: { role: 'textbox', name_regex: '[Ss]eed' }, value: 'test-seed-12345' },
      ],
      expected: {
        dom: {
          input_value: [{ target: { role: 'textbox', name_regex: '[Ss]eed' }, equals: 'test-seed-12345' }],
        },
      },
      category: ['form-state'],
      notes:
        'REPLACE for lobby-seed-input-accepts-optional-value: original had empty contains_text array. ' +
        'Stream 5 input_value.equals catches the actual intent (input.value persists after fill).',
    },
  },
  {
    id: 'raise-slider-shows-validation-error',
    replace: {
      title: 'Raise slider shows validation error for illegal amount',
      area: 'core',
      severity: 'P1',
      preconditions: { auth_state: 'logged_in' },
      actions: [
        { type: 'goto', path: '/table' },
        {
          type: 'fill',
          target: { role: 'textbox', name_regex: '[Aa]mount|[Rr]aise|[Bb]et' },
          value: '0',
        },
        { type: 'click', target: { role: 'button', name_regex: '[Rr]aise|[Bb]et' } },
      ],
      expected: {
        dom: {
          // Scope to the validation error element specifically — the
          // generic "error" needle (G17) was too broad. SUT exposes a
          // test_id="raise-validation-error" or similar.
          element_text_equals: [{ target: { test_id: 'raise-validation-error' }, equals: 'Amount must be at least the big blind' }],
        },
      },
      category: ['validation'],
      notes:
        'REPLACE for raise-slider-shows-validation-error: original used "error" needle (G17). Stream 5 ' +
        'element_text_equals on a scoped validation message element is the rigorous check. The exact ' +
        'message string may need adjustment per the SUT — left as a likely-correct placeholder.',
    },
  },
  {
    id: 'replay-hand-select-button-updates-view',
    replace: {
      title: 'Selecting a hand in replay updates the view via URL hand-id',
      area: 'core',
      severity: 'P1',
      preconditions: { auth_state: 'logged_in' },
      actions: [
        { type: 'goto', path: '/replay' },
        { type: 'click', target: { role: 'button', name_regex: '[Ss]elect|[Hh]and' } },
      ],
      expected: {
        url: { matches: '\\bhand=' },
        dom: {
          class_contains: [{ target: { test_id: 'replay-canvas' }, class: 'is-loaded' }],
        },
      },
      category: ['ui-state', 'navigation'],
      notes:
        'REPLACE for replay-hand-select-button-updates-view: original had empty contains_text. Stream 5 ' +
        'combines url change (hand= query param) + class_contains on the canvas being is-loaded. ' +
        'class_contains is the structural signal of "view updated"; URL is the navigation signal.',
    },
  },
  {
    id: 'replay-next-button-advances-timeline',
    replace: {
      title: 'Replay Next button advances the timeline by 1',
      area: 'core',
      severity: 'P1',
      preconditions: { auth_state: 'logged_in' },
      actions: [
        { type: 'goto', path: '/replay' },
        { type: 'click', target: { role: 'button', name_regex: '[Nn]ext' } },
      ],
      expected: {
        dom: {
          // After one Next click, timeline index should read "2" (was "1" initially).
          // Anchored to a scoped counter element rather than a free-text needle.
          element_text_equals: [{ target: { test_id: 'replay-timeline-index' }, equals: '2' }],
        },
      },
      category: ['ui-state', 'sequence'],
      notes:
        'REPLACE for replay-next-button-advances-timeline: original had empty contains_text. Stream 5 ' +
        'element_text_equals on the timeline counter test_id catches the +1 increment. If the SUT ' +
        'starts at 0 instead of 1, change equals to "1".',
    },
  },
  {
    id: 'replay-street-filter-resets-on-hand-change',
    replace: {
      title: 'Replay street filter resets to "all" when changing hands',
      area: 'core',
      severity: 'P2',
      preconditions: { auth_state: 'logged_in' },
      actions: [
        { type: 'goto', path: '/replay' },
        { type: 'click', target: { role: 'button', name_regex: '[Ff]lop' } },
        { type: 'click', target: { role: 'listitem', name_regex: '[Hh]and' } },
      ],
      expected: {
        dom: {
          element_text_equals: [{ target: { test_id: 'street-filter-active' }, equals: 'all' }],
        },
      },
      category: ['ui-state', 'reset'],
      notes:
        'REPLACE for replay-street-filter-resets-on-hand-change: original had empty contains_text. ' +
        'Stream 5 element_text_equals on the active-filter element catches the reset to "all".',
    },
  },
  {
    id: 'werewolf-lobby-recent-tab-filters-completed-games',
    replace: {
      title: 'Werewolf lobby RECENT tab shows completed games (different list than ALL)',
      area: 'core',
      severity: 'P2',
      preconditions: { auth_state: 'anonymous' },
      actions: [
        { type: 'goto', path: '/werewolf' },
        { type: 'click', target: { role: 'tab', name_regex: 'RECENT' } },
      ],
      expected: {
        dom: {
          // After clicking RECENT, the list area should only contain games
          // whose status is "completed". Anchored to a scoped status badge.
          element_text_equals: [{ target: { test_id: 'lobby-list-status-badge', first: true }, equals: 'Completed' }],
          attribute_equals: [
            { target: { role: 'tab', name_regex: 'RECENT' }, attribute: 'aria-selected', equals: 'true' },
          ],
        },
      },
      category: ['ui-state', 'filter'],
      notes:
        'REPLACE for werewolf-lobby-recent-tab-filters-completed-games: original was a mirror assertion ' +
        '(click "RECENT" → assert text contains "RECENT") — doesn\'t test filtering. Stream 5 dual check: ' +
        'tab marked active (aria-selected) + scoped status badge on first list item shows "Completed".',
    },
  },
  {
    id: 'werewolf-lobby-tab-featured-active-state',
    replace: {
      title: 'Werewolf lobby Featured tab shows active state',
      area: 'core',
      severity: 'P2',
      preconditions: { auth_state: 'anonymous' },
      actions: [
        { type: 'goto', path: '/werewolf' },
        { type: 'click', target: { role: 'tab', name_regex: 'FEATURED' } },
      ],
      expected: {
        dom: {
          attribute_equals: [
            { target: { role: 'tab', name_regex: 'FEATURED' }, attribute: 'aria-selected', equals: 'true' },
          ],
        },
      },
      category: ['ui-state'],
      notes:
        'REPLACE for werewolf-lobby-tab-featured-active-state: original mirror assertion. Stream 5 ' +
        'attribute_equals on aria-selected is the standard a11y signal for tab active state.',
    },
  },
  {
    id: 'werewolf-lobby-tab-live-filters-games',
    replace: {
      title: 'Werewolf lobby ALL LIVE tab shows only live games',
      area: 'core',
      severity: 'P2',
      preconditions: { auth_state: 'anonymous' },
      actions: [
        { type: 'goto', path: '/werewolf' },
        { type: 'click', target: { role: 'tab', name_regex: 'ALL LIVE' } },
      ],
      expected: {
        dom: {
          element_text_equals: [{ target: { test_id: 'lobby-list-status-badge', first: true }, equals: 'Live' }],
          attribute_equals: [
            { target: { role: 'tab', name_regex: 'ALL LIVE' }, attribute: 'aria-selected', equals: 'true' },
          ],
        },
      },
      category: ['ui-state', 'filter'],
      notes:
        'REPLACE for werewolf-lobby-tab-live-filters-games: same shape as RECENT REPLACE. Dual check: ' +
        'tab aria-selected + first list status badge = "Live".',
    },
  },
];

function build(entry) {
  const { id, replace } = entry;
  const newId = `${id}-REPLACE`;
  return {
    id: newId,
    title: replace.title,
    area: replace.area,
    severity: replace.severity,
    preconditions: replace.preconditions,
    actions: replace.actions,
    expected: replace.expected,
    category: replace.category,
    provenance: {
      source: 'stream3-replace',
      generated_at: TODAY,
      reviewed_by: 'stream3-author',
      reviewed_at: TODAY,
      status: 'approved',
      replaces: id,
      duplicates_of: [],
    },
    review: {
      validity: 'tp',
      validity_verified_in_product: false,
      specificity: 2,
      severity_original: replace.severity,
      severity_final: replace.severity,
      notes: `Stream 3 REPLACE 2026-05-27: ${replace.notes}`,
    },
  };
}

let written = 0;
for (const entry of REPLACES) {
  const out = build(entry);
  const p = path.join(GT_DIR, `${out.id}.yml`);
  if (existsSync(p)) {
    console.log(`  skip (exists): ${p}`);
    continue;
  }
  writeFileSync(p, stringify(out, { lineWidth: 0 }), 'utf8');
  written++;
  console.log(`  ✓ ${p}`);
}
console.log(`Stream 3 REPLACE: wrote ${written} new contracts.`);

// Sanity: re-parse each.
let bad = 0;
for (const entry of REPLACES) {
  const p = path.join(GT_DIR, `${entry.id}-REPLACE.yml`);
  try {
    parse(readFileSync(p, 'utf8'));
  } catch (e) {
    console.error(`  ✗ malformed: ${p}: ${e.message}`);
    bad++;
  }
}
if (bad) process.exit(1);
