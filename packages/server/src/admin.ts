// flyctl ssh console -C "node dist/admin.js reset-credentials"
// node dist/admin.js app-manifest https://specage.fly.dev   (prints the GitHub App manifest; the human submits it)
if (process.argv[2] === 'app-manifest') {
  const url = (process.argv[3] ?? '').replace(/\/$/, '');
  if (!/^https:\/\/[^/]+$/.test(url)) {
    console.error('usage: node dist/admin.js app-manifest https://<host>');
    process.exit(2);
  }
  // Contents read & write, Metadata read, no webhooks, no user OAuth: least privilege for the fixed API.
  console.log(
    JSON.stringify(
      {
        name: 'specage',
        url,
        redirect_url: `${url}/`,
        public: false,
        default_permissions: { contents: 'write', metadata: 'read' },
        default_events: [],
        hook_attributes: { active: false, url: `${url}/unused` },
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const { openDb } = await import('./db.js');
const db = openDb(process.env.DB_PATH ?? '/data/specage.db');
if (process.argv[2] === 'reset-credentials') {
  const n = db.resetCreds();
  db.audit('reset-credentials', null, `deleted ${n}`);
  console.log(`deleted ${n} passkey(s); /signup is open again (still gated by the owner key)`);
} else {
  console.error('usage: node dist/admin.js reset-credentials | app-manifest <url>');
  process.exit(2);
}
