import { writeFileSync } from 'node:fs';

const attention = [
  { kind: 'Approve',   id: 'SR-12', title: 'Article list screen: e-ink pagination', meta: 'draft · design r3 · lane L3' },
  { kind: 'Re-arm',    id: 'SR-7',  title: 'Room migration v2',                      meta: 'verify failed twice with the same failure · $3.80 spent' },
  { kind: 'Answer',    id: 'SR-3',  title: 'OPML import',                            meta: 'run asked: keep folder hierarchy?' },
  { kind: 'Review',    id: 'SR-5',  title: 'Feed parser core (pure Kotlin)',         meta: 'PR #14 · CI passing · lane L3 · +412 −38' },
  { kind: 'Reconcile', id: 'SR-5',  title: 'proposes PROJECT-DESIGN.md r4',          meta: 'sha 9f3c1a · accept or reject' },
];
const frontier = [
  { id: 'SR-9',  title: 'Feed fixture parser tests',  state: 'ready',   note: 'L4' },
  { id: 'SR-10', title: 'Boox refresh-mode hook',     state: 'ready',   note: 'L3' },
  { id: 'SR-8',  title: 'Reader typography settings', state: 'running', note: 'run 31' },
  { id: 'SR-11', title: 'Offline sync worker',        state: 'blocked', note: 'by SR-7' },
  { id: 'SR-13', title: 'Feed subscribe screen',      state: 'draft',   note: 'no design' },
];
const counts = [['draft', 3], ['ready', 2], ['running', 1], ['needs you', 2], ['review', 1], ['done', 4]];
const run = { id: 'SR-8', title: 'Reader typography settings', sandbox: 'fly-3', hb: 'heartbeat 4s', cost: '1.42', cap: '5.00', time: '06:12', tcap: '14:00', turns: '38', turncap: '80', phase: 'verifying (fast)' };
const hot = k => k === 'Re-arm' || k === 'Answer';

const head = (fonts, css) => `<!doctype html>
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
    ${css}
  </style>
</helmet>`;
const foot = `</x-dc>
</body>
</html>`;

