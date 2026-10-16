export type Direction = 'back' | 'same' | 'forward';

export interface TransitionRow<S extends string, A extends string> {
  readonly from: readonly S[];
  readonly to: S;
  readonly owner: A;
}

/**
 * What a subject must have to stand in some statuses. The Piece checks it on
 * every edge that crosses from outside `in` to inside it, and answers
 * `missingAt` for writes that are not transitions (creation, field edits).
 * Edges inside `in` are not re-checked: the invariant already held there.
 */
export interface Requirement<S extends string, Sub, M> {
  readonly in: readonly S[];
  /** Empty means satisfied. Order is the order the refusal names them in. */
  readonly missing: (subject: Sub) => readonly M[];
  /** How a refusal names one missing thing: `app` reads as *an app*. */
  readonly label: (missing: M) => string;
}

export interface WorkflowDefinition<S extends string, N extends string, A extends string, Sub, M> {
  /** What the Piece's refusals call a subject: *a ticket in review does not go back to building*. */
  readonly noun: string;
  /** Lifecycle order. Also the order `Direction` is read from. */
  readonly statuses: readonly [S, ...S[]];
  /**
   * The authorities each actor holds, itself first.
   */
  readonly actors: { readonly [K in A]: readonly [K, ...NoInfer<A>[]] };
  /** In table order: `names`, `edges` and `from()` keep it. */
  readonly transitions: { readonly [K in N]: TransitionRow<NoInfer<S>, NoInfer<A>> };
  readonly requires?: Requirement<NoInfer<S>, Sub, M>;
}

export class WorkflowDefinitionError extends Error {}

export interface Edge<S extends string, N extends string, A extends string> {
  readonly from: S;
  readonly to: S;
  readonly name: N;
  readonly owner: A;
  readonly direction: Direction;
  /** Derived: the edge crosses into the requirement's statuses. Never written by hand. */
  readonly guarded: boolean;
}

export type Found<E> = { readonly ok: true; readonly edge: E } | { readonly ok: false; readonly refusal: string };

/**
 * May this actor take it now? Structure, then authority, then the
 * requirement (ADR-0003's order). `owner` is absent on a structural refusal:
 * there is no arrow, so there is no one whose arrow it was.
 */
export type Judged<E, A extends string> = { readonly ok: true; readonly edge: E } | { readonly ok: false; readonly refusal: string; readonly owner?: A };

/**
 * Members are closures over the definition, so `lifecycle.from` can be
 * passed as a callback.
 */
export interface Workflow<S extends string, N extends string, A extends string, Sub, M> {
  readonly statuses: readonly [S, ...S[]];
  /** Every name, in table order; a tuple so `z.enum(lifecycle.names)` works. */
  readonly names: readonly [N, ...N[]];
  readonly transitions: { readonly [K in N]: TransitionRow<S, A> };
  /** Every arrow, rows expanded in table order. */
  readonly edges: readonly Edge<S, N, A>[];
  isName(name: string): name is N;
  /** Every arrow out of a status, in table order. */
  from(status: S): readonly Edge<S, N, A>[];
  named(from: S, name: N): Found<Edge<S, N, A>>;
  toward(from: S, to: S): Found<Edge<S, N, A>>;
  judge(subject: Sub & { readonly status: S }, name: N, actor: A): Judged<Edge<S, N, A>, A>;
  /** What the requirement finds missing for a subject standing in `status`; empty outside `requires.in`. */
  missingAt(status: S, subject: Sub): readonly M[];
}

export type StatusOf<W extends { readonly statuses: readonly string[] }> = W['statuses'][number];
export type NameOf<W extends { readonly names: readonly string[] }> = W['names'][number];
export type EdgeOf<W extends { readonly edges: readonly unknown[] }> = W['edges'][number];

/**
 * Builds the workflow once, at module load. Throws on a definition the types
 * cannot reject, so a bad Assembly fails its first test rather than a request:
 *
 * - no transitions at all, so `names` is never an empty tuple;
 * - a status listed twice in `statuses`, or twice in one row's `from`
 *   (which would make `(from, name)` address two arrows);
 * - two arrows sharing `(from, to)`: a drop would name two verbs.
 */
