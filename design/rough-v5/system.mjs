import { writeFileSync, readFileSync } from 'node:fs';
const t = { page: '#232A2E', tile: '#2D353B', raised: '#343F44', rule: '#3D484D', rule2: '#475258', ink: '#D3C6AA', mute: '#9DA9A0', dim: '#7A8478', system: '#A7C080', human: '#E67E80', live: '#E69875', draft: '#DBBC7F', review: '#83C092', link: '#7FBBB3' };
const base = `
  .s { width: 1440px; height: 900px; background: ${t.page}; color: ${t.ink}; font-family: 'IBM Plex Sans', system-ui, sans-serif; font-size: 13.5px; line-height: 1.5; box-sizing: border-box; padding: 28px 32px; overflow: hidden; display: grid; gap: 20px; }
  .s .m { font-family: 'JetBrains Mono', ui-monospace, monospace; }
  .s h1 { font-weight: 500; font-size: 20px; margin: 0; line-height: 1.2; display: flex; align-items: baseline; gap: 14px; }
  .s h1 span { font-family: 'JetBrains Mono'; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: ${t.mute}; font-weight: 400; }
  .s .lbl { font-family: 'JetBrains Mono'; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: ${t.system}; border-bottom: 1px solid ${t.rule}; padding-bottom: 6px; margin-bottom: 10px; }
  .s .note { color: ${t.mute}; font-size: 12.5px; }
  .s .sw { display: grid; grid-template-columns: 44px 1fr; gap: 10px; align-items: center; padding: 5px 0; }
  .s .sw i { display: block; height: 30px; border: 1px solid ${t.rule}; }
  .s .sw b { font-weight: 500; font-size: 13px; display: block; } .s .sw small { font-family: 'JetBrains Mono'; font-size: 11px; color: ${t.mute}; }
  .s .ty { display: grid; grid-template-columns: 150px 1fr; gap: 12px; padding: 7px 0; border-bottom: 1px solid ${t.rule}; align-items: baseline; }
  .s .ty small { font-family: 'JetBrains Mono'; font-size: 11px; color: ${t.mute}; }
  .s .sp { display: flex; align-items: flex-end; gap: 14px; } .s .sp div { background: ${t.system}; } .s .sp span { font-family: 'JetBrains Mono'; font-size: 10.5px; color: ${t.mute}; display: block; margin-top: 4px; }
  .s .tile { background: ${t.tile}; border: 1px solid ${t.rule}; display: flex; flex-direction: column; }
  .s .tile.focus { border-color: ${t.system}; box-shadow: 0 0 0 1px ${t.system} inset; } .s .tile.hot { border-color: ${t.live}; }
  .s .th { display: flex; gap: 10px; padding: 8px 14px 7px 18px; border-bottom: 1px solid ${t.rule}; background: ${t.raised}; font-family: 'JetBrains Mono'; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: ${t.system}; } .s .tile.hot .th { color: ${t.live}; } .s .th span { color: ${t.mute}; } .s .th .k { margin-left: auto; display: flex; gap: 6px; }
  .s kbd { font-family: 'JetBrains Mono'; font-size: 10.5px; color: ${t.mute}; border: 1px solid ${t.rule2}; padding: 0 5px; line-height: 15px; }
  .s .body { padding: 6px 14px 10px 18px; }
  .s .row { display: grid; grid-template-columns: 22px 88px 1fr auto; gap: 10px; align-items: center; padding: 8px 8px; margin: 0 -8px; border-bottom: 1px solid ${t.rule}; }
  .s .row.sel { background: ${t.raised}; box-shadow: inset 2px 0 0 ${t.system}; }
  .s .row .n { font-family: 'JetBrains Mono'; color: ${t.mute}; font-size: 11.5px; } .s .row .kind { font-family: 'JetBrains Mono'; font-size: 10.5px; letter-spacing: .12em; color: ${t.system}; } .s .row.hot .kind { color: ${t.human}; }
  .s .row .t { font-weight: 500; font-size: 13.5px; line-height: 1.25; } .s .row .t span { font-family: 'JetBrains Mono'; font-weight: 400; color: ${t.mute}; font-size: 11px; margin-right: 8px; } .s .row .t em { display: block; font-style: normal; font-weight: 400; color: ${t.mute}; font-size: 11.5px; font-family: 'JetBrains Mono'; margin-top: 2px; }
  .s .fr { display: grid; grid-template-columns: 14px 58px 1fr auto; gap: 10px; align-items: center; padding: 7px 8px; margin: 0 -8px; border-bottom: 1px solid ${t.rule}; }
  .s .fr .id, .s .fr .st { font-family: 'JetBrains Mono'; font-size: 11px; color: ${t.mute}; letter-spacing: .08em; } .s .fr .t { font-weight: 500; font-size: 13px; }
  .s .fr i { width: 8px; height: 8px; background: ${t.system}; transform: rotate(45deg); } .s .fr.running i { background: ${t.live}; transform: none; border-radius: 50%; animation: br 1.6s ease-in-out infinite; } .s .fr.running .st { color: ${t.live}; } .s .fr.ready .st { color: ${t.system}; }
  .s .fr.blocked i { background: none; border: 1px solid ${t.mute}; box-sizing: border-box; transform: rotate(45deg); } .s .fr.blocked .t { color: ${t.mute}; text-decoration: line-through; text-decoration-color: ${t.rule2}; }
  .s .fr.draft i { background: ${t.draft}; transform: none; } .s .fr.draft .t { color: ${t.mute}; } .s .fr.draft .st { color: ${t.draft}; }
  @keyframes br { 50% { opacity: .45; } } @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
  .s .card { background: ${t.raised}; border: 1px solid ${t.rule}; padding: 10px 12px 9px; display: flex; flex-direction: column; gap: 4px; } .s .card.hot { border-color: ${t.human}; } .s .card.live { border-color: ${t.live}; } .s .card.sel { border-color: ${t.system}; box-shadow: 0 0 0 1px ${t.system} inset; }
  .s .card .id { font-family: 'JetBrains Mono'; font-size: 10.5px; color: ${t.mute}; letter-spacing: .08em; display: flex; justify-content: space-between; } .s .card .id i { font-style: normal; color: ${t.system}; } .s .card.hot .id i { color: ${t.human}; } .s .card.live .id i { color: ${t.live}; }
  .s .card .t { font-weight: 500; font-size: 13px; line-height: 1.25; } .s .card .mt { font-family: 'JetBrains Mono'; font-size: 10.5px; color: ${t.mute}; }
  .s .card .bar2 { height: 3px; background: ${t.rule}; margin-top: 4px; position: relative; } .s .card .bar2 i { position: absolute; left: 0; top: 0; bottom: 0; background: ${t.live}; }
  .s .chip { display: inline-block; border: 1px solid ${t.rule2}; padding: 1px 8px; font-family: 'JetBrains Mono'; font-size: 11px; margin-right: 6px; letter-spacing: .05em; } .s .chip.d { color: ${t.draft}; border-color: ${t.draft}; } .s .chip.s { color: ${t.system}; border-color: ${t.system}; } .s .chip.h { color: ${t.human}; border-color: ${t.human}; } .s .chip.r { color: ${t.review}; border-color: ${t.review}; }
  .s .meter { display: grid; grid-template-columns: 52px 1fr 90px; gap: 10px; align-items: center; font-family: 'JetBrains Mono'; font-size: 11px; color: ${t.mute}; margin: 6px 0; } .s .meter div { height: 4px; background: ${t.rule}; position: relative; } .s .meter div i { position: absolute; left: 0; top: 0; bottom: 0; background: ${t.system}; } .s .meter div i.h { background: ${t.live}; } .s .meter b { color: ${t.ink}; font-weight: 500; font-size: 15px; text-align: right; }
  .s .kv { display: grid; grid-template-columns: 100px 1fr; gap: 10px; padding: 6px 0; border-bottom: 1px solid ${t.rule}; align-items: baseline; font-size: 12.5px; } .s .kv .l { color: ${t.mute}; font-family: 'JetBrains Mono'; font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; }
  .s .rev { display: grid; grid-template-columns: 42px 1fr auto; gap: 12px; padding: 7px 0; border-bottom: 1px solid ${t.rule}; align-items: baseline; } .s .rev .r { font-family: 'JetBrains Mono'; font-size: 14px; color: ${t.system}; } .s .rev.p .r { color: ${t.human}; } .s .rev .mt { font-family: 'JetBrains Mono'; font-size: 10.5px; color: ${t.mute}; display: block; } .s .rev .st { font-family: 'JetBrains Mono'; font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: ${t.mute}; } .s .rev.p .st { color: ${t.human}; }
  .s .msg { display: grid; grid-template-columns: 72px 1fr; gap: 10px; padding: 7px 0; border-bottom: 1px solid ${t.rule}; font-size: 12.5px; } .s .msg span { font-family: 'JetBrains Mono'; font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: ${t.mute}; padding-top: 2px; } .s .msg span.y { color: ${t.system}; }
  .s .bar { display: flex; align-items: center; gap: 20px; padding: 0 14px; height: 32px; font-family: 'JetBrains Mono'; font-size: 11.5px; letter-spacing: .1em; text-transform: uppercase; color: ${t.mute}; border: 1px solid ${t.rule}; background: ${t.tile}; } .s .bar .ws { display: flex; gap: 2px; } .s .bar .ws span { padding: 3px 10px; border: 1px solid transparent; } .s .bar .ws span.on { border-color: ${t.system}; color: ${t.system}; } .s .bar .mid { margin-left: auto; margin-right: auto; color: ${t.ink}; } .s .bar b { color: ${t.ink}; font-weight: 400; font-size: 15px; margin-right: 4px; } .s .bar .hot b { color: ${t.human}; }
  .s svg text { font-family: 'IBM Plex Sans'; font-weight: 500; font-size: 11.5px; fill: ${t.ink}; } .s svg text.id { font-family: 'JetBrains Mono'; font-weight: 400; font-size: 9.5px; fill: ${t.mute}; letter-spacing: .08em; }
  .s svg .e { fill: none; stroke: ${t.system}; stroke-width: 1; opacity: .5; } .s svg .e.dead { stroke: ${t.mute}; stroke-dasharray: 3 4; } .s svg .nd { fill: ${t.tile}; stroke: ${t.system}; stroke-width: 1.5; } .s svg .nd.done { fill: ${t.system}; } .s svg .nd.human { stroke: ${t.human}; } .s svg .nd.run { stroke: ${t.live}; fill: ${t.live}; animation: br 1.6s ease-in-out infinite; } .s svg .nd.draft { stroke: ${t.draft}; stroke-dasharray: 2 3; } .s svg .nd.blk { stroke: ${t.mute}; } .s svg .nd.rev { stroke: ${t.review}; stroke-width: 3; }
`;
const head = c => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap">
  <style>
    body { margin: 0; }
    a { color: ${t.link}; } a:hover { color: ${t.ink}; }
    ${c}
  </style>
