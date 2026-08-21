import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sandboxedReviewDoc } from './sandbox.ts';

test('sandboxedReviewDoc() injects a CSP meta tag into an existing <head>', () => {
  const out = sandboxedReviewDoc('<html><head><title>x</title></head><body>hi</body></html>');
  assert.match(out, /<head><meta http-equiv="Content-Security-Policy"/);
});

test('sandboxedReviewDoc() adds a <head> when the document only has <html>', () => {
  const out = sandboxedReviewDoc('<html><body>hi</body></html>');
  assert.match(out, /<html><head><meta http-equiv="Content-Security-Policy"[^>]*><\/head>/);
});

test('sandboxedReviewDoc() wraps a bare fragment with a <head> of its own', () => {
  const out = sandboxedReviewDoc('<p>hi</p>');
  assert.match(out, /^<head><meta http-equiv="Content-Security-Policy"[^>]*><\/head><p>hi<\/p>$/);
});

test('sandboxedReviewDoc() default-src none blocks network fetches other than data: URIs', () => {
  const out = sandboxedReviewDoc('<p>hi</p>');
  assert.match(out, /default-src 'none'/);
  assert.match(out, /img-src data:/);
});
