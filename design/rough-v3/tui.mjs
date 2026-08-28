import { writeFileSync } from 'node:fs';
const W = 168; // columns
const pad = (s, n) => { const l = [...s].length; return l >= n ? [...s].slice(0, n).join('') : s + ' '.repeat(n - l); };
const box = (title, w, lines, h, focus = false) => {
  const inner = w - 2; const out = [];
  const t = ` ${title} `; const top = (focus ? '┏' : '┌') + (focus ? '━' : '─') + t + (focus ? '━' : '─').repeat(Math.max(0, inner - [...t].length - 1)) + (focus ? '┓' : '┐');
  out.push(top);
  for (let i = 0; i < h - 2; i++) out.push((focus ? '┃' : '│') + pad(lines[i] ?? '', inner) + (focus ? '┃' : '│'));
  out.push((focus ? '┗' : '└') + (focus ? '━' : '─').repeat(inner) + (focus ? '┛' : '┘'));
  return out;
};
const beside = (...cols) => { const h = Math.max(...cols.map(c => c.length)); return Array.from({ length: h }, (_, i) => cols.map(c => c[i] ?? ' '.repeat([...c[0]].length)).join('')); };

const att = [
  ['1', 'APPROVE  ', 'SR-12', 'Article list screen: e-ink pagination', 'draft · design r3 · L3'],
  ['2', 'RE-ARM   ', 'SR-7 ', 'Room migration v2', 'verify failed ×2, same failure · $3.80'],
  ['3', 'ANSWER   ', 'SR-3 ', 'OPML import', 'run asked: keep folder hierarchy?'],
  ['4', 'REVIEW   ', 'SR-5 ', 'Feed parser core (pure Kotlin)', 'PR #14 · CI green · L3 · +412 −38'],
  ['5', 'RECONCILE', 'SR-5 ', 'proposes PROJECT-DESIGN.md r4', 'sha 9f3c1a · accept / reject'],
];
const fr = [
  ['◆', 'SR-9 ', 'Feed fixture parser tests', 'ready   L4 · next'],
  ['◆', 'SR-10', 'Boox refresh-mode hook', 'ready   L3'],
  ['●', 'SR-8 ', 'Reader typography settings', 'running run 31 · hb 4s'],
  ['◇', 'SR-11', 'Offline sync worker', 'blocked by SR-7'],
  ['·', 'SR-13', 'Feed subscribe screen', 'draft   no design'],
];
const home = () => {
  const L = [];
  L.push(pad(' goblin-foundry  [1 home] 2 tickets  3 design  4 runs  5 evidence      subway-reader/mvp · r3@4b7e2d', W - 34) + 'draft 3 ready 2 run 1 NEEDS 2 rev 1 ');
  const a = []; a.push('');
  att.forEach(([n, k, id, t, m], i) => { a.push(`${i === 0 ? '▶' : ' '} [${n}] ${k} ${id}  ${t}`); a.push(`               ${m}`); a.push(''); });
  a.push(''); a.push(' j/k move   ⏎ open   a approve   r re-arm   : command');
  const g = ['',
    '   SR-1 ◆──┬── SR-2 ◆──┐',
    '   core    │   fetch   ├── SR-5 ◈ parser ──┬── SR-9 ◆ fixture tests',
    '           │           │       review      ├── SR-8 ● typography ──┐',
    '           └── SR-4 ◆──┤                   └── SR-10 ◆ refresh    ├── SR-12 ▲ article list ─── SR-13 · subscribe',
    '               fixtures└── SR-3 ▲ opml import                      │',
    '                                                                   │',
    '   SR-7 ▲ room migration ╌╌╌ SR-11 ◇ offline sync                  │',
    '',
    '   ◆ done/ready  ◈ review  ● running  ▲ needs you  ◇ blocked  · draft    ╌╌ source can\'t proceed',
  ];
  const f = ['']; fr.forEach(([s, id, t, n]) => f.push(` ${s} ${id}  ${pad(t, 30)} ${n}`)); f.push(''); f.push(' J/K reorder claim order   s status   n new');
  const r = ['',
    ' spend  ▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱▱▱▱  $1.42 / 5.00',
    ' wall   ▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱  06:12 / 14:00',
    ' turns  ▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱  38 / 80',
    '',
    ' 06:08 verify(fast) exit 1 · 2 tests failed',
    ' 06:09 correct_same_session 1/2',
    ' 06:11 edit core/Typography.kt',
    ' 06:12 verify(fast) running █',
    ' digests ok · scope ok · fly-3 · hb 4s',
  ];
  const left = box('waiting on you · 5', 78, a, 22, true);
  const right = box('frontier · what depends on what', W - 78, g, 22);
  const bl = box('claim order', 78, f, 14);
  const br = box('run 31 · SR-8 · verifying (fast) · fly-3', W - 78, r, 14);
  L.push(...beside(left, right)); L.push(...beside(bl, br));
  L.push(pad(' :  ', W - 30) + 'tue 09:41  ? help  q quit ');
  return L;
};
const ticket = () => {
  const L = [];
  L.push(pad(' goblin-foundry   1 home [2 tickets] 3 design  4 runs  5 evidence      tickets / subway-reader / mvp / SR-12', W - 34) + 'draft 3 ready 2 run 1 NEEDS 2 rev 1 ');
  const s = ['', ' SR-12  Article list screen: e-ink pagination                       DRAFT', '',
    ' The article list is the home screen of Subway Reader. On Boox e-ink it',
    ' must paginate with full-page refreshes: no scrolling, no partial redraws,',
    ' one tap per page. Unread count comes from the core module; the screen',
    ' never computes it.', '',
    ' ACCEPTANCE', '  1. List paginates with a full-page refresh, no partial redraws on Boox.', '  2. Unread count matches core fixture 07.', '  3. Screenshot of first and last page attached as evidence.', '',
    ' SCOPE       app/src/main/…/reader/list/**   core/src/…/paging/**', ' PROTECTED   core/src/test/fixtures/**   verify.mk', '', '', ' e edit   a approve → ready   d deps   p plan   esc back'];
  const st = ['', ' status     DRAFT → ready needs your approval', ' lane       L3', ' design     r3 @4b7e2d  PROJECT-DESIGN.md', ' depends    SR-5  SR-8', ' blocks     SR-13', ' budget     $5 · 14 min · 80 turns', '', ' RUNS       none yet', '', ' HISTORY', '  1h  you      edited spec · rev 2', '  3h  planner  proposed acceptance #3', '  1d  you      created from planning · r3'];
  const p = ['', ' you      Should page size be fixed or derived from the device font scale?', '', ' planner  Derive it: core exposes pageSize(fontScale, viewport); the screen', '          just asks. Keeps the Boox variant testable on JVM.', '', ' you      Agreed. Deferred: landscape. Not in MVP.', '', ' planner  Open: should the unread badge refresh on page turn or on sync', '          only? Affects acceptance #2.', '', ' > █', '', ' ⏎ send   ready when no open question can change scope'];
  L.push(...beside(box('spec · rev 2', 100, s, 21, true), box('state', W - 100, st, 21)));
  L.push(...box('planning · 3 exchanges · 1 open question', W, p, 15));
  L.push(pad(' :  ', W - 30) + 'tue 09:41  ? help  q quit ');
  return L;
};

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const color = (lines, t) => lines.map(l => esc(l)
  .replace(/\[(\d)\]|(?<=\[)[12345] home|\[1 home\]|\[2 tickets\]/g, m => `<b class="c">${m}</b>`)
  .replace(/\b(RE-ARM|ANSWER|NEEDS|running|▲|●)\b|▲|●|█/g, m => `<b class="m">${m}</b>`)
  .replace(/\b(APPROVE|REVIEW|RECONCILE|ready|review|◆|◈)\b|◆|◈|▰+/g, m => `<b class="c">${m}</b>`)
  .replace(/\b(DRAFT|draft)\b/g, m => `<b class="a">${m}</b>`)
  .replace(/\bSR-\d+\b/g, m => `<span class="id">${m}</span>`)
  .replace(/^(▶)/, '<b class="c">▶</b>')
  .replace(/^(\s*)([┏┃┗][^\n]*)$/, (m, sp, rest) => sp + rest)
);
const frame = (title, lines, mode) => {
  const t = mode === 'night' ? { bg: '#07090E', ink: '#D7E3E9', mute: '#5E7280', c: '#3AF0FF', m: '#FF2D86', a: '#FFC14D', bar: '#0E1520' } : { bg: '#EEF2F4', ink: '#0C161D', mute: '#5B6E79', c: '#006E7F', m: '#B50D57', a: '#8A5A00', bar: '#DDE5EA' };
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap">
  <style>
    body { margin: 0; }
    a { color: inherit; } a:hover { color: inherit; }
    .tui { width: 1440px; height: 900px; background: ${t.bg}; color: ${t.ink}; box-sizing: border-box; padding: 26px 20px 20px; overflow: hidden; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12.5px; line-height: 17px; position: relative; }
    .tui .tb { position: absolute; top: 0; left: 0; right: 0; height: 22px; background: ${t.bar}; color: ${t.mute}; font-size: 11px; line-height: 22px; padding: 0 12px; }
    .tui pre { margin: 0; font: inherit; white-space: pre; letter-spacing: 0; }
    .tui .c { color: ${t.c}; font-weight: 400; } .tui .m { color: ${t.m}; font-weight: 400; } .tui .a { color: ${t.a}; font-weight: 400; } .tui .id { color: ${t.mute}; }
    .tui pre > .l0, .tui pre > .ln { background: ${t.bar}; color: ${t.mute}; display: block; }
    .tui .box { color: ${t.mute}; }
  </style>
</helmet>
<div class="tui"><div class="tb">${title} — foundry · 168×48 · ${mode === 'night' ? 'dark' : 'light'} terminal</div><pre>${color(lines, t).map((l, i, arr) => i === 0 || i === arr.length - 1 ? `<span class="l0">${l}</span>` : l).join('\n')}</pre></div>
</x-dc>
</body>
</html>`;
};
writeFileSync('TuiHome.dc.html', frame('foundry — home', home(), 'night'));
writeFileSync('TuiTicket.dc.html', frame('foundry — SR-12', ticket(), 'night'));
writeFileSync('TuiHomeLight.dc.html', frame('foundry — home', home(), 'day'));
console.log(home().length, ticket().length, Math.max(...home().map(l => [...l].length)));
