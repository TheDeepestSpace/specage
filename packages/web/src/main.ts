import './style.css';
import { renderAddDevice, renderHome, renderLogin, renderSignup } from './auth.js';
import { renderEditor } from './editor.js';
import { fail } from './dom.js';
import { renderViewer } from './viewer.js';

const root = document.getElementById('app')!;

async function main() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  // Static page (GitHub Pages): a baked data.json sits next to index.html.
  try {
    const r = await fetch('./data.json', { credentials: 'omit' });
    if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) {
      renderViewer(root, await r.json());
      return;
    }
  } catch {
    /* not a static page */
  }
  const m = /^\/r\/([\w.-]+\/[\w.-]+)$/.exec(path);
  if (m) return renderEditor(root, m[1]);
  if (path === '/login') return renderLogin(root);
  if (path === '/signup') return renderSignup(root);
  if (path === '/add-device') return renderAddDevice(root);
  if (path === '/') return renderHome(root);
  fail(root, 'Not found');
}
main().catch((e) => fail(root, String(e?.message ?? e)));
