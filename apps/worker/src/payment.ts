import type { Harness, PaymentMethod } from '@goblin/schema';

/**
 * Every cost the factory has ever shown was a list-price estimate of a
 * currency nobody spends: both lanes authenticate with a subscription or a
 * plan seat. This module answers what actually paid for a phase, from
 * evidence the runner reports, so a dollar cap only ever binds on a lane that
 * can really spend a dollar.
 */

/** Providers known to be a flat-rate plan rather than a metered key. */
const PLAN_PROVIDERS = new Set(['opencode-go']);

/** The Claude Agent SDK's `apiKeySource` values that mean an OAuth subscription
 *  login rather than any form of configured API key. */
const CLAUDE_SUBSCRIPTION_SOURCES = new Set(['oauth']);
/** `none` means the subprocess reported no credential at all — not evidence of
 *  either a subscription or a key, so it lands on `unknown`. */
const CLAUDE_UNKNOWN_SOURCES = new Set(['none']);

/** `claude-code` always talks to Anthropic; `pi` names its provider in the model ref. */
export function providerFor(harness: Harness, model: string): string {
  if (harness === 'claude-code') return 'anthropic';
  const slash = model.indexOf('/');
  return slash > 0 ? model.slice(0, slash) : 'unknown';
}

/**
 * The one place a payment method is derived, for both lanes and both the
 * before-the-session declaration and the after-the-session observation.
 *
 * `credentialSource` is the Claude harness's `apiKeySource`, known only once
 * the session's init message has arrived; pass `null` before then and this
 * returns the tier's declared method, which is what a cap must be chosen from.
 * For `pi`, the provider named in the model reference is evidence available
 * up front, so it is used whether or not a credential source was passed.
 */
export function derivePaymentMethod(input: {
  harness: Harness;
  provider: string | null;
  credentialSource: string | null;
  declared: PaymentMethod;
}): PaymentMethod {
  if (input.harness === 'pi') {
    if (!input.provider) return input.declared;
    return PLAN_PROVIDERS.has(input.provider) ? 'plan' : 'api-key';
  }
  if (!input.credentialSource) return input.declared;
  if (CLAUDE_SUBSCRIPTION_SOURCES.has(input.credentialSource)) return 'subscription';
  if (CLAUDE_UNKNOWN_SOURCES.has(input.credentialSource)) return 'unknown';
  return 'api-key';
}

/** A subscription or plan tier that quietly observed a real API key — exactly
 *  the surprise this module exists to catch. */
export function isPaymentMismatch(declared: PaymentMethod, observed: PaymentMethod): boolean {
  return observed === 'api-key' && declared !== 'api-key';
}

/** Real money, or money that cannot be ruled out. Everything else is an estimate. */
export function isBillable(paidBy: PaymentMethod): boolean {
  return paidBy === 'api-key' || paidBy === 'unknown';
}

/** No dollar cap for a lane that spends no dollars; the tier's own cap otherwise. */
export function startingCapUsd(paidBy: PaymentMethod, budgetUsd: number): number | undefined {
  return paidBy === 'api-key' ? budgetUsd : undefined;
}
