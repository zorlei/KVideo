import fs from 'node:fs';
import path from 'node:path';
import { finding } from '../core/finding.mjs';
import { walk, writeJson } from '../core/files.mjs';
import { newPage, stabilize } from '../browser/session.mjs';
import { pageMetrics } from '../browser/metrics.mjs';

async function scrollFrames(page) {
  return page.evaluate(async () => {
    const frames = [];
    const started = performance.now();
    let previous = started;
    await new Promise((resolve) => {
      const step = (now) => {
        frames.push(now - previous); previous = now;
        const progress = Math.min(1, (now - started) / 2500);
        scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * progress);
        if (progress < 1) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
    frames.sort((a, b) => a - b);
    return { count: frames.length, p95: frames[Math.ceil(frames.length * .95) - 1] || 0, over34: frames.filter((item) => item > 34).length };
  });
}

export async function checkPerformance(ctx) {
  if (!ctx.state.browser || !ctx.state.appReady) return;
  const session = await newPage(ctx.state.browser, ctx, { width: 1440, height: 1000 });
  const cdp = await session.context.newCDPSession(session.page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await session.page.goto(`${ctx.config.localUrl}/settings`, { waitUntil: 'domcontentloaded', timeout: ctx.config.navigationTimeoutMs });
  await stabilize(session.page);
  const frames = await scrollFrames(session.page);
  const metrics = await pageMetrics(session.page);
  await session.context.close();
  const bundles = walk(path.join(ctx.config.root, '.next', 'static'), (file) => file.endsWith('.js')).map((file) => ({ file, bytes: fs.statSync(file).size }));
  const bundle = { count: bundles.length, totalBytes: bundles.reduce((sum, item) => sum + item.bytes, 0), largest: bundles.sort((a, b) => b.bytes - a.bytes).slice(0, 20) };
  const target = path.join(ctx.dirs.metrics, 'performance.json');
  writeJson(target, { frames, metrics, bundle });
  const longTaskTotal = metrics.longTasks.reduce((sum, item) => sum + item, 0);
  const good = frames.p95 <= 34 && frames.over34 / Math.max(frames.count, 1) <= .05 && longTaskTotal <= ctx.config.maxLongTaskMs;
  finding(ctx, {
    id: 'performance.scroll-jank', category: 'performance', title: 'Settings scrolling remains smooth under 4× CPU throttling',
    status: good ? 'PASS' : 'FAIL', severity: 'high', expected: 'frame p95 <=34ms, >34ms frames <=5%, long tasks <=500ms total',
    actual: JSON.stringify({ frames, longTaskTotal }), reason: good ? 'Throttled scroll animation stayed within the frame budget.' : 'Measured frame gaps or main-thread long tasks exceed the budget.',
    evidence: [target], remediation: 'Profile long tasks, reduce render scope, virtualize long lists, and remove layout thrashing.',
  });
  const largest = bundle.largest[0]?.bytes || 0;
  finding(ctx, {
    id: 'performance.bundle-size', category: 'performance', title: 'Client JavaScript bundle size is bounded',
    status: largest <= 1_000_000 ? 'PASS' : 'WARN', severity: 'medium', expected: 'Largest emitted JS asset <= 1,000,000 raw bytes', actual: JSON.stringify(bundle),
    reason: largest <= 1_000_000 ? 'No single emitted asset exceeds the guardrail.' : 'A very large asset increases parse, compile, and low-end device latency.',
    evidence: [target], remediation: 'Split heavy dependencies and defer feature code outside initial routes.',
  });
}
