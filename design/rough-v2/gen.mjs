import { writeFileSync } from 'node:fs';

const attention = [
  { kind: 'approve',   id: 'SR-12', title: 'Article list screen: e-ink pagination', meta: 'draft · design r3 · lane L3', key: 'a' },
  { kind: 're-arm',    id: 'SR-7',  title: 'Room migration v2',                      meta: 'verify failed twice, same failure · $3.80 spent', key: 'r' },
  { kind: 'answer',    id: 'SR-3',  title: 'OPML import',                            meta: 'the run asked: keep folder hierarchy?', key: '⏎' },
  { kind: 'review',    id: 'SR-5',  title: 'Feed parser core (pure Kotlin)',         meta: 'PR #14 · CI green · lane L3 · +412 −38', key: '⏎' },
  { kind: 'reconcile', id: 'SR-5',  title: 'proposes PROJECT-DESIGN.md r4',          meta: 'sha 9f3c1a · accept or reject', key: '⏎' },
];
const frontier = [
  { id: 'SR-9',  title: 'Feed fixture parser tests',  state: 'ready',   note: 'L4 · next to claim' },
  { id: 'SR-10', title: 'Boox refresh-mode hook',     state: 'ready',   note: 'L3' },
  { id: 'SR-8',  title: 'Reader typography settings', state: 'running', note: 'run 31 · heartbeat 4s' },
  { id: 'SR-11', title: 'Offline sync worker',        state: 'blocked', note: 'by SR-7' },
  { id: 'SR-13', title: 'Feed subscribe screen',      state: 'draft',   note: 'no design yet' },
];
const run = { id: 'SR-8', title: 'Reader typography settings', sandbox: 'fly-3', cost: 1.42, cap: 5, min: 6.2, mcap: 14, turns: 38, tcap: 80, phase: 'verifying (fast)' };
const hot = k => k === 're-arm' || k === 'answer';

const T = {
  night: { bg: '#14111C', tile: '#1A1624', tile2: '#211C2E', line: '#2C2640', ink: '#EAE5F2', mute: '#8E86A4', green: '#A9F07C', torch: '#FFA45E', teal: '#7EE0D2', lilac: '#BBA9FF', pink: '#FF9AC4', gglow: 'rgba(169,240,124,.35)', tglow: 'rgba(255,164,94,.45)', bar: '#0F0D16' },
  day:   { bg: '#E9E6F0', tile: '#F8F6FC', tile2: '#F0EDF6', line: '#D3CDE0', ink: '#1F1930', mute: '#6A6380', green: '#2F7F22', torch: '#C9591A', teal: '#127A70', lilac: '#6A55C8', pink: '#C2417A', gglow: 'rgba(47,127,34,.3)', tglow: 'rgba(201,89,26,.4)', bar: '#DDD8E8' },
};

