// flyctl ssh console -C "node dist/admin.js reset-credentials"
import { openDb } from './db.js';

const db = openDb(process.env.DB_PATH ?? '/data/specage.db');
if (process.argv[2] === 'reset-credentials') {
  const n = db.resetCreds();
  db.audit('reset-credentials', null, `deleted ${n}`);
  console.log(`deleted ${n} passkey(s); /signup is open again (still gated by the owner key)`);
} else {
  console.error('usage: node dist/admin.js reset-credentials');
  process.exit(2);
}
