function finite(value, fallback) {
  if (value === '' || value === 'any') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function numericCandidate({ min, max, value, step }) {
  const lower = finite(min, 0);
  const upper = Math.max(lower, finite(max, lower + 100));
  const increment = Math.max(Number.EPSILON, finite(step, 1));
  const midpoint = lower + ((upper - lower) / 2);
  const snapped = Math.min(upper, lower + (Math.round((midpoint - lower) / increment) * increment));
  const current = finite(value, lower);
  const candidate = Math.abs(snapped - current) > Number.EPSILON ? snapped : lower;
  return String(Number(candidate.toFixed(10)));
}

async function numericValue(locator) {
  const bounds = await locator.evaluate((element) => ({
    min: element.min, max: element.max, value: element.value, step: element.step,
  }));
  return numericCandidate(bounds);
}

export async function fillInput(locator, type) {
  if (['number', 'range'].includes(type)) return locator.fill(await numericValue(locator));
  if (type === 'url') return locator.fill('https://example.com/verification');
  if (type === 'email') return locator.fill('verification@example.com');
  if (type === 'tel') return locator.fill('0123456789');
  return locator.fill('验证');
}

export async function toggleInput(locator, type) {
  const label = locator.locator('xpath=ancestor::label[1]');
  if (await label.count()) {
    await label.click({ timeout: 5000 });
    return 'clickLabel';
  }
  const checked = type === 'radio' ? true : !(await locator.isChecked());
  await locator.setChecked(checked, { force: true });
  return 'setChecked';
}

export async function prepareActionState(page, action) {
  const label = action.aria.trim().toLowerCase();
  const mode = /^(播放|play)$/.test(label) ? 'paused' : /^(暂停|pause)$/.test(label) ? 'playing' : null;
  if (!mode) return;
  await page.evaluate(async (expected) => {
    const videos = [...document.querySelectorAll('video')];
    if (expected === 'paused') videos.forEach((video) => video.pause());
    else await Promise.all(videos.map((video) => video.play().catch(() => {})));
  }, mode);
}
