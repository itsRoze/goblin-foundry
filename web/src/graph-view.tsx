import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { isBlocked, type ProjectGraph } from '@goblin/shared';
import { DIAMOND, LABEL_TOP, NODE_H, layoutGraph, traceGraph, type LaidNode } from './graph';
import { StatusChip, homeLine, statusTone, ticketPath } from './tickets';
import { Empty } from './ui';
import { useGraphViewport } from './graph-viewport';

/*
 * The renderer is `graph-view.tsx` rather than `graph.tsx` because a bare
 * `./graph` import resolves to `graph.ts` — two modules cannot share a stem
 * here, and the pure layout keeps the plain name it is tested under.
 */

/** A square on its point, drawn from its centre — the one shape in the graph (DESIGN.md Components). */
const SHAPE = `M 0 ${-DIAMOND} L ${DIAMOND} 0 L 0 ${DIAMOND} L ${-DIAMOND} 0 Z`;
/** Ticket identifiers sit beside the status diamond; titles live in the detail area. */
const KEY_X = 16;
const KEY_Y = LABEL_TOP + 4;


/** DESIGN.md Components: a popover is intent, not a twitch — hover waits, focus does not. */
const HOVER_MS = 120;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The tile header's subtitle: what is drawn, counted. */
export const graphSubtitle = (graph: ProjectGraph) => `${plural(graph.nodes.length, 'ticket')} · ${plural(graph.edges.length, 'edge')}`;

/**
 * The legend is copy, not a key (DESIGN.md Components) — it says what the drawing
 * means in a sentence, and says the other thing when there is nothing to read.
 */
const legendFor = (edges: number) =>
  edges === 0
    ? 'no dependencies yet — declare one from a ticket'
    : 'left to right · dashed while the blocker is open · hollow diamond means blocked';

/** A fitted dependency map; hover or keyboard focus traces both directions. */
export function DependencyGraph({ graph }: { graph: ProjectGraph }) {
  const markerId = useId().replaceAll(':', '');
  const workspace = useRef<HTMLDivElement>(null);
  const [vertical, setVertical] = useState(false);
  const layout = useMemo(() => layoutGraph(graph.nodes, graph.edges, vertical), [graph, vertical]);
  const [expanded, setExpanded] = useState(false);
  useLayoutEffect(() => {
    const box = workspace.current;
    if (!box) return;
    const measure = () => setVertical(box.clientWidth < 760);
    const observer = new ResizeObserver(measure);
    measure();
    observer.observe(box);
    return () => observer.disconnect();
  }, [expanded, graph.nodes.length]);
  const dialog = useRef<HTMLDialogElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const restingHeight = useRef(0);
  const entry = layout.nodes.reduce<LaidNode | undefined>((first, node) => {
    if (!first) return node;
    const order = vertical ? node.y - first.y || node.x - first.x : node.x - first.x || node.y - first.y;
    return order < 0 ? node : first;
  }, undefined);
  const viewport = useGraphViewport(layout.width || 1, layout.height || 1, entry ?? { x: 0, y: 0 }, expanded);
  const [active, setActive] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLayoutEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.showModal();
    return () => { document.body.style.overflow = previous; };
  }, [expanded]);
  const close = () => {
    setExpanded(false);
    setActive(null);
    requestAnimationFrame(() => expandButton.current?.focus());
  };

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
  const shown = viewport.panning ? undefined : layout.nodes.find((n) => n.key === active);
  const trace = traceGraph(shown?.key ?? null, layout.edges);
  const relation = (key: string) => key === shown?.key ? 'selected' : trace.upstream.nodes.has(key) ? 'upstream' : trace.downstream.nodes.has(key) ? 'downstream' : shown ? 'unrelated' : '';
  const edgeRelation = (key: string) => trace.upstream.paths.has(key) ? 'upstream' : trace.downstream.paths.has(key) ? 'downstream' : shown ? 'unrelated' : '';

  const connections = layout.edges.map((edge) => ({ ...edge, tone: edgeRelation(`${edge.blocker}>${edge.blocked}`) }));
  const highlighted = (tone: string) => tone === 'upstream' || tone === 'downstream';
  connections.sort((a, b) => Number(highlighted(a.tone)) - Number(highlighted(b.tone)));

  const content = (
    <div ref={workspace} className="gf-graph-workspace">
      <div className="gf-graph-tools" role="group" aria-label="graph view">
        <button type="button" className="gf-btn" aria-label="zoom out" disabled={viewport.view.scale <= viewport.minScale} onClick={() => viewport.zoom(viewport.view.scale / 1.25)}>−</button>
        <button type="button" className="gf-btn gf-graph-scale" aria-label="reset graph to 100%" title="Reset to 100%" onClick={viewport.reset}>{Math.round(viewport.view.scale * 100)}%</button>
        <button type="button" className="gf-btn" aria-label="zoom in" disabled={viewport.view.scale >= 2} onClick={() => viewport.zoom(viewport.view.scale * 1.25)}>+</button>
        <button type="button" className="gf-btn" onClick={viewport.fit}>fit</button>
        <button ref={expanded ? undefined : expandButton} type="button" className="gf-btn gf-graph-expand" onClick={(event) => { if (expanded) close(); else { restingHeight.current = event.currentTarget.closest('.gf-graph-workspace')!.getBoundingClientRect().height; setActive(null); setExpanded(true); } }}>{expanded ? 'close' : 'expand'}</button>
      </div>
      <div ref={viewport.ref} className={`gf-graph${viewport.panning ? ' is-panning' : ''}`} data-testid="graph" style={expanded ? undefined : { height: Math.min(440, Math.max(200, layout.height + 32)) }}>
      <svg width="100%" height="100%" aria-label="dependency graph" tabIndex={0} {...viewport.svgProps}>
        <defs>
          {['base', 'upstream', 'downstream', 'unrelated'].map((tone) => <marker key={tone} id={`${markerId}-${tone}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto" markerUnits="userSpaceOnUse"><path className={`gf-graph-arrow is-${tone}`} d="M 1 1 L 7 4 L 1 7" /></marker>)}
        </defs>
        <g className="gf-graph-edges">
          {connections.map((e) => {
            const tone = e.tone;
            return <path key={`${e.blocker}>${e.blocked}`} className={`gf-graph-edge${e.open ? ' is-open' : ''}${tone ? ` is-${tone}` : ''}`} d={e.path} markerEnd={`url(#${markerId}-${tone || 'base'})`} data-testid={`edge-${e.blocker}-${e.blocked}`} />;
          })}
        </g>
        {layout.nodes.map((n) => (
          <Node key={n.key} node={n} relation={relation(n.key)} onEnter={() => linger(n.key)} onLeave={() => show(null)} onFocus={(keyboard) => { if (keyboard) viewport.focus(n); show(n.key); }} />
        ))}
      </svg>
      </div>
      <div className="gf-graph-inspect">
        {shown ? <Popover node={shown} upstream={trace.upstream.nodes.size} downstream={trace.downstream.nodes.size} /> : <p className="gf-graph-help">Hover a ticket to trace its paths. Tab explores; click opens the ticket.</p>}
      </div>
      <div className="gf-graph-trace-key"><span className="is-upstream">prerequisites</span><span className="is-downstream">downstream</span></div>
      <p className="gf-graph-help">drag or scroll to pan · pinch or ctrl-scroll to zoom</p>
      <p className="gf-graph-legend" data-testid="graph-legend">
        {legendFor(layout.edges.length).replace('left to right', vertical ? 'top to bottom' : 'left to right')}
      </p>
    </div>
  );
  return expanded ? <><div aria-hidden="true" style={{ height: restingHeight.current }} />{createPortal(
    <dialog ref={dialog} className="gf-graph-expanded" aria-label="dependency graph" onCancel={(event) => { event.preventDefault(); close(); }} onKeyDown={(event) => event.stopPropagation()}>
      <div className="gf-graph-heading">graph <span>{graphSubtitle(graph)}</span></div>
      {content}
    </dialog>, document.body,
  )}</> : content;
}