const css = t => `
  .g { background: ${t.bg}; color: ${t.ink}; font-family: 'Recursive', ui-monospace, monospace; font-variation-settings: 'MONO' 0, 'CASL' 0.35, 'wght' 420; font-size: 13.5px; position: relative; overflow: hidden; box-sizing: border-box; display: grid; grid-template-rows: 34px 1fr; }
  .g .mono { font-variation-settings: 'MONO' 1, 'CASL' 0, 'wght' 400; }
  .g .bar { background: ${t.bar}; display: flex; align-items: center; gap: 18px; padding: 0 14px; font-size: 12px; font-variation-settings: 'MONO' 1, 'CASL' 0, 'wght' 450; color: ${t.mute}; }
  .g .ws { display: flex; gap: 4px; }
  .g .ws span { padding: 2px 9px; border-radius: 6px; }
  .g .ws span.on { background: ${t.green}; color: ${t.bar}; font-variation-settings: 'MONO' 1, 'wght' 650; }
  .g .bar .mid { margin-left: auto; margin-right: auto; color: ${t.ink}; }
  .g .bar .cts { display: flex; gap: 14px; }
  .g .bar .cts b { color: ${t.ink}; font-variation-settings: 'MONO' 1, 'wght' 650; margin-right: 3px; }
  .g .bar .cts .hot b { color: ${t.torch}; }
  .g .bar .mini { display: flex; align-items: center; gap: 6px; }
  .g .bar .mini i { width: 60px; height: 5px; background: ${t.line}; border-radius: 3px; position: relative; overflow: hidden; }
  .g .bar .mini i:after { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 28%; background: ${t.torch}; }
  .g .desk { padding: 10px; display: grid; gap: 10px; min-height: 0; }
  .g .tile { background: ${t.tile}; border: 2px solid ${t.line}; border-radius: 10px; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
  .g .tile.focus { border-color: ${t.green}; box-shadow: 0 0 0 1px ${t.green}, 0 0 22px ${t.gglow}; }
  .g .tile.hotb { border-color: ${t.torch}; }
  .g .th { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px solid ${t.line}; font-size: 12px; font-variation-settings: 'MONO' 1, 'CASL' 0, 'wght' 500; color: ${t.mute}; background: ${t.tile2}; }
  .g .th b { color: ${t.ink}; font-variation-settings: 'MONO' 1, 'wght' 650; }
  .g .th .dot { width: 8px; height: 8px; border-radius: 50%; background: ${t.mute}; }
  .g .tile.focus .th .dot { background: ${t.green}; box-shadow: 0 0 8px ${t.gglow}; }
  .g .tile.hotb .th .dot { background: ${t.torch}; animation: breathe 1.8s ease-in-out infinite; }
  @keyframes breathe { 50% { box-shadow: 0 0 12px ${t.tglow}; } }
  .g .th .keys { margin-left: auto; display: flex; gap: 6px; }
  .g kbd { font-family: inherit; font-variation-settings: 'MONO' 1, 'wght' 500; font-size: 11px; color: ${t.mute}; border: 1px solid ${t.line}; border-radius: 4px; padding: 0 5px; line-height: 16px; background: ${t.tile}; }
  .g .body { padding: 6px 12px 10px; overflow: hidden; flex: 1; display: flex; flex-direction: column; }
  .g .row { display: grid; grid-template-columns: 78px 1fr auto; gap: 12px; align-items: center; padding: 9px 8px; border-radius: 8px; margin: 0 -8px; }
  .g .row.sel { background: ${t.tile2}; outline: 1px solid ${t.line}; }
  .g .row .kind { font-size: 11.5px; font-variation-settings: 'MONO' 1, 'wght' 600; color: ${t.teal}; letter-spacing: .02em; }
  .g .row.hot .kind { color: ${t.torch}; }
  .g .row .t { font-variation-settings: 'MONO' 0, 'CASL' 0.4, 'wght' 560; font-size: 14px; line-height: 1.25; }
  .g .row .t span { font-variation-settings: 'MONO' 1, 'wght' 450; color: ${t.mute}; font-size: 11.5px; margin-right: 6px; }
  .g .row .t em { display: block; font-style: normal; color: ${t.mute}; font-size: 12px; font-variation-settings: 'MONO' 0, 'CASL' 0.6, 'wght' 400; }
  .g .fr { display: grid; grid-template-columns: 16px 56px 1fr auto; gap: 10px; align-items: center; padding: 7px 8px; margin: 0 -8px; border-radius: 8px; }
  .g .fr .id { font-variation-settings: 'MONO' 1; font-size: 11.5px; color: ${t.mute}; }
  .g .fr .t { font-variation-settings: 'CASL' 0.4, 'wght' 520; }
  .g .fr .n { font-size: 11.5px; color: ${t.mute}; font-variation-settings: 'MONO' 1; }
  .g .fr i { width: 9px; height: 9px; border-radius: 3px; background: ${t.green}; transform: rotate(45deg); }
  .g .fr.running i { background: ${t.torch}; box-shadow: 0 0 8px ${t.tglow}; border-radius: 50%; transform: none; }
  .g .fr.blocked i { background: transparent; border: 1.5px solid ${t.mute}; box-sizing: border-box; } .g .fr.blocked .t { color: ${t.mute}; text-decoration: line-through; text-decoration-color: ${t.line}; }
  .g .fr.draft i { background: ${t.lilac}; opacity: .7; } .g .fr.draft .t { color: ${t.mute}; }
  .g .grab { color: ${t.line}; font-size: 14px; letter-spacing: -2px; cursor: grab; }
  .g svg text { font-family: 'Recursive'; font-variation-settings: 'CASL' 0.4, 'wght' 520; font-size: 12px; fill: ${t.ink}; }
  .g svg text.id { font-variation-settings: 'MONO' 1, 'wght' 400; font-size: 10px; fill: ${t.mute}; }
  .g svg .e { fill: none; stroke: ${t.teal}; stroke-width: 1.5; opacity: .55; } .g svg .e.dead { stroke: ${t.mute}; stroke-dasharray: 4 4; opacity: .45; }
  .g svg .nd { fill: ${t.tile}; stroke: ${t.green}; stroke-width: 2; }
  .g svg .nd.done { fill: ${t.green}; } .g svg .nd.draft { stroke: ${t.lilac}; stroke-dasharray: 3 3; } .g svg .nd.blocked { stroke: ${t.mute}; }
  .g svg .nd.human { stroke: ${t.torch}; } .g svg .nd.review { stroke: ${t.teal}; fill: ${t.teal}; }
  .g svg .nd.running { stroke: ${t.torch}; fill: ${t.torch}; animation: pulse 1.8s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { filter: drop-shadow(0 0 4px ${t.tglow}); } 50% { filter: drop-shadow(0 0 16px ${t.tglow}); } }
  .g .meter { display: grid; grid-template-columns: 52px 1fr 78px; gap: 10px; align-items: center; font-variation-settings: 'MONO' 1; font-size: 11.5px; color: ${t.mute}; margin: 4px 0; }
  .g .meter div { height: 6px; border-radius: 3px; background: ${t.line}; overflow: hidden; } .g .meter div i { display: block; height: 100%; background: ${t.torch}; border-radius: 3px; }
  .g .meter b { color: ${t.ink}; font-variation-settings: 'MONO' 1, 'wght' 600; text-align: right; }
  .g .log { font-variation-settings: 'MONO' 1; font-size: 11.5px; color: ${t.mute}; line-height: 1.6; margin-top: 6px; }
  .g .log div { animation: fade .5s ease-out both; } .g .log div:nth-child(2) { animation-delay: .15s; } .g .log div:nth-child(3) { animation-delay: .3s; } .g .log div:nth-child(4) { animation-delay: .45s; } .g .log div:nth-child(5) { animation-delay: .6s; }
  @keyframes fade { from { opacity: 0; transform: translateY(4px); } }
  .g .log b { color: ${t.green}; font-variation-settings: 'MONO' 1, 'wght' 500; } .g .log i { color: ${t.torch}; font-style: normal; } .g .log .cur { display: inline-block; width: 7px; height: 12px; background: ${t.green}; vertical-align: -2px; animation: blink 1s steps(1) infinite; }
  @keyframes blink { 50% { opacity: 0; } }
  .g .field { display: grid; grid-template-columns: 96px 1fr; gap: 10px; padding: 7px 0; border-bottom: 1px solid ${t.line}; align-items: baseline; }
  .g .field span { color: ${t.mute}; font-variation-settings: 'MONO' 1; font-size: 11.5px; }
  .g .chip { display: inline-block; border: 1px solid ${t.line}; border-radius: 6px; padding: 1px 8px; font-size: 12px; margin-right: 6px; background: ${t.tile2}; }
  .g .chip.lilac { color: ${t.lilac}; border-color: ${t.lilac}; } .g .chip.green { color: ${t.green}; border-color: ${t.green}; }
  .g h1 { font-variation-settings: 'CASL' 0.6, 'wght' 620; font-size: 20px; margin: 2px 0 8px; line-height: 1.2; }
  .g .ac { padding: 6px 0 2px 18px; margin: 0; line-height: 1.5; font-variation-settings: 'CASL' 0.5, 'wght' 420; }
  .g .hint { margin-top: auto; padding-top: 8px; color: ${t.mute}; font-size: 11.5px; font-variation-settings: 'MONO' 1; display: flex; gap: 12px; }
  .g .empty { color: ${t.mute}; font-variation-settings: 'CASL' 0.7, 'wght' 400; padding: 8px 0; }
`;

