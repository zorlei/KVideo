import assert from 'node:assert/strict';
import test from 'node:test';
import { numericCandidate, prepareActionState } from '../src/browser/action-state.mjs';
import { getConfig } from '../src/config.mjs';
import { latestDeployment } from '../src/checks/deployment.mjs';
import { redact, redactText } from '../src/core/redact.mjs';
import { escapeXml } from '../src/core/xml.mjs';

test('redacts keyed secrets recursively', () => {
  assert.deepEqual(redact({ nested: { password: 'value', safe: 'visible' } }), {
    nested: { password: '[REDACTED]', safe: 'visible' },
  });
});

test('redacts bearer, GitHub, JWT, and query credentials', () => {
  const token = ['gho', '_abcdefghijklmnopqrstuvwxyz123456'].join('');
  const raw = `Bearer abc.def ${token} ?token=secret-value`;
  const result = redactText(raw);
  assert.doesNotMatch(result, /abcdefghijklmnopqrstuvwxyz|secret-value/);
});

test('escapes XML metacharacters', () => {
  assert.equal(escapeXml(`<a x="1">Tom & 'Ada'</a>`), '&lt;a x=&quot;1&quot;&gt;Tom &amp; &apos;Ada&apos;&lt;/a&gt;');
});

test('chooses valid alternative values for numeric and range inputs', () => {
  assert.equal(numericCandidate({ min: '0', max: '1', value: '0.5', step: '0.01' }), '0');
  assert.equal(numericCandidate({ min: '10', max: '100', value: '70', step: '1' }), '55');
});

test('maps play and pause controls to deterministic media preconditions', async () => {
  const modes = [];
  const page = { evaluate: async (_callback, mode) => modes.push(mode) };
  await prepareActionState(page, { aria: '播放' });
  await prepareActionState(page, { aria: 'Pause' });
  await prepareActionState(page, { aria: '搜索' });
  assert.deepEqual(modes, ['paused', 'playing']);
});

test('accepts explicit full-run action budgets', () => {
  const config = getConfig(['node', 'verify', '--root', process.cwd(), '--max-actions', '1234', '--max-action-depth', '7']);
  assert.equal(config.maxActionStates, 1234);
  assert.equal(config.maxActionDepth, 7);
});

test('selects the newest Cloudflare production deployment', () => {
  const output = JSON.stringify([
    { Environment: 'Production', Source: 'abcdef1', Deployment: 'https://new.pages.dev' },
    { Environment: 'Production', Source: '1234567', Deployment: 'https://old.pages.dev' },
  ]);
  assert.equal(latestDeployment(output)?.Source, 'abcdef1');
  assert.equal(latestDeployment('not json'), null);
});
