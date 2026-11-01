import { api, ApiError, loadMe, passkeyLogin, passkeyRegister } from './api.js';
import { h } from './dom.js';

const msg = (m: string, err = false) =>
  h('p', { class: err ? 'error' : 'note', role: err ? 'alert' : 'status' }, m);

export function renderLogin(root: HTMLElement) {
  const out = h('div', {});
  const btn = h(
    'button',
    {
      id: 'login',
      onclick: async () => {
        try {
          await passkeyLogin();
          location.href = '/';
        } catch (e: any) {
          out.replaceChildren(
            e instanceof ApiError && e.status === 404
              ? h(
                  'p',
                  {},
                  'No passkey is registered yet. ',
                  h('a', { href: '/signup' }, 'Sign up with the owner key'),
                  '.',
                )
              : msg(`Sign-in failed: ${e.message}`, true),
          );
        }
      },
    },
    'Sign in with passkey',
  );
  root.replaceChildren(h('main', { class: 'auth' }, h('h1', {}, 'specage'), btn, out));
}

export async function renderSignup(root: HTMLElement) {
  const main = h('main', { class: 'auth' }, h('h1', {}, 'specage sign-up'));
  root.replaceChildren(main);
  let ch: { challenge: string; command: string };
  try {
    ch = await api('GET', '/signup');
  } catch {
    main.append(msg('Sign-up is closed: a passkey already exists.', true));
    return;
  }
  const sig = h('textarea', {
    id: 'signature',
    rows: '10',
    placeholder: '-----BEGIN SSH SIGNATURE-----',
    spellcheck: 'false',
  }) as HTMLTextAreaElement;
  const out = h('div', {});
  main.append(
    h(
      'p',
      {},
      'Save this challenge as challenge.txt (exactly), sign it with the owner key, and paste the signature. It expires in 5 minutes.',
    ),
    h('pre', { id: 'challenge' }, ch.challenge),
    h('pre', { id: 'command' }, ch.command),
    sig,
    h(
      'button',
      {
        id: 'verify',
        onclick: async () => {
          try {
            await api('POST', '/auth/signup/verify', { signature: sig.value });
            await passkeyRegister('first passkey');
            location.href = '/';
          } catch (e: any) {
            out.replaceChildren(msg(e.message, true));
          }
        },
      },
      'Verify and create passkey',
    ),
    out,
  );
}

export async function renderAddDevice(root: HTMLElement) {
  const token = location.hash.slice(1);
  history.replaceState(null, '', location.pathname);
  const out = h('div', {});
  root.replaceChildren(h('main', { class: 'auth' }, h('h1', {}, 'Add this device'), out));
  try {
    await api('POST', '/auth/device/redeem', { token });
    await passkeyRegister('device');
    location.href = '/';
  } catch (e: any) {
    out.replaceChildren(msg(e.message, true));
  }
}

export async function renderHome(root: HTMLElement) {
  const me = await loadMe();
  if (!me) {
    location.href = '/login';
    return;
  }
  const out = h('ul', { id: 'repos' });
  root.replaceChildren(
    h(
      'main',
      { class: 'auth' },
      h('h1', {}, 'specage'),
      h('p', { class: 'note' }, `Signed in as ${me.label}`),
      out,
      h(
        'button',
        {
          onclick: async () => {
            await api('POST', '/auth/logout', {});
            location.href = '/login';
          },
        },
        'Sign out',
      ),
    ),
  );
  root.querySelector('main')!.insertBefore(
    initForm(() => void renderHome(root)),
    out.nextSibling,
  );
  try {
    const repos: string[] = await api('GET', '/api/repos');
    out.replaceChildren(...repos.map((r) => h('li', {}, h('a', { href: `/r/${r}` }, r))));
    if (!repos.length) out.replaceChildren(h('li', {}, 'No specage-enabled repos found.'));
  } catch (e: any) {
    out.replaceChildren(msg(e.message, true));
  }
}

/** Owner-only "Add project": pick an installation repo, preview the plan, then create (passkey step-up). */
function initForm(onDone: () => void): HTMLElement {
  const repoSel = h('select', { id: 'init-repo' }) as HTMLSelectElement;
  const backend = h('input', { id: 'init-backend', value: 'claude' }) as HTMLInputElement;
  const plan = h('pre', { id: 'init-plan' });
  const out = h('div', { id: 'init-out' });
  const body = () => ({ repo: repoSel.value, backend: backend.value });
  const show = (p: any) =>
    plan.replaceChildren(
      document.createTextNode(
        [
          `project ${p.project} (${p.repo}) in ${p.data_repo}`,
          ...p.branches.map((b: any) => `${b.action}: ${b.name}`),
          `labels on ${p.repo}: ${p.labels.join(', ')}`,
          ...p.warnings.map((w: string) => `WARNING: ${w}`),
        ].join('\n'),
      ),
    );
  api('GET', '/api/init/repos')
    .then((rs: { repo: string; initialised: boolean }[]) =>
      repoSel.replaceChildren(
        ...rs.map((r) =>
          h('option', { value: r.repo }, r.initialised ? `${r.repo} (already added)` : r.repo),
        ),
      ),
    )
    .catch((e: any) => out.replaceChildren(msg(e.message, true)));
  return h(
    'section',
    { id: 'init' },
    h('h2', {}, 'Add project'),
    h('label', {}, 'Repo ', repoSel),
    h('label', {}, 'Backend ', backend),
    h(
      'button',
      {
        id: 'init-preview',
        onclick: async () => {
          try {
            show(await api('POST', '/api/init/preview', body()));
            out.replaceChildren();
          } catch (e: any) {
            out.replaceChildren(msg(e.message, true));
          }
        },
      },
      'Preview',
    ),
    h(
      'button',
      {
        id: 'init-create',
        onclick: async () => {
          try {
            await passkeyLogin(); // step-up: creates branches and labels
            show(await api('POST', '/api/init', body()));
            out.replaceChildren(msg('Project added'));
            setTimeout(onDone, 800);
          } catch (e: any) {
            out.replaceChildren(msg(e.message, true));
          }
        },
      },
      'Create',
    ),
    plan,
    out,
  );
}