const fonts = 'family=Recursive:CASL,MONO,wght@0..1,0..1,300..800';
const head = c => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fonts}&display=swap">
  <style>
    body { margin: 0; }
    a { color: inherit; } a:hover { color: inherit; }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
    ${c}
  </style>
</helmet>`;
const foot = `</x-dc>
</body>
</html>`;

const bar = t => `<div class="bar">
  <div class="ws"><span class="on">1 home</span><span>2 tickets</span><span>3 design</span><span>4 runs</span><span>5 evidence</span></div>
  <span class="mid">subway-reader / mvp · design r3 @4b7e2d</span>
  <div class="cts">${[['draft', 3], ['ready', 2], ['running', 1], ['needs you', 2], ['review', 1]].map(([k, n]) => `<span class="${k === 'needs you' ? 'hot' : ''}"><b>${n}</b>${k}</span>`).join('')}</div>
  <span class="mini">run 31 <i></i> $${run.cost}</span>
  <span>tue 09:41</span>
</div>`;

const tile = (title, keys, body, cls = '') => `<div class="tile ${cls}"><div class="th"><i class="dot"></i><b>${title}</b>${keys ? `<span class="keys">${keys.map(k => `<kbd>${k}</kbd>`).join('')}</span>` : ''}</div><div class="body">${body}</div></div>`;

const attBody = (sel = 0) => attention.map((x, i) => `<div class="row ${hot(x.kind) ? 'hot' : ''} ${i === sel ? 'sel' : ''}"><span class="kind">${x.kind}</span><div class="t"><span>${x.id}</span>${x.title}<em>${x.meta}</em></div><kbd>${x.key}</kbd></div>`).join('') + `<div class="hint"><span>j/k move</span><span>⏎ open</span><span>a approve</span><span>r re-arm</span><span>⌘k anything</span></div>`;
const frBody = () => frontier.map(x => `<div class="fr ${x.state}"><span class="grab">⋮⋮</span><span class="id">${x.id}</span><span class="t">${x.title}</span><span class="n">${x.note}</span></div>`).join('') + `<div class="hint"><span>drag to reorder claim order</span><span>s set status</span><span>n new ticket</span></div>`;

const N = [
  ['SR-1', 'Core module', 60, 60, 'done'], ['SR-2', 'Feed fetch', 200, 30, 'done'], ['SR-4', 'Fixtures', 200, 110, 'done'],
  ['SR-5', 'Parser core', 340, 70, 'review'], ['SR-3', 'OPML import', 340, 170, 'human'], ['SR-7', 'Room migration v2', 160, 210, 'human'],
  ['SR-9', 'Fixture tests', 490, 30, 'ready'], ['SR-8', 'Typography', 490, 120, 'running'], ['SR-10', 'Refresh hook', 490, 210, 'ready'],
  ['SR-11', 'Offline sync', 330, 270, 'blocked'], ['SR-12', 'Article list', 640, 160, 'human'], ['SR-13', 'Subscribe screen', 640, 260, 'draft'],
];
const E = [[0,1],[0,2],[1,3],[2,3],[2,4],[0,5],[3,6],[3,7],[3,8],[5,9],[7,10],[8,10],[10,11]];
const graph = (w, h, sx = 1, sy = 1) => {
  const p = i => ({ x: N[i][2] * sx, y: N[i][3] * sy });
  const es = E.map(([a, b]) => { const P = p(a), Q = p(b); const dead = ['human', 'blocked'].includes(N[a][4]); return `<path class="e ${dead ? 'dead' : ''}" d="M${P.x} ${P.y} C ${P.x + 60} ${P.y}, ${Q.x - 60} ${Q.y}, ${Q.x} ${Q.y}"/>`; }).join('');
  const ns = N.map(([id, l, x, y, s]) => `<g><circle class="nd ${s}" cx="${x * sx}" cy="${y * sy}" r="${s === 'running' ? 9 : 7}"/><text class="id" x="${x * sx + 13}" y="${y * sy - 3}">${id}</text><text x="${x * sx + 13}" y="${y * sy + 10}">${l}</text></g>`).join('');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="margin: 6px 0 0 -4px; max-width: 100%;">${es}${ns}</svg>`;
};
const graphBody = (w, h, sx, sy) => graph(w, h, sx, sy) + `<div class="hint"><span>edges = depends on</span><span>dashed = source can't proceed</span><span>click a node to open</span></div>`;

