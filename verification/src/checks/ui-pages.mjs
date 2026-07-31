import path from 'node:path';
import { finding } from '../core/finding.mjs';
import { writeJson } from '../core/files.mjs';
import { launchBrowser, newPage, stabilize } from '../browser/session.mjs';
import { discoverPages } from '../browser/routes.mjs';
import { pageMetrics } from '../browser/metrics.mjs';
import { scanAxe } from '../browser/axe.mjs';

function safeName(value) {
  return value.replace(/^\//, '').replace(/[^a-zA-Z0-9]+/g, '-') || 'home';
}

export async function checkUiPages(ctx) {
  if (!ctx.state.appReady) return;
  const browser = ctx.state.browser || await launchBrowser(ctx);
  ctx.state.browser = browser;
  const routes = discoverPages(ctx);
  ctx.state.pageRoutes = routes;
  const results = [];
  for (const viewport of ctx.config.viewports) {
    for (const route of routes) {
      const session = await newPage(browser, ctx, viewport);
      let response = null;
      let axe = { violations: [], incomplete: [] };
      try {
        response = await session.page.goto(`${ctx.config.localUrl}${route}`, { waitUntil: 'domcontentloaded', timeout: ctx.config.navigationTimeoutMs });
        await stabilize(session.page);
        axe = await scanAxe(session.page, ctx);
        const screenshot = path.join(ctx.dirs.screenshots, `${viewport.name}-${safeName(route)}.png`);
        await session.page.screenshot({ path: screenshot, fullPage: true });
        results.push({ viewport, route, status: response?.status() || 0, metrics: await pageMetrics(session.page), axe, observed: session.observed, screenshot });
      } catch (error) {
        results.push({ viewport, route, status: response?.status() || 0, error: error instanceof Error ? error.stack || error.message : String(error), axe, observed: session.observed });
      } finally {
        await session.context.close();
      }
    }
  }
  const target = path.join(ctx.dirs.raw, 'ui-pages.json');
  writeJson(target, results);
  const renderFailures = results.filter((item) => item.error || item.status >= 400 || item.status === 0);
  const runtimeErrors = results.filter((item) => item.metrics?.errors?.length || item.metrics?.rejections?.length || item.observed.pageErrors.length || item.observed.consoleErrors.length);
  const overflow = results.filter((item) => item.metrics && item.metrics.scrollWidth > item.metrics.clientWidth + 1);
  const severeA11y = results.flatMap((item) => item.axe.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact)).map((violation) => ({ route: item.route, viewport: item.viewport.name, ...violation })));
  aggregate(ctx, 'ui.route-render', 'Every page renders in every target viewport', renderFailures, results.length, 'critical', target);
  aggregate(ctx, 'ui.runtime-errors', 'Pages emit no uncaught or console errors', runtimeErrors, results.length, 'critical', target);
  aggregate(ctx, 'ui.horizontal-overflow', 'Pages do not overflow target viewports horizontally', overflow, results.length, 'high', target);
  aggregate(ctx, 'ui.accessibility', 'Pages have no serious or critical automated accessibility violations', severeA11y, results.length, 'high', target);
  ctx.state.uiPages = results;
}

function aggregate(ctx, id, title, failures, total, severity, evidence) {
  finding(ctx, {
    id, category: 'ui', title, status: failures.length ? 'FAIL' : 'PASS', severity, expected: `0 failures across ${total} page/viewport cases`,
    actual: failures.length ? JSON.stringify(failures.slice(0, 30)) : `${total} cases passed`,
    reason: failures.length ? 'At least one enumerated page state violated the declared UI contract.' : 'Every enumerated page state met the contract.',
    evidence: [evidence], remediation: 'Open the named screenshot and evidence record, reproduce the exact route/viewport, and repair the underlying component.',
  });
}
