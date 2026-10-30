import Database from 'better-sqlite3';

export interface CredentialRow {
  id: string;
  public_key: Buffer;
  counter: number;
  transports: string | null;
  created: number;
  last_used: number | null;
  label: string;
}

export interface Db {
  raw: Database.Database;
  credCount(): number;
  creds(): CredentialRow[];
  cred(id: string): CredentialRow | undefined;
  addCred(c: Omit<CredentialRow, 'last_used'>): unknown;
  touchCred(id: string, counter: number): unknown;
  delCred(id: string): number;
  resetCreds(): number;
  consumeNonce(n: string): boolean;
  nonceUsed(n: string): boolean;
  addLink(hash: string, expires: number): unknown;
  useLink(hash: string): boolean;
  audit(action: string, repo: string | null, result: string): unknown;
  auditRows(): any[];
}

export function openDb(path: string): Db {
  const db: Database.Database = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS credentials (
      id TEXT PRIMARY KEY, public_key BLOB NOT NULL, counter INTEGER NOT NULL,
      transports TEXT, created INTEGER NOT NULL, last_used INTEGER, label TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS consumed_nonces (nonce TEXT PRIMARY KEY, at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS device_links (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, action TEXT NOT NULL, repo TEXT, result TEXT NOT NULL);
  `);
  return {
    raw: db,
    credCount: () => (db.prepare('SELECT COUNT(*) c FROM credentials').get() as any).c as number,
    creds: () => db.prepare('SELECT * FROM credentials ORDER BY created').all() as CredentialRow[],
    cred: (id: string) => db.prepare('SELECT * FROM credentials WHERE id=?').get(id) as CredentialRow | undefined,
    addCred: (c: Omit<CredentialRow, 'last_used'>) =>
      db.prepare('INSERT INTO credentials (id, public_key, counter, transports, created, label) VALUES (?,?,?,?,?,?)').run(c.id, c.public_key, c.counter, c.transports, c.created, c.label),
    touchCred: (id: string, counter: number) =>
      db.prepare('UPDATE credentials SET counter=?, last_used=? WHERE id=?').run(counter, Date.now(), id),
    delCred: (id: string) => db.prepare('DELETE FROM credentials WHERE id=?').run(id).changes,
    resetCreds: () => db.prepare('DELETE FROM credentials').run().changes,
    consumeNonce: (nonce: string): boolean =>
      db.prepare('INSERT OR IGNORE INTO consumed_nonces (nonce, at) VALUES (?,?)').run(nonce, Date.now()).changes === 1,
    nonceUsed: (nonce: string) => !!db.prepare('SELECT 1 FROM consumed_nonces WHERE nonce=?').get(nonce),
    addLink: (hash: string, expires: number) => db.prepare('INSERT INTO device_links (hash, expires) VALUES (?,?)').run(hash, expires),
    useLink: (hash: string): boolean =>
      db.prepare('UPDATE device_links SET used=1 WHERE hash=? AND used=0 AND expires>?').run(hash, Date.now()).changes === 1,
    audit: (action: string, repo: string | null, result: string) =>
      db.prepare('INSERT INTO audit (at, action, repo, result) VALUES (?,?,?,?)').run(Date.now(), action, repo, result),
    auditRows: () => db.prepare('SELECT * FROM audit ORDER BY id').all() as any[],
  };
}