/* ============ A · RISO ZINE ============ */
function riso(mode) {
  const t = mode === 'day'
    ? { paper: '#F1ECDF', ink: '#141414', pink: '#FF3FA8', blue: '#1A4FE6', green: '#00A65A', mute: '#4E4A44', grain: 'rgba(0,0,0,.06)' }
    : { paper: '#121212', ink: '#EFE9DA', pink: '#FF5DBA', blue: '#6C95FF', green: '#3BE38A', mute: '#B5AE9E', grain: 'rgba(255,255,255,.05)' };
  const css = `
  .z { width: 1280px; height: 800px; background: ${t.paper}; color: ${t.ink}; font-family: 'Space Mono', monospace; font-size: 13px; position: relative; overflow: hidden; box-sizing: border-box;
       background-image: radial-gradient(${t.grain} 1px, transparent 1.2px); background-size: 4px 4px; }
  .z .head { position: absolute; left: 40px; top: 28px; }
  .z .head h1 { font-family: 'Syne', sans-serif; font-weight: 800; font-size: 84px; line-height: .86; letter-spacing: -.04em; margin: 0; text-transform: uppercase; position: relative; }
  .z .head h1:before { content: attr(data-t); position: absolute; left: 4px; top: 3px; color: ${t.pink}; z-index: -1; }
  .z .head h1 i { font-family: 'Instrument Serif', serif; font-style: italic; font-weight: 400; text-transform: none; letter-spacing: 0; }
  .z .tape { position: absolute; right: -60px; top: 54px; background: ${t.blue}; color: ${t.paper}; font-family: 'Syne'; font-weight: 800; font-size: 15px; letter-spacing: .12em; text-transform: uppercase; padding: 8px 90px; transform: rotate(8deg); box-shadow: 4px 4px 0 ${t.pink}; }
  .z .cmd { position: absolute; left: 40px; top: 214px; font-size: 12px; color: ${t.mute}; }
  .z .cmd b { font-weight: 400; border: 1.5px solid ${t.ink}; padding: 2px 7px; margin-right: 8px; }
  .z .list { position: absolute; left: 40px; top: 262px; width: 680px; }
  .z .row { display: grid; grid-template-columns: 40px 118px 1fr; gap: 14px; align-items: start; padding: 11px 0; border-top: 2px solid ${t.ink}; }
  .z .row .n { font-family: 'Syne'; font-weight: 800; font-size: 26px; line-height: 1; }
  .z .stamp { font-family: 'Syne'; font-weight: 800; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; border: 2.5px solid ${t.blue}; color: ${t.blue}; padding: 4px 6px; text-align: center; transform: rotate(-3deg); border-radius: 3px; display: inline-block; }
  .z .stamp.hot { border-color: ${t.pink}; color: ${t.pink}; transform: rotate(2deg); }
  .z .stamp.ok { border-color: ${t.green}; color: ${t.green}; }
  .z .row .t { font-family: 'Syne'; font-weight: 700; font-size: 16px; line-height: 1.2; }
  .z .row .t em { font-family: 'Instrument Serif'; font-style: italic; font-weight: 400; font-size: 17px; color: ${t.mute}; display: block; margin-top: 2px; }
  .z .row .id { color: ${t.mute}; font-size: 11px; }
  .z .col { position: absolute; left: 780px; top: 262px; width: 460px; }
  .z .col h2 { font-family: 'Syne'; font-weight: 800; font-size: 22px; text-transform: uppercase; letter-spacing: -.02em; margin: 0 0 6px; display: flex; justify-content: space-between; align-items: baseline; }
  .z .col h2 small { font-family: 'Space Mono'; font-weight: 400; font-size: 11px; color: ${t.mute}; letter-spacing: 0; text-transform: none; }
  .z .fr { display: grid; grid-template-columns: 52px 1fr auto; gap: 10px; padding: 8px 0; border-top: 1.5px dashed ${t.ink}; align-items: center; }
  .z .fr .id { font-size: 11px; color: ${t.mute}; }
  .z .fr .t { font-family: 'Syne'; font-weight: 700; font-size: 14px; }
  .z .fr.running .t { background: ${t.pink}; color: ${t.paper}; padding: 1px 6px; }
  .z .fr.blocked { opacity: .5; text-decoration: line-through; }
  .z .fr.draft .t { font-weight: 400; font-style: italic; font-family: 'Instrument Serif'; font-size: 16px; }
  .z .runblk { position: absolute; left: 780px; top: 600px; width: 460px; height: 160px; background: ${t.ink}; color: ${t.paper}; padding: 16px 18px; box-sizing: border-box; }
  .z .runblk h2 { font-family: 'Syne'; font-weight: 800; font-size: 20px; margin: 0 0 8px; text-transform: uppercase; }
  .z .runblk h2 span { color: ${t.pink}; }
  .z .bar { height: 14px; margin: 6px 0; background-image: radial-gradient(${t.pink} 2px, transparent 2.4px); background-size: 8px 8px; position: relative; }
  .z .bar i { position: absolute; right: 0; top: 0; bottom: 0; background: ${t.ink}; }
  .z .bar b { position: absolute; left: 0; top: -13px; font-weight: 400; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; }
  .z .counts { position: absolute; left: 40px; bottom: 26px; display: flex; gap: 22px; font-size: 11px; text-transform: uppercase; letter-spacing: .12em; }
  .z .counts b { font-family: 'Syne'; font-weight: 800; font-size: 22px; display: block; letter-spacing: -.03em; }
  .z .counts .hot b { color: ${t.pink}; }
  `;
  const att = attention.map((x, i) => `
    <div class="row"><span class="n">${i + 1}</span><span class="stamp ${hot(x.kind) ? 'hot' : x.kind === 'Review' ? 'ok' : ''}">${x.kind}</span>
      <div class="t"><span class="id">${x.id}</span> ${x.title}<em>${x.meta}</em></div></div>`).join('');
  const fr = frontier.map(x => `<div class="fr ${x.state}"><span class="id">${x.id}</span><span class="t">${x.title}</span><span class="id">${x.state === 'running' ? run.hb : x.note}</span></div>`).join('');
  return head('family=Syne:wght@700;800&family=Instrument+Serif:ital@1&family=Space+Mono', css) + `
<div class="z">
  <div class="head"><h1 data-t="Waiting on you">Waiting <i>on</i> you</h1></div>
  <div class="tape">Subway Reader · MVP · design r3</div>
  <div class="cmd"><b>⌘K</b>approve · re-arm · open · new ticket &nbsp;&nbsp; <b>1–5</b>jump</div>
  <div class="list">${att}</div>
  <div class="col"><h2>Frontier <small>claim order</small></h2>${fr}</div>
  <div class="runblk">
    <h2>Now pouring <span>${run.id}</span></h2>
    <div class="bar"><b>$${run.cost} of ${run.cap}</b><i style="width: 72%;"></i></div>
    <div class="bar"><b>${run.time} of ${run.tcap} · ${run.turns} turns</b><i style="width: 56%;"></i></div>
    <div style="font-size: 11px; margin-top: 10px; color: ${t.paper}; opacity: .8;">${run.sandbox} · ${run.hb} · ${run.phase}</div>
  </div>
  <div class="counts">${counts.map(([k, n]) => `<span class="${k === 'needs you' ? 'hot' : ''}"><b>${n}</b>${k}</span>`).join('')}</div>
</div>` + foot;
}

