import assert from 'node:assert/strict';

export function verificationTargets(suffix) {
  // PostgreSQL identifiers cap at63 bytes; the longest prefix+_test consumes30.
  assert.match(suffix ?? '', /^[a-z0-9_]{1,33}$/);
  return Object.fromEntries(['core', 'seed', 'layout', 'content', 'browser', 'ui_native', 'inventory', 'finance', 'event_seed'].map(kind => [kind,
    kind === 'inventory' ? `cinehook_event_inventory_${suffix}_test` : kind === 'event_seed' ? `cinehook_event_seed_${suffix}_test` : `refinement_${kind}_${suffix}_test`]));
}
