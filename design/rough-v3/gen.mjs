import { writeFileSync, readFileSync } from 'node:fs';

const attention = [
  { kind: 'APPROVE',   id: 'SR-12', title: 'Article list screen: e-ink pagination', meta: 'draft · design r3 · lane L3', key: 'A' },
  { kind: 'RE-ARM',    id: 'SR-7',  title: 'Room migration v2',                      meta: 'verify failed twice, same failure · $3.80 spent', key: 'R' },
  { kind: 'ANSWER',    id: 'SR-3',  title: 'OPML import',                            meta: 'the run asked: keep folder hierarchy?', key: '⏎' },
  { kind: 'REVIEW',    id: 'SR-5',  title: 'Feed parser core (pure Kotlin)',         meta: 'PR #14 · CI green · lane L3 · +412 −38', key: '⏎' },
  { kind: 'RECONCILE', id: 'SR-5',  title: 'proposes PROJECT-DESIGN.md r4',          meta: 'sha 9f3c1a · accept or reject', key: '⏎' },
];
const frontier = [
  { id: 'SR-9',  title: 'Feed fixture parser tests',  state: 'ready',   note: 'L4 · NEXT' },
  { id: 'SR-10', title: 'Boox refresh-mode hook',     state: 'ready',   note: 'L3' },
  { id: 'SR-8',  title: 'Reader typography settings', state: 'running', note: 'RUN 31 · HB 4S' },
  { id: 'SR-11', title: 'Offline sync worker',        state: 'blocked', note: 'BY SR-7' },
  { id: 'SR-13', title: 'Feed subscribe screen',      state: 'draft',   note: 'NO DESIGN' },
];
const hot = k => k === 'RE-ARM' || k === 'ANSWER';

const T = {
  night: { bg: '#06080D', pan: '#0B1019', pan2: '#101724', ink: '#DCE8EE', mute: '#6F8391', cyan: '#3AF0FF', mag: '#FF2D86', amber: '#FFC14D', line: '#1B2736', line2: '#2A3A4D', cglow: 'rgba(58,240,255,.35)', mglow: 'rgba(255,45,134,.45)', grid: 'rgba(58,240,255,.05)' },
  day:   { bg: '#E2E9ED', pan: '#F2F6F8', pan2: '#E8EEF2', ink: '#0C161D', mute: '#4C606B', cyan: '#006E7F', mag: '#B50D57', amber: '#8A5A00', line: '#B5C4CD', line2: '#93A6B2', cglow: 'rgba(0,110,127,.25)', mglow: 'rgba(181,13,87,.3)', grid: 'rgba(0,110,127,.07)' },
};
const F = {
  chakra:  { link: 'family=Chakra+Petch:wght@400;600;700&family=Share+Tech+Mono', ui: "'Chakra Petch', sans-serif", mono: "'Share Tech Mono', monospace", w: 600, big: 700 },
  martian: { link: 'family=Martian+Mono:wght@300;400;600;800', ui: "'Martian Mono', monospace", mono: "'Martian Mono', monospace", w: 600, big: 800 },
};
const cut = 'polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px)';

