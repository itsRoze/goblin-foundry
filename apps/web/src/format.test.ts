import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spendOrTokens, tokens } from './format.ts';

test('tokens() renders under a thousand as a plain count', () => {
  assert.equal(tokens(0), '0 tok');
  assert.equal(tokens(842), '842 tok');
});

test('tokens() renders a thousand or more in k, one decimal', () => {
  assert.equal(tokens(1000), '1.0k tok');
  assert.equal(tokens(12345), '12.3k tok');
});

test('spendOrTokens() shows tokens when nothing is billable — the honest default on a subscription', () => {
  assert.equal(spendOrTokens({ billableUsd: 0, inputTokens: 900, outputTokens: 100 }), '1.0k tok');
});

test('spendOrTokens() shows real money once billable spend is above zero', () => {
  assert.equal(spendOrTokens({ billableUsd: 3.5, inputTokens: 900, outputTokens: 100 }), '$3.50');
});
