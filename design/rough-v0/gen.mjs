import { writeFileSync } from 'node:fs';

const attention = [
  { kind: 'Approve',   id: 'SR-12', title: 'Article list screen: e-ink pagination', meta: 'draft · design r3 · lane L3' },
  { kind: 'Re-arm',    id: 'SR-7',  title: 'Room migration v2',                      meta: 'needs human · verify failed twice with the same failure · $3.80 spent' },
  { kind: 'Answer',    id: 'SR-3',  title: 'OPML import',                            meta: 'needs human · run asked: keep folder hierarchy?' },
  { kind: 'Review',    id: 'SR-5',  title: 'Feed parser core (pure Kotlin)',         meta: 'PR #14 · CI passing · lane L3 · +412 −38' },
  { kind: 'Reconcile', id: 'SR-5',  title: 'proposes PROJECT-DESIGN.md r4',          meta: 'sha 9f3c1a · accept or reject' },
];
const frontier = [
  { id: 'SR-9',  title: 'Feed fixture parser tests',     state: 'ready',   note: 'L4' },
  { id: 'SR-10', title: 'Boox refresh-mode hook',        state: 'ready',   note: 'L3' },
  { id: 'SR-8',  title: 'Reader typography settings',    state: 'running', note: 'run 31' },
  { id: 'SR-11', title: 'Offline sync worker',           state: 'blocked', note: 'by SR-7' },
  { id: 'SR-13', title: 'Feed subscribe screen',         state: 'draft',   note: 'no design' },
];
const run = { id: 'SR-8', title: 'Reader typography settings', sandbox: 'sandbox fly-3', hb: 'heartbeat 4s ago', cost: '$1.42 of $5.00', time: '06:12 of 14:00', turns: '38 turns', phase: 'implement · verifying (fast)' };

const head = (title, fonts, css) => `<!doctype html>
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
    ${css}
  </style>
</helmet>`;
const foot = `</x-dc>
</body>
</html>`;

/* ---------- MAIN: shared wireframe ---------- */
function main() {
  const css = `
  .wf { width: 1280px; height: 800px; background: #f6f5f1; color: #222; font-family: 'Caveat', cursive; font-size: 20px; display: grid; grid-template-columns: 180px 1fr 1fr; grid-template-rows: 64px 1fr 150px; gap: 16px; padding: 16px; box-sizing: border-box; }
  .box { border: 2px dashed #777; border-radius: 4px; padding: 12px; box-sizing: border-box; background: #fbfaf7; }
  .box h3 { margin: 0 0 6px; font-size: 24px; font-weight: 700; }
  .box p { margin: 0 0 4px; line-height: 1.25; }
  .sm { font-size: 16px; color: #555; }
  .note { position: absolute; background: #fff5a6; padding: 6px 10px; transform: rotate(-2deg); font-size: 18px; box-shadow: 2px 2px 0 #c9b95a; }
  `;
  return head('Wireframe', 'family=Caveat:wght@400;700', css) + `
<div class="wf" style="position: relative;">
  <div class="box" style="grid-column: 1 / 4; display: flex; align-items: center; gap: 24px;">
    <span style="font-size: 28px; font-weight: 700;">Goblin Foundry</span>
    <span class="sm">Subway Reader ▾</span>
    <span class="sm" style="margin-left: auto;">⌘K anything · one run live · 5 things waiting on you</span>
  </div>
  <div class="box">
    <h3>Apps</h3>
    <p>Subway Reader</p>
    <p class="sm">— MVP project</p>
    <p class="sm">— Boox polish (later)</p>
    <p style="margin-top: 12px;">Goblin Foundry</p>
    <p class="sm">(dogfood, after SR)</p>
  </div>
  <div class="box">
    <h3>Waiting on you ①</h3>
    <p class="sm">Approve draft → ready</p>
    <p class="sm">Re-arm a needs-human ticket (with reason)</p>
    <p class="sm">Answer a run's question</p>
    <p class="sm">Review a PR (lane L3/L4)</p>
    <p class="sm">Accept/reject a design revision</p>
    <p style="margin-top: 8px;">Every row = one decision, one keystroke away.</p>
  </div>
  <div class="box">
    <h3>Ready frontier ③</h3>
    <p class="sm">ready ∧ unblocked ∧ not leased ∧ within limits</p>
    <p class="sm">shows blockers, lane, design revision</p>
    <p class="sm">running ticket glows here too</p>
    <p style="margin-top: 8px;">Order of tickets = order the controller will claim.</p>
  </div>
  <div class="box" style="grid-column: 2 / 4;">
    <h3>Running now ④</h3>
    <p class="sm">SR-8 · sandbox · heartbeat · cost / cap · time / cap · phase · evidence so far</p>
    <p class="sm">Design revision / planning conversation ② lives one click in from any ticket.</p>
  </div>
  <div class="note" style="left: 420px; top: 30px;">Same bones for all four skins →</div>
</div>` + foot;
}