</helmet>`;
const foot = `</x-dc>
</body>
</html>`;
const sw = (hex, name, use) => `<div class="sw"><i style="background: ${hex};"></i><div><b>${name}</b><small>${hex} · ${use}</small></div></div>`;

const tokens = head(base + `.s { grid-template-rows: auto 1fr; } .s .cols { display: grid; grid-template-columns: 1fr 1fr 1.2fr; gap: 28px; min-height: 0; }`) + `
<div class="s">
  <h1>Goblin Foundry · house style v0 <span>tokens · Everforest dark · flat</span></h1>
  <div class="cols">
    <div>
      <div class="lbl">Surfaces · three steps, one rule</div>
      ${sw(t.page, 'page', 'app background')}${sw(t.tile, 'tile', 'panels, tables')}${sw(t.raised, 'raised', 'headers, cards, selected, chips')}${sw(t.rule, 'rule', '1px rules, borders')}${sw(t.rule2, 'rule-2', 'inputs, kbd')}
      <div class="lbl" style="margin-top: 18px;">Text</div>
      ${sw(t.ink, 'ink', 'primary')}${sw(t.mute, 'mute', 'secondary · 5.7:1 on tile')}${sw(t.dim, 'dim', 'handles, dividers — never words')}
      <p class="note" style="margin: 14px 0 0;">No gradients, shadows, blur, glow or radius. Focus is a border colour change and nothing else.</p>
    </div>
    <div>
      <div class="lbl">Colour by meaning · one job each</div>
      ${sw(t.system, 'system', 'controller · ready · ok · focus')}${sw(t.human, 'human', 'your attention is required — nothing else')}${sw(t.live, 'live', 'a run is alive · watch, don\'t touch')}${sw(t.draft, 'draft', 'not yet real')}${sw(t.review, 'review', 'PR open · merge pending')}${sw(t.link, 'link', 'links · paths · shas')}
      <p class="note" style="margin: 14px 0 0;">Red means act; orange means it's working and costs money while you look away — watch it, don't touch it. done is mute; cancelled is mute + struck; blocked is not a state and never a colour. Stock Everforest fails AA at label sizes; mute and the accents here are text-safe on tile. Don't reach back for the stock values under 16px.</p>
      <div class="lbl" style="margin-top: 18px;">Space · 4px base · 12px WM gap</div>
      <div class="sp"><div style="width: 4px; height: 4px;"></div><div style="width: 8px; height: 8px;"></div><div style="width: 12px; height: 12px;"></div><div style="width: 14px; height: 14px;"></div><div style="width: 18px; height: 18px;"></div><div style="width: 24px; height: 24px;"></div><span>4 · 8 · 12 · 14 · 18 · 24 &nbsp; radius 0</span></div>
    </div>
    <div>
      <div class="lbl">Type · IBM Plex Sans + JetBrains Mono</div>
      <div class="ty"><small>title · sans 500 20</small><span style="font-weight: 500; font-size: 20px;">Article list screen</span></div>
      <div class="ty"><small>row title · sans 500 14</small><span style="font-weight: 500; font-size: 14px;">Feed parser core (pure Kotlin)</span></div>
      <div class="ty"><small>body · sans 400 13.5/1.5</small><span>On Boox e-ink it must paginate with full-page refreshes: no scrolling, no partial redraws.</span></div>
      <div class="ty"><small>meta · mono 11.5</small><span class="m" style="font-size: 11.5px; color: ${t.mute};">verify failed twice, same failure · $3.80 spent</span></div>
      <div class="ty"><small>label · mono 11 caps .14em</small><span class="m" style="font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: ${t.system};">waiting on you</span></div>
      <div class="ty"><small>kbd · mono 10.5</small><span><kbd>J</kbd> <kbd>K</kbd> <kbd>⏎</kbd> <kbd>⌘K</kbd></span></div>
      <div class="ty"><small>stat · mono 500 22 · stat tiles only</small><span class="m" style="font-weight: 500; font-size: 22px;">$18.60</span></div>
      <div class="ty"><small>number · mono 500 15 · in rows</small><span class="m" style="font-weight: 500; font-size: 15px;">$1.42 <span style="font-weight: 400; font-size: 11px; color: ${t.mute};">/ 5.00</span></span></div>
      <p class="note" style="margin: 14px 0 0;">Mono is a signal — identifiers, keys, paths, telemetry — not a mood. A whole paragraph in mono means something is wrong. Telemetry inside rows is text-size; only stat tiles get the 22. Run cost is always <span class="m">$x.xx / cap</span>.</p>
      <div class="lbl" style="margin-top: 18px;">Motion</div>
      <p class="note" style="margin: 0;">120ms hover/focus/select · 200ms tiles and rows moving · one ambient animation (a live run breathes) · all off under reduced-motion. No marquee, scanline, glow or spring.</p>
      <div class="lbl" style="margin-top: 18px;">Not a strict system</div>
      <p class="note" style="margin: 0;">These notes describe what the mockups do so new screens belong. When the product needs something they don't cover, do the sensible thing and update the notes. Drift is fine; unexplained drift isn't.</p>
    </div>
  </div>