export function defineWorkflow<const S extends string, const N extends string, const A extends string, Sub = unknown, M = never>(
  definition: WorkflowDefinition<S, N, A, Sub, M>,
): Workflow<S, N, A, Sub, M> {
  const { noun, statuses, actors, transitions, requires } = definition;
  const names = Object.keys(transitions) as N[];
  const requiredIn = new Set<S>(requires?.in ?? []);
  const direction = (from: S, to: S): Direction => (from === to ? 'same' : statuses.indexOf(to) < statuses.indexOf(from) ? 'back' : 'forward');

  const edges: Edge<S, N, A>[] = names.flatMap((name) => {
    const row = transitions[name];
    return row.from.map((from) => ({ from, to: row.to, name, owner: row.owner, direction: direction(from, row.to), guarded: !requiredIn.has(from) && requiredIn.has(row.to) }));
  });

  const repeated = <T>(list: readonly T[]): T[] => [...new Set(list.filter((x, i) => list.indexOf(x) !== i))];
  const faults: string[] = [];
  if (names.length === 0) faults.push('no transitions');
  for (const status of repeated(statuses)) faults.push(`status ${status} is listed twice`);
  for (const name of names) for (const from of repeated(transitions[name].from)) faults.push(`${name} leads out of ${from} twice`);
  const byTarget = new Map<string, Edge<S, N, A>>();
  for (const edge of edges) {
    const other = byTarget.get(`${edge.from}/${edge.to}`);
    if (other && other.name !== edge.name) faults.push(`${edge.from} → ${edge.to} is both ${other.name} and ${edge.name}`);
    else byTarget.set(`${edge.from}/${edge.to}`, edge);
  }
  if (faults.length > 0) throw new WorkflowDefinitionError(faults.join('; '));

  const byName = new Map(edges.map((edge) => [`${edge.from}/${edge.name}`, edge]));
  const edgesFrom = new Map<S, Edge<S, N, A>[]>();
  for (const edge of edges) edgesFrom.set(edge.from, [...(edgesFrom.get(edge.from) ?? []), edge]);
  const known = new Set<string>(names);

  const noArrow = (from: S, to: S): string => {
    const where = direction(from, to);
    return where === 'same' ? `a ${noun} in ${from} is already in ${to}` : `a ${noun} in ${from} does not go ${where === 'back' ? 'back to' : 'to'} ${to}`;
  };
  const named = (from: S, name: N): Found<Edge<S, N, A>> => {
    const edge = byName.get(`${from}/${name}`);
    return edge ? { ok: true, edge } : { ok: false, refusal: noArrow(from, transitions[name].to) };
  };
  const toward = (from: S, to: S): Found<Edge<S, N, A>> => {
    const edge = byTarget.get(`${from}/${to}`);
    return edge ? { ok: true, edge } : { ok: false, refusal: noArrow(from, to) };
  };
  const judge = (subject: Sub & { readonly status: S }, name: N, actor: A): Judged<Edge<S, N, A>, A> => {
    const found = named(subject.status, name);
    if (!found.ok) return found;
    const { edge } = found;
    if (!actors[actor].includes(edge.owner)) return { ok: false, refusal: `${name} is the ${edge.owner}'s move, not the ${actor}'s`, owner: edge.owner };
    if (edge.guarded && requires) {
      const lacks = requires.missing(subject);
      if (lacks.length > 0) return { ok: false, refusal: `${name} needs ${lacks.map(requires.label).join(' and ')}`, owner: edge.owner };
    }
    return { ok: true, edge };
  };
  const missingAt = (status: S, subject: Sub): readonly M[] => (requires && requiredIn.has(status) ? requires.missing(subject) : []);

  return {
    statuses,
    names: names as [N, ...N[]],
    transitions,
    edges,
    isName: (name): name is N => known.has(name),
    from: (status) => edgesFrom.get(status) ?? [],
    named,
    toward,
    judge,
    missingAt,
  };
}
