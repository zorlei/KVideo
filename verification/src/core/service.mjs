import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { rawPath } from './log.mjs';

export async function waitForUrl(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(3000) });
      if (response.status < 500) return { ok: true, status: response.status };
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { ok: false, error: lastError };
}

export async function startProcess(ctx, name, command, args, options = {}) {
  const outputPath = rawPath(ctx, `${name}.log`);
  const stream = fs.createWriteStream(outputPath, { flags: 'w' });
  const child = spawn(command, args, {
    cwd: options.cwd || ctx.config.root,
    env: { ...process.env, ...(options.env || {}) },
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(stream);
  child.stderr.pipe(stream);
  const service = { name, child, outputPath, stopped: false };
  ctx.services.push(service);
  if (options.url) service.ready = await waitForUrl(options.url, options.timeoutMs);
  return service;
}

export function stopProcess(service) {
  if (!service?.child?.pid || service.stopped) return;
  service.stopped = true;
  try {
    process.kill(-service.child.pid, 'SIGTERM');
  } catch {
    try { service.child.kill('SIGTERM'); } catch { /* already stopped */ }
  }
}

export function stopAll(ctx) {
  for (const service of [...ctx.services].reverse()) {
    if (typeof service.close === 'function') service.close();
    else stopProcess(service);
  }
}
