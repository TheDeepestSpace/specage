import { expect, test, type Page } from '@playwright/test';
import { mockApi } from './mocks.js';

async function openEditor(page: Page, spec?: string, text = 'Shooting') {
  await mockApi(page, { spec });
  await page.goto('/r/acme/tbgwaf');
  await expect(page.locator('.cm-content')).toContainText(text);
  await expect(page.locator('.cm-gutters')).toBeVisible();
  if (!spec) await expect(page.locator('.dot[data-status="verified"]')).toBeVisible();
}

test('repos list', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await expect(page.locator('#repos a')).toHaveCount(2);
  await expect(page).toHaveScreenshot('repos.png', { fullPage: true });
});

test('repos list: empty state', async ({ page }) => {
  await mockApi(page, { repos: [], initRepos: [] });
  await page.goto('/');
  await expect(page.locator('#repos')).toContainText('No specage-enabled repos found.');
  await expect(page).toHaveScreenshot('repos-empty.png', { fullPage: true });
});

test('editor: layout is not clipped', async ({ page }) => {
  await openEditor(page);
  const vp = page.viewportSize()!;
  const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
  const gutters = await box('.cm-gutters');
  const lineNo = await box('.cm-lineNumbers .cm-gutterElement:nth-child(2)');
  const host = await box('#editor');
  const content = await box('.cm-content');
  expect(gutters.x).toBeGreaterThanOrEqual(0);
  expect(lineNo.x).toBeGreaterThanOrEqual(host.x);
  expect(lineNo.width).toBeGreaterThan(8);
  expect(content.x).toBeGreaterThanOrEqual(gutters.x + gutters.width - 1);
  // text is inset from the gutter, not flush against it
  const pad = await page
    .locator('.cm-line')
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
  expect(pad).toBeGreaterThanOrEqual(8);
  expect(host.width).toBeGreaterThan(Math.min(vp.width, 800) * 0.5);
  expect(host.height).toBeGreaterThan(250);
  // nothing overflows the viewport horizontally
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(sw).toBeLessThanOrEqual(vp.width);
  // no overlap between editor and pane on desktop
  const pane = await box('#pane');
  if (vp.width > 800) expect(host.x + host.width).toBeLessThanOrEqual(pane.x + 1);
});

test('editor: sample spec', async ({ page }) => {
  await openEditor(page);
  await expect(page).toHaveScreenshot('editor.png');
});

test('editor: sidebar with pinned node', async ({ page }) => {
  await openEditor(page);
  await page.locator('.cm-line', { hasText: 'never exceeds the magazine' }).click();
  await expect(page.locator('#crumbs strong')).toHaveText('shoot.burst.cap');
  await page.locator('#pin').check();
  await expect(page.locator('#pin')).toBeChecked();
  await expect(page.locator('#pane')).toContainText('verified');
  await expect(page).toHaveScreenshot('editor-pinned.png');
});

test('editor: empty pane state', async ({ page }) => {
  await openEditor(page, '# empty\n', 'empty');
  await expect(page.locator('#pane')).toContainText('Place the cursor in a node.');
  await expect(page).toHaveScreenshot('editor-empty.png');
});

