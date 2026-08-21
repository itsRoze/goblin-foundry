import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveProjectKey, formatRef, parseRef, resolveRef } from './ref.ts';

test('formatRef() joins an uppercased key and the short id', () => {
  assert.equal(formatRef('FAC', 10), 'FAC-10');
  assert.equal(formatRef('fac', 10), 'FAC-10');
});

test('parseRef() round-trips a canonical ref produced by formatRef()', () => {
  assert.deepEqual(parseRef(formatRef('FAC', 10)), { key: 'FAC', shortId: 10 });
  assert.deepEqual(parseRef(formatRef('PRB', 1)), { key: 'PRB', shortId: 1 });
});

test('parseRef() normalizes a lowercase or mixed-case key deterministically', () => {
  assert.deepEqual(parseRef('fac-10'), { key: 'FAC', shortId: 10 });
  assert.deepEqual(parseRef('Fac-10'), { key: 'FAC', shortId: 10 });
});

test('parseRef() accepts a key carrying digits', () => {
  assert.deepEqual(parseRef('GF2-15'), { key: 'GF2', shortId: 15 });
});

test('parseRef() rejects a bare number, a missing number, and garbage', () => {
  assert.equal(parseRef('10'), null);
  assert.equal(parseRef('FAC-'), null);
  assert.equal(parseRef('FAC'), null);
  assert.equal(parseRef('not a ref'), null);
  assert.equal(parseRef(''), null);
});

test('deriveProjectKey() takes initials from a multi-word slug', () => {
  assert.equal(deriveProjectKey('goblin-foundry'), 'GF');
  assert.equal(deriveProjectKey('problem-solver-app'), 'PSA');
});

test('deriveProjectKey() takes the first three letters of a single-word slug', () => {
  assert.equal(deriveProjectKey('factory'), 'FAC');
  assert.equal(deriveProjectKey('ab'), 'AB');
});

test('deriveProjectKey() breaks a collision by appending a number to the base', () => {
  assert.equal(deriveProjectKey('goblin-foundry', ['GF']), 'GF2');
  assert.equal(deriveProjectKey('goblin-foundry', ['GF', 'GF2']), 'GF3');
});

test('deriveProjectKey() ignores case when checking taken keys', () => {
  assert.equal(deriveProjectKey('goblin-foundry', ['gf']), 'GF2');
});

test('resolveRef() resolves a canonical ref to the one matching candidate', () => {
  const candidates = [{ key: 'FAC', shortId: 10 }, { key: 'PRB', shortId: 10 }];
  assert.deepEqual(resolveRef('FAC-10', candidates), { status: 'unique', candidate: candidates[0] });
});

test('resolveRef() reports none for a canonical ref with no matching candidate', () => {
  const candidates = [{ key: 'FAC', shortId: 10 }];
  assert.deepEqual(resolveRef('PRB-10', candidates), { status: 'none' });
});

test('resolveRef() resolves a bare number when exactly one candidate has it', () => {
  const candidates = [{ key: 'FAC', shortId: 10 }];
  assert.deepEqual(resolveRef('10', candidates), { status: 'unique', candidate: candidates[0] });
  assert.deepEqual(resolveRef('#10', candidates), { status: 'unique', candidate: candidates[0] });
});

test('resolveRef() reports ambiguity when more than one project has the bare number', () => {
  const candidates = [{ key: 'FAC', shortId: 1 }, { key: 'PRB', shortId: 1 }];
  assert.deepEqual(resolveRef('1', candidates), { status: 'ambiguous', candidates });
});

test('resolveRef() reports none for a bare number nothing matches', () => {
  const candidates = [{ key: 'FAC', shortId: 10 }];
  assert.deepEqual(resolveRef('99', candidates), { status: 'none' });
});

test('resolveRef() reports none for input that is neither a ref nor a number', () => {
  const candidates = [{ key: 'FAC', shortId: 10 }];
  assert.deepEqual(resolveRef('hello', candidates), { status: 'none' });
});