const css = (t, f) => `
  .h { background: ${t.bg}; color: ${t.ink}; font-family: ${f.ui}; font-size: 13px; position: relative; overflow: hidden; box-sizing: border-box; display: grid; grid-template-rows: 32px 1fr;
       background-image: linear-gradient(${t.grid} 1px, transparent 1px), linear-gradient(90deg, ${t.grid} 1px, transparent 1px); background-size: 40px 40px; }
  .h .m { font-family: ${f.mono}; }
  .h .bar { display: flex; align-items: center; gap: 20px; padding: 0 14px; font-family: ${f.mono}; font-size: 11.5px; letter-spacing: .1em; text-transform: uppercase; color: ${t.mute}; border-bottom: 1px solid ${t.cyan}; background: ${t.pan}; }
  .h .ws { display: flex; gap: 2px; }
  .h .ws span { padding: 3px 10px; border: 1px solid transparent; }
  .h .ws span.on { border-color: ${t.cyan}; color: ${t.cyan}; box-shadow: 0 0 10px ${t.cglow} inset; }
  .h .bar .mid { margin-left: auto; margin-right: auto; color: ${t.ink}; }
  .h .bar .cts { display: flex; gap: 14px; }
  .h .bar .cts b { color: ${t.ink}; font-weight: 400; font-size: 15px; margin-right: 4px; } .h .bar .cts .hot b { color: ${t.mag}; text-shadow: 0 0 8px ${t.mglow}; }
  .h .bar .mini { display: flex; align-items: center; gap: 6px; } .h .bar .mini i { width: 64px; height: 4px; background: ${t.line}; position: relative; } .h .bar .mini i:after { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 28%; background: ${t.mag}; box-shadow: 0 0 6px ${t.mglow}; }
  .h .desk { padding: 12px; display: grid; gap: 12px; min-height: 0; }
  .h .tile { background: ${t.pan}; clip-path: ${cut}; position: relative; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
  .h .tile:before { content: ''; position: absolute; inset: 0; border: 1px solid ${t.line2}; clip-path: ${cut}; pointer-events: none; }
  .h .tile.focus:before { border-color: ${t.cyan}; box-shadow: 0 0 0 1px ${t.cyan} inset, 0 0 30px ${t.cglow} inset; }
  .h .tile.hotb:before { border-color: ${t.mag}; box-shadow: 0 0 24px ${t.mglow} inset; }
  .h .tile .c { position: absolute; width: 10px; height: 10px; border: 2px solid ${t.cyan}; pointer-events: none; }
  .h .tile .c.tr { right: 0; top: 0; border-left: 0; border-bottom: 0; } .h .tile .c.bl { left: 0; bottom: 0; border-right: 0; border-top: 0; }
  .h .tile.hotb .c { border-color: ${t.mag}; }
  .h .th { display: flex; align-items: center; gap: 10px; padding: 8px 14px 7px 18px; border-bottom: 1px solid ${t.line}; font-family: ${f.mono}; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: ${t.cyan}; }
  .h .th span.s { color: ${t.mute}; }
  .h .tile.hotb .th { color: ${t.mag}; }
  .h .th .keys { margin-left: auto; display: flex; gap: 6px; }
  .h kbd { font-family: ${f.mono}; font-size: 10.5px; color: ${t.mute}; border: 1px solid ${t.line2}; padding: 0 5px; line-height: 15px; letter-spacing: .05em; }
  .h .body { padding: 6px 14px 10px 18px; overflow: hidden; flex: 1; display: flex; flex-direction: column; }
  .h .row { display: grid; grid-template-columns: 30px 88px 1fr auto; gap: 10px; align-items: center; padding: 8px 8px; margin: 0 -8px; border-bottom: 1px solid ${t.line}; }
  .h .row.sel { background: ${t.pan2}; box-shadow: inset 3px 0 0 ${t.cyan}; }
  .h .row .n { font-family: ${f.mono}; color: ${t.mute}; font-size: 11.5px; } .h .row .n:before { content: '['; } .h .row .n:after { content: ']'; }
  .h .row .kind { font-family: ${f.mono}; font-size: 10.5px; letter-spacing: .12em; color: ${t.cyan}; }
  .h .row.hot .kind { color: ${t.mag}; text-shadow: 0 0 10px ${t.mglow}; }
  .h .row .t { font-weight: ${f.w}; font-size: 13.5px; line-height: 1.25; }
  .h .row .t span { font-family: ${f.mono}; font-weight: 400; color: ${t.mute}; font-size: 11px; margin-right: 8px; }
  .h .row .t em { display: block; font-style: normal; font-weight: 400; color: ${t.mute}; font-size: 11.5px; font-family: ${f.mono}; margin-top: 2px; }
  .h .fr { display: grid; grid-template-columns: 14px 58px 1fr auto; gap: 10px; align-items: center; padding: 7px 8px; margin: 0 -8px; border-bottom: 1px solid ${t.line}; }
  .h .fr .id { font-family: ${f.mono}; font-size: 11px; color: ${t.mute}; }
  .h .fr .t { font-weight: ${f.w}; font-size: 13px; }
  .h .fr .s { font-family: ${f.mono}; font-size: 10.5px; letter-spacing: .1em; color: ${t.cyan}; }
  .h .fr i { width: 8px; height: 8px; background: ${t.cyan}; box-shadow: 0 0 8px ${t.cglow}; }
  .h .fr.running i, .h .fr.running .s { background: ${t.mag}; color: ${t.mag}; box-shadow: 0 0 8px ${t.mglow}; } .h .fr.running .s { background: none; }
  .h .fr.blocked i { background: none; border: 1px solid ${t.mute}; box-sizing: border-box; box-shadow: none; } .h .fr.blocked .t, .h .fr.blocked .s { color: ${t.mute}; }
  .h .fr.draft i { background: ${t.amber}; box-shadow: none; } .h .fr.draft .t { color: ${t.mute}; } .h .fr.draft .s { color: ${t.amber}; }
  .h .grab { color: ${t.line2}; font-family: ${f.mono}; font-size: 12px; }
  .h svg text { font-family: ${f.ui}; font-weight: ${f.w}; font-size: 11.5px; fill: ${t.ink}; }
  .h svg text.id { font-family: ${f.mono}; font-weight: 400; font-size: 9.5px; fill: ${t.mute}; letter-spacing: .08em; }
  .h svg .e { fill: none; stroke: ${t.cyan}; stroke-width: 1; opacity: .5; } .h svg .e.dead { stroke: ${t.mute}; stroke-dasharray: 3 4; opacity: .5; }
  .h svg .nd { fill: ${t.pan}; stroke: ${t.cyan}; stroke-width: 1.5; }
  .h svg .nd.done { fill: ${t.cyan}; } .h svg .nd.draft { stroke: ${t.amber}; stroke-dasharray: 2 3; } .h svg .nd.blocked { stroke: ${t.mute}; }
  .h svg .nd.human { stroke: ${t.mag}; } .h svg .nd.review { stroke: ${t.cyan}; fill: ${t.pan2}; stroke-width: 3; }
  .h svg .nd.running { stroke: ${t.mag}; fill: ${t.mag}; animation: pulse 1.6s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { filter: drop-shadow(0 0 3px ${t.mglow}); } 50% { filter: drop-shadow(0 0 14px ${t.mglow}); } }
  .h .big { font-family: ${f.mono}; font-size: 38px; line-height: 1; letter-spacing: -.02em; margin-top: 6px; } .h .big small { font-size: 12px; color: ${t.mute}; letter-spacing: .1em; }
  .h .g { height: 8px; background: ${t.line}; position: relative; margin: 6px 0 10px; } .h .g i { position: absolute; left: 0; top: 0; bottom: 0; background: ${t.cyan}; box-shadow: 0 0 10px ${t.cglow}; } .h .g i.m { background: ${t.mag}; box-shadow: 0 0 10px ${t.mglow}; }
  .h .g b { position: absolute; right: 0; top: -14px; font-family: ${f.mono}; font-size: 10px; font-weight: 400; color: ${t.mute}; letter-spacing: .1em; }
  .h .scan { position: absolute; left: 0; right: 0; height: 36px; background: linear-gradient(transparent, ${t.mglow}, transparent); animation: scan 2.8s linear infinite; pointer-events: none; }
  @keyframes scan { from { top: -36px; } to { top: 100%; } }
  .h .ev { font-family: ${f.mono}; font-size: 11px; color: ${t.mute}; line-height: 1.6; letter-spacing: .03em; } .h .ev b { color: ${t.cyan}; font-weight: 400; } .h .ev i { color: ${t.mag}; font-style: normal; }
  .h .ev .cur { display: inline-block; width: 7px; height: 11px; background: ${t.mag}; vertical-align: -1px; animation: blink 1s steps(1) infinite; } @keyframes blink { 50% { opacity: 0; } }
  .h .hint { margin-top: auto; padding-top: 8px; color: ${t.mute}; font-size: 10.5px; font-family: ${f.mono}; letter-spacing: .08em; text-transform: uppercase; display: flex; gap: 14px; }
  .h .field { display: grid; grid-template-columns: 100px 1fr; gap: 10px; padding: 7px 0; border-bottom: 1px solid ${t.line}; align-items: baseline; }
  .h .field span.l { color: ${t.mute}; font-family: ${f.mono}; font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; }
  .h .chip { display: inline-block; border: 1px solid ${t.line2}; padding: 1px 8px; font-family: ${f.mono}; font-size: 11px; margin-right: 6px; letter-spacing: .05em; }
  .h .chip.amber { color: ${t.amber}; border-color: ${t.amber}; } .h .chip.cyan { color: ${t.cyan}; border-color: ${t.cyan}; }
  .h h1 { font-weight: ${f.big}; font-size: 20px; margin: 4px 0 8px; line-height: 1.2; text-transform: uppercase; letter-spacing: .02em; }
  .h .ac { padding: 4px 0 0 18px; margin: 0; line-height: 1.5; }
  .h .empty { color: ${t.mute}; padding: 8px 0; line-height: 1.5; }
`;

