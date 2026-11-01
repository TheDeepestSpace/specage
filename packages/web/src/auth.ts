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
  try {
    const repos: string[] = await api('GET', '/api/repos');
    out.replaceChildren(...repos.map((r) => h('li', {}, h('a', { href: `/r/${r}` }, r))));
    if (!repos.length) out.replaceChildren(h('li', {}, 'No specage-enabled repos found.'));
  } catch (e: any) {
    out.replaceChildren(msg(e.message, true));
  }
}