/* ---------- A: THE FOUNDRY ---------- */
function foundry(mode) {
  const t = mode === 'day'
    ? { bg: '#EFE3CF', sur: '#F9F3E8', sur2: '#E8DAC2', ink: '#2A2822', mute: '#5E574A', copper: '#B4632A', verd: '#2F8A75', heat: '#E3672D', line: '#D8C8AC', glow: 'rgba(227,103,45,.28)' }
    : { bg: '#10201B', sur: '#172A24', sur2: '#20362E', ink: '#EFE5D3', mute: '#9AA69B', copper: '#E09256', verd: '#6FCDB3', heat: '#FF8C4B', line: '#2C443B', glow: 'rgba(255,140,75,.35)' };
  const css = `
  .a { width: 1280px; height: 800px; background: ${t.bg}; color: ${t.ink}; font-family: 'Public Sans', system-ui, sans-serif; font-size: 14px; display: grid; grid-template-columns: 72px 1fr; box-sizing: border-box; overflow: hidden; }
  .a .rail { background: ${t.sur2}; display: flex; flex-direction: column; align-items: center; gap: 18px; padding-top: 18px; }
  .a .mark { width: 36px; height: 36px; border-radius: 50%; background: ${t.copper}; display: grid; place-items: center; color: ${t.bg}; font-family: 'Bricolage Grotesque'; font-weight: 800; font-size: 18px; }
  .a .app { width: 40px; height: 40px; border-radius: 10px; border: 2px solid ${t.line}; display: grid; place-items: center; font-family: 'Bricolage Grotesque'; font-weight: 700; font-size: 13px; color: ${t.mute}; }
  .a .app.on { border-color: ${t.verd}; color: ${t.verd}; }
  .a .body { padding: 22px 32px; display: flex; flex-direction: column; gap: 20px; }
  .a h1 { font-family: 'Bricolage Grotesque'; font-weight: 800; font-size: 30px; letter-spacing: -0.02em; margin: 0; }
  .a .top { display: flex; align-items: baseline; gap: 18px; }
  .a .kbd { margin-left: auto; font-family: 'IBM Plex Mono'; font-size: 12px; color: ${t.mute}; border: 1px solid ${t.line}; padding: 6px 12px; border-radius: 999px; }
  /* pour line */
  .a .line { position: relative; height: 84px; display: grid; grid-template-columns: repeat(6, minmax(0,1fr)); align-items: end; }
  .a .line:before { content: ''; position: absolute; left: 0; right: 0; top: 40px; height: 6px; background: linear-gradient(90deg, ${t.verd}, ${t.copper} 55%, ${t.heat} 70%, ${t.verd}); border-radius: 3px; opacity: .9; }
  .a .st { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding-left: 4px; }
  .a .st b { font-family: 'Bricolage Grotesque'; font-weight: 700; font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: ${t.mute}; }
  .a .st .n { font-family: 'Bricolage Grotesque'; font-size: 28px; font-weight: 800; line-height: 1; }
  .a .st i { position: absolute; top: 37px; left: 4px; width: 12px; height: 12px; border-radius: 50%; background: ${t.sur}; border: 3px solid ${t.copper}; }
  .a .st.hot i { border-color: ${t.heat}; box-shadow: 0 0 0 8px ${t.glow}; }
  .a .cols { display: grid; grid-template-columns: 1.25fr 1fr; gap: 20px; flex: 1; min-height: 0; }
  .a .card { background: ${t.sur}; border: 1px solid ${t.line}; border-radius: 14px; padding: 18px 20px; display: flex; flex-direction: column; gap: 10px; }
  .a h2 { font-family: 'Bricolage Grotesque'; font-weight: 700; font-size: 18px; margin: 0; display: flex; align-items: baseline; gap: 10px; }
  .a h2 small { font-weight: 400; color: ${t.mute}; font-size: 13px; font-family: 'Public Sans'; }
  .a .row { display: grid; grid-template-columns: 92px 1fr auto; gap: 12px; align-items: center; padding: 10px 0; border-top: 1px solid ${t.line}; }
  .a .tag { font-family: 'Bricolage Grotesque'; font-weight: 700; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; padding: 4px 8px; border-radius: 6px; background: ${t.sur2}; color: ${t.copper}; text-align: center; }
  .a .tag.hot { background: ${t.heat}; color: ${t.bg}; }
  .a .tag.verd { background: ${t.verd}; color: ${t.bg}; }
  .a .ttl { display: flex; flex-direction: column; gap: 2px; }
  .a .ttl span { font-weight: 600; }
  .a .ttl em { font-style: normal; color: ${t.mute}; font-size: 12.5px; }
  .a .id { font-family: 'IBM Plex Mono'; font-size: 12px; color: ${t.mute}; }
  .a .key { font-family: 'IBM Plex Mono'; font-size: 11px; color: ${t.mute}; border: 1px solid ${t.line}; border-radius: 4px; padding: 2px 6px; }
  .a .slug { display: grid; grid-template-columns: 70px 1fr auto; gap: 12px; align-items: center; padding: 9px 12px; border-radius: 10px; border: 1px solid ${t.line}; }
  .a .slug.running { border-color: ${t.heat}; box-shadow: inset 0 0 0 1px ${t.heat}, 0 0 24px ${t.glow}; }
  .a .slug.blocked { opacity: .55; }
  .a .slug.draft { border-style: dashed; }
  .a .dot { width: 10px; height: 10px; border-radius: 50%; background: ${t.verd}; }
  .a .slug.running .dot { background: ${t.heat}; }
  .a .slug.blocked .dot { background: ${t.mute}; }
  .a .slug.draft .dot { background: transparent; border: 2px solid ${t.mute}; box-sizing: border-box; }
  .a .runbar { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 14px; margin-top: 4px; }
  .a .meter { display: flex; flex-direction: column; gap: 5px; font-family: 'IBM Plex Mono'; font-size: 12px; color: ${t.mute}; }
  .a .meter div { height: 6px; border-radius: 3px; background: ${t.sur2}; overflow: hidden; }
  .a .meter div i { display: block; height: 100%; background: ${t.copper}; }
  `;
  const att = attention.map((x, i) => `
    <div class="row">
      <span class="tag ${x.kind === 'Re-arm' || x.kind === 'Answer' ? 'hot' : x.kind === 'Review' ? 'verd' : ''}">${x.kind}</span>
      <div class="ttl"><span><span class="id">${x.id}</span> &nbsp;${x.title}</span><em>${x.meta}</em></div>
      <span class="key">${i + 1}</span>
    </div>`).join('');
  const fr = frontier.map(x => `
    <div class="slug ${x.state}"><span class="id">${x.id}</span><span style="display: flex; align-items: center; gap: 10px;"><i class="dot"></i>${x.title}</span><span class="id">${x.state === 'running' ? run.hb : x.note}</span></div>`).join('');
  return head('Foundry', 'family=Bricolage+Grotesque:wght@700;800&family=Public+Sans:wght@400;600&family=IBM+Plex+Mono', css) + `
<div class="a">
  <div class="rail">
    <div class="mark">G</div>
    <div class="app on">SR</div>
    <div class="app">GF</div>
  </div>
  <div class="body">
    <div class="top"><h1>Subway Reader</h1><span style="color: ${t.mute};">MVP project · design r3 approved</span><span class="kbd">⌘K  approve · re-arm · open · ticket</span></div>
    <div class="line">
      <div class="st"><b>Draft</b><span class="n">3</span><i></i></div>
      <div class="st"><b>Ready</b><span class="n">2</span><i></i></div>
      <div class="st hot"><b>Running</b><span class="n">1</span><i></i></div>
      <div class="st"><b>Needs you</b><span class="n">2</span><i></i></div>
      <div class="st"><b>Review</b><span class="n">1</span><i></i></div>
      <div class="st"><b>Done</b><span class="n">4</span><i></i></div>
    </div>
    <div class="cols">
      <div class="card">
        <h2>Waiting on you <small>5 decisions · press a number</small></h2>
        ${att}
      </div>
      <div style="display: flex; flex-direction: column; gap: 20px; min-height: 0;">
        <div class="card" style="flex: 1;">
          <h2>Ready frontier <small>claim order</small></h2>
          <div style="display: flex; flex-direction: column; gap: 8px;">${fr}</div>
        </div>
        <div class="card" style="border-color: ${t.heat};">
          <h2>Pouring <small>${run.id} · ${run.phase}</small></h2>
          <div class="runbar">
            <div class="meter"><span>${run.cost}</span><div><i style="width: 28%;"></i></div></div>
            <div class="meter"><span>${run.time}</span><div><i style="width: 44%;"></i></div></div>
            <div class="meter"><span>${run.turns}</span><div><i style="width: 47%;"></i></div></div>
            <div class="meter"><span>${run.sandbox}</span><div><i style="width: 100%; background: ${t.verd};"></i></div></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>` + foot;
}

