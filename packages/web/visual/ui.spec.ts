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
