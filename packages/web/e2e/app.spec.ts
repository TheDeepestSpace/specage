import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

function sign(challenge: string, ns: string): string {
  const d = mkdtempSync(join(tmpdir(), 'sig-'));
  writeFileSync(join(d, 'challenge.txt'), challenge);
  execFileSync('ssh-keygen', [
    '-Y',
    'sign',
    '-f',
    '/tmp/specage-e2e/k',
    '-n',
    ns,
    join(d, 'challenge.txt'),
  ]);
  return readFileSync(join(d, 'challenge.txt.sig'), 'utf8');
}

async function virtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext({ baseURL: 'http://localhost:8788' })).newPage();
  await virtualAuthenticator(page);
});

test('unauthenticated users are sent to login; API is 401', async () => {
  const r = await page.request.get('/api/me');
  expect(r.status()).toBe(401);
  await page.goto('/r/o/r');
  await expect(page).toHaveURL(/\/login$/);
});

test('sign-up needs the owner key; wrong signature rejected', async () => {
  await page.goto('/signup');
  const challenge = await page.locator('#challenge').innerText();
  const command = await page.locator('#command').innerText();
  const ns = /-n (\S+)/.exec(command)![1];
  await page
    .locator('#signature')
    .fill('-----BEGIN SSH SIGNATURE-----\nAAAA\n-----END SSH SIGNATURE-----');
  await page.locator('#verify').click();
  await expect(page.locator('.error')).toBeVisible();
  await page.locator('#signature').fill(sign(challenge, ns));
  await page.locator('#verify').click();
  await expect(page).toHaveURL(/localhost:8788\/$/);
  await expect(page.locator('#repos a')).toHaveText('o/r');
});

test('/signup disappears once a passkey exists', async () => {
  const r = await page.request.get('/signup');
  expect(r.status()).toBe(404);
});

test('login with the passkey after logout', async () => {
  await page.evaluate(async () => {
    const me = await (await fetch('/api/me')).json();
    await fetch('/auth/logout', {
      method: 'POST',
      headers: { 'x-specage': '1', 'x-csrf-token': me.csrf },
    });
  });
  await page.goto('/login');
  await page.locator('#login').click();
  await expect(page).toHaveURL(/localhost:8788\/$/);
});