/* ============ B · BIOLUMINESCENT ============ */
function bio(mode) {
  const t = mode === 'night'
    ? { bg: '#100C16', bg2: '#17121F', ink: '#EDE6F3', mute: '#8E84A0', green: '#A6FF5E', teal: '#5CE6CC', torch: '#FF9A3C', line: '#2A2338', glow: 'rgba(166,255,94,.45)', tglow: 'rgba(255,154,60,.5)' }
    : { bg: '#E9EFE1', bg2: '#F3F6EC', ink: '#17201A', mute: '#5E6A5C', green: '#2E7D2A', teal: '#157A6E', torch: '#D2601B', line: '#CBD5C0', glow: 'rgba(46,125,42,.35)', tglow: 'rgba(210,96,27,.45)' };
  const css = `
  .o { width: 1280px; height: 800px; background: radial-gradient(1100px 700px at 30% 40%, ${t.bg2}, ${t.bg}); color: ${t.ink}; font-family: 'Manrope', system-ui, sans-serif; font-size: 13.5px; position: relative; overflow: hidden; display: grid; grid-template-columns: 1fr 420px; box-sizing: border-box; }
  .o .graph { position: relative; padding: 30px 36px; }
  .o h1 { font-family: 'Bodoni Moda', serif; font-style: italic; font-weight: 400; font-size: 44px; margin: 0; letter-spacing: -.01em; line-height: 1; }
  .o h1 span { font-style: normal; font-family: 'Manrope'; font-size: 13px; color: ${t.mute}; letter-spacing: .1em; text-transform: uppercase; display: block; margin-bottom: 8px; }
  .o svg text { font-family: 'Manrope'; font-size: 12.5px; fill: ${t.ink}; font-weight: 600; }
  .o svg text.id { font-family: 'DM Mono', monospace; font-size: 10.5px; fill: ${t.mute}; font-weight: 400; }
  .o svg .edge { fill: none; stroke: ${t.teal}; stroke-width: 1.5; opacity: .55; }
  .o svg .edge.dead { stroke: ${t.mute}; stroke-dasharray: 4 4; opacity: .5; }
  .o svg .node { fill: ${t.bg2}; stroke: ${t.green}; stroke-width: 2; }
  .o svg .node.done { fill: ${t.green}; stroke: ${t.green}; }
  .o svg .node.draft { stroke: ${t.mute}; stroke-dasharray: 3 3; }
  .o svg .node.blocked { stroke: ${t.mute}; }
  .o svg .node.human { stroke: ${t.torch}; filter: drop-shadow(0 0 8px ${t.tglow}); }
  .o svg .node.running { stroke: ${t.torch}; fill: ${t.torch}; animation: pulse 1.8s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { filter: drop-shadow(0 0 6px ${t.tglow}); } 50% { filter: drop-shadow(0 0 22px ${t.tglow}); } }
  .o svg .halo { fill: none; stroke: ${t.green}; stroke-width: 1; opacity: .35; }
  .o .legend { position: absolute; left: 36px; bottom: 26px; display: flex; gap: 18px; font-size: 11px; color: ${t.mute}; letter-spacing: .06em; text-transform: uppercase; }
  .o .legend i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; vertical-align: -1px; border: 1.5px solid ${t.green}; }
  .o .side { border-left: 1px solid ${t.line}; padding: 30px 28px; display: flex; flex-direction: column; gap: 6px; background: ${t.bg}; }
  .o h2 { font-family: 'Bodoni Moda', serif; font-style: italic; font-weight: 400; font-size: 26px; margin: 0 0 6px; display: flex; justify-content: space-between; align-items: baseline; }
  .o h2 small { font-family: 'DM Mono'; font-style: normal; font-size: 11px; color: ${t.mute}; }
  .o .it { display: grid; grid-template-columns: 14px 1fr auto; gap: 12px; align-items: start; padding: 10px 0; border-top: 1px solid ${t.line}; }
  .o .it i { width: 8px; height: 8px; border-radius: 50%; margin-top: 6px; background: ${t.green}; box-shadow: 0 0 10px ${t.glow}; }
  .o .it.hot i { background: ${t.torch}; box-shadow: 0 0 12px ${t.tglow}; }
  .o .it b { display: block; font-weight: 700; font-size: 14px; }
  .o .it b span { font-family: 'DM Mono'; font-weight: 400; font-size: 11px; color: ${t.mute}; margin-right: 6px; }
  .o .it em { font-style: normal; color: ${t.mute}; font-size: 12.5px; }
  .o .it kbd { font-family: 'DM Mono'; font-size: 11px; color: ${t.mute}; border: 1px solid ${t.line}; border-radius: 999px; padding: 1px 8px; }
  .o .kind { font-family: 'DM Mono'; font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: ${t.teal}; }
  .o .it.hot .kind { color: ${t.torch}; }
  .o .runc { margin-top: auto; border: 1px solid ${t.torch}; border-radius: 16px; padding: 14px 16px; box-shadow: 0 0 30px ${t.tglow} inset; }
  .o .runc h3 { margin: 0 0 8px; font-family: 'Bodoni Moda'; font-style: italic; font-weight: 400; font-size: 20px; }
  .o .m { display: grid; grid-template-columns: 62px 1fr auto; gap: 10px; align-items: center; font-family: 'DM Mono'; font-size: 11px; color: ${t.mute}; margin: 5px 0; }
  .o .m div { height: 4px; background: ${t.line}; border-radius: 2px; } .o .m div i { display: block; height: 100%; border-radius: 2px; background: ${t.torch}; box-shadow: 0 0 8px ${t.tglow}; }
  `;
  // graph nodes
  const N = [
    ['SR-1', 'Core module', 120, 150, 'done'], ['SR-2', 'Feed fetch', 300, 110, 'done'], ['SR-4', 'Fixtures', 300, 220, 'done'],
    ['SR-5', 'Parser core', 470, 165, 'review'], ['SR-3', 'OPML import', 470, 300, 'human'], ['SR-7', 'Room migration v2', 250, 360, 'human'],
    ['SR-9', 'Fixture tests', 650, 120, 'ready'], ['SR-8', 'Typography', 650, 250, 'running'], ['SR-10', 'Refresh hook', 650, 380, 'ready'],
    ['SR-11', 'Offline sync', 450, 450, 'blocked'], ['SR-12', 'Article list', 800, 320, 'human'], ['SR-13', 'Subscribe screen', 800, 460, 'draft'],
  ];
  const E = [[0,1],[0,2],[1,3],[2,3],[2,4],[0,5],[3,6],[3,7],[3,8],[5,9],[7,10],[8,10],[10,11]];
  const pos = i => ({ x: N[i][2], y: N[i][3] });
  const edges = E.map(([a, b]) => { const p = pos(a), q = pos(b); const dead = N[a][4] === 'human' || N[a][4] === 'blocked'; return `<path class="edge ${dead ? 'dead' : ''}" d="M${p.x} ${p.y} C ${p.x + 70} ${p.y}, ${q.x - 70} ${q.y}, ${q.x} ${q.y}"/>`; }).join('');
  const nodes = N.map(([id, l, x, y, s]) => `<g><circle class="halo" cx="${x}" cy="${y}" r="${s === 'running' ? 26 : 18}"/><circle class="node ${s}" cx="${x}" cy="${y}" r="${s === 'running' ? 12 : 9}"/><text class="id" x="${x + 16}" y="${y - 4}">${id}</text><text x="${x + 16}" y="${y + 11}">${l}</text></g>`).join('');
  const att = attention.map((x, i) => `<div class="it ${hot(x.kind) ? 'hot' : ''}"><i></i><div><span class="kind">${x.kind}</span><b><span>${x.id}</span>${x.title}</b><em>${x.meta}</em></div><kbd>${i + 1}</kbd></div>`).join('');
  return head('family=Bodoni+Moda:ital,wght@1,400&family=Manrope:wght@400;600;700&family=DM+Mono', css) + `
<div class="o">
  <div class="graph">
    <h1><span>Subway Reader · MVP · design r3</span>What grows from what</h1>
    <svg width="880" height="520" viewBox="0 0 880 520" style="margin-top: 10px;">${edges}${nodes}</svg>
    <div class="legend"><span><i></i>ready</span><span><i style="background: ${t.green};"></i>done</span><span><i style="border-color: ${t.torch}; background: ${t.torch};"></i>running</span><span><i style="border-color: ${t.torch};"></i>needs you</span><span><i style="border-style: dashed; border-color: ${t.mute};"></i>draft</span><span>edges are dependencies · dashed when the source can't proceed</span></div>
  </div>
  <div class="side">
    <h2>Waiting on you <small>5 · ⌘K</small></h2>
    ${att}
    <div class="runc"><h3>${run.id} is growing</h3>
      <div class="m"><span>spend</span><div><i style="width: 28%;"></i></div><span>$${run.cost}/${run.cap}</span></div>
      <div class="m"><span>time</span><div><i style="width: 44%;"></i></div><span>${run.time}/${run.tcap}</span></div>
      <div class="m"><span>turns</span><div><i style="width: 47%;"></i></div><span>${run.turns}/${run.turncap}</span></div>
      <div class="m" style="margin-top: 8px;"><span>${run.sandbox}</span><span style="color: ${t.ink};">${run.phase}</span><span>${run.hb}</span></div>
    </div>
  </div>
</div>` + foot;
}