</div>` + foot;

const components = head(base + `.s { grid-template-rows: auto auto 1fr; } .s .g3 { display: grid; grid-template-columns: 1.15fr 1fr 1fr; gap: 20px; min-height: 0; } .s .stack { display: flex; flex-direction: column; gap: 16px; min-height: 0; }`) + `
<div class="s">
  <h1>Components <span>as built in the four pages</span></h1>
  <div class="bar"><div class="ws"><span class="on">1 home</span><span>2 tickets</span><span>3 design</span><span>4 runs</span><span>5 evidence</span></div><span class="mid">subway-reader / mvp · design r3 @4b7e2d</span><span><b>3</b>draft</span><span><b>2</b>ready</span><span class="hot"><b>2</b>needs you</span><span>09:41</span></div>
  <div class="g3">
    <div class="stack">
      <div class="tile focus"><div class="th">tile · focused <span>label · subtitle</span><span class="k"><kbd>⌘1</kbd></span></div><div class="body">
        <div class="row sel"><span class="n">1</span><span class="kind">APPROVE</span><div class="t"><span>SR-12</span>Attention row, selected<em>meta line in mono · what happened, not what it means</em></div><kbd>A</kbd></div>
        <div class="row hot"><span class="n">2</span><span class="kind">RE-ARM</span><div class="t"><span>SR-7</span>Attention row, needs you<em>kind goes red when the human is the blocker</em></div><kbd>R</kbd></div>
        <div class="fr ready"><i></i><span class="id">SR-9</span><span class="t">Frontier row · ready</span><span class="st">L4 · NEXT</span></div>
        <div class="fr running"><i></i><span class="id">SR-8</span><span class="t">Frontier row · running</span><span class="st">RUN 31 · HB 4S</span></div>
        <div class="fr blocked"><i></i><span class="id">SR-11</span><span class="t">Frontier row · blocked</span><span class="st">BY SR-7</span></div>
        <div class="fr draft"><i></i><span class="id">SR-13</span><span class="t">Frontier row · draft</span><span class="st">NO DESIGN</span></div>
      </div></div>
      <div class="tile hot"><div class="th">tile · live run <span>orange while it spends</span><span class="k"><kbd>⌘4</kbd></span></div><div class="body">
        <div class="meter"><span>spend</span><div><i class="h" style="width: 28%;"></i></div><b>$1.42 <span style="font-size: 11px; color: ${t.mute}; font-weight: 400;">/ 5.00</span></b></div>
        <div class="meter"><span>wall</span><div><i class="h" style="width: 44%;"></i></div><b>06:12 <span style="font-size: 11px; color: ${t.mute}; font-weight: 400;">/ 14:00</span></b></div>
        <div class="meter"><span>turns</span><div><i style="width: 47%;"></i></div><b>38 <span style="font-size: 11px; color: ${t.mute}; font-weight: 400;">/ 80</span></b></div>
      </div></div>
    </div>
    <div class="stack">
      <div class="tile"><div class="th">kanban cards</div><div class="body" style="display: flex; flex-direction: column; gap: 8px;">
        <div class="card sel"><div class="id">SR-9<i>next to claim</i></div><div class="t">Card · selected</div><div class="mt">L4 · r3</div></div>
        <div class="card live"><div class="id">SR-8<i>$1.42 · 06:12</i></div><div class="t">Card · running</div><div class="mt">run 31 · fly-3</div><div class="bar2"><i style="width: 44%;"></i></div></div>
        <div class="card hot"><div class="id">SR-3<i>keep folder hierarchy?</i></div><div class="t">Card · needs you</div><div class="mt">run 29 · asked</div></div>
        <div class="card"><div class="id">SR-4<i></i></div><div class="t">Card · plain</div><div class="mt">merged 2d</div></div>
        <div style="font-family: 'JetBrains Mono'; font-size: 11px; color: ${t.mute}; padding: 6px 8px; border: 1px dashed ${t.rule2};">refusal · the controller moves this when the PR merges</div>
      </div></div>
      <div class="tile"><div class="th">chips · kv rows</div><div class="body">
        <div style="padding: 6px 0 10px;"><span class="chip d">DRAFT</span><span class="chip s">READY</span><span class="chip h">NEEDS YOU</span><span class="chip r">REVIEW</span><span class="chip">L3</span><span class="chip">SR-5</span></div>
        <div class="kv"><span class="l">status</span><div><span class="chip d">DRAFT</span>→ ready needs your approval</div></div>
        <div class="kv"><span class="l">design</span><div><span class="chip s">R3</span><a href="#">PROJECT-DESIGN.md @4b7e2d</a></div></div>
        <div class="kv"><span class="l">depends on</span><div><span class="chip">SR-5</span><span class="chip">SR-8</span></div></div>
      </div></div>
    </div>
    <div class="stack">
      <div class="tile"><div class="th">graph · nodes by state</div><div class="body">
        <svg width="380" height="150" viewBox="0 0 380 150">
          <path class="e" d="M40 40 L100 40 L100 30 L160 30"/><path class="e" d="M40 40 L100 40 L100 70 L160 70"/><path class="e dead" d="M40 110 L100 110 L100 110 L160 110"/><path class="e" d="M180 30 L240 30 L240 50 L300 50"/>
          <g><rect class="nd done" x="34" y="34" width="12" height="12" transform="rotate(45 40 40)"/><text class="id" x="12" y="64">done</text></g>
          <g><rect class="nd" x="154" y="24" width="12" height="12" transform="rotate(45 160 30)"/><text class="id" x="172" y="34">ready</text></g>
          <g><rect class="nd rev" x="154" y="64" width="12" height="12" transform="rotate(45 160 70)"/><text class="id" x="172" y="74">review</text></g>
          <g><rect class="nd human" x="34" y="104" width="12" height="12" transform="rotate(45 40 110)"/><text class="id" x="8" y="134">needs you</text></g>
          <g><rect class="nd blk" x="154" y="104" width="12" height="12" transform="rotate(45 160 110)"/><text class="id" x="172" y="114">blocked</text></g>
          <g><rect class="nd run" x="293" y="43" width="14" height="14" transform="rotate(45 300 50)"/><text class="id" x="314" y="54">running</text></g>
          <g><rect class="nd draft" x="294" y="104" width="12" height="12" transform="rotate(45 300 110)"/><text class="id" x="314" y="114">draft</text></g>
        </svg>
        <p class="note" style="margin: 4px 0 0; font-size: 11.5px;">Edge = depends on. Dashed = the source can't proceed. The running node breathes.</p>
      </div></div>
      <div class="tile"><div class="th">design revisions · planning</div><div class="body">
        <div class="rev p"><span class="r">r4</span><div>Proposed by SR-5<span class="mt">sha 9f3c1a · after merge + your approval</span></div><span class="st">accept · reject</span></div>
        <div class="rev"><span class="r">r3</span><div>Pagination model<span class="mt">sha 4b7e2d · used by runs 27–31</span></div><span class="st">approved</span></div>
        <div class="msg"><span class="y">you</span><div>Fixed or derived page size?</div></div>
        <div class="msg"><span>planner</span><div>Derive it: core exposes <span class="m">pageSize(fontScale, viewport)</span>.</div></div>
      </div></div>
    </div>
  </div>
</div>` + foot;

writeFileSync('Tokens.dc.html', tokens);
writeFileSync('Components.dc.html', components);
const c = JSON.parse(readFileSync('canvas.json', 'utf8'));
c.pages = [{ id: 'system', name: 'System' }, { id: 'pages', name: 'Pages' }];
c.artboards.forEach(a => a.page = 'pages'); c.annotations.forEach(a => a.page = 'pages');
c.artboards.push({ file: 'Tokens.dc.html', x: 0, y: 0, w: 1440, h: 900, title: 'Tokens', page: 'system' }, { file: 'Components.dc.html', x: 1540, y: 0, w: 1440, h: 900, title: 'Components', page: 'system' });
c.annotations.push({ id: 'sys', x: 3080, y: 0, w: 420, page: 'system', text: 'HOUSE STYLE v0 — not a strict design system.\n\nSource of truth in the repo: design/DESIGN.md and design/tokens.css. This page is the visual companion. The four pages on the "Pages" page are built from these tokens.' });
c.launch = { view: 'canvas', page: 'system' };
writeFileSync('canvas.json', JSON.stringify(c, null, 2));
console.log('system ok');
