import path from 'node:path';
import { finding } from '../core/finding.mjs';
import { writeJson } from '../core/files.mjs';
import { newPage, stabilize } from '../browser/session.mjs';

async function playCase(ctx, episode) {
  const session = await newPage(ctx.state.browser, ctx, { width: 1440, height: 1000 });
  const route = `/player?id=fixture-video-1&source=fixture&title=%E9%AA%8C%E8%AF%81%E8%A7%86%E9%A2%91&episode=${episode}`;
  try {
    await session.page.goto(`${ctx.config.localUrl}${route}`, { waitUntil: 'domcontentloaded', timeout: ctx.config.navigationTimeoutMs });
    await stabilize(session.page);
    await session.page.locator('video').waitFor({ state: 'attached', timeout: 20_000 });
    const before = await session.page.locator('video').evaluate(async (video) => {
      video.muted = true; await video.play();
      return { currentTime: video.currentTime, readyState: video.readyState, networkState: video.networkState };
    });
    await session.page.waitForTimeout(2600);
    const after = await session.page.locator('video').evaluate((video) => {
      const quality = video.getVideoPlaybackQuality?.();
      return { currentTime: video.currentTime, duration: video.duration, paused: video.paused, readyState: video.readyState,
        width: video.videoWidth, height: video.videoHeight, totalFrames: quality?.totalVideoFrames, droppedFrames: quality?.droppedVideoFrames, error: video.error?.message || null };
    });
    await session.page.screenshot({ path: path.join(ctx.dirs.screenshots, `video-episode-${episode}.png`), fullPage: true });
    return { before, after, observed: session.observed };
  } catch (error) { return { error: error instanceof Error ? error.stack || error.message : String(error), observed: session.observed }; }
  finally { await session.context.close(); }
}

async function stallCase(ctx) {
  const session = await newPage(ctx.state.browser, ctx, { width: 1440, height: 1000 });
  try {
    await session.page.goto(`${ctx.config.localUrl}/player?id=fixture-video-1&source=fixture&title=stall&episode=0`, { waitUntil: 'domcontentloaded' });
    await stabilize(session.page);
    const video = session.page.locator('video');
    await video.waitFor({ state: 'attached', timeout: 20_000 });
    await video.evaluate(async (element) => { element.muted = true; await element.play(); });
    await session.page.waitForTimeout(600);
    await video.evaluate((element) => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
      const frozen = descriptor.get.call(element);
      window.__kvFrozen = true;
      Object.defineProperty(element, 'currentTime', { configurable: true, get() { return window.__kvFrozen ? frozen : descriptor.get.call(this); }, set(value) { descriptor.set.call(this, value); } });
    });
    await session.page.waitForTimeout(600);
    const detected = await session.page.locator('.loading-overlay-glass').isVisible().catch(() => false);
    await video.evaluate((element) => { window.__kvFrozen = false; delete element.currentTime; });
    await session.page.waitForTimeout(500);
    const recovered = !(await session.page.locator('.loading-overlay-glass').isVisible().catch(() => false));
    return { detected, recovered };
  } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  finally { await session.context.close(); }
}

export async function checkVideo(ctx) {
  if (!ctx.state.browser || !ctx.state.mediaOk) return;
  const mp4 = await playCase(ctx, 0);
  const hls = await playCase(ctx, 1);
  const stall = await stallCase(ctx);
  const target = path.join(ctx.dirs.raw, 'video-playback.json');
  writeJson(target, { mp4, hls, stall });
  for (const [name, result] of Object.entries({ mp4, hls })) {
    const advance = result.after ? result.after.currentTime - result.before.currentTime : 0;
    const dropped = result.after?.droppedFrames || 0;
    const total = result.after?.totalFrames || 0;
    const ok = !result.error && advance >= ctx.config.minVideoAdvanceSeconds && result.after?.width === 640 && result.after?.height === 360 && (!total || dropped / total <= .05);
    finding(ctx, {
      id: `video.${name}`, category: 'video', title: `${name.toUpperCase()} fixture plays with correct resolution and low frame loss`,
      status: ok ? 'PASS' : 'FAIL', severity: 'critical', expected: `advance >=${ctx.config.minVideoAdvanceSeconds}s, 640x360, dropped <=5%`,
      actual: JSON.stringify({ advance, result }), reason: ok ? 'Real browser media playback met timing and quality thresholds.' : 'Playback stalled, decoded incorrectly, errored, or dropped excessive frames.',
      evidence: [target], remediation: 'Inspect player events, HLS configuration, proxy mode, codec support, and browser console evidence.',
    });
  }
  finding(ctx, {
    id: 'video.stall-detector', category: 'video', title: '200ms stall detector shows and clears the loading overlay',
    status: stall.detected && stall.recovered ? 'PASS' : 'FAIL', severity: 'high', expected: 'Overlay appears while currentTime is frozen and disappears after recovery',
    actual: JSON.stringify(stall), reason: stall.detected && stall.recovered ? 'The live player responded to a controlled playback freeze.' : 'Stall detection or recovery UI did not transition correctly.',
    evidence: [target], remediation: 'Repair currentTime polling, loading state ownership, or recovery clearing logic.',
  });
}