/* ============ C · BLACKLETTER FOUNDRY ============ */
function black(mode) {
  const t = mode === 'night'
    ? { bg: '#18121F', steel: '#231B2C', ink: '#F2EADB', mute: '#9C92AA', torch: '#FF8A2A', acid: '#CCFF3A', line: '#F2EADB' }
    : { bg: '#E8E5E0', steel: '#F3F1EC', ink: '#17131C', mute: '#5E5768', torch: '#D9651A', acid: '#4A8A00', line: '#17131C' };
  const css = `
  .k { width: 1280px; height: 800px; background: ${t.bg}; color: ${t.ink}; font-family: 'Archivo', system-ui, sans-serif; font-size: 13px; position: relative; overflow: hidden; display: grid; grid-template-rows: 150px 1fr 40px; box-sizing: border-box; }
  .k .mast { border-bottom: 4px solid ${t.line}; display: grid; grid-template-columns: 330px 1fr; }
  .k .mast h1 { font-family: 'UnifrakturMaguntia', serif; font-weight: 400; font-size: 58px; margin: 0; padding: 26px 28px 0; line-height: .95; border-right: 4px solid ${t.line}; }
  .k .mast h1 small { display: block; font-family: 'Archivo'; font-size: 11px; letter-spacing: .18em; text-transform: uppercase; color: ${t.mute}; margin-top: 8px; }
  .k .nums { display: grid; grid-template-columns: repeat(6, minmax(0,1fr)); }
  .k .nums div { border-right: 2px solid ${t.line}; padding: 14px 18px 0; display: flex; flex-direction: column; justify-content: space-between; }
  .k .nums div:last-child { border-right: 0; }
  .k .nums b { font-family: 'Bebas Neue', sans-serif; font-weight: 400; font-size: 104px; line-height: .82; letter-spacing: -.02em; }
  .k .nums span { font-size: 11px; letter-spacing: .16em; text-transform: uppercase; padding-bottom: 12px; }
  .k .nums .hot b { color: ${t.torch}; } .k .nums .run b { color: ${t.acid}; -webkit-text-stroke: 1.5px ${t.ink}; }
  .k .main { display: grid; grid-template-columns: 330px 1fr 380px; min-height: 0; }
  .k .side { border-right: 4px solid ${t.line}; padding: 20px 28px; display: flex; flex-direction: column; gap: 10px; }
  .k .side h2, .k .att h2, .k .fr h2 { font-family: 'UnifrakturMaguntia'; font-weight: 400; font-size: 30px; margin: 0 0 4px; }
  .k .side p { margin: 0; line-height: 1.45; }
  .k .side .rev { border: 2px solid ${t.line}; padding: 10px 12px; font-family: 'JetBrains Mono', monospace; font-size: 11.5px; line-height: 1.5; }
  .k .side .rev b { display: block; font-family: 'Bebas Neue'; font-size: 24px; letter-spacing: .02em; font-weight: 400; }
  .k .att { padding: 20px 28px; border-right: 4px solid ${t.line}; display: flex; flex-direction: column; }
  .k .row { display: grid; grid-template-columns: 56px 100px 1fr; gap: 14px; align-items: center; padding: 10px 0; border-bottom: 2px solid ${t.line}; position: relative; }
  .k .row .n { font-family: 'Bebas Neue'; font-size: 40px; line-height: 1; }
  .k .row .kind { font-family: 'Bebas Neue'; font-size: 18px; letter-spacing: .06em; color: ${t.mute}; }
  .k .row.hot { background: repeating-linear-gradient(-45deg, transparent 0 14px, ${t.torch} 14px 16px); background-size: 100% 6px; background-repeat: no-repeat; background-position: bottom; }
  .k .row.hot .kind { color: ${t.torch}; }
  .k .row .t { font-weight: 700; font-size: 15px; }
  .k .row .t em { display: block; font-style: normal; font-weight: 400; color: ${t.mute}; font-size: 12px; }
  .k .row .id { font-family: 'JetBrains Mono'; font-size: 11px; color: ${t.mute}; }
  .k .fr { padding: 20px 28px; }
  .k .fl { display: grid; grid-template-columns: 30px 60px 1fr; gap: 10px; align-items: center; padding: 8px 0; border-bottom: 1.5px solid ${t.line}; }
  .k .fl .n { font-family: 'Bebas Neue'; font-size: 22px; color: ${t.mute}; }
  .k .fl .id { font-family: 'JetBrains Mono'; font-size: 11px; color: ${t.mute}; }
  .k .fl .t { font-weight: 600; font-size: 14px; }
  .k .fl .t small { font-weight: 400; color: ${t.mute}; margin-left: 6px; font-size: 11px; }
  .k .fl.running .t { color: ${t.acid}; } .k .fl.blocked { opacity: .5; } .k .fl.draft .t { font-weight: 400; font-style: italic; }
  .k .ticker { border-top: 4px solid ${t.line}; background: ${t.ink}; color: ${t.bg}; overflow: hidden; display: flex; align-items: center; font-family: 'JetBrains Mono'; font-size: 12px; white-space: nowrap; }
  .k .ticker span { display: inline-block; padding-left: 100%; animation: tick 28s linear infinite; }
  .k .ticker b { color: ${t.acid}; font-weight: 400; } .k .ticker i { color: ${t.torch}; font-style: normal; }
  @keyframes tick { to { transform: translateX(-100%); } }
  `;
  const att = attention.map((x, i) => `<div class="row ${hot(x.kind) ? 'hot' : ''}"><span class="n">${i + 1}</span><span class="kind">${x.kind}</span><div class="t"><span class="id">${x.id}</span> ${x.title}<em>${x.meta}</em></div></div>`).join('');
  const fr = frontier.map((x, i) => `<div class="fl ${x.state}"><span class="n">${i + 1}</span><span class="id">${x.id}</span><span class="t">${x.title}<small>${x.state === 'running' ? run.hb : x.state + ' · ' + x.note}</small></span></div>`).join('');
  return head('family=UnifrakturMaguntia&family=Bebas+Neue&family=Archivo:wght@400;600;700&family=JetBrains+Mono', css) + `
<div class="k">
  <div class="mast">
    <h1>Goblin Foundry<small>Subway Reader · MVP</small></h1>
    <div class="nums">${counts.map(([k, n]) => `<div class="${k === 'needs you' ? 'hot' : k === 'running' ? 'run' : ''}"><b>${n}</b><span>${k}</span></div>`).join('')}</div>
  </div>
  <div class="main">
    <div class="side">
      <h2>The Run</h2>
      <p><b>${run.id}</b> ${run.title}</p>
      <div class="rev"><b>$${run.cost} <span style="color: ${t.mute}; font-size: 14px;">/ ${run.cap}</span></b>${run.time} of ${run.tcap} · ${run.turns} of ${run.turncap} turns<br>${run.sandbox} · ${run.hb}<br>${run.phase}</div>
      <h2 style="margin-top: 14px;">Design</h2>
      <div class="rev"><b>r3 · approved</b>PROJECT-DESIGN.md<br>sha 4b7e2d · used by runs 27–31<br><span style="color: ${t.torch};">r4 proposed by SR-5 →</span></div>
      <p style="margin-top: auto; color: ${t.mute}; font-family: 'JetBrains Mono'; font-size: 11px;">⌘K · 1–5 jump · a approve · r re-arm</p>
    </div>
    <div class="att"><h2>Waiting on you</h2>${att}</div>
    <div class="fr"><h2>Frontier</h2>${fr}</div>
  </div>
  <div class="ticker"><span>06:08 verify(fast) exit 1 · 2 tests &nbsp;·&nbsp; 06:09 <b>correct_same_session</b> 1 of 2 &nbsp;·&nbsp; 06:11 edit core/Typography.kt &nbsp;·&nbsp; 06:12 verify(fast) running &nbsp;·&nbsp; protected digests ok · scope ok &nbsp;·&nbsp; <i>SR-7 needs you: same failure twice</i> &nbsp;·&nbsp; PR #14 CI green</span></div>
</div>` + foot;
}

