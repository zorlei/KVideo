import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);

test('client asset transpilation removes logical assignment syntax for WebView 83', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'kvideo-webview83-'));
  const assetPath = path.join(tempDir, 'chunk.js');

  await writeFile(
    assetPath,
    [
      'let count = null;',
      'let fallback = 0;',
      'let enabled = true;',
      'count ??= 1;',
      'fallback ||= 2;',
      'enabled &&= false;',
      'globalThis.__kvideoWebView83Result = { count, fallback, enabled };',
    ].join('\n')
  );

  await execFileAsync(process.execPath, [
    path.resolve('scripts/transpile-client-assets.mjs'),
    tempDir,
  ]);

  const output = await readFile(assetPath, 'utf8');

  assert.equal(output.includes('??='), false);
  assert.equal(output.includes('||='), false);
  assert.equal(output.includes('&&='), false);
});
