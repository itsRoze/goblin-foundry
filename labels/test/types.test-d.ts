import { defineLabels, type LabelOf } from '../src/index';

const chores = defineLabels({ vocabulary: ['errand', 'work', 'home'] as const });
const inline = defineLabels({ vocabulary: ['errand', 'work'] });
const open = defineLabels({ vocabulary: 'open' });

const label: LabelOf<typeof chores> = 'errand';
// @ts-expect-error not in the fixed list
const notALabel: LabelOf<typeof chores> = 'urgent';
// @ts-expect-error not in the fixed list, even without `as const`
const notInline: LabelOf<typeof inline> = 'home';
const anyName: LabelOf<typeof open> = 'wayfinder:research';

const judged = chores.judge(['Home']);
if (judged.ok) {
  const narrowed: readonly ('errand' | 'work' | 'home')[] = judged.labels;
  // @ts-expect-error a judged set is the fixed names, not any string
  const widened: readonly 'errand'[] = judged.labels;
}
const openJudged = open.judge(['x']);
if (openJudged.ok) {
  const names: readonly string[] = openJudged.labels;
}

// @ts-expect-error a fixed vocabulary names at least one label
defineLabels({ vocabulary: [] });
// @ts-expect-error `'open'` or a list, nothing else
defineLabels({ vocabulary: 'closed' });
