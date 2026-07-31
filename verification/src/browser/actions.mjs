import crypto from 'node:crypto';
import { fillInput, prepareActionState, toggleInput } from './action-state.mjs';

export async function scanActions(page) {
  return page.evaluate(() => {
    const selector = 'button,a[href],input,select,textarea,[role="button"],[data-focusable]';
    document.querySelectorAll('[data-kv-verify]').forEach((element) => element.removeAttribute('data-kv-verify'));
    const visible = (element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      if (element.closest('[aria-hidden="true"],[hidden],[inert]')) return false;
      if (style.visibility === 'hidden' || style.display === 'none' || style.pointerEvents === 'none' || Number(style.opacity) === 0) return false;
      if (box.width <= 0 || box.height <= 0) return false;
      const fixed = style.position === 'fixed' || getComputedStyle(element.parentElement || element).position === 'fixed';
      if (fixed && (box.bottom <= 0 || box.top >= innerHeight || box.right <= 0 || box.left >= innerWidth)) return false;
      const intersects = box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth;
      if (!intersects) return true;
      const x = Math.max(0, Math.min(innerWidth - 1, box.left + box.width / 2));
      const y = Math.max(0, Math.min(innerHeight - 1, box.top + box.height / 2));
      const top = document.elementFromPoint(x, y);
      return !top || top === element || element.contains(top);
    };
    const identity = (element) => {
      const explicit = ['id', 'name', 'data-testid', 'aria-controls'].map((name) => element.getAttribute(name)).find(Boolean);
      if (explicit) return `${element.tagName.toLowerCase()}#${explicit}`;
      const parts = [];
      for (let current = element; current?.parentElement && current !== document.body && parts.length < 6; current = current.parentElement) {
        const siblings = [...current.parentElement.children].filter((item) => item.tagName === current.tagName);
        parts.unshift(`${current.tagName.toLowerCase()}:${siblings.indexOf(current) + 1}`);
      }
      return parts.join('>');
    };
    const counts = new Map();
    return [...document.querySelectorAll(selector)].filter(visible).map((element, id) => {
      const text = (element.innerText || element.value || '').trim().replace(/\s+/g, ' ').slice(0, 120);
      const disabled = element.matches(':disabled') || Boolean(element.closest('[aria-disabled="true"]'));
      const state = [element.value || '', element.checked ?? '', element.getAttribute('aria-expanded') || '',
        element.getAttribute('aria-pressed') || '', element.getAttribute('data-state') || '', disabled].join(':');
      const path = identity(element);
      const base = [path, element.getAttribute('role') || '', element.getAttribute('aria-label') || '', text, element.getAttribute('href') || '', element.getAttribute('type') || '', state].join('|');
      const occurrence = counts.get(base) || 0;
      counts.set(base, occurrence + 1);
      element.setAttribute('data-kv-verify', String(id));
      return {
        id, key: `${base}|${occurrence}`, path, tag: element.tagName.toLowerCase(), text,
        aria: element.getAttribute('aria-label') || '', href: element.getAttribute('href') || '',
        type: element.getAttribute('type') || '', state, disabled,
      };
    });
  });
}

export function stateHash(url, actions) {
  return crypto.createHash('sha256').update(`${url}\n${actions.map((item) => item.key).join('\n')}`).digest('hex').slice(0, 20);
}

async function findCurrent(page, action) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const actions = await scanActions(page);
    const exact = actions.find((item) => item.key === action.key);
    if (exact) return { current: exact, matchedBy: 'key' };
    if (['input', 'textarea', 'select'].includes(action.tag)) {
      const fields = ['path', 'tag', 'aria', 'href', 'type', 'disabled'];
      const structural = actions.filter((item) => fields.every((field) => item[field] === action[field]));
      if (structural.length === 1) return { current: structural[0], matchedBy: 'structure' };
    }
    const semantic = actions.filter((item) => ['tag', 'aria', 'text', 'href', 'type', 'state'].every((field) => item[field] === action[field]));
    if (semantic.length === 1) return { current: semantic[0], matchedBy: 'semantic' };
    await prepareActionState(page, action);
    const viewport = page.viewportSize();
    if (viewport) {
      await page.mouse.move(1, 1);
      await page.mouse.move(Math.floor(viewport.width / 2), Math.floor(viewport.height / 2));
    }
    await page.waitForTimeout(200);
  }
  return null;
}

export async function performAction(page, action, fixtureFile) {
  const match = await findCurrent(page, action);
  if (!match) return { ok: false, reason: 'action missing during replay' };
  const { current, matchedBy } = match;
  if (current.disabled) return { ok: true, skipped: true, matchedBy, reason: 'control is disabled in this state' };
  const locator = page.locator(`[data-kv-verify="${current.id}"]`);
  if (current.tag === 'input' && current.type === 'file') {
    await locator.setInputFiles(fixtureFile); return { ok: true, operation: 'setInputFiles', matchedBy };
  }
  if (current.tag === 'input' && ['checkbox', 'radio'].includes(current.type)) {
    return { ok: true, operation: await toggleInput(locator, current.type), matchedBy };
  }
  if (current.tag === 'input' && ['button', 'submit'].includes(current.type)) {
    await locator.click({ timeout: 5000 }); return { ok: true, operation: 'click', matchedBy };
  }
  if (current.tag === 'input' || current.tag === 'textarea') {
    await fillInput(locator, current.type); return { ok: true, operation: 'fill', matchedBy };
  }
  if (current.tag === 'select') {
    const values = await locator.locator('option').evaluateAll((options) => options.map((option) => option.value));
    if (!values.length) return { ok: true, skipped: true, matchedBy, reason: 'select has no options' };
    await locator.selectOption(values[Math.min(1, values.length - 1)]); return { ok: true, operation: 'select', matchedBy };
  }
  await locator.click({ timeout: 5000 });
  return { ok: true, operation: 'click', matchedBy };
}
