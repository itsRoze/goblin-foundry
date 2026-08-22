import type { StatusKind } from './types.ts';

/**
 * Canonical display names and column colours for the fixed status kinds.
 * Per-project rows can rename or recolour a kind, but this map is the fallback
 * and the source of truth for newly created projects (seed + importer).
 */
export const STATUS_DISPLAY: Record<StatusKind, [string, string]> = {
  backlog:          ['Backlog',          '#5B6578'],
  ready_for_design: ['Ready for Design', '#B86E00'],
  designing:        ['Designing',        '#6146D6'],
  design_review:    ['Design Review',    '#B86E00'],
  ready_for_dev:    ['Ready for Dev',    '#1F4FD8'],
  building:         ['Building',         '#6146D6'],
  in_review:        ['In Review',        '#6146D6'],
  ready_to_merge:   ['Ready to Merge',   '#B86E00'],
  deploying:        ['Deploying',        '#6146D6'],
  done:             ['Done',             '#1E8E5A'],
  canceled:         ['Canceled',         '#C8323C'],
};
