import fs from 'node:fs';
import path from 'node:path';
import { finding } from '../core/finding.mjs';
import { walk, relative, writeJson } from '../core/files.mjs';
import { log } from '../core/log.mjs';
import { newPage, stabilize } from '../browser/session.mjs';
import { performAction, scanActions, stateHash } from '../browser/actions.mjs';

async function navigate(page, ctx, route, pathSteps, fixtureFile) {
  await page.goto(`${ctx.config.localUrl}${route}`, { waitUntil: 'domcontentloaded', timeout: ctx.config.navigationTimeoutMs });
  await stabilize(page);
  for (const action of pathSteps) {
    const result = await performAction(page, action, fixtureFile);
    if (!result.ok) return result;
    await page.waitForTimeout(250);
  }
  return { ok: true };
}

function staysWithinRoute(ctx, route, action, urlAfter) {
  const start = new URL(route, ctx.config.localUrl);
  const target = action.href ? new URL(action.href, start) : new URL(urlAfter);
  return target.origin === start.origin && target.pathname === start.pathname;
}

export async function checkUiActions(ctx) {
  if (!ctx.state.browser || !ctx.state.pageRoutes) return;
  const session = await newPage(ctx.state.browser, ctx, { width: 1440, height: 1000 });
  await session.context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const fixtureFile = path.join(ctx.dirs.raw, 'import-fixture.json');
  fs.writeFileSync(fixtureFile, JSON.stringify({ settings: { sources: [] } }));
  const results = [];
  const cappedRoutes = [];
  for (const route of ctx.state.pageRoutes) {
    const routeStart = results.length;
    const queue = [[]];
    const seenStates = new Set();
    const testedActions = new Set();
    let routeActions = 0;
    let hitCap = false;
    log(ctx, 'info', 'ui.action-route.start', 'Starting recursive runtime control exploration', { route });
    while (queue.length && (ctx.config.quick ? results.length : routeActions) < ctx.config.maxActionStates) {
      const steps = queue.shift();
      const stepKeys = steps.map((item) => item.key);
      const replay = await navigate(session.page, ctx, route, steps, fixtureFile);
      if (!replay.ok) {
        results.push({ route, depth: steps.length, steps: stepKeys, phase: 'state-replay', result: replay });
        log(ctx, 'error', 'ui.action-failure', 'State path replay failed', { route, steps: stepKeys, result: replay });
        await session.page.screenshot({ path: path.join(ctx.dirs.screenshots, `action-failure-${results.length}.png`), fullPage: true }).catch(() => {});
        continue;
      }
      const actions = await scanActions(session.page);
      const hash = stateHash(session.page.url(), actions);
      if (seenStates.has(hash)) continue;
      seenStates.add(hash);
      for (const action of actions) {
        if (testedActions.has(action.key)) continue;
        if ((ctx.config.quick ? results.length : routeActions) >= ctx.config.maxActionStates) {
          hitCap = true;
          break;
        }
        testedActions.add(action.key);
        routeActions += 1;
        const reset = await navigate(session.page, ctx, route, steps, fixtureFile);
        if (!reset.ok) {
          results.push({ route, state: hash, depth: steps.length, steps: stepKeys, phase: 'action-reset', action, result: reset });
          log(ctx, 'error', 'ui.action-failure', 'Action state reset failed', { route, state: hash, steps: stepKeys, action, result: reset });
          continue;
        }
        let result;
        try { result = await performAction(session.page, action, fixtureFile); await session.page.waitForTimeout(300); }
        catch (error) { result = { ok: false, reason: error instanceof Error ? error.message : String(error) }; }
        const after = result.ok ? await scanActions(session.page) : [];
        const changed = result.ok && stateHash(session.page.url(), after) !== hash;
        results.push({ route, state: hash, depth: steps.length, steps: stepKeys, action, result, changed, urlAfter: session.page.url() });
        if (!result.ok) {
          log(ctx, 'error', 'ui.action-failure', 'Runtime control interaction failed', { route, state: hash, depth: steps.length, steps: stepKeys, action, result, urlAfter: session.page.url() });
          await session.page.screenshot({ path: path.join(ctx.dirs.screenshots, `action-failure-${results.length}.png`), fullPage: true }).catch(() => {});
        }
        if (changed && steps.length < ctx.config.maxActionDepth && staysWithinRoute(ctx, route, action, session.page.url())) {
          queue.push([...steps, action]);
        }
      }
    }
    const capped = hitCap || queue.length > 0;
    if (capped) cappedRoutes.push(route);
    log(ctx, 'info', 'ui.action-route.end', 'Finished recursive runtime control exploration', {
      route, actions: results.length - routeStart, uniqueActions: testedActions.size,
      uniqueStates: seenStates.size, pendingStates: queue.length, capped,
    });
    if (ctx.config.quick && results.length >= ctx.config.maxActionStates) break;
  }
  const trace = path.join(ctx.dirs.traces, 'ui-actions.zip');
  await session.context.tracing.stop({ path: trace });
  await session.context.close();
  const declared = sourceActionInventory(ctx);
  const target = path.join(ctx.dirs.raw, 'ui-actions.json');
  writeJson(target, { results, declared, cappedRoutes, observed: session.observed });
  const failures = results.filter((item) => item.result && !item.result.ok);
  const skipped = results.filter((item) => item.result?.skipped);
  const uniqueRuntime = new Set(results.filter((item) => item.action).map((item) => `${item.route}|${item.action.key}`)).size;
  finding(ctx, {
    id: 'ui.action-execution', category: 'ui', title: 'Every discovered runtime control accepts its intended interaction',
    status: failures.length ? 'FAIL' : 'PASS', severity: 'critical', expected: '0 click/fill/select/upload failures',
    actual: failures.length ? JSON.stringify(failures.slice(0, 30)) : `${results.length - skipped.length} operated; ${skipped.length} disabled/skipped`,
    reason: failures.length ? 'A visible runtime control could not be replayed or operated.' : 'All discovered controls were exercised without automation failure.',
    evidence: [target, trace], remediation: 'Repair unstable selectors, disabled-state logic, click handlers, or the underlying UI exception.',
  });
  finding(ctx, {
    id: 'ui.action-state-coverage', category: 'ui', title: 'Recursive UI state exploration exhausts its queue',
    status: cappedRoutes.length ? (ctx.config.quick ? 'SKIP' : 'FAIL') : 'PASS', severity: 'high', expected: `Queue exhausted below ${ctx.config.maxActionStates} actions per route and depth ${ctx.config.maxActionDepth}`,
    actual: cappedRoutes.length ? `Coverage cap reached on ${cappedRoutes.join(', ')} after ${results.length} actions` : `${results.length} actions; queue exhausted`,
    reason: cappedRoutes.length ? (ctx.config.quick ? 'Quick mode intentionally limits exploration.' : 'Unexplored reachable states remain, so “all buttons” cannot be claimed.') : 'No additional state-changing action remained within the discovered graph.',
    evidence: [target], remediation: 'Raise limits or split workflows until every reachable state is exhausted.',
  });
  finding(ctx, {
    id: 'ui.action-inventory', category: 'ui', title: 'Static and runtime interaction inventory is recorded',
    status: 'INFO', severity: 'info', expected: 'Every source declaration and discovered runtime control remains auditable',
    actual: JSON.stringify({ staticDeclarationSites: declared.length, runtimeActionInstances: results.length, uniqueRuntimeControls: uniqueRuntime, disabledOrSkipped: skipped.length, failures: failures.length, cappedRoutes }),
    reason: 'Static declaration sites and runtime controls are different populations; the evidence preserves both without claiming a false one-to-one mapping.',
    evidence: [target], remediation: 'Use file/line declarations and trace-backed runtime states to investigate controls absent from reachable test states.',
  });
}

function sourceActionInventory(ctx) {
  const files = walk(ctx.config.root, (file) => /\.(tsx|jsx)$/.test(file) && !file.includes('/verification/'));
  return files.flatMap((file) => fs.readFileSync(file, 'utf8').split(/\r?\n/).flatMap((line, index) =>
    /<(button|input|select|textarea)|onClick=|role=["']button/.test(line) ? [{ file: relative(ctx.config.root, file), line: index + 1 }] : [],
  ));
}