const head = (f, c) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?${f.link}&display=swap">
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

const bar = () => `<div class="bar">
  <div class="ws"><span class="on">1 home</span><span>2 tickets</span><span>3 design</span><span>4 runs</span><span>5 evidence</span></div>
  <span class="mid">subway-reader / mvp · design r3 @4b7e2d</span>
  <div class="cts">${[['draft', 3], ['ready', 2], ['running', 1], ['needs you', 2], ['review', 1]].map(([k, n]) => `<span class="${k === 'needs you' ? 'hot' : ''}"><b>${n}</b>${k}</span>`).join('')}</div>
  <span class="mini">run 31 <i></i> $1.42</span><span>09:41</span>
</div>`;
const tile = (title, sub, keys, body, cls = '') => `<div class="tile ${cls}"><i class="c tr"></i><i class="c bl"></i><div class="th"><span>${title}</span>${sub ? `<span class="s">${sub}</span>` : ''}${keys ? `<span class="keys">${keys.map(k => `<kbd>${k}</kbd>`).join('')}</span>` : ''}</div><div class="body">${body}</div></div>`;

const attBody = () => attention.map((x, i) => `<div class="row ${hot(x.kind) ? 'hot' : ''} ${i === 0 ? 'sel' : ''}"><span class="n">${i + 1}</span><span class="kind">${x.kind}</span><div class="t"><span>${x.id}</span>${x.title}<em>${x.meta}</em></div><kbd>${x.key}</kbd></div>`).join('') + `<div class="hint"><span>J/K move</span><span>⏎ open</span><span>A approve</span><span>R re-arm</span><span>⌘K anything</span></div>`;
const frBody = () => frontier.map(x => `<div class="fr ${x.state}"><span class="grab">≡</span><span class="id">${x.id}</span><span class="t">${x.title}</span><span class="s">${x.note}</span></div>`).join('') + `<div class="hint"><span>drag = claim order</span><span>S status</span><span>N new ticket</span></div>`;