const runBody = () => `
  <div class="meter"><span>spend</span><div><i style="width: 28%;"></i></div><b>$${run.cost} / ${run.cap}</b></div>
  <div class="meter"><span>time</span><div><i style="width: 44%;"></i></div><b>06:12 / 14:00</b></div>
  <div class="meter"><span>turns</span><div><i style="width: 47%;"></i></div><b>${run.turns} / ${run.tcap}</b></div>
  <div class="log"><div>06:08 verify(fast) exit 1 · 2 tests failed</div><div>06:09 <b>correct_same_session</b> 1 of 2</div><div>06:11 edit core/Typography.kt</div><div>06:12 verify(fast) <i>running</i> <span class="cur"></span></div><div>protected digests ok · scope ok · ${run.sandbox} · heartbeat 4s</div></div>`;

const detailBody = () => `
  <h1>Article list screen: e-ink pagination</h1>
  <div class="field"><span>status</span><div><span class="chip lilac">draft</span><kbd>s</kbd> → ready when approved</div></div>
  <div class="field"><span>lane</span><div><span class="chip">L3 · read the full diff</span></div></div>
  <div class="field"><span>design</span><div><span class="chip green">r3 · approved</span>PROJECT-DESIGN.md @4b7e2d</div></div>
  <div class="field"><span>depends on</span><div><span class="chip">SR-5 parser core</span><span class="chip">SR-8 typography</span></div></div>
  <div class="field"><span>scope</span><div class="mono" style="font-size: 12px;">app/src/main/…/reader/list/** · core/src/…/paging/**</div></div>
  <div class="field"><span>acceptance</span><div><ol class="ac"><li>List paginates with a full-page refresh, no partial redraws on Boox.</li><li>Unread count matches core module fixture 07.</li><li>Screenshot of first and last page attached as evidence.</li></ol></div></div>
  <div class="field"><span>budget</span><div>$5 · 14 min · 80 turns (repo defaults)</div></div>
  <div class="hint"><span>a approve → ready</span><span>e edit</span><span>d deps</span><span>esc back</span></div>`;

