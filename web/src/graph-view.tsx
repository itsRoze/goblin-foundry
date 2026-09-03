import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { isBlocked, type ProjectGraph } from '@goblin/shared';
import { DIAMOND, LABEL_TOP, NODE_H, NODE_W, clipTitle, layoutGraph, type LaidNode } from './graph';
import { StatusChip, homeLine, statusTone, ticketPath } from './tickets';
import { Empty } from './ui';

/*
 * The renderer is `graph-view.tsx` rather than `graph.tsx` because a bare
 * `./graph` import resolves to `graph.ts` — two modules cannot share a stem
 * here, and the pure layout keeps the plain name it is tested under.
 */

/** A square on its point, drawn from its centre — the one shape in the graph (DESIGN.md §6). */
const SHAPE = `M 0 ${-DIAMOND} L ${DIAMOND} 0 L 0 ${DIAMOND} L ${-DIAMOND} 0 Z`;
/** Where the label sits around the diamond: the key beside it and above the edge line, the title beneath both. */
const KEY_X = DIAMOND + 7;
const KEY_Y = -5;
const TITLE_Y = DIAMOND + 15;

/** DESIGN.md §6: a popover is intent, not a twitch — hover waits, focus does not. */
const HOVER_MS = 120;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The tile header's subtitle: what is drawn, counted. */
export const graphSubtitle = (graph: ProjectGraph) => `${plural(graph.nodes.length, 'ticket')} · ${plural(graph.edges.length, 'edge')}`;

/**
 * The legend is copy, not a key (DESIGN.md §6) — it says what the drawing
 * means in a sentence, and says the other thing when there is nothing to read.
 */
const legendFor = (edges: number) =>
  edges === 0
    ? 'no dependencies yet — declare one from a ticket'
    : 'blocker → blocked · dashed while the blocker is open · ◇ blocked · mute is outside this project';

/**
 * The project's dependency graph: our own SVG over a dagre layout, at its
 * natural size inside a box that scrolls both ways, so the page never does
 * (DESIGN.md §5). No arrowheads — rank order carries the direction — and no
 * opacity anywhere: a blocked node is the kanban's hollow ◇ and a struck
 * title, never a colour and never a dimming (DESIGN.md §3).
 */
export function DependencyGraph({ graph }: { graph: ProjectGraph }) {
  const layout = useMemo(() => layoutGraph(graph.nodes, graph.edges), [graph]);
  const [active, setActive] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  // a pointer leaving mid-wait must not still be waiting when the component goes
  useEffect(() => cancel, [cancel]);
  const linger = useCallback(
    (key: string) => {
      cancel();
      timer.current = setTimeout(() => setActive(key), HOVER_MS);
    },
    [cancel],
  );
  const show = useCallback(
    (key: string | null) => {
      cancel();
      setActive(key);
    },
    [cancel],
  );

  if (layout.nodes.length === 0) return <Empty>no tickets — press c</Empty>;
  const shown = layout.nodes.find((n) => n.key === active);

  return (
    <>
      <div className="gf-graph" data-testid="graph">
      <svg width={layout.width} height={layout.height} aria-label="dependency graph">
        {/* edges first, so an opaque diamond hides the end of its own wire rather than wearing it */}
        <g className="gf-graph-edges">
          {layout.edges.map((e) => (
            <path key={`${e.blocker}>${e.blocked}`} className={`gf-graph-edge${e.open ? ' is-open' : ''}`} d={e.path} data-testid={`edge-${e.blocker}-${e.blocked}`} />
          ))}
        </g>
        {layout.nodes.map((n) => (
          <Node key={n.key} node={n} onEnter={() => linger(n.key)} onLeave={() => show(null)} onFocus={() => show(n.key)} />
        ))}
      </svg>
        {shown && <Popover node={shown} />}
      </div>
      {/* the legend sits under the drawing and stays put while the drawing scrolls */}
      <p className="gf-graph-legend" data-testid="graph-legend">
        {legendFor(layout.edges.length)}
      </p>
    </>
  );
}

/**
 * The whole node is the link: click opens the ticket, `tab` reaches it, and a
 * tap does the same (there is no hover on touch). The hit area is the box
 * dagre reserved, not just the shapes in it, so the title is as clickable as
 * the diamond.
 */
function Node({ node, onEnter, onLeave, onFocus }: { node: LaidNode; onEnter: () => void; onLeave: () => void; onFocus: () => void }) {
  // a ticket outside this project is context, not subject: mute, with no status treatment at all
  const tone = node.external ? 'mute' : statusTone(node.status);
  const marks = `${node.external ? ' is-external' : ''}${isBlocked(node) ? ' is-blocked' : ''}`;
  return (
    <g transform={`translate(${node.x} ${node.y})`}>
      <Link
        className={`gf-graph-node is-${tone}${marks}`}
        to={ticketPath(node)}
        tabIndex={0}
        aria-label={`${node.key} ${node.title}`}
        data-testid={`node-${node.key}`}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onFocus={onFocus}
        onBlur={onLeave}
      >
        <rect className="gf-graph-hit" x={-DIAMOND} y={-LABEL_TOP} width={NODE_W} height={NODE_H} />
        <path className="gf-graph-diamond" d={SHAPE} />
        <text className="gf-graph-key" x={KEY_X} y={KEY_Y}>
          {node.key}
        </text>
        <text className="gf-graph-title" x={-DIAMOND} y={TITLE_Y}>
          {clipTitle(node.title)}
        </text>
      </Link>
    </g>
  );
}

/**
 * What the diamond had no room for. It is placed in the scrolling content
 * beside its node, so it travels with the drawing, and it never takes the
 * pointer — a popover you can hover is a popover you can get stuck under.
 */
function Popover({ node }: { node: LaidNode }) {
  return (
    <div className="gf-graph-pop" role="tooltip" style={{ left: node.x + 16, top: node.y + 14 }} data-testid="graph-popover">
      <span className="gf-graph-pop-head">
        <span className="gf-key">{node.key}</span>
        <StatusChip status={node.status} />
      </span>
      <span className="gf-graph-pop-title">{node.title}</span>
      {isBlocked(node) && <span className="gf-graph-pop-line">blocked by {node.blocked_by.join(', ')}</span>}
      {node.description_line !== '' && <span className="gf-graph-pop-line">{node.description_line}</span>}
      {node.external && <span className="gf-graph-pop-line">{homeLine(node.external.app, node.external.project)}</span>}
    </div>
  );
}