const N = [
  ['SR-1', 'Core module', 60, 60, 'done'], ['SR-2', 'Feed fetch', 200, 30, 'done'], ['SR-4', 'Fixtures', 200, 110, 'done'],
  ['SR-5', 'Parser core', 340, 70, 'review'], ['SR-3', 'OPML import', 340, 170, 'human'], ['SR-7', 'Room migration v2', 160, 210, 'human'],
  ['SR-9', 'Fixture tests', 490, 30, 'ready'], ['SR-8', 'Typography', 490, 120, 'running'], ['SR-10', 'Refresh hook', 490, 210, 'ready'],
  ['SR-11', 'Offline sync', 330, 270, 'blocked'], ['SR-12', 'Article list', 640, 160, 'human'], ['SR-13', 'Subscribe screen', 640, 260, 'draft'],
];
const E = [[0,1],[0,2],[1,3],[2,3],[2,4],[0,5],[3,6],[3,7],[3,8],[5,9],[7,10],[8,10],[10,11]];
const graph = (w, h, sx, sy) => {
  const p = i => ({ x: N[i][2] * sx, y: N[i][3] * sy });
  const es = E.map(([a, b]) => { const P = p(a), Q = p(b); const dead = ['human', 'blocked'].includes(N[a][4]); const mx = (P.x + Q.x) / 2; return `<path class="e ${dead ? 'dead' : ''}" d="M${P.x} ${P.y} L${mx} ${P.y} L${mx} ${Q.y} L${Q.x} ${Q.y}"/>`; }).join('');
  const ns = N.map(([id, l, x, y, s]) => { const r = s === 'running' ? 7 : 5.5; const X = x * sx, Y = y * sy; return `<g><rect class="nd ${s}" x="${X - r}" y="${Y - r}" width="${2 * r}" height="${2 * r}" transform="rotate(45 ${X} ${Y})"/><text class="id" x="${X + 13}" y="${Y - 3}">${id}</text><text x="${X + 13}" y="${Y + 10}">${l}</text></g>`; }).join('');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="margin-top: 6px; max-width: 100%;">${es}${ns}</svg><div class="hint"><span>edge = depends on</span><span>dashed = source can't proceed</span><span>click node = open</span></div>`;
};
const runBody = () => `<div class="scan"></div>
  <div class="big">$1.42<small> / 5.00</small></div><div class="g"><i style="width: 28%;"></i><b>SPEND</b></div>
  <div class="big">06:12<small> / 14:00</small></div><div class="g"><i style="width: 44%;"></i><b>WALL</b></div>
  <div class="big">38<small> / 80 TURNS</small></div><div class="g"><i class="m" style="width: 47%;"></i><b>TURNS</b></div>
  <div class="ev">06:08 verify(fast) exit 1 · 2 tests failed<br>06:09 <b>correct_same_session</b> 1/2<br>06:11 edit core/Typography.kt<br>06:12 verify(fast) <i>running</i> <span class="cur"></span><br>digests ok · scope ok · fly-3 · hb 4s</div>`;
const detailBody = () => `
  <h1>Article list screen: e-ink pagination</h1>
  <div class="field"><span class="l">status</span><div><span class="chip amber">DRAFT</span><kbd>S</kbd> → ready when approved</div></div>
  <div class="field"><span class="l">lane</span><div><span class="chip">L3 · read the full diff</span></div></div>
  <div class="field"><span class="l">design</span><div><span class="chip cyan">R3 · APPROVED</span>PROJECT-DESIGN.md @4b7e2d</div></div>
  <div class="field"><span class="l">depends on</span><div><span class="chip">SR-5</span><span class="chip">SR-8</span></div></div>
  <div class="field"><span class="l">scope</span><div class="m" style="font-size: 11.5px;">app/src/main/…/reader/list/** · core/src/…/paging/**</div></div>
  <div class="field"><span class="l">acceptance</span><div><ol class="ac"><li>List paginates with a full-page refresh, no partial redraws on Boox.</li><li>Unread count matches core fixture 07.</li><li>Screenshot of first and last page attached as evidence.</li></ol></div></div>
  <div class="field"><span class="l">budget</span><div class="m">$5 · 14 MIN · 80 TURNS · repo defaults</div></div>
  <div class="hint"><span>A approve → ready</span><span>E edit</span><span>D deps</span><span>ESC back</span></div>`;

const laptop = (mode, fk) => { const t = T[mode], f = F[fk]; return head(f, css(t, f) + `.h { width: 1440px; height: 900px; } .h .desk { grid-template-columns: 1.15fr 1fr; grid-template-rows: 1.05fr 1fr; }`) + `
<div class="h">${bar()}<div class="desk">
  ${tile('waiting on you', '5 · oldest first', ['⌘1'], attBody(), 'focus')}
  ${tile('frontier', 'what depends on what', ['⌘2'], graph(700, 300, 1, 1))}
  ${tile('claim order', 'ready ∧ ¬blocked ∧ ¬leased', ['⌘3'], frBody())}
  ${tile('run 31 · SR-8', 'verifying (fast) · fly-3', ['⌘4'], runBody(), 'hotb')}
</div></div>` + foot; };
const wide = (mode, fk) => { const t = T[mode], f = F[fk]; return head(f, css(t, f) + `.h { width: 2560px; height: 1440px; font-size: 14.5px; } .h .desk { grid-template-columns: 1fr 1.25fr 1fr; grid-template-rows: 1.1fr 1fr; gap: 14px; } .h .row .t { font-size: 15px; } .h .row .t em { font-size: 12.5px; } .h svg text { font-size: 13px; } .h svg text.id { font-size: 10.5px; } .h { grid-template-rows: 36px 1fr; } .h .bar { font-size: 12.5px; } .h h1 { font-size: 24px; } .h .big { font-size: 44px; }`) + `
<div class="h">${bar()}<div class="desk">
  ${tile('waiting on you', '5 · oldest first', ['⌘1'], attBody())}
  ${tile('frontier', 'what depends on what', ['⌘2'], graph(1000, 440, 1.4, 1.45))}
  ${tile('SR-12', 'ticket · draft', ['⌘5', 'ESC'], detailBody(), 'focus')}
  ${tile('claim order', 'ready ∧ ¬blocked ∧ ¬leased', ['⌘3'], frBody())}
  ${tile('run 31 · SR-8', 'verifying (fast) · fly-3', ['⌘4'], runBody(), 'hotb')}
  ${tile('planning', 'SR-12', ['⌘6'], `<div class="empty">Nothing yet. Start a planning conversation and its questions, assumptions and deferred decisions will attach here, pinned to design r3.</div><div class="hint"><span>P start planning</span></div>`)}
</div></div>` + foot; };


