import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unwrapHtmlFragment } from './html.ts';

test('unwrapHtmlFragment() strips a CDATA section around a fragment', () => {
  const inner = '<style>.a { color: red; }</style>\n<h1>Design</h1>';
  assert.equal(unwrapHtmlFragment(`<![CDATA[${inner}]]>`), inner);
  assert.equal(unwrapHtmlFragment(`  <![CDATA[\n${inner}\n]]>  `), inner);
});

test('unwrapHtmlFragment() strips a markdown fence, with or without a language', () => {
  const inner = '<h1>Design</h1>';
  assert.equal(unwrapHtmlFragment('```html\n' + inner + '\n```'), inner);
  assert.equal(unwrapHtmlFragment('```\n' + inner + '\n```'), inner);
});

test('unwrapHtmlFragment() strips a fence wrapped around a CDATA section', () => {
  const inner = '<h1>Design</h1>';
  assert.equal(unwrapHtmlFragment('```html\n<![CDATA[' + inner + ']]>\n```'), inner);
});

test('unwrapHtmlFragment() leaves an ordinary fragment alone', () => {
  const inner = '<style>.a { color: red; }</style><h1>Design</h1><p>a &gt; b</p>';
  assert.equal(unwrapHtmlFragment(inner), inner);
  assert.equal(unwrapHtmlFragment(''), '');
});

test('unwrapHtmlFragment() does not strip a CDATA that is only part of the document', () => {
  const inner = '<h1>Design</h1><p>Use <code>&lt;![CDATA[</code> nowhere.</p>';
  assert.equal(unwrapHtmlFragment(inner), inner);
});