/* ---------- B: FIELD NOTEBOOK ---------- */
function notebook(mode) {
  const t = mode === 'day'
    ? { bg: '#F5EEDD', page: '#FBF6EA', ink: '#1F2A22', mute: '#655F53', moss: '#4E6B3A', rust: '#A9532C', rule: '#E2D8C1', pencil: '#6F6959', tape: 'rgba(200,180,120,.45)' }
    : { bg: '#1A1813', page: '#221F19', ink: '#EAE1CC', mute: '#9E9685', moss: '#93B96E', rust: '#D97A4C', rule: '#342F25', pencil: '#A79F8A', tape: 'rgba(230,200,120,.25)' };
  const css = `
  .b { width: 1280px; height: 800px; background: ${t.bg}; color: ${t.ink}; font-family: 'Literata', Georgia, serif; font-size: 15px; box-sizing: border-box; padding: 28px 36px; display: grid; grid-template-columns: 150px 1fr 340px; gap: 28px; overflow: hidden; }
  .b .page { background: ${t.page}; box-shadow: 0 1px 0 ${t.rule}, 0 6px 18px rgba(0,0,0,.08); padding: 26px 30px; box-sizing: border-box; background-image: repeating-linear-gradient(transparent 0 27px, ${t.rule} 27px 28px); background-position: 0 58px; }
  .b .margin { font-family: 'Caveat', cursive; font-size: 19px; color: ${t.pencil}; display: flex; flex-direction: column; gap: 14px; padding-top: 10px; }
  .b .margin b { font-family: 'Instrument Serif', serif; font-weight: 400; font-size: 26px; color: ${t.ink}; letter-spacing: -0.01em; }
  .b h1 { font-family: 'Instrument Serif', serif; font-weight: 400; font-size: 40px; margin: 0; line-height: 1; letter-spacing: -0.01em; }
  .b h1 i { color: ${t.rust}; }
  .b .date { font-family: 'Courier Prime', monospace; font-size: 13px; color: ${t.mute}; }
  .b h2 { font-family: 'Instrument Serif', serif; font-weight: 400; font-size: 22px; margin: 26px 0 6px; border-bottom: 1px solid ${t.ink}; padding-bottom: 2px; display: flex; justify-content: space-between; align-items: baseline; }
  .b h2 span { font-family: 'Courier Prime'; font-size: 12px; color: ${t.mute}; }
  .b .li { display: grid; grid-template-columns: 22px 88px 1fr; gap: 10px; line-height: 28px; align-items: baseline; }
  .b .li .bx { width: 13px; height: 13px; border: 1.5px solid ${t.ink}; display: inline-block; vertical-align: -1px; }
  .b .li .k { font-family: 'Courier Prime'; font-size: 13px; color: ${t.rust}; text-transform: uppercase; letter-spacing: .05em; }
  .b .li em { font-style: italic; color: ${t.mute}; font-size: 14px; }
  .b .li .id { font-family: 'Courier Prime'; font-size: 13px; color: ${t.mute}; }
  .b .cards { display: flex; flex-direction: column; gap: 16px; padding-top: 6px; }
  .b .card { background: ${t.page}; border: 1px solid ${t.rule}; padding: 14px 16px 12px; position: relative; box-shadow: 0 2px 6px rgba(0,0,0,.06); }
  .b .card:before { content: ''; position: absolute; top: -8px; left: 50%; width: 60px; height: 16px; margin-left: -30px; background: ${t.tape}; transform: rotate(-2deg); }
  .b .card .id { font-family: 'Courier Prime'; font-size: 12px; color: ${t.mute}; display: flex; justify-content: space-between; }
  .b .card .t { font-family: 'Instrument Serif'; font-size: 20px; margin: 2px 0 6px; }
  .b .card .s { font-family: 'Caveat'; font-size: 18px; color: ${t.moss}; }
  .b .card.running { border-color: ${t.rust}; }
  .b .card.running .s { color: ${t.rust}; }
  .b .card.blocked { opacity: .6; }
  .b .card.draft { border-style: dashed; }
  .b .spec { border: 1px solid ${t.ink}; padding: 10px 12px; font-family: 'Courier Prime'; font-size: 12.5px; line-height: 1.5; margin-top: 4px; }
  .b .spec b { font-family: 'Instrument Serif'; font-size: 17px; font-weight: 400; display: block; }
  `;
  const att = attention.map(x => `<div class="li"><span class="bx"></span><span class="k">${x.kind}</span><span><span class="id">${x.id}</span> ${x.title} — <em>${x.meta}</em></span></div>`).join('');
  const fr = frontier.map(x => `<div class="card ${x.state}"><div class="id"><span>${x.id}</span><span>${x.state}</span></div><div class="t">${x.title}</div><div class="s">${x.state === 'running' ? run.hb + ' · ' + run.cost : x.state === 'blocked' ? 'waiting on ' + x.note : x.state === 'draft' ? 'needs a design first' : 'lane ' + x.note + ', unblocked'}</div></div>`).join('');
  return head('Notebook', 'family=Instrument+Serif&family=Literata:ital,wght@0,400;0,600;1,400&family=Caveat&family=Courier+Prime', css) + `
<div class="b">
  <div class="margin">
    <b>Goblin<br>Foundry</b>
    <span>apps</span>
    <span style="color: ${t.ink};">→ Subway Reader</span>
    <span>&nbsp;&nbsp;&nbsp;Goblin Foundry</span>
    <span style="margin-top: 20px;">design r3<br>approved Aug 24</span>
    <span>r4 proposed<br>by SR-5 ↗</span>
    <span style="margin-top: auto;">⌘K to write<br>anywhere</span>
  </div>
  <div class="page">
    <div class="date">Tuesday 26 August · entry 41</div>
    <h1>Subway Reader, <i>MVP</i></h1>
    <h2>To decide <span>five, in order of cost of waiting</span></h2>
    ${att}
    <h2>Running <span>${run.id} · ${run.phase}</span></h2>
    <div class="li"><span></span><span class="k">${run.sandbox}</span><span>${run.title} — <em>${run.hb}, ${run.cost}, ${run.time}, ${run.turns}</em></span></div>
    <div class="spec" style="margin-top: 22px; width: 380px;"><b>PROJECT-DESIGN.md · r3</b>path research/subway-reader/PROJECT-DESIGN.md<br>sha 4b7e2d · approved by you · used by runs 27–31</div>
  </div>
  <div class="cards">
    <div style="font-family: 'Instrument Serif'; font-size: 22px; display: flex; justify-content: space-between; align-items: baseline;">Ready frontier <span class="date">claim order</span></div>
    ${fr}
  </div>
</div>` + foot;
}

