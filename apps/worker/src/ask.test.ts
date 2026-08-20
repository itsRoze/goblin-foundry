import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseAsk } from './ask.ts';

test('parseAsk keeps well-formed questions with their options', () => {
  const parsed = parseAsk({
    questions: [{
      question: 'Which store?', header: 'Store', multiSelect: true,
      options: [{ label: 'Postgres', description: 'the one we run' }, { label: 'SQLite' }],
    }],
  });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]!.header, 'Store');
  assert.equal(parsed[0]!.multiSelect, true);
  assert.deepEqual(parsed[0]!.options, [
    { label: 'Postgres', description: 'the one we run' },
    { label: 'SQLite', description: '' },
  ]);
});

test('parseAsk drops anything without a question, and defaults the rest', () => {
  const parsed = parseAsk({ questions: [{ header: 'x' }, { question: '   ' }, { question: 'Real?' }] });
  assert.deepEqual(parsed, [{ question: 'Real?', header: '', multiSelect: false, options: [] }]);
});

test('parseAsk survives input that is not a question round at all', () => {
  assert.deepEqual(parseAsk({}), []);
  assert.deepEqual(parseAsk({ questions: 'nope' as unknown as [] }), []);
});