/* ============ D · HUD ============ */
function hud(mode) {
  const t = mode === 'night'
    ? { bg: '#05070B', pan: '#0B1119', ink: '#D9E7EC', mute: '#6F8592', cyan: '#3AF0FF', mag: '#FF2D86', line: '#1C2A36', cglow: 'rgba(58,240,255,.35)', mglow: 'rgba(255,45,134,.4)' }
    : { bg: '#E4EBEE', pan: '#F1F5F7', ink: '#0E1A21', mute: '#4E626D', cyan: '#00707F', mag: '#B8105B', line: '#B9C8D0', cglow: 'rgba(0,112,127,.25)', mglow: 'rgba(184,16,91,.3)' };
  const cut = 'polygon(14px 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%, 0 14px)';
  const css = `
  .h { width: 1280px; height: 800px; background: ${t.bg}; color: ${t.ink}; font-family: 'Chakra Petch', sans-serif; font-size: 13px; position: relative; overflow: hidden; box-sizing: border-box; padding: 18px 22px; display: grid; grid-template-rows: 56px 1fr; gap: 14px;
       background-image: linear-gradient(${t.line} 1px, transparent 1px), linear-gradient(90deg, ${t.line} 1px, transparent 1px); background-size: 40px 40px; }
  .h .top { display: flex; align-items: center; gap: 24px; border-bottom: 1px solid ${t.cyan}; padding-bottom: 10px; }
  .h .top h1 { font-weight: 700; font-size: 26px; margin: 0; letter-spacing: .04em; text-transform: uppercase; }
  .h .top h1 b { color: ${t.cyan}; }
  .h .top .st { font-family: 'Share Tech Mono', monospace; font-size: 12px; color: ${t.mute}; letter-spacing: .08em; }
  .h .top .st b { color: ${t.ink}; font-weight: 400; }
  .h .top .cts { margin-left: auto; display: flex; gap: 16px; font-family: 'Share Tech Mono'; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: ${t.mute}; }
  .h .top .cts b { color: ${t.ink}; font-size: 18px; font-weight: 400; margin-right: 4px; } .h .top .cts .hot b { color: ${t.mag}; }
  .h .grid { display: grid; grid-template-columns: 1.35fr 1fr 0.95fr; gap: 14px; min-height: 0; }
  .h .pan { background: ${t.pan}; clip-path: ${cut}; padding: 14px 16px; position: relative; display: flex; flex-direction: column; gap: 6px; }
  .h .pan:before { content: ''; position: absolute; inset: 0; border: 1px solid ${t.line}; clip-path: ${cut}; pointer-events: none; }
  .h .pan.hot:before { border-color: ${t.mag}; }
  .h .pan.run:before { border-color: ${t.cyan}; }
  .h .hd { font-family: 'Share Tech Mono'; font-size: 11px; letter-spacing: .16em; text-transform: uppercase; color: ${t.cyan}; display: flex; justify-content: space-between; margin-bottom: 4px; }
  .h .hd span { color: ${t.mute}; }
  .h .pan.hot .hd { color: ${t.mag}; }
  .h .r { display: grid; grid-template-columns: 34px 92px 1fr; gap: 10px; align-items: center; padding: 8px 0; border-top: 1px solid ${t.line}; }
  .h .r .n { font-family: 'Share Tech Mono'; color: ${t.mute}; font-size: 12px; }
  .h .r .n:before { content: '['; } .h .r .n:after { content: ']'; }
  .h .r .kind { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; font-weight: 700; color: ${t.cyan}; }
  .h .r.hot .kind { color: ${t.mag}; text-shadow: 0 0 10px ${t.mglow}; }
  .h .r .t { font-weight: 600; font-size: 14px; }
  .h .r .t em { display: block; font-style: normal; font-weight: 400; font-size: 11.5px; color: ${t.mute}; font-family: 'Share Tech Mono'; }
  .h .r .id { font-family: 'Share Tech Mono'; color: ${t.mute}; font-size: 11px; margin-right: 6px; }
  .h .f { display: grid; grid-template-columns: 58px 1fr auto; gap: 10px; align-items: center; padding: 8px 0; border-top: 1px solid ${t.line}; }
  .h .f .id { font-family: 'Share Tech Mono'; color: ${t.mute}; font-size: 11px; }
  .h .f .t { font-weight: 600; }
  .h .f .s { font-family: 'Share Tech Mono'; font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: ${t.cyan}; }
  .h .f.running .s { color: ${t.mag}; } .h .f.blocked, .h .f.draft { opacity: .55; } .h .f.blocked .s, .h .f.draft .s { color: ${t.mute}; }
  .h .big { font-family: 'Share Tech Mono'; font-size: 46px; line-height: 1; color: ${t.ink}; letter-spacing: -.02em; }
  .h .big small { font-size: 14px; color: ${t.mute}; letter-spacing: .1em; }
  .h .g { height: 10px; background: ${t.line}; position: relative; margin: 6px 0 12px; }
  .h .g i { position: absolute; left: 0; top: 0; bottom: 0; background: ${t.cyan}; box-shadow: 0 0 12px ${t.cglow}; }
  .h .g i.m { background: ${t.mag}; box-shadow: 0 0 12px ${t.mglow}; }
  .h .g b { position: absolute; right: 0; top: -15px; font-family: 'Share Tech Mono'; font-size: 11px; font-weight: 400; color: ${t.mute}; }
  .h .scan { position: absolute; left: 0; right: 0; height: 40px; background: linear-gradient(transparent, ${t.cglow}, transparent); animation: scan 2.6s linear infinite; pointer-events: none; }
  @keyframes scan { from { top: -40px; } to { top: 100%; } }
  .h .ev { font-family: 'Share Tech Mono'; font-size: 11.5px; color: ${t.mute}; line-height: 1.55; }
  .h .ev b { color: ${t.cyan}; font-weight: 400; } .h .ev i { color: ${t.mag}; font-style: normal; }
  `;
  const att = attention.map((x, i) => `<div class="r ${hot(x.kind) ? 'hot' : ''}"><span class="n">${i + 1}</span><span class="kind">${x.kind}</span><div class="t"><span class="id">${x.id}</span>${x.title}<em>${x.meta}</em></div></div>`).join('');
  const fr = frontier.map(x => `<div class="f ${x.state}"><span class="id">${x.id}</span><span class="t">${x.title}</span><span class="s">${x.state === 'running' ? run.hb : x.state + ' ' + x.note}</span></div>`).join('');
  return head('family=Chakra+Petch:wght@400;600;700&family=Share+Tech+Mono', css) + `
<div class="h">
  <div class="top"><h1>Goblin <b>Foundry</b></h1><span class="st">APP <b>SUBWAY READER</b> · PROJECT <b>MVP</b> · DESIGN <b>R3</b> @4B7E2D</span>
    <div class="cts">${counts.map(([k, n]) => `<span class="${k === 'needs you' ? 'hot' : ''}"><b>${n}</b>${k}</span>`).join('')}</div></div>
  <div class="grid">
    <div class="pan hot"><div class="hd">Waiting on you <span>5 · oldest first · ⌘K</span></div>${att}</div>
    <div class="pan"><div class="hd">Frontier <span>claim order</span></div>${fr}</div>
    <div class="pan run"><div class="scan"></div><div class="hd">Run 31 · ${run.id} <span>${run.sandbox}</span></div>
      <div class="big">$${run.cost}<small> / ${run.cap}</small></div><div class="g"><i style="width: 28%;"></i><b>SPEND</b></div>
      <div class="big">${run.time}<small> / ${run.tcap}</small></div><div class="g"><i style="width: 44%;"></i><b>WALL</b></div>
      <div class="big">${run.turns}<small> / ${run.turncap} TURNS</small></div><div class="g"><i class="m" style="width: 47%;"></i><b>TURNS</b></div>
      <div class="hd" style="margin-top: 6px;">Events <span>${run.phase}</span></div>
      <div class="ev">06:08 verify(fast) exit 1 · 2 tests<br>06:09 <b>correct_same_session</b> 1/2<br>06:11 edit core/Typography.kt<br>06:12 verify(fast) <i>running</i><br>digests ok · scope ok · ${run.hb}</div>
    </div>
  </div>
</div>` + foot;
}