/* ---------- C: CONTROL ROOM ---------- */
function control(mode) {
  const t = mode === 'day'
    ? { bg: '#E4E7E0', pan: '#EEF0EA', ink: '#15181A', mute: '#5F6660', amber: '#9A5A00', green: '#1E6E3C', red: '#A8321E', line: '#B9BFB4', fill: '#D6DAD2' }
    : { bg: '#0B0D0C', pan: '#111413', ink: '#D9D6C9', mute: '#6F756D', amber: '#FFB000', green: '#7CFF9B', red: '#FF5C4D', line: '#242926', fill: '#1A1F1C' };
  const css = `
  .c { width: 1280px; height: 800px; background: ${t.bg}; color: ${t.ink}; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12.5px; box-sizing: border-box; padding: 14px; display: grid; grid-template-rows: 24px 150px 1fr; gap: 12px; overflow: hidden; line-height: 1.4; }
  .c .bar { display: flex; gap: 22px; align-items: center; text-transform: uppercase; letter-spacing: .1em; font-size: 11px; color: ${t.mute}; }
  .c .bar b { color: ${t.ink}; font-weight: 700; }
  .c .bar .live { color: ${t.green}; }
  .c .bar .live:before { content: '●'; margin-right: 6px; }
  .c .pan { background: ${t.pan}; border: 1px solid ${t.line}; padding: 10px 12px; box-sizing: border-box; display: flex; flex-direction: column; gap: 6px; min-height: 0; }
  .c .hd { text-transform: uppercase; letter-spacing: .12em; font-size: 11px; color: ${t.mute}; display: flex; justify-content: space-between; border-bottom: 1px solid ${t.line}; padding-bottom: 6px; margin-bottom: 4px; }
  .c .fsm { position: relative; display: grid; grid-template-columns: repeat(6, minmax(0,1fr)); align-items: center; height: 100%; }
  .c .fsm:before { content: ''; position: absolute; left: 60px; right: 60px; top: 50%; border-top: 1px solid ${t.line}; }
  .c .node { position: relative; justify-self: center; border: 1px solid ${t.line}; background: ${t.bg}; padding: 8px 12px; min-width: 110px; text-align: center; }
  .c .node b { display: block; font-size: 22px; font-weight: 700; line-height: 1.1; }
  .c .node span { text-transform: uppercase; letter-spacing: .1em; font-size: 10px; color: ${t.mute}; }
  .c .node.on { border-color: ${t.amber}; color: ${t.amber}; box-shadow: 0 0 0 1px ${t.amber} inset; }
  .c .node.hum { border-color: ${t.red}; }
  .c .node.hum b { color: ${t.red}; }
  .c .edge { position: absolute; top: 12px; left: 0; right: 0; text-align: center; font-size: 10px; color: ${t.mute}; }
  .c .grid { display: grid; grid-template-columns: 1.3fr 1fr 0.9fr; gap: 12px; min-height: 0; }
  .c table { border-collapse: collapse; width: 100%; }
  .c td { padding: 6px 6px; border-bottom: 1px solid ${t.line}; vertical-align: top; }
  .c td.k { color: ${t.amber}; text-transform: uppercase; letter-spacing: .08em; font-size: 11px; white-space: nowrap; }
  .c td.k.hum { color: ${t.red}; }
  .c td.k.ok { color: ${t.green}; }
  .c td .m { color: ${t.mute}; display: block; font-size: 11.5px; }
  .c td.h { text-align: right; color: ${t.mute}; white-space: nowrap; }
  .c td.h kbd { border: 1px solid ${t.line}; padding: 0 5px; font-family: inherit; }
  .c .st { text-transform: uppercase; font-size: 10.5px; letter-spacing: .08em; }
  .c .st.ready { color: ${t.green}; } .c .st.running { color: ${t.amber}; } .c .st.blocked, .c .st.draft { color: ${t.mute}; }
  .c .tel { display: grid; grid-template-columns: 96px 1fr 70px; gap: 8px; align-items: center; }
  .c .tel .g { height: 8px; background: ${t.fill}; position: relative; }
  .c .tel .g i { position: absolute; left: 0; top: 0; bottom: 0; background: ${t.amber}; }
  .c .tel .g i.ok { background: ${t.green}; }
  .c .hb { font-size: 11px; color: ${t.mute}; letter-spacing: .05em; word-break: break-all; line-height: 1.3; }
  .c .hb b { color: ${t.green}; font-weight: 400; }
  `;
  const att = attention.map((x, i) => `<tr><td class="k ${x.kind === 'Re-arm' || x.kind === 'Answer' ? 'hum' : x.kind === 'Review' ? 'ok' : ''}">${x.kind}</td><td>${x.id} ${x.title}<span class="m">${x.meta}</span></td><td class="h"><kbd>${i + 1}</kbd></td></tr>`).join('');
  const fr = frontier.map((x, i) => `<tr><td class="h" style="text-align: left;">${i + 1}</td><td>${x.id} ${x.title}</td><td class="h"><span class="st ${x.state}">${x.state}</span> ${x.note}</td></tr>`).join('');
  return head('Control', 'family=JetBrains+Mono:wght@400;700', css) + `
<div class="c">
  <div class="bar"><b>GOBLIN FOUNDRY</b><span>app SUBWAY-READER</span><span>project MVP</span><span>design r3 @4b7e2d</span><span class="live">controller tick 2s</span><span style="margin-left: auto;">⌘K</span></div>
  <div class="pan">
    <div class="hd"><span>lifecycle · authority: human unless marked</span><span>edges: controller ▸ · human ▹</span></div>
    <div class="fsm">
      <div class="node"><b>3</b><span>draft</span><i class="edge">▹ approve</i></div>
      <div class="node"><b>2</b><span>ready</span><i class="edge">▸ lease</i></div>
      <div class="node on"><b>1</b><span>running</span><i class="edge">▸ pr exists</i></div>
      <div class="node hum"><b>2</b><span>needs_human</span><i class="edge">▹ re-arm</i></div>
      <div class="node"><b>1</b><span>ready_for_review</span><i class="edge">▹ merge</i></div>
      <div class="node"><b>4</b><span>done</span></div>
    </div>
  </div>
  <div class="grid">
    <div class="pan"><div class="hd"><span>attention · 5</span><span>oldest first</span></div><table>${att}</table></div>
    <div class="pan"><div class="hd"><span>frontier · claim order</span><span>ready ∧ ¬blocked ∧ ¬leased</span></div><table>${fr}</table></div>
    <div class="pan">
      <div class="hd"><span>run 31 · ${run.id}</span><span>${run.sandbox}</span></div>
      <div class="tel"><span>cost</span><div class="g"><i style="width: 28%;"></i></div><span style="text-align: right;">1.42/5.00</span></div>
      <div class="tel"><span>wall</span><div class="g"><i style="width: 44%;"></i></div><span style="text-align: right;">06:12/14</span></div>
      <div class="tel"><span>turns</span><div class="g"><i style="width: 47%;"></i></div><span style="text-align: right;">38/80</span></div>
      <div class="tel"><span>lease</span><div class="g"><i class="ok" style="width: 100%;"></i></div><span style="text-align: right;">hb 4s</span></div>
      <div class="hd" style="margin-top: 8px;"><span>events</span><span>${run.phase}</span></div>
      <div class="hb">06:08 ▸ verify(fast) exit 1 · 2 tests<br>06:09 ▸ correct_same_session 1/2<br>06:11 ▸ edit core/Typography.kt<br>06:12 ▸ verify(fast) <b>running</b><br>—— protected digests ok · scope ok</div>
    </div>
  </div>
</div>` + foot;
}