/* laptop 1440×900 */
const laptop = mode => { const t = T[mode]; return head(css(t) + `.g { width: 1440px; height: 900px; } .g .desk { grid-template-columns: 1.15fr 1fr; grid-template-rows: 1.05fr 1fr; }`) + `
<div class="g">${bar(t)}
  <div class="desk">
    ${tile('waiting on you · 5', ['⌘1'], attBody(), 'focus')}
    ${tile('frontier · what grows from what', ['⌘2'], graphBody(700, 300, 1, 1))}
    ${tile('claim order', ['⌘3'], frBody())}
    ${tile('run 31 · SR-8 · ' + run.phase, ['⌘4'], runBody(), 'hotb')}
  </div>
</div>` + foot; };

/* wide 2560×1440 */
const wide = mode => { const t = T[mode]; return head(css(t) + `.g { width: 2560px; height: 1440px; font-size: 15px; } .g .desk { grid-template-columns: 1fr 1.25fr 1fr; grid-template-rows: 1.1fr 1fr; gap: 12px; } .g .row .t { font-size: 15.5px; } .g .row .t em { font-size: 13px; } .g svg text { font-size: 13.5px; } .g svg text.id { font-size: 11px; } .g .bar { height: 38px; font-size: 13px; } .g h1 { font-size: 24px; }`) + `
<div class="g">${bar(t)}
  <div class="desk">
    ${tile('waiting on you · 5', ['⌘1'], attBody(), '')}
    ${tile('frontier · what grows from what', ['⌘2'], graphBody(1000, 440, 1.4, 1.45))}
    ${tile('SR-12 · ticket', ['⌘5', 'esc'], detailBody(), 'focus')}
    ${tile('claim order', ['⌘3'], frBody())}
    ${tile('run 31 · SR-8 · ' + run.phase, ['⌘4'], runBody(), 'hotb')}
    ${tile('planning · SR-12', ['⌘6'], `<div class="empty">Conversation with the planner lives here once /grill-me runs against this ticket — questions, assumptions, deferred decisions, all attached to design r3.</div><div class="hint"><span>p start planning</span></div>`)}
  </div>
</div>` + foot; };

writeFileSync('Main.dc.html', laptop('night'));
writeFileSync('LaptopDay.dc.html', laptop('day'));
writeFileSync('WideNight.dc.html', wide('night'));
writeFileSync('WideDay.dc.html', wide('day'));

writeFileSync('canvas.json', JSON.stringify({
  artboards: [
    { file: 'Main.dc.html', x: 0, y: 0, w: 1440, h: 900, title: 'Tiling · night · 14" laptop' },
    { file: 'LaptopDay.dc.html', x: 1540, y: 0, w: 1440, h: 900, title: 'Tiling · day · 14" laptop' },
    { file: 'WideNight.dc.html', x: 0, y: 1100, w: 2560, h: 1440, title: 'Tiling · night · 32" (ticket open)' },
    { file: 'WideDay.dc.html', x: 0, y: 2740, w: 2560, h: 1440, title: 'Tiling · day · 32" (ticket open)' },
  ],
  annotations: [
    { id: 'brief3', x: 3080, y: 0, w: 520, text: 'ROUND 3 — "tech goblins". Bio × HUD, restyled as a tiling window manager: a status bar with workspaces, tiles with gaps, a focused-tile border, keyboard hints in every title bar. No characters.\n\nWarm on purpose: plum, spore green, torch, teal — pastel-bright, never neon. One typeface (Recursive) that slides between mono for data and a casual sans for titles.\n\nOn 32" more tiles open: the ticket detail and planning tile appear beside the graph, the way a WM fills a wider screen.' },
    { id: 'motion3', x: 3080, y: 320, w: 520, text: 'Motion: focused border glow, the running node breathes, log lines fade in, a blinking cursor in the run tile. All off under reduced-motion.\n\nManipulation (Linear-like): j/k + enter, drag handles on claim order, s to set status, n new ticket, ⌘K for everything.' },
  ],
  launch: { view: 'canvas' },
}, null, 2));
console.log('ok');