test('editor: gutter dots follow the trace, live hashing marks edits stale', async () => {
  await page.goto('/r/o/r');
  await expect(page.locator('.cm-content')).toContainText('Limit magazine');
  await expect(page.locator('.dot[data-status="stale"]')).toHaveCount(1); // shoot.burst: trace hash differs
  await expect(page.locator('.dot[data-status="verified"]')).toHaveCount(1); // shoot.cap
  // edit the verified node: it becomes stale immediately
  await page.locator('.cm-line', { hasText: 'Limit magazine' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.type('X'); // any text edit changes the hash
  await expect(page.locator('.dot[data-status="verified"]')).toHaveCount(0);
  await expect(page.locator('.dot[data-status="stale"]')).toHaveCount(2);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.dot[data-status="verified"]')).toHaveCount(1);
});

test('GRAMMAR.md tab is rendered, read-only, and keeps spec edits', async () => {
  await page.goto('/r/o/r');
  await expect(page.locator('.cm-content')).toContainText('Limit magazine');
  await page.locator('.cm-line', { hasText: 'Limit magazine' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.type('Q');
  await page.getByRole('tab', { name: 'GRAMMAR.md' }).click();
  const g = page.locator('#grammar');
  await expect(g).toBeVisible();
  await expect(page.locator('#editor')).toBeHidden();
  await expect(g.getByRole('heading', { name: 'The specage language', level: 1 })).toBeVisible();
  await expect(g.getByRole('heading', { name: 'Markers', level: 2 })).toBeVisible();
  await expect(g.locator('table').first()).toBeVisible();
  await expect(g.locator('pre')).not.toHaveCount(0);
  expect(await g.locator('.cm-editor, [contenteditable], input, textarea').count()).toBe(0);
  await page.getByRole('tab', { name: 'Spec' }).click();
  await expect(page.locator('.cm-line', { hasText: 'QLimit magazine' })).toBeVisible();
  await expect(page.locator('#save')).toBeEnabled();
  await page.keyboard.press('Control+z'); // restore for later tests
  await expect(page.locator('#save')).toBeDisabled();
});

test('trace pane follows the cursor and pins', async () => {
  await page.locator('.cm-line', { hasText: 'Limit magazine' }).click();
  await expect(page.locator('#crumbs strong')).toHaveText('shoot.cap', { timeout: 3000 });
  await expect(page.locator('#pane')).toContainText('verified');
  await page.locator('#pin').check();
  await page.locator('.cm-line', { hasText: 'Shoot a burst' }).click();
  await page.waitForTimeout(400);
  await expect(page.locator('#crumbs strong')).toHaveText('shoot.cap');
  await page.locator('#pin').uncheck();
  await page.locator('.cm-line', { hasText: 'Shoot a burst' }).click();
  await expect(page.locator('#crumbs strong')).toHaveText('shoot.burst', { timeout: 3000 });
  await expect(page.locator('#pane')).toContainText('Changed since');
});

test('lint is shown on the client and enforced by the server (422)', async () => {
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nx @dup.id; y @dup.id;');
  await expect(page.locator('.cm-lintRange-error')).toBeVisible({ timeout: 3000 });
  await page.locator('#save').click();
  await expect(page.locator('#diagnostics')).toContainText('E003');
  await expect(page.locator('#status')).toContainText('Not saved');
  // the server refuses it even when called directly
  const status = await page.evaluate(async () => {
    const me = await (await fetch('/api/me')).json();
    const cur = await (await fetch('/api/r/o/r/spec')).json();
    const r = await fetch('/api/r/o/r/spec', {
      method: 'PUT',
      headers: { 'x-specage': '1', 'x-csrf-token': me.csrf, 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'a @x; b @x;', base_sha: cur.head_sha }),
    });
    return r.status;
  });
  expect(status).toBe(422);
});

test('save, then a conflict with a 3-way view and re-apply', async () => {
  await page.reload();
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('Mine one @shoot.mine;\n');
  await page.keyboard.press('Control+s');
  await expect(page.locator('#status')).toContainText('Saved');
  // someone else saves a different change
  await page.evaluate(async () => {
    const me = await (await fetch('/api/me')).json();
    const cur = await (await fetch('/api/r/o/r/spec')).json();
    await fetch('/api/r/o/r/spec', {
      method: 'PUT',
      headers: { 'x-specage': '1', 'x-csrf-token': me.csrf, 'content-type': 'application/json' },
      body: JSON.stringify({
        content: cur.content + 'Theirs @shoot.theirs;\n',
        base_sha: cur.head_sha,
      }),
    });
  });
  await page.keyboard.type('Mine two @shoot.mine2;\n');
  await page.keyboard.press('Control+s');
  await expect(page.locator('#conflict')).toBeVisible();
  await expect(page.locator('#conflict .col')).toHaveCount(3);
  await expect(page.locator('#conflict .chg').first()).toBeVisible();
  await page.locator('#reapply').click();
  await expect(page.locator('#status')).toContainText('Saved');
});

test('add project: preview, step-up passkey assertion, then POST', async () => {
  await page.goto('/');
  await page.locator('#init-repo').selectOption('o/new');
  await page.locator('#init-preview').click();
  await expect(page.locator('#init-plan')).toContainText('create: specages/new/spec');
  const order: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url()).pathname;
    if (r.method() === 'POST' && (u === '/auth/login/verify' || u === '/api/init')) order.push(u);
  });
  await page.locator('#init-create').click();
  await expect(page.locator('#init-out')).toContainText('Project added');
  expect(order).toEqual(['/auth/login/verify', '/api/init']);
});

test('init is refused without a session', async () => {
  const r = await page
    .context()
    .browser()!
    .newContext()
    .then((c) =>
      c.request.post('http://localhost:8788/api/init', {
        data: {},
        headers: { origin: 'http://localhost:8788', 'x-specage': '1' },
      }),
    );
  expect(r.status()).toBe(401);
});

test('cross-origin writes are rejected (CSRF)', async () => {
  const s = await page.evaluate(async () => {
    const r = await fetch('/api/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    return r.status;
  });
  expect(s).toBe(403);
});
