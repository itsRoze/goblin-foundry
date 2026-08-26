import { POLICY_PRESETS, type Policy, type PolicyOverride } from './policy.ts';

/** One of the three inputs to a merge: preset, project override, repo file. */
export type PolicyLayer = 'preset' | 'project' | 'file';

/**
 * Which layer supplied one leaf, and what every layer below it had offered.
 * `displaced` is empty when only the preset named this leaf. Computed for
 * display, never stored — a pure function of the three layers.
 */
export type ProvenanceEntry = {
  layer: PolicyLayer;
  value: unknown;
  displaced: { layer: PolicyLayer; value: unknown }[];
};

/** Dot-joined leaf path ("budgets.gateRetries", "models.builder.effort") to its provenance. */
export type Provenance = Record<string, ProvenanceEntry>;

export type ResolveResult = {
  presetName: Policy['preset'];
  policy: Policy;
  provenance: Provenance;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

type NamedLayer = { layer: Exclude<PolicyLayer, 'preset'>; value: unknown };

/**
 * Deep-merges one leaf of the base preset against the same path in the
 * project and file layers. Arrays are leaves — a layer that names one
 * replaces it wholesale rather than unioning with a lower layer's list.
 */
function mergeAt(path: string[], base: unknown, layers: NamedLayer[], provenance: Provenance): unknown {
  if (isPlainObject(base)) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(base)) {
      const childLayers = layers.map(l => ({
        layer: l.layer,
        value: isPlainObject(l.value) ? l.value[key] : undefined,
      }));
      result[key] = mergeAt([...path, key], base[key], childLayers, provenance);
    }
    return result;
  }

  // A leaf: an array or a scalar. Every layer that named it, in order, base first.
  const chain: { layer: PolicyLayer; value: unknown }[] = [{ layer: 'preset', value: base }];
  for (const l of layers) if (l.value !== undefined) chain.push(l);
  const winner = chain[chain.length - 1]!;
  provenance[path.join('.')] = { layer: winner.layer, value: winner.value, displaced: chain.slice(0, -1) };
  return winner.value;
}

/**
 * Merges preset, project override and file override into one frozen `Policy`,
 * plus the provenance of every leaf. `preset` is itself a leaf: whichever
 * layer names it last picks the merge base, and the other layers' remaining
 * leaves still apply on top of that base — a `preset:` line in the file is
 * not a reset of the project's own deltas.
 */
export function resolvePolicy(projectOverride: PolicyOverride, fileOverride: PolicyOverride): ResolveResult {
  const presetName = fileOverride.preset ?? projectOverride.preset ?? 'standard';
  const base = POLICY_PRESETS[presetName];
  const provenance: Provenance = {};
  const layers: NamedLayer[] = [
    { layer: 'project', value: projectOverride },
    { layer: 'file', value: fileOverride },
  ];
  const merged = mergeAt([], base, layers, provenance) as Policy;
  return { presetName: merged.preset, policy: merged, provenance };
}
