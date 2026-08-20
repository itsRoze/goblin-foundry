import { query } from '@anthropic-ai/claude-agent-sdk';

const configDir = '/tmp/claude-501/-Users-roze-dev-factory/593b4349-5949-4e4f-b765-2631f8e7fcbd/scratchpad/authtest';
let source = 'unknown', text = '', err = '';
for await (const m of query({
  prompt: 'Reply with exactly: OK',
  options: {
    model: 'haiku', maxTurns: 1, settingSources: [], allowedTools: [],
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
  },
})) {
  if (m.type === 'system' && m.subtype === 'init') source = m.apiKeySource;
  if (m.type === 'result') { text = m.subtype === 'success' ? m.result : ''; err = m.subtype; }
}
console.log(JSON.stringify({ apiKeySource: source, subtype: err, reply: text.slice(0, 40) }));