/* ---------- extra CSS for views ---------- */
const viewCss = (t, f) => `
  .h .cols { display: grid; grid-template-columns: repeat(6, minmax(0,1fr)); gap: 12px; min-height: 0; }
  .h .col { display: flex; flex-direction: column; gap: 8px; min-height: 0; }
  .h .ch { font-family: ${f.mono}; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: ${t.cyan}; display: flex; justify-content: space-between; padding: 6px 2px; border-bottom: 1px solid ${t.line2}; }
  .h .ch span { color: ${t.mute}; } .h .ch.hot { color: ${t.mag}; } .h .ch b { font-weight: 400; color: ${t.ink}; }
  .h .card { background: ${t.pan}; clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px); position: relative; padding: 10px 12px 9px; display: flex; flex-direction: column; gap: 4px; }
  .h .card:before { content: ''; position: absolute; inset: 0; border: 1px solid ${t.line2}; clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px); pointer-events: none; }
  .h .card.hot:before { border-color: ${t.mag}; } .h .card.live:before { border-color: ${t.mag}; box-shadow: 0 0 18px ${t.mglow} inset; } .h .card.sel:before { border-color: ${t.cyan}; box-shadow: 0 0 0 1px ${t.cyan} inset; }
  .h .card.done { opacity: .75; }
  .h .card .id { font-family: ${f.mono}; font-size: 10.5px; color: ${t.mute}; letter-spacing: .08em; display: flex; justify-content: space-between; }
  .h .card .id i { font-style: normal; color: ${t.cyan}; } .h .card.hot .id i, .h .card.live .id i { color: ${t.mag}; }
  .h .card .t { font-weight: ${f.w}; font-size: 13px; line-height: 1.25; }
  .h .card .m { font-family: ${f.mono}; font-size: 10.5px; color: ${t.mute}; letter-spacing: .04em; }
  .h .card .bar2 { height: 3px; background: ${t.line}; margin-top: 4px; position: relative; } .h .card .bar2 i { position: absolute; left: 0; top: 0; bottom: 0; background: ${t.mag}; box-shadow: 0 0 6px ${t.mglow}; }
  .h .ghost { border: 1px dashed ${t.line2}; padding: 10px 12px; font-family: ${f.mono}; font-size: 10.5px; color: ${t.mute}; letter-spacing: .08em; text-transform: uppercase; }
  .h .page { display: grid; grid-template-columns: 1fr 380px; gap: 12px; min-height: 0; }
  .h .tk { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; min-height: 0; }
  .h .desc { line-height: 1.55; font-size: 13.5px; margin: 4px 0 8px; }
  .h .desc p { margin: 0 0 8px; }
  .h .kv { display: grid; grid-template-columns: 92px 1fr; gap: 8px; padding: 6px 0; border-bottom: 1px solid ${t.line}; align-items: baseline; font-size: 12.5px; }
  .h .kv span.l { color: ${t.mute}; font-family: ${f.mono}; font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; }
  .h .runs { font-family: ${f.mono}; font-size: 11px; letter-spacing: .03em; }
  .h .runs div { display: grid; grid-template-columns: 52px 1fr auto; gap: 10px; padding: 6px 0; border-bottom: 1px solid ${t.line}; color: ${t.mute}; }
  .h .runs div b { color: ${t.ink}; font-weight: 400; } .h .runs .ok { color: ${t.cyan}; } .h .runs .bad { color: ${t.mag}; }
  .h .msg { display: grid; grid-template-columns: 72px 1fr; gap: 10px; padding: 8px 0; border-bottom: 1px solid ${t.line}; font-size: 12.5px; line-height: 1.45; }
  .h .msg span { font-family: ${f.mono}; font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: ${t.mute}; padding-top: 2px; } .h .msg span.you { color: ${t.cyan}; }
  .h .ph { display: flex; align-items: baseline; gap: 18px; padding: 2px 4px 10px; }
  .h .ph h1 { margin: 0; font-size: 26px; } .h .ph .m2 { font-family: ${f.mono}; font-size: 11px; color: ${t.mute}; letter-spacing: .1em; text-transform: uppercase; }
  .h .stat { display: grid; grid-template-columns: repeat(5, minmax(0,1fr)); gap: 12px; }
  .h .stat .card { align-items: flex-start; } .h .stat .card .big { margin-top: 0; font-size: 30px; }
  .h .rev { display: grid; grid-template-columns: 42px 1fr auto; gap: 12px; padding: 8px 0; border-bottom: 1px solid ${t.line}; align-items: baseline; }
  .h .rev .r { font-family: ${f.mono}; font-size: 14px; color: ${t.cyan}; } .h .rev.prop .r { color: ${t.mag}; }
  .h .rev .m { font-family: ${f.mono}; font-size: 10.5px; color: ${t.mute}; letter-spacing: .04em; display: block; margin-top: 2px; }
  .h .rev .st { font-family: ${f.mono}; font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: ${t.mute}; }
  .h .rev.prop .st { color: ${t.mag}; }
  .h .tl { display: grid; grid-template-columns: 58px 1fr 64px 64px 44px; gap: 10px; padding: 6px 8px; margin: 0 -8px; border-bottom: 1px solid ${t.line}; font-size: 12.5px; align-items: center; }
  .h .tl .id, .h .tl .s2 { font-family: ${f.mono}; font-size: 10.5px; color: ${t.mute}; letter-spacing: .08em; text-transform: uppercase; }
  .h .tl .s2.c { color: ${t.cyan}; } .h .tl .s2.m { color: ${t.mag}; } .h .tl .s2.a { color: ${t.amber}; }
`;

