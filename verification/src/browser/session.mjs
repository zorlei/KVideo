import { chromium } from 'playwright';
import { browserInit, sourceArgument } from './init.mjs';
import { installMocks } from './mocks.mjs';

export async function launchBrowser(ctx) {
  const browser = await chromium.launch({
    executablePath: ctx.state.chromePath,
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling'],
  });
  ctx.services.push({ name: 'playwright-browser', close: () => browser.close() });
  return browser;
}

export async function newPage(browser, ctx, viewport) {
  const context = await browser.newContext({ viewport, colorScheme: 'dark', locale: 'zh-CN', reducedMotion: 'reduce' });
  await context.addInitScript(browserInit(), sourceArgument(ctx.config.fixtureUrl));
  const page = await context.newPage();
  const observed = { consoleErrors: [], consoleWarnings: [], pageErrors: [], failedRequests: [], httpErrors: [], dialogs: [], downloads: [], popups: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') observed.consoleErrors.push(message.text());
    if (message.type() === 'warning') observed.consoleWarnings.push(message.text());
  });
  page.on('pageerror', (error) => observed.pageErrors.push(error.stack || error.message));
  page.on('requestfailed', (request) => observed.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  page.on('response', (response) => {
    if (response.status() >= 400) observed.httpErrors.push({ method: response.request().method(), status: response.status(), url: response.url() });
  });
  page.on('dialog', async (dialog) => {
    observed.dialogs.push({ type: dialog.type(), message: dialog.message(), defaultValue: dialog.defaultValue() });
    await dialog.dismiss().catch(() => {});
  });
  page.on('download', (download) => observed.downloads.push({ filename: download.suggestedFilename(), url: download.url() }));
  page.on('popup', (popup) => {
    observed.popups.push({ url: popup.url() });
    popup.close().catch(() => {});
  });
  await installMocks(page, ctx);
  return { context, page, observed };
}

export async function stabilize(page) {
  const css = '*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important;caret-color:transparent!important}::view-transition-old(root),::view-transition-new(root){animation:none!important}';
  await page.addStyleTag({ content: css });
  await page.evaluate(async () => {
    await document.fonts?.ready;
    const images = Promise.all([...document.images].map((image) => image.complete ? null : new Promise((resolve) => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', resolve, { once: true });
    })));
    await Promise.race([images, new Promise((resolve) => setTimeout(resolve, 1000))]);
  });
  await page.waitForTimeout(250);
}
