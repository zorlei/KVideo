import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { rawPath } from './log.mjs';

function terminate(child, signal) {
  if (!child.pid || child.killed) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try { child.kill(signal); } catch { /* process already ended */ }
  }
}

export function runCommand(ctx, name, command, args = [], options = {}) {
  const started = Date.now();
  const outputPath = rawPath(ctx, `${name}.log`);
  const stream = fs.createWriteStream(outputPath, { flags: 'w' });
  const env = { ...process.env, ...(options.env || {}) };
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd || ctx.config.root,
      env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let tail = '';
    let timedOut = false;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      stream.end(() => resolve(result));
    };
    const capture = (chunk) => {
      const text = chunk.toString();
      stream.write(text);
      tail = `${tail}${text}`.slice(-12_000);
      if (options.live) process.stdout.write(text);
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate(child, 'SIGTERM');
      setTimeout(() => terminate(child, 'SIGKILL'), 3000).unref();
    }, options.timeoutMs || ctx.config.commandTimeoutMs);
    child.on('error', (error) => {
      finish({ code: 127, error: error.message, tail, outputPath, timedOut, durationMs: Date.now() - started });
    });
    child.on('exit', (code, signal) => {
      finish({ code: code ?? 1, signal, tail, outputPath, timedOut, durationMs: Date.now() - started });
    });
  });
}

export async function runNpm(ctx, name, args, options = {}) {
  return runCommand(ctx, name, 'npm', args, options);
}