const cols = [
  ['draft', 'DRAFT', [['SR-12', 'Article list screen: e-ink pagination', 'L3 · r3', 'hot', 'needs approval'], ['SR-13', 'Feed subscribe screen', 'no design', '', ''], ['SR-14', 'Settings: refresh cadence', 'no design', '', '']]],
  ['ready', 'READY', [['SR-9', 'Feed fixture parser tests', 'L4 · r3', 'sel', 'next to claim'], ['SR-10', 'Boox refresh-mode hook', 'L3 · r3', '', '']]],
  ['running', 'RUNNING', [['SR-8', 'Reader typography settings', 'run 31 · fly-3', 'live', '$1.42 · 06:12 · 38t']]],
  ['human', 'NEEDS YOU', [['SR-7', 'Room migration v2', 'run 30 · failed ×2', 'hot', 'same failure twice'], ['SR-3', 'OPML import', 'run 29 · asked', 'hot', 'keep folder hierarchy?']]],
  ['review', 'REVIEW', [['SR-5', 'Feed parser core (pure Kotlin)', 'PR #14 · CI green', '', 'proposes r4']]],
  ['done', 'DONE', [['SR-4', 'Curated feed fixtures', 'merged 2d', 'done', ''], ['SR-2', 'Feed fetch with ETag', 'merged 4d', 'done', ''], ['SR-1', 'Core module skeleton', 'merged 6d', 'done', '']]],
];
const kanban = (mode, fk) => { const t = T[mode], f = F[fk]; return head(f, css(t, f) + viewCss(t, f) + `.h { width: 1440px; height: 900px; } .h .desk { grid-template-rows: auto 1fr; }`) + `
<div class="h">${bar().replace('class="on">1 home', '>1 home').replace('<span>2 tickets', '<span class="on">2 tickets')}<div class="desk">
  <div class="ph"><h1>Tickets</h1><span class="m2">board · 12 tickets · filter: mvp</span><span class="m2" style="margin-left: auto;">drag = move · ▹ human-only columns: draft→ready, needs you→ready, review→done · ▸ controller: ready→running→review</span></div>
  <div class="cols">${cols.map(([k, h, cs]) => `<div class="col"><div class="ch ${k === 'human' ? 'hot' : ''}">${h}<span><b>${cs.length}</b></span></div>${cs.map(([id, tt, m, cl, note]) => `<div class="card ${cl}"><div class="id">${id}<i>${note}</i></div><div class="t">${tt}</div><div class="m">${m}</div>${cl === 'live' ? '<div class="bar2"><i style="width: 44%;"></i></div>' : ''}</div>`).join('')}${k === 'draft' ? '<div class="ghost">N · new ticket</div>' : ''}</div>`).join('')}</div>
</div></div>` + foot; };