writeFileSync('Main.dc.html', riso('day'));
writeFileSync('RisoNight.dc.html', riso('night'));
writeFileSync('BioNight.dc.html', bio('night'));
writeFileSync('BioDay.dc.html', bio('day'));
writeFileSync('BlackletterNight.dc.html', black('night'));
writeFileSync('BlackletterDay.dc.html', black('day'));
writeFileSync('HudNight.dc.html', hud('night'));
writeFileSync('HudDay.dc.html', hud('day'));

const W = 1280, H = 800, GX = 100, GY = 200;
const row = (i, a, b) => [{ file: a, x: 0, y: i * (H + GY), w: W, h: H }, { file: b, x: W + GX, y: i * (H + GY), w: W, h: H }];
const NX = 2 * W + 2 * GX;
writeFileSync('canvas.json', JSON.stringify({
  artboards: [
    { file: 'Main.dc.html', x: 0, y: 0, w: W, h: H, title: 'Riso Zine · day' }, { file: 'RisoNight.dc.html', x: W + GX, y: 0, w: W, h: H, title: 'Riso Zine · night' },
    ...row(1, 'BioNight.dc.html', 'BioDay.dc.html'),
    ...row(2, 'BlackletterNight.dc.html', 'BlackletterDay.dc.html'),
    ...row(3, 'HudNight.dc.html', 'HudDay.dc.html'),
  ],
  annotations: [
    { id: 'brief2', x: NX, y: -140, w: 560, text: 'ROUND 2 — more punk. Same state as round 1 (5 decisions, 5 frontier tickets, 1 live run). No characters. Each direction carries one motion signature; reduced-motion disables it.\n\nRound 1 lives on page "Round 1". Notebook is held as a candidate for the design-doc view only.' },
    { id: 'riso-n', x: NX, y: 0, w: 360, text: 'RISO ZINE\nWhy: punk as in print — two fluorescent inks, misregistration, rubber stamps for decision kinds, a halftone budget bar. Serif italic against a brutal grotesk.\nMotion: stamps slam in; status changes = ink drying.\nTradeoff: needs restraint at 32" or it shouts.' },
    { id: 'bio-n', x: NX, y: H + GY, w: 360, text: 'BIOLUMINESCENT\nWhy: dependencies are the hero — the ready frontier IS the graph, and a run visibly pulses where it grows. Cave-plum from GoblinNight, spore green, torch.\nMotion: the running node breathes; edges light up as blockers clear.\nTradeoff: graphs get messy past ~40 tickets; needs a list mode too.' },
    { id: 'black-n', x: NX, y: 2 * (H + GY), w: 360, text: 'BLACKLETTER FOUNDRY\nWhy: a masthead, not a toolbar. Giant counts you read from across the room; hazard stripes where the human is needed; a live event ticker.\nMotion: ticker crawl; counts roll like a flipboard.\nTradeoff: blackletter must stay to headings only or legibility dies.' },
    { id: 'hud-n', x: NX, y: 3 * (H + GY), w: 360, text: 'HUD\nWhy: chamfered panels, bracketed ids, a scanline over the live run — cyberpunk done as an instrument, not a movie set.\nMotion: scan sweep on the run; values tick up.\nTradeoff: closest to a genre; ages fastest.' },
  ],
  launch: { view: 'canvas' },
}, null, 2));
console.log('ok');
