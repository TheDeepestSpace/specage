import { expect, test } from '@playwright/test';

const URL = 'http://127.0.0.1:4173/index.html';

test('read-only page renders spec, status chips, aggregates, markers, questions', async ({ page }) => {
  await page.goto(URL);
  await expect(page.locator('h1')).toHaveText('tbgwaf');
  await expect(page.locator('details.block').first()).toBeVisible();
  await expect(page.locator('.chip.st-verified').first()).toBeVisible();
  await expect(page.locator('.chip.st-stale').first()).toBeVisible(); // bar: hash differs from the trace
  await expect(page.locator('.chip.st-contradiction')).toHaveCount(1);
  await expect(page.locator('details.block > summary .agg').first()).toContainText('verified');
  await expect(page.locator('.marker.mk-constraint')).toBeVisible();
  await expect(page.locator('.marker.mk-proof').first()).toContainText('proof');
  await expect(page.locator('.has-question')).toHaveCount(1);
  await expect(page.locator('.report pre')).toBeHidden(); // collapsed by default
});

test('deep link opens and highlights the node', async ({ page }) => {
  await page.goto(`${URL}#shoot.burst.cap`);
  await expect(page.locator('#shoot\\.burst\\.cap')).toBeVisible();
  await expect(page.locator('.target')).toHaveCount(1);
});

test('search filters', async ({ page }) => {
  await page.goto(URL);
  await page.getByLabel('Search').fill('pause menu');
  await expect(page.locator('#menu\\.pause')).toBeVisible();
  await expect(page.locator('#shoot\\.burst\\.cap')).toBeHidden();
});

test('evidence links are pinned to commits and allowlisted; media shown', async ({ page }) => {
  await page.goto(`${URL}#shoot.burst.cap`);
  const links = page.locator('#shoot\\.burst\\.cap ~ .detail a, details.leafdet:has(#shoot\\.burst\\.cap) .detail a');
  const hrefs = await links.evaluateAll((a) => a.map((x) => (x as HTMLAnchorElement).href));
  expect(hrefs.some((h) => /github\.com\/TheDeepestSpace\/tbgwaf\/blob\/9ff2e3a0+aa\/src\/game\/Weapon\.h#L60-L75/.test(h))).toBe(true);
  expect(hrefs.some((h) => h.endsWith('/pull/138'))).toBe(true);
  await page.goto(`${URL}#shoot.burst.bar`);
  await page.locator('img.thumb').click();
  await expect(page.locator('dialog.lightbox')).toBeVisible();
  await page.goto(`${URL}#menu.pause`);
  await expect(page.locator('video')).toHaveCount(1);
});

test('has an Edit link to the server and never asks for a token', async ({ page }) => {
  await page.goto(URL);
  await expect(page.getByRole('link', { name: 'Edit' })).toHaveAttribute('href', 'https://specage.fly.dev/r/TheDeepestSpace/tbgwaf');
  await expect(page.locator('input[type=password]')).toHaveCount(0);
});

test('works without localStorage', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('denied'); } }); });
  await page.goto(URL);
  await expect(page.locator('h1')).toHaveText('tbgwaf');
  await page.locator('details.block > summary').first().click();
});
