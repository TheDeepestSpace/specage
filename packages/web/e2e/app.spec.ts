import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

test('code panel draws a 100-column ruler', async () => {
  await page.goto('/r/o/r');
  await expect(page.locator('.cm-content')).toContainText('Limit magazine');
  const ruler = page.locator('.cm-scroller > .cm-ruler');
  await expect(ruler).toHaveCount(1);
  const [rx, cx, pad, cw] = await page.evaluate(() => {
    const r = document.querySelector('.cm-ruler') as HTMLElement;
    const c = document.querySelector('.cm-content') as HTMLElement;
    const l = document.querySelector('.cm-line') as HTMLElement;
    const m = document.createElement('span');
    m.textContent = 'x'.repeat(100);
    m.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
    l.appendChild(m);
    const w = m.getBoundingClientRect().width / 100;
    m.remove();
    return [r.offsetLeft, c.offsetLeft, parseFloat(getComputedStyle(l).paddingLeft), w];
  });
  expect(Math.abs(rx - (cx + pad + 100 * cw))).toBeLessThan(2);
  await page.screenshot({ path: 'test-results/ruler.png' });
});

test('editor: native spellcheck on for prose, off for ids/refs/markers', async () => {
  await page.goto('/r/o/r');
  const content = page.locator('.cm-content');
  await expect(content).toContainText('Limit magazine');
  await expect(content).toHaveAttribute('spellcheck', 'true');
  await expect(content.locator('.cm-spec-id').first()).toHaveAttribute('spellcheck', 'false');
  const before = await content.innerText();
  await page.locator('.cm-line', { hasText: 'Limit magazine' }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' mispelled');
  await expect(content).toContainText('mispelled'); // typing is untouched by spellcheck
  await page.keyboard.press('Control+z');
  expect(await content.innerText()).toBe(before);
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

// ---- planner questions (the e2e server seeds q-0001 on shoot.cap and top-level q-0002, with a stand-in planner) ----
const shot = async (name: string) => {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`) });
};

test('questions: orange ? badge on the node, top-level question in the panel, dispatch-held note', async () => {
  await page.goto('/r/o/r');
  await expect(page.locator('.cm-content')).toContainText('Limit magazine');
  const badges = page.locator('.q-badge');
  await expect(badges).toHaveCount(1);
  // the badge sits on the shoot.cap line, to the right of the status dot
  const line = page.locator('.cm-line', { hasText: 'Limit magazine' });
  const lb = (await line.boundingBox())!;
  const bb = (await badges.boundingBox())!;
  const db = (await page.locator('.dot[data-status="verified"]').boundingBox())!;
  expect(Math.abs(bb.y - lb.y)).toBeLessThan(lb.height);
  expect(bb.x).toBeGreaterThan(db.x);
  // top-level question shows in the side panel with no node selected
  const top = page.locator('#top-questions [data-question="q-0002"]');
  await expect(top).toContainText('Withdraw issue #8?');
  await expect(top).toContainText('Holding dispatch of #8');
  await shot('questions-badge-and-top-level');
});

test('questions: clicking the badge opens the node thread; answer, follow-up, resolve collapses', async () => {
  await page.locator('.q-badge').click();
  const q = page.locator('#node-questions [data-question="q-0001"]');
  await expect(q).toBeVisible();
  await expect(page.locator('#crumbs strong')).toHaveText('shoot.cap');
  await expect(q).toContainText('Holding dispatch of #7');
  await shot('questions-node-thread');
  // answer with a standard choice: stays open and gets written to the trail
  await q.getByRole('button', { name: 'Keep' }).click();
  await expect(q.locator('.q-msg')).toHaveCount(1);
  await expect(q.locator('.q-msg').first()).toContainText('Keep the issue.');
  await expect(q).toHaveClass(/q-open/);
  // the planner follows up in the same thread (the stand-in replies on the trail; reload to see it)
  await page.reload();
  await page.locator('.q-badge').click();
  await expect(q.locator('.q-msg')).toHaveCount(2);
  await expect(q.locator('.q-msg').last()).toContainText('Anything else');
  await expect(q).toHaveClass(/q-open/);
  await expect(page.locator('.q-badge')).toHaveCount(1);
  // free-text follow-up; "done" makes the stand-in planner resolve it -> thread collapses
  await q.getByLabel('Answer').fill('Keep it, but cap at 30. done');
  await q.getByRole('button', { name: 'Send' }).click();
  await expect(q.locator('.q-msg')).toHaveCount(3);
  await page.reload();
  await page.locator('.cm-line', { hasText: 'Limit magazine' }).click();
  const resolved = page.locator('#node-questions details[data-question="q-0001"]');
  await expect(resolved).toBeVisible();
  await expect(resolved).not.toHaveAttribute('open', '');
  await expect(resolved.locator('summary')).toContainText('resolved');
  await expect(page.locator('.q-badge')).toHaveCount(0);
  await shot('questions-resolved-collapsed');
  // still expandable
  await resolved.locator('summary').click();
  await expect(resolved.locator('.q-msg')).toHaveCount(4);
  // the other question is untouched and still visible
  await expect(page.locator('#top-questions [data-question="q-0002"]')).toHaveClass(/q-open/);
  // answers were persisted to the trail via the API
  const st = await (await page.request.get('/api/r/o/r/state')).json();
  expect(st.questions.find((x: any) => x.id === 'q-0001')).toMatchObject({ state: 'resolved' });
  expect(st.questions.find((x: any) => x.id === 'q-0002').thread).toEqual([]);
});

test('questions: clicking an option with a colon and backticks is accepted', async () => {
  const q = page.locator('#top-questions [data-question="q-0002"]');
  await q.getByRole('button', { name: /^yes: carry trace\/claims/ }).click();
  await expect(q.locator('.q-msg').first()).toContainText('retire `s-43c9243d`');
  await expect(q.locator('.error')).toHaveText('');
  await expect(q).toHaveClass(/q-open/);
  await shot('questions-option-answered');
});

test('questions: top-level question can be withdrawn from the panel', async () => {
  const q = page.locator('#top-questions [data-question="q-0002"]');
  await q.getByRole('button', { name: 'Withdraw', exact: true }).click();
  await expect(q.locator('.q-msg').last()).toContainText('Withdraw the issue.');
  await expect(q.locator('.q-msg').last()).toContainText('withdraw');
  await shot('questions-top-level-answered');
});
