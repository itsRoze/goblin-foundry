import { defineWorkflow, type NameOf, type StatusOf } from '../src/index';

/**
 * What the types refuse. Checked by `tsc` (an unused `@ts-expect-error` is
 * itself an error), never run.
 */

const plain = defineWorkflow({ noun: 'x', statuses: ['a', 'b'], actors: { me: ['me'] }, transitions: { go: { from: ['a'], to: 'b', owner: 'me' } } });

const name: NameOf<typeof plain> = 'go';
// @ts-expect-error not a name
const notAName: NameOf<typeof plain> = 'gone';
const status: StatusOf<typeof plain> = 'b';
// @ts-expect-error not a status
const notAStatus: StatusOf<typeof plain> = 'c';

// @ts-expect-error from typo
defineWorkflow({ noun: 'x', statuses: ['a', 'b'], actors: { me: ['me'] }, transitions: { go: { from: ['c'], to: 'b', owner: 'me' } } });
// @ts-expect-error to typo
defineWorkflow({ noun: 'x', statuses: ['a', 'b'], actors: { me: ['me'] }, transitions: { go: { from: ['a'], to: 'c', owner: 'me' } } });
// @ts-expect-error owner typo
defineWorkflow({ noun: 'x', statuses: ['a', 'b'], actors: { me: ['me'] }, transitions: { go: { from: ['a'], to: 'b', owner: 'you' } } });
// @ts-expect-error an actor holds itself first
defineWorkflow({ noun: 'x', statuses: ['a', 'b'], actors: { me: ['you'], you: ['you'] }, transitions: { go: { from: ['a'], to: 'b', owner: 'me' } } });
// @ts-expect-error requirement status typo
defineWorkflow({ noun: 'x', statuses: ['a', 'b'], actors: { me: ['me'] }, transitions: { go: { from: ['a'], to: 'b', owner: 'me' } }, requires: { in: ['z'], missing: (_: { x: number }) => ['x' as const], label: () => '' } });

const guarded = defineWorkflow({
  noun: 'x',
  statuses: ['a', 'b'],
  actors: { me: ['me'] },
  transitions: { go: { from: ['a'], to: 'b', owner: 'me' } },
  requires: { in: ['b'], missing: (subject: { x: number | null }) => (subject.x === null ? ['x' as const] : []), label: () => 'an x' },
});

// the subject type is read off the requirement
// @ts-expect-error judge needs the requirement's fields
guarded.judge({ status: 'a' }, 'go', 'me');
guarded.judge({ status: 'a', x: 1 }, 'go', 'me');
plain.judge({ status: 'a' }, 'go', 'me');
// @ts-expect-error unknown actor
plain.judge({ status: 'a' }, 'go', 'you');
// @ts-expect-error unknown name
plain.named('a', 'gone');
// @ts-expect-error unknown status
plain.toward('a', 'c');
const missing: readonly 'x'[] = guarded.missingAt('b', { x: null });

void [name, notAName, status, notAStatus, missing];