/* ---------- D: GOBLIN WORKSHOP ---------- */
function goblin(mode) {
  const t = mode === 'day'
    ? { bg: '#F1E3C3', pan: '#FBF3DF', ink: '#2B1E17', mute: '#63534A', green: '#5B9A45', torch: '#E8842C', plum: '#6E4D93', line: '#2B1E17', shadow: '#2B1E17', wood: '#C89A62' }
    : { bg: '#1D1823', pan: '#2A2333', ink: '#F4EAD5', mute: '#A398B0', green: '#7FC864', torch: '#FFA447', plum: '#B692E6', line: '#F4EAD5', shadow: '#0B080F', wood: '#5A4433' };
  const css = `
  .d { width: 1280px; height: 800px; background: ${t.bg}; color: ${t.ink}; font-family: 'Sora', system-ui, sans-serif; font-size: 14px; box-sizing: border-box; padding: 20px 28px; display: grid; grid-template-rows: 44px 210px 1fr; gap: 18px; overflow: hidden; }
  .d .hd { display: flex; align-items: center; gap: 16px; }
  .d h1 { font-family: 'Silkscreen', monospace; font-size: 22px; margin: 0; letter-spacing: -.02em; }
  .d .pill { border: 3px solid ${t.line}; background: ${t.pan}; padding: 6px 12px; box-shadow: 4px 4px 0 ${t.shadow}; font-weight: 600; font-size: 13px; }
  .d .benches { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 18px; }
  .d .bench { border: 3px solid ${t.line}; background: ${t.pan}; box-shadow: 6px 6px 0 ${t.shadow}; padding: 14px 16px; display: grid; grid-template-columns: 96px 1fr; gap: 14px; position: relative; }
  .d .bench:after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 18px; background: ${t.wood}; border-top: 3px solid ${t.line}; }
  .d .bench h3 { font-family: 'Silkscreen'; font-size: 13px; margin: 0 0 6px; }
  .d .bench p { margin: 0 0 4px; line-height: 1.35; }
  .d .bench .m { color: ${t.mute}; font-size: 12.5px; }
  .d .bubble { display: inline-block; border: 2px solid ${t.line}; background: ${t.bg}; padding: 4px 8px; font-size: 12px; margin-top: 6px; box-shadow: 3px 3px 0 ${t.shadow}; }
  .d .cols { display: grid; grid-template-columns: 1.2fr 1fr; gap: 18px; min-height: 0; }
  .d .board { border: 3px solid ${t.line}; background: ${t.pan}; box-shadow: 6px 6px 0 ${t.shadow}; padding: 16px 18px; display: flex; flex-direction: column; gap: 10px; }
  .d h2 { font-family: 'Silkscreen'; font-size: 14px; margin: 0; display: flex; justify-content: space-between; }
  .d h2 span { font-family: 'Sora'; font-weight: 400; color: ${t.mute}; font-size: 12px; }
  .d .note { display: grid; grid-template-columns: 84px 1fr auto; gap: 12px; align-items: center; padding: 9px 10px; border: 2px solid ${t.line}; background: ${t.bg}; box-shadow: 3px 3px 0 ${t.shadow}; }
  .d .kind { font-family: 'Silkscreen'; font-size: 10px; padding: 4px 6px; text-align: center; border: 2px solid ${t.line}; background: ${t.green}; color: #fff; }
  .d .kind.hot { background: ${t.torch}; } .d .kind.plum { background: ${t.plum}; }
  .d .note b { display: block; font-weight: 600; }
  .d .note i { font-style: normal; color: ${t.mute}; font-size: 12px; }
  .d .kbd { font-family: 'Silkscreen'; font-size: 11px; border: 2px solid ${t.line}; padding: 2px 6px; }
  .d .crate { display: grid; grid-template-columns: 24px 60px 1fr auto; gap: 10px; align-items: center; padding: 8px 10px; border: 2px solid ${t.line}; background: ${t.bg}; }
  .d .crate.blocked { opacity: .55; } .d .crate.draft { border-style: dashed; } .d .crate.running { border-color: ${t.torch}; box-shadow: 3px 3px 0 ${t.torch}; }
  .d .sq { width: 14px; height: 14px; border: 2px solid ${t.line}; background: ${t.green}; }
  .d .crate.running .sq { background: ${t.torch}; } .d .crate.blocked .sq { background: ${t.mute}; } .d .crate.draft .sq { background: transparent; }
  .d .id { font-family: 'Silkscreen'; font-size: 10px; color: ${t.mute}; }
  `;
  const gob = (fill, mood) => `<svg width="96" height="96" viewBox="0 0 48 48" shape-rendering="crispEdges" aria-hidden="true">
    <rect x="6" y="14" width="6" height="8" fill="${fill}"/><rect x="36" y="14" width="6" height="8" fill="${fill}"/>
    <rect x="12" y="10" width="24" height="20" fill="${fill}"/>
    <rect x="17" y="17" width="4" height="4" fill="${t.ink}"/><rect x="27" y="17" width="4" height="4" fill="${t.ink}"/>
    ${mood === 'ask' ? `<rect x="20" y="25" width="8" height="2" fill="${t.ink}"/>` : mood === 'idle' ? `<rect x="18" y="25" width="12" height="2" fill="${t.ink}"/>` : `<rect x="18" y="24" width="12" height="3" fill="${t.ink}"/><rect x="20" y="27" width="8" height="1" fill="${t.ink}"/>`}
    <rect x="14" y="30" width="20" height="12" fill="${t.plum}"/><rect x="10" y="32" width="4" height="8" fill="${fill}"/><rect x="34" y="32" width="4" height="8" fill="${fill}"/>
    <rect x="16" y="42" width="6" height="4" fill="${t.ink}"/><rect x="26" y="42" width="6" height="4" fill="${t.ink}"/>
  </svg>`;
  const att = attention.map((x, i) => `<div class="note"><span class="kind ${x.kind === 'Re-arm' || x.kind === 'Answer' ? 'hot' : x.kind === 'Reconcile' ? 'plum' : ''}">${x.kind}</span><span><b><span class="id">${x.id}</span> ${x.title}</b><i>${x.meta}</i></span><span class="kbd">${i + 1}</span></div>`).join('');
  const fr = frontier.map(x => `<div class="crate ${x.state}"><i class="sq"></i><span class="id">${x.id}</span><span>${x.title}</span><span class="id">${x.state === 'running' ? 'at bench 1' : x.note}</span></div>`).join('');
  return head('Goblin', 'family=Silkscreen:wght@400;700&family=Sora:wght@400;600', css) + `
<div class="d">
  <div class="hd"><h1>GOBLIN FOUNDRY</h1><span class="pill">Subway Reader · MVP</span><span class="pill" style="border-color: ${t.torch};">design r3 approved</span><span class="pill" style="margin-left: auto;">⌘K</span></div>
  <div class="benches">
    <div class="bench" style="border-color: ${t.torch};">${gob(t.green, 'work')}<div><h3>BENCH 1 · ${run.sandbox}</h3><p>${run.id} ${run.title}</p><p class="m">${run.cost} · ${run.time} · ${run.turns}</p><span class="bubble">verifying… 2 tests failed, fixing</span></div></div>
    <div class="bench">${gob(t.green, 'ask')}<div><h3>BENCH 2 · waiting</h3><p>SR-3 OPML import</p><p class="m">stopped and came back with a question</p><span class="bubble">keep folder hierarchy?</span></div></div>
    <div class="bench">${gob(t.green, 'idle')}<div><h3>BENCH 3 · idle</h3><p class="m">Next up: SR-9, when bench 1 frees.</p></div></div>
  </div>
  <div class="cols">
    <div class="board"><h2>YOUR DESK <span>5 things to decide</span></h2>${att}</div>
    <div class="board"><h2>SHELF <span>ready frontier, claim order</span></h2><div style="display: flex; flex-direction: column; gap: 8px;">${fr}</div></div>
  </div>
</div>` + foot;
}

