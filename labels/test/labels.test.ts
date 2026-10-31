import { describe, expect, test } from 'bun:test';
import { LabelsDefinitionError, defineLabels } from '../src/index';

const open = defineLabels({ vocabulary: 'open' });
const chores = defineLabels({ vocabulary: ['errand', 'work', 'home'] });

describe('defineLabels', () => {
  test('keeps its rules, so an Assembly can offer the fixed names or say there is no limit', () => {
    expect(chores.vocabulary).toEqual(['errand', 'work', 'home']);
    expect(chores.limit).toBeUndefined();
    expect(defineLabels({ vocabulary: 'open', limit: 3 })).toMatchObject({ vocabulary: 'open', limit: 3 });
  });

  test('throws at load for a fixed list written other than as `normalise` writes it, or naming a label twice', () => {
    expect(() => defineLabels({ vocabulary: ['Work', 'home', 'home'] })).toThrow(new LabelsDefinitionError('Work is written as work; home is listed twice'));
  });

  test('throws at load for a fixed list with a malformed name', () => {
    expect(() => defineLabels({ vocabulary: ['', 'day off'] })).toThrow(new LabelsDefinitionError('a label cannot be blank; day off is not one word: a label has no spaces or commas'));
  });

  test('throws at load for an empty fixed list, which no type can stop when the list is built at run time', () => {
    const none: string[] = [];
    expect(() => defineLabels({ vocabulary: none as unknown as [string] })).toThrow(new LabelsDefinitionError('a fixed vocabulary names no labels'));
  });

  test('throws at load for a limit that is not a positive whole number', () => {
    expect(() => defineLabels({ vocabulary: 'open', limit: 0 })).toThrow(new LabelsDefinitionError('a limit of 0 is not a positive whole number'));
    expect(() => defineLabels({ vocabulary: 'open', limit: 1.5 })).toThrow(new LabelsDefinitionError('a limit of 1.5 is not a positive whole number'));
  });
});

describe('normalise', () => {
  test('trims and lower-cases, so `Needs-Info ` and `needs-info` are one label', () => {
    expect(open.normalise('Needs-Info ')).toBe('needs-info');
    expect(open.normalise('needs-info')).toBe('needs-info');
  });

  test('keeps `:` as part of the name', () => {
    expect(open.normalise(' Wayfinder:Research')).toBe('wayfinder:research');
  });
});

describe('judge', () => {
  test('an open vocabulary accepts any well-formed name, normalised, in the order proposed', () => {
    expect(open.judge(['Wayfinder:Research', 'needs-info'])).toEqual({ ok: true, labels: ['wayfinder:research', 'needs-info'] });
  });

  test('an empty or whitespace name is refused with a sentence', () => {
    expect(open.judge([''])).toEqual({ ok: false, refusal: 'a label cannot be blank' });
    expect(open.judge(['needs-info', '  '])).toEqual({ ok: false, refusal: 'a label cannot be blank' });
  });

  test('a name with a space or comma inside is refused, since a set of labels is written comma-separated', () => {
    expect(open.judge(['Needs Info'])).toEqual({ ok: false, refusal: 'needs info is not one word: a label has no spaces or commas' });
    expect(open.judge(['work,home'])).toEqual({ ok: false, refusal: 'work,home is not one word: a label has no spaces or commas' });
  });

  test('a fixed list accepts its own names however they are written', () => {
    expect(chores.judge(['Home', 'errand'])).toEqual({ ok: true, labels: ['home', 'errand'] });
  });

  test('a fixed list refuses any other name, naming the allowed ones', () => {
    expect(chores.judge(['home', 'Urgent'])).toEqual({ ok: false, refusal: 'urgent is not a label here; the labels are errand, work and home' });
    expect(defineLabels({ vocabulary: ['yes', 'no'] }).judge(['maybe'])).toEqual({ ok: false, refusal: 'maybe is not a label here; the labels are yes and no' });
    expect(defineLabels({ vocabulary: ['only'] }).judge(['other'])).toEqual({ ok: false, refusal: 'other is not a label here; the only label is only' });
  });

  test('duplicates after normalisation collapse to the first, rather than refuse', () => {
    expect(open.judge(['needs-info', 'triage', 'Needs-Info ', 'needs-info'])).toEqual({ ok: true, labels: ['needs-info', 'triage'] });
  });

  test('a set over the limit is refused, counted after duplicates collapse', () => {
    const light = defineLabels({ vocabulary: 'open', limit: 2 });
    expect(light.judge(['a', 'b', 'c'])).toEqual({ ok: false, refusal: '3 labels are over the limit of 2' });
    expect(light.judge(['a', 'b', 'A'])).toEqual({ ok: true, labels: ['a', 'b'] });
    expect(defineLabels({ vocabulary: 'open', limit: 1 }).judge(['a', 'b'])).toEqual({ ok: false, refusal: '2 labels are over the limit of 1' });
  });

  test('an empty set is a fine set, and with no limit any number of labels is', () => {
    expect(chores.judge([])).toEqual({ ok: true, labels: [] });
    const many = Array.from({ length: 50 }, (_, i) => `l${i}`);
    expect(open.judge(many)).toEqual({ ok: true, labels: many });
  });
});

describe('matches', () => {
  const carried = ['wayfinder:research', 'needs-info'];

  test('an item with any of the asked labels matches', () => {
    expect(open.matches(carried, ['ready-for-human', 'needs-info'])).toBe(true);
    expect(open.matches(carried, ['ready-for-human', 'wayfinder:task'])).toBe(false);
  });

  test('the ask is normalised, so `?label=Needs-Info` finds `needs-info`', () => {
    expect(open.matches(carried, [' Needs-Info'])).toBe(true);
  });

  test('`wayfinder:research` is one name: asking for `wayfinder` does not match it', () => {
    expect(open.matches(carried, ['wayfinder'])).toBe(false);
  });

  test('an empty ask matches everything, an unlabelled item included', () => {
    expect(open.matches(carried, [])).toBe(true);
    expect(open.matches([], [])).toBe(true);
    expect(open.matches([], ['needs-info'])).toBe(false);
  });
});
