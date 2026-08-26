import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  derivePaymentMethod, isBillable, isPaymentMismatch, providerFor, startingCapUsd,
} from './payment.ts';

test('providerFor names Anthropic for claude-code regardless of model', () => {
  assert.equal(providerFor('claude-code', 'opus'), 'anthropic');
  assert.equal(providerFor('claude-code', 'sonnet'), 'anthropic');
});

test('providerFor reads the provider named in a pi model reference', () => {
  assert.equal(providerFor('pi', 'opencode-go/kimi-k3'), 'opencode-go');
  assert.equal(providerFor('pi', 'not-a-ref'), 'unknown');
});

test('before a claude-code session reports anything, the declared method stands', () => {
  assert.equal(derivePaymentMethod({
    harness: 'claude-code', provider: 'anthropic', credentialSource: null, declared: 'subscription',
  }), 'subscription');
});

test('an oauth login observes a subscription no matter what was declared', () => {
  assert.equal(derivePaymentMethod({
    harness: 'claude-code', provider: 'anthropic', credentialSource: 'oauth', declared: 'subscription',
  }), 'subscription');
});

test('a credential source that names a configured key observes api-key', () => {
  for (const source of ['ANTHROPIC_API_KEY', 'apiKeyHelper', '/login managed key', 'user', 'project', 'org', 'temporary']) {
    assert.equal(derivePaymentMethod({
      harness: 'claude-code', provider: 'anthropic', credentialSource: source, declared: 'subscription',
    }), 'api-key', `expected ${source} to observe api-key`);
  }
});

test('no credential reported at all observes unknown, not a guess', () => {
  assert.equal(derivePaymentMethod({
    harness: 'claude-code', provider: 'anthropic', credentialSource: 'none', declared: 'subscription',
  }), 'unknown');
});

test('pi derives its payment method from the provider, known before the session starts', () => {
  assert.equal(derivePaymentMethod({
    harness: 'pi', provider: 'opencode-go', credentialSource: null, declared: 'plan',
  }), 'plan');
  assert.equal(derivePaymentMethod({
    harness: 'pi', provider: 'some-metered-provider', credentialSource: null, declared: 'plan',
  }), 'api-key');
});

test('pi with no provider yet falls back to the declared method', () => {
  assert.equal(derivePaymentMethod({
    harness: 'pi', provider: null, credentialSource: null, declared: 'plan',
  }), 'plan');
});

test('isPaymentMismatch fires only when real money shows up where none was declared', () => {
  assert.equal(isPaymentMismatch('subscription', 'api-key'), true);
  assert.equal(isPaymentMismatch('plan', 'api-key'), true);
  assert.equal(isPaymentMismatch('api-key', 'api-key'), false);
  assert.equal(isPaymentMismatch('subscription', 'subscription'), false);
  assert.equal(isPaymentMismatch('subscription', 'unknown'), false);
});

test('isBillable counts real money and money that cannot be ruled out', () => {
  assert.equal(isBillable('api-key'), true);
  assert.equal(isBillable('unknown'), true);
  assert.equal(isBillable('subscription'), false);
  assert.equal(isBillable('plan'), false);
});

test('startingCapUsd caps only an api-key tier; a subscription or plan phase starts uncapped', () => {
  assert.equal(startingCapUsd('api-key', 12), 12);
  assert.equal(startingCapUsd('subscription', 12), undefined);
  assert.equal(startingCapUsd('plan', 12), undefined);
  // A synthetic tier the factory cannot see today: the path that must be right
  // before the day an api-key lane exists for real.
  assert.equal(startingCapUsd('unknown', 12), undefined);
});