/**
 * The whole marker opens its ticket. Hover and keyboard focus trace it.
 * Layout reserves the hit area.
 */
function Node({ node, relation, onEnter, onLeave, onFocus }: { node: LaidNode; relation: string; onEnter: () => void; onLeave: () => void; onFocus: (keyboard: boolean) => void }) {
  // a ticket outside this project is context, not subject: mute, with no status treatment at all
  const tone = node.external ? 'mute' : statusTone(node.status);
  const marks = `${node.external ? ' is-external' : ''}${isBlocked(node) ? ' is-blocked' : ''}`;
  return (
    <g transform={`translate(${node.x} ${node.y})`}>
      <Link
        className={`gf-graph-node is-${tone}${marks}${relation ? ` is-${relation}` : ''}`}
        to={ticketPath(node)}
        tabIndex={0}
        aria-label={`${node.key} ${node.title}`}
        data-testid={`node-${node.key}`}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onFocus={(event) => onFocus(event.currentTarget.matches(':focus-visible'))}
        onBlur={onLeave}
      >
        <rect className="gf-graph-hit" width={node.width} height={NODE_H} />
        <path className="gf-graph-diamond" transform={`translate(7 ${LABEL_TOP})`} d={SHAPE} />
        <text className="gf-graph-key" x={KEY_X} y={KEY_Y}>
          {node.key}
        </text>

      </Link>
    </g>
  );
}

/** Stable detail area: full titles never obscure the dependency lines. */
function Popover({ node, upstream, downstream }: { node: LaidNode; upstream: number; downstream: number }) {
  return (
    <div className="gf-graph-pop" role="status" data-testid="graph-popover">
      <span className="gf-graph-pop-head">
        <span className="gf-key">{node.key}</span>
        <StatusChip status={node.status} />
      </span>
      <Link className="gf-graph-pop-title" to={ticketPath(node)}>{node.title}</Link>
      <span className="gf-graph-pop-line">{plural(upstream, 'prerequisite')} · {plural(downstream, 'downstream ticket')}</span>
      {isBlocked(node) && <span className="gf-graph-pop-line">blocked by {node.blocked_by.join(', ')}</span>}
      {node.description_line !== '' && <span className="gf-graph-pop-line">{node.description_line}</span>}
      {node.external && <span className="gf-graph-pop-line">{homeLine(node.external.app, node.external.project)}</span>}
    </div>
  );
}