const ticket = (mode, fk) => { const t = T[mode], f = F[fk]; return head(f, css(t, f) + viewCss(t, f) + `.h { width: 1440px; height: 900px; } .h .desk { grid-template-rows: auto 1fr; }`) + `
<div class="h">${bar().replace('class="on">1 home', '>1 home').replace('<span>2 tickets', '<span class="on">2 tickets')}<div class="desk">
  <div class="ph"><span class="m2">tickets / subway-reader / mvp /</span><h1>SR-12 · Article list screen: e-ink pagination</h1><span class="chip amber">DRAFT</span><span class="m2" style="margin-left: auto;">A approve · E edit · D deps · P plan · ESC</span></div>
  <div class="page">
    <div class="tk">
      ${tile('spec', 'revision 2 · edited 1h ago', ['E'], `<div class="desc"><p>The article list is the home screen of Subway Reader. On Boox e-ink it must paginate with full-page refreshes: no scrolling, no partial redraws, one tap per page.</p><p>Unread count comes from the core module; the screen never computes it.</p></div>
        <div class="kv"><span class="l">acceptance</span><ol class="ac" style="padding-left: 16px; margin-top: -2px;"><li>List paginates with a full-page refresh, no partial redraws on Boox.</li><li>Unread count matches core fixture 07.</li><li>Screenshot of first and last page attached as evidence.</li></ol></div>
        <div class="kv"><span class="l">scope</span><div class="m" style="font-size: 11.5px;">app/src/main/…/reader/list/**<br>core/src/…/paging/**</div></div>
        <div class="kv"><span class="l">protected</span><div class="m" style="font-size: 11.5px;">core/src/test/fixtures/** · verify.mk</div></div>`, 'focus')}
      ${tile('planning', '3 exchanges · 1 open question', ['P'], `
        <div class="msg"><span class="you">you</span><div>Should page size be fixed or derived from the device font scale?</div></div>
        <div class="msg"><span>planner</span><div>Derive it: core exposes <span class="m">pageSize(fontScale, viewport)</span>; the screen just asks. Keeps the Boox variant testable on JVM.</div></div>
        <div class="msg"><span class="you">you</span><div>Agreed. Deferred: landscape. Not in MVP.</div></div>
        <div class="msg"><span>planner</span><div>Open: should the unread badge refresh on page turn or on sync only? Affects acceptance #2.</div></div>
        <div class="hint"><span>⏎ reply</span><span>ready when no open question can change scope</span></div>`)}
    </div>
    <div style="display: flex; flex-direction: column; gap: 12px; min-height: 0;">
      ${tile('state', '', null, `
        <div class="kv"><span class="l">status</span><div><span class="chip amber">DRAFT</span> → ready needs your approval</div></div>
        <div class="kv"><span class="l">lane</span><div><span class="chip">L3</span></div></div>
        <div class="kv"><span class="l">design</span><div><span class="chip cyan">R3</span>PROJECT-DESIGN.md @4b7e2d</div></div>
        <div class="kv"><span class="l">depends on</span><div><span class="chip">SR-5</span><span class="chip">SR-8</span></div></div>
        <div class="kv"><span class="l">blocks</span><div><span class="chip">SR-13</span></div></div>
        <div class="kv"><span class="l">budget</span><div class="m" style="font-size: 11px;">$5 · 14 MIN · 80 TURNS</div></div>`)}
      ${tile('runs', 'none yet', null, `<div class="empty">No runs. The controller claims this ticket once it is ready, unblocked and unleased.</div>`)}
      ${tile('history', '', null, `<div class="runs"><div><span>1h</span><b>you</b> edited spec · rev 2</div><div><span>3h</span><b>planner</b> proposed acceptance #3</div><div><span>1d</span><b>you</b> created from planning · design r3</div></div>`)}
    </div>
  </div>
</div></div>` + foot; };

const project = (mode, fk) => { const t = T[mode], f = F[fk]; return head(f, css(t, f) + viewCss(t, f) + `.h { width: 1440px; height: 900px; } .h .desk { grid-template-rows: auto auto 1fr; }`) + `
<div class="h">${bar().replace('class="on">1 home', '>1 home').replace('<span>3 design', '<span class="on">3 design')}<div class="desk">
  <div class="ph"><span class="m2">apps / subway-reader /</span><h1>MVP</h1><span class="m2">project · started Aug 20 · 12 tickets · 4 merged</span><span class="m2" style="margin-left: auto;">N new ticket · P plan · G graph</span></div>
  <div class="stat">
    <div class="card"><div class="id">MERGED</div><div class="big">4<small> / 12</small></div></div>
    <div class="card"><div class="id">SPEND</div><div class="big">$18.60</div><div class="m">$4.65 per merged ticket</div></div>
    <div class="card"><div class="id">FIRST-TRY SUCCESS</div><div class="big">3<small> / 4</small></div></div>
    <div class="card hot"><div class="id">NEEDS YOU<i>2</i></div><div class="big">2</div><div class="m">SR-7 · SR-3</div></div>
    <div class="card"><div class="id">REVERTS · 14D</div><div class="big">0</div></div>
  </div>
  <div class="page" style="grid-template-columns: 1fr 1fr;">
    ${tile('design revisions', 'PROJECT-DESIGN.md · in repo', ['O'], `
      <div class="rev prop"><span class="r">r4</span><div>Proposed by SR-5 (PR #14) — adds a parser error taxonomy<span class="m">sha 9f3c1a · takes effect after merge and your approval</span></div><span class="st">accept · reject</span></div>
      <div class="rev"><span class="r">r3</span><div>Pagination model, unread semantics, JVM/Android seam<span class="m">sha 4b7e2d · approved Aug 24 · used by runs 27–31</span></div><span class="st">approved</span></div>
      <div class="rev"><span class="r">r2</span><div>Fixture strategy, protected paths<span class="m">sha c01d77 · superseded</span></div><span class="st">superseded</span></div>
      <div class="rev"><span class="r">r1</span><div>First planning pass<span class="m">sha 71aa02 · superseded</span></div><span class="st">superseded</span></div>
      <div class="hint"><span>revisions are path + sha</span><span>markdown lives in the app repo</span></div>`, 'focus')}
    ${tile('tickets', '12 · by state', ['⌘2'], `
      ${[['SR-12','Article list screen: e-ink pagination','draft','a','L3','r3'],['SR-7','Room migration v2','needs you','m','L3','r3'],['SR-3','OPML import','needs you','m','L4','r3'],['SR-8','Reader typography settings','running','m','L3','r3'],['SR-9','Feed fixture parser tests','ready','c','L4','r3'],['SR-10','Boox refresh-mode hook','ready','c','L3','r3'],['SR-5','Feed parser core (pure Kotlin)','review','c','L3','r3'],['SR-11','Offline sync worker','blocked','','L3','r3'],['SR-13','Feed subscribe screen','draft','a','—','—']].map(([id,tt,s,c,l,r]) => `<div class="tl"><span class="id">${id}</span><span>${tt}</span><span class="s2 ${c}">${s}</span><span class="s2">${l}</span><span class="s2">${r}</span></div>`).join('')}
      <div class="hint"><span>+3 done</span><span>⏎ open</span><span>S status</span></div>`)}
  </div>
</div></div>` + foot; };

writeFileSync('KanbanNight.dc.html', kanban('night', 'chakra'));
writeFileSync('TicketNight.dc.html', ticket('night', 'chakra'));
writeFileSync('ProjectNight.dc.html', project('night', 'chakra'));

writeFileSync('Main.dc.html', laptop('night', 'chakra'));
writeFileSync('MartianNight.dc.html', laptop('night', 'martian'));
writeFileSync('ChakraDay.dc.html', laptop('day', 'chakra'));
writeFileSync('WideNight.dc.html', wide('night', 'chakra'));
writeFileSync('WideDay.dc.html', wide('day', 'chakra'));

writeFileSync('canvas.json', JSON.stringify({
  artboards: [
    { file: 'Main.dc.html', x: 0, y: 0, w: 1440, h: 900, title: 'HUD · night · type A: Chakra Petch + Share Tech Mono' },
    { file: 'MartianNight.dc.html', x: 1540, y: 0, w: 1440, h: 900, title: 'HUD · night · type B: Martian Mono everywhere' },
    { file: 'ChakraDay.dc.html', x: 3080, y: 0, w: 1440, h: 900, title: 'HUD · day · type A' },
    { file: 'KanbanNight.dc.html', x: 0, y: 1100, w: 1440, h: 900, title: 'Kanban · workspace 2' },
    { file: 'TicketNight.dc.html', x: 1540, y: 1100, w: 1440, h: 900, title: 'Ticket page · SR-12' },
    { file: 'ProjectNight.dc.html', x: 3080, y: 1100, w: 1440, h: 900, title: 'Project page · MVP' },
    { file: 'WideNight.dc.html', x: 0, y: 2200, w: 2560, h: 1440, title: 'HUD · night · 32" (ticket open)' },
    { file: 'WideDay.dc.html', x: 0, y: 3840, w: 2560, h: 1440, title: 'HUD · day · 32" (ticket open)' },
  ],
  annotations: [
    { id: 'brief4', x: 2660, y: 2200, w: 520, text: 'ROUND 4 — back to the HUD, keeping the tiling bones.\n\nSquare everything: chamfered panels, corner brackets, 1px rules, diamond nodes and orthogonal edges in the graph. Cyan = system / ready, magenta = needs a human or is live, amber = draft only. Warmth comes from copy and pacing, not from softening the geometry.\n\nTwo type options, same layout: A Chakra Petch (squared humanist) + Share Tech Mono; B Martian Mono, a wide techno mono for everything. Pick one; both day/wide boards use A for now.' },
    { id: 'views4', x: 4620, y: 1100, w: 420, text: 'Row 2 — the other surfaces, all night / type A.\n\nKanban: columns are the lifecycle; human-only transitions are marked so a drag the controller owns is refused, not faked.\n\nTicket: spec + planning conversation side by side; state rail on the right; runs/history below it.\n\nProject: outcomes up top (what survived, not what shipped), design revisions as path+sha, the ticket table.' },
    { id: 'motion4', x: 2660, y: 2600, w: 520, text: 'Motion: scanline over the live run, the running node pulses, cursor blinks, focused tile glows inward. All off under reduced-motion.' },
  ],
  launch: { view: 'canvas' },
}, null, 2));
console.log('ok');

/* TUI artboards (generated by tui.mjs) join the canvas on their own row */
{
  const c = JSON.parse(readFileSync('canvas.json', 'utf8'));
  c.artboards.push(
    { file: 'TuiHome.dc.html', x: 0, y: 5480, w: 1440, h: 900, title: 'TUI · home · dark terminal' },
    { file: 'TuiTicket.dc.html', x: 1540, y: 5480, w: 1440, h: 900, title: 'TUI · ticket SR-12' },
    { file: 'TuiHomeLight.dc.html', x: 3080, y: 5480, w: 1440, h: 900, title: 'TUI · home · light terminal' },
  );
  c.annotations.push({ id: 'tui4', x: 4620, y: 5480, w: 420, text: 'TUI investigation — the same home and ticket screens as a full-screen terminal app (168×48, box-drawing, 3 accent colours, same keys as the GUI).\n\nWhat survives: the tiles, the attention list, the claim order, the run meters, the planning conversation. What suffers: the dependency graph (hand-drawn ASCII, unmaintainable past ~15 nodes), drag-and-drop (becomes J/K reorder), and the 32" case (a TUI just gets wider columns).\n\nA TUI could be the first client the blueprint\'s S1 calls "minimal" — the web GUI the second.' });
  writeFileSync('canvas.json', JSON.stringify(c, null, 2));
}