test('editor: vim toggle (persisted, mode indicator, :w saves)', async ({ page }) => {
  await openEditor(page);
  const vim = page.locator('#vim');
  const mode = page.locator('#vim-mode');
  await expect(vim).not.toBeChecked();
  await expect(mode).toBeHidden();
  await expect(page.locator('.cm-fat-cursor')).toHaveCount(0);

  await vim.check();
  await page.locator('.cm-line', { hasText: 'never exceeds the magazine' }).click();
  await expect(mode).toHaveText('NORMAL');
  await expect(page.locator('.cm-fat-cursor').first()).toBeVisible();
  await page.keyboard.press('i');
  await expect(mode).toHaveText('INSERT');
  await page.keyboard.type('x');
  await page.keyboard.press('Escape');
  await expect(mode).toHaveText('NORMAL');
  await page.keyboard.press('V');
  await expect(mode).toHaveText('VISUAL LINE');
  await page.keyboard.press('Escape');
  await expect(mode).toHaveText('NORMAL');
  // :w goes through the normal save path (mocked PUT)
  await expect(page.locator('#save')).toBeEnabled();
  await page.keyboard.type(':w');
  await page.keyboard.press('Enter');
  await expect(page.locator('#status')).toHaveText('Saved bbbbbbb');
  await expect(page.locator('#save')).toBeDisabled();

  // Mod-s still saves in vim mode
  await page.keyboard.press('i');
  await page.keyboard.type('y');
  await page.keyboard.press('Escape');
  await expect(page.locator('#save')).toBeEnabled();
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('#save')).toBeDisabled();

  // the choice survives a reload, and switching it off removes the block cursor
  await page.reload();
  await expect(page.locator('.cm-content')).toContainText('Shooting');
  await expect(vim).toBeChecked();
  await expect(mode).toHaveText('NORMAL');
  await vim.uncheck();
  await expect(mode).toBeHidden();
  await expect(page.locator('.cm-fat-cursor')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('editor-vim'))).toBe('0');
});

test.describe('dark scheme', () => {
  test.use({ colorScheme: 'dark' });

  test('editor: caret follows the text colour', async ({ page }) => {
    await openEditor(page);
    await page.locator('.cm-line', { hasText: 'never exceeds the magazine' }).click();
    const c = await page.locator('.cm-content').evaluate((el) => {
      const cs = getComputedStyle(el);
      const rgb = (s: string) => s.match(/\d+/g)!.slice(0, 3).map(Number);
      return {
        caret: cs.caretColor,
        text: cs.color,
        caretLum: rgb(cs.caretColor).reduce((a, b) => a + b, 0) / 3,
        bgLum: rgb(getComputedStyle(document.body).backgroundColor).reduce((a, b) => a + b, 0) / 3,
      };
    });
    expect(c.caret).toBe(c.text);
    expect(c.caret).not.toBe('rgb(0, 0, 0)');
    expect(c.caretLum).toBeGreaterThan(c.bgLum + 100); // light caret on a dark background
    // vim's insert-mode cursor is drawSelection's .cm-cursor: same colour rule
    await page.locator('#vim').check();
    await page.locator('.cm-content').click();
    await page.keyboard.press('i');
    const cur = await page
      .locator('.cm-cursor.cm-cursor-primary')
      .first()
      .evaluate((el) => getComputedStyle(el).borderLeftColor);
    expect(cur).toBe(c.text);
    await page.keyboard.press('Escape');
    await page.locator('#vim').uncheck();
    await page.locator('h1').first().click(); // blur the editor so no cursor is in the shot
    await expect(page).toHaveScreenshot('editor-dark.png');
  });
});

test('editor: Tab stays in the editor; completion popup is visible and themed', async ({
  page,
}) => {
  await openEditor(page);
  const content = page.locator('.cm-content');
  await content.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  // Tab indents instead of moving focus
  await page.keyboard.press('Tab');
  await expect(content).toBeFocused();
  // typing "@" opens the completion popup
  await page.keyboard.type('Hello @');
  const tip = page.locator('.cm-tooltip-autocomplete');
  await expect(tip).toBeVisible();
  await expect(tip.locator('li[aria-selected]')).toBeVisible();
  const bg = await tip.evaluate((el) => getComputedStyle(el).backgroundColor);
  const card = await page.evaluate(() => {
    const d = document.createElement('div');
    d.style.background = 'var(--card)';
    document.body.append(d);
    const c = getComputedStyle(d).backgroundColor;
    d.remove();
    return c;
  });
  expect(bg).toBe(card);
  // Tab accepts the completion and focus remains
  await page.keyboard.press('Tab');
  await expect(tip).toBeHidden();
  await expect(content).toBeFocused();
  // Esc closes the popup; Esc then Tab leaves the editor
  await page.keyboard.type(' @');
  await expect(tip).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tip).toBeHidden();
  await page.keyboard.press('Tab');
  await expect(content).not.toBeFocused();
});
