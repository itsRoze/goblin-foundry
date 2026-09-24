import { expect, test } from 'bun:test';
import { ticketBranchName } from '../src/implementation';

test('branch suggestions use the current title and a safe lowercase key/title slug', () => {
  const ticket = { key: 'GF-14', title: 'Choose a useful finite-edition selection policy' };
  expect(ticketBranchName(ticket)).toBe('gf-14-choose-a-useful-finite-edition-selection-policy');
  expect(ticketBranchName({ ...ticket, title: 'Café / Reader: [offline] .. @{work} LOCK.lock' })).toBe('gf-14-cafe-reader-offline-work-lock-lock');
  expect(ticketBranchName({ ...ticket, title: '🚇' })).toBe('gf-14-untitled');
});