writeFileSync('Main.dc.html', main());
writeFileSync('FoundryDay.dc.html', foundry('day'));
writeFileSync('FoundryNight.dc.html', foundry('night'));
writeFileSync('NotebookDay.dc.html', notebook('day'));
writeFileSync('NotebookNight.dc.html', notebook('night'));
writeFileSync('ControlDay.dc.html', control('day'));
writeFileSync('ControlNight.dc.html', control('night'));
writeFileSync('GoblinDay.dc.html', goblin('day'));
writeFileSync('GoblinNight.dc.html', goblin('night'));

const W = 1280, H = 800, GX = 100, GY = 200;
const row = (y, a, b) => [{ file: a, x: 0, y, w: W, h: H }, { file: b, x: W + GX, y, w: W, h: H }];
const canvas = {
  artboards: [
    { file: 'Main.dc.html', x: 0, y: 0, w: W, h: H, title: 'Shared bones (wireframe)' },
    ...row(H + GY, 'FoundryDay.dc.html', 'FoundryNight.dc.html'),
    ...row(2 * (H + GY), 'NotebookDay.dc.html', 'NotebookNight.dc.html'),
    ...row(3 * (H + GY), 'ControlDay.dc.html', 'ControlNight.dc.html'),
    ...row(4 * (H + GY), 'GoblinDay.dc.html', 'GoblinNight.dc.html'),
  ],
  annotations: [
    { id: 'brief', x: W + GX, y: 0, w: 520, text: 'Goblin Foundry tracker — home screen, four directions.\n\nSame bones every time: Waiting on you (decisions) · Ready frontier (claim order) · Running now (evidence, budget, heartbeat). Apps/projects on the side; design revisions one click in.\n\nRough sketches to pick a FEEL. Day + night for each, as two characters rather than an inverted palette.' },
    { id: 'a-note', x: 2 * W + 2 * GX, y: H + GY, w: 360, text: 'A · THE FOUNDRY (solarpunk industrial)\nWhy: the lifecycle is literally a pour line; heat = a run in progress; copper/verdigris keep it warm but serious.\nTradeoff: the metaphor has to earn its keep on every screen or it becomes decoration.' },
    { id: 'b-note', x: 2 * W + 2 * GX, y: 2 * (H + GY), w: 360, text: 'B · FIELD NOTEBOOK\nWhy: the blueprint calls the tracker "durable memory" — this reads like one. Best for long design docs and planning conversations.\nTradeoff: lowest density; the running-run telemetry feels slightly out of place on paper.' },
    { id: 'c-note', x: 2 * W + 2 * GX, y: 3 * (H + GY), w: 360, text: 'C · CONTROL ROOM\nWhy: "code owns the loop" made visible — the FSM with authority marked is the header. Densest; fastest with a keyboard.\nTradeoff: closest to the AI-tool default look; hostile to reading prose.' },
    { id: 'd-note', x: 2 * W + 2 * GX, y: 4 * (H + GY), w: 360, text: 'D · GOBLIN WORKSHOP\nWhy: benches make sandboxes, leases and questions tangible — a goblin waiting with a question is impossible to ignore. Data views stay typographic.\nTradeoff: risks toy-ness; needs real sprite craft and discipline about where characters appear.' },
  ],
  launch: { view: 'canvas' },
};
writeFileSync('canvas.json', JSON.stringify(canvas, null, 2));
console.log('ok');
