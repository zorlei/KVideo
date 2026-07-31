import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { finding } from '../core/finding.mjs';
import { writeJson } from '../core/files.mjs';
import { newPage, stabilize } from '../browser/session.mjs';

function safe(value) {
  return value.replace(/^\//, '').replace(/[^a-zA-Z0-9]+/g, '-') || 'home';
}

function providerSpecific(route) {
  return route === '/iptv' || route.endsWith('/settings');
}

function padded(image, width, height) {
  const output = new PNG({ width, height, fill: true });
  PNG.bitblt(image, output, 0, 0, image.width, image.height, 0, 0);
  return output;
}

function compare(leftFile, rightFile, diffFile) {
  const leftRaw = PNG.sync.read(fs.readFileSync(leftFile));
  const rightRaw = PNG.sync.read(fs.readFileSync(rightFile));
  const width = Math.max(leftRaw.width, rightRaw.width);
  const height = Math.max(leftRaw.height, rightRaw.height);
  const left = padded(leftRaw, width, height);
  const right = padded(rightRaw, width, height);
  const diff = new PNG({ width, height });
  const pixels = pixelmatch(left.data, right.data, diff.data, width, height, { threshold: 0.12, includeAA: false });
  fs.writeFileSync(diffFile, PNG.sync.write(diff));
  return { pixels, total: width * height, ratio: pixels / (width * height), dimensions: { left: [leftRaw.width, leftRaw.height], right: [rightRaw.width, rightRaw.height] } };
}

async function signature(page) {
  const value = await page.evaluate(() => [...document.body.querySelectorAll('*')].map((element) => {
    const text = element.children.length ? '' : (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    return `${element.tagName}:${element.getAttribute('role') || ''}:${element.getAttribute('aria-label') || ''}:${text}`;
  }).join('\n'));
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function capture(browser, ctx, base, route, viewport, file) {
  const session = await newPage(browser, ctx, viewport);
  try {
    const response = await session.page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded', timeout: ctx.config.navigationTimeoutMs });
    await stabilize(session.page);
    await session.page.screenshot({ path: file, fullPage: true });
    return { status: response?.status() || 0, signature: await signature(session.page), observed: session.observed };
  } finally { await session.context.close(); }
}

export async function checkVisual(ctx) {
  if (ctx.config.offline || !ctx.state.browser || !ctx.state.pageRoutes) return finding(ctx, {
    id: 'visual.deployment-diff', category: 'visual', title: 'Local and Cloudflare UI visual comparison', status: 'SKIP', severity: 'high',
    expected: 'Online reference and browser available', actual: ctx.config.offline ? '--offline' : 'browser unavailable', reason: 'Pixel comparison requires both surfaces.', remediation: 'Rerun online after local startup.',
  });
  const routes = ctx.config.quick ? ['/'] : ctx.state.pageRoutes;
  const viewports = ctx.config.quick ? [ctx.config.viewports[0]] : ctx.config.viewports.filter((item) => ['mobile', 'desktop'].includes(item.name));
  const results = [];
  for (const viewport of viewports) for (const route of routes) {
    const stem = `${viewport.name}-${safe(route)}`;
    const local = path.join(ctx.dirs.screenshots, `visual-local-${stem}.png`);
    const remote = path.join(ctx.dirs.screenshots, `visual-remote-${stem}.png`);
    const diff = path.join(ctx.dirs.diffs, `visual-diff-${stem}.png`);
    try {
      const localMeta = await capture(ctx.state.browser, ctx, ctx.config.localUrl, route, viewport, local);
      const remoteMeta = await capture(ctx.state.browser, ctx, ctx.config.referenceUrl, route, viewport, remote);
      results.push({ route, viewport: viewport.name, localMeta, remoteMeta, comparison: compare(local, remote, diff), local, remote, diff });
    } catch (error) { results.push({ route, viewport: viewport.name, error: error instanceof Error ? error.message : String(error) }); }
  }
  const target = path.join(ctx.dirs.raw, 'visual-comparison.json');
  writeJson(target, results);
  const unexpected = results.filter((item) => item.error || (!providerSpecific(item.route) && item.comparison?.ratio > ctx.config.visualDiffRatio));
  finding(ctx, {
    id: 'visual.deployment-diff', category: 'visual', title: 'Local and Cloudflare UI stay within visual deviation threshold',
    status: unexpected.length ? 'FAIL' : 'PASS', severity: 'high', expected: `Pixel difference <= ${ctx.config.visualDiffRatio * 100}% outside provider-specific routes`,
    actual: JSON.stringify(results.map((item) => ({ route: item.route, viewport: item.viewport, ratio: item.comparison?.ratio, signaturesMatch: item.localMeta?.signature === item.remoteMeta?.signature, error: item.error }))),
    reason: unexpected.length ? 'Unexpected deployment-specific visual drift exceeds the configured threshold.' : 'Common UI surfaces match; provider-specific differences remain recorded.',
    evidence: [target, ctx.dirs.diffs], remediation: 'Inspect diff images, stabilize dynamic content, and reconcile deployment build/runtime differences.',
  });
}
