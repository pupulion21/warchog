import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if(path!==':memory:')chmodSync(path,0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, token_hash TEXT UNIQUE, expires INTEGER, wallet TEXT);
      CREATE TABLE IF NOT EXISTS challenges (nonce TEXT PRIMARY KEY, address TEXT, message TEXT, origin TEXT, expires INTEGER);
      CREATE TABLE IF NOT EXISTS matches (code TEXT PRIMARY KEY, updated INTEGER, terminal INTEGER, data TEXT);
      CREATE TABLE IF NOT EXISTS replay_chunks (code TEXT, part INTEGER, data TEXT, PRIMARY KEY(code,part));
      CREATE TABLE IF NOT EXISTS signed_results (record_id TEXT PRIMARY KEY, code TEXT, data TEXT);`);
    this.db.exec('CREATE TABLE IF NOT EXISTS paid_bindings(code TEXT PRIMARY KEY, record_id TEXT UNIQUE, data TEXT)');
    this.db.exec('CREATE TABLE IF NOT EXISTS paid_terms(code TEXT PRIMARY KEY, record_id TEXT UNIQUE, data TEXT)');
    this.db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
    this.db.prepare('DELETE FROM challenges WHERE expires < ?').run(Date.now());
    // A process restart cannot silently resume an uncheckpointed physics world.
    this.db.prepare('UPDATE matches SET terminal=1, data=json_set(data,\'$.interrupted\',json(\'true\')) WHERE terminal=0').run();
  }
  session(token: string) { return this.db.prepare('SELECT id,wallet FROM sessions WHERE token_hash=? AND expires>?').get(digest(token), Date.now()) as { id: string; wallet: string | null } | undefined; }
  createSession() {
    const token = randomBytes(32).toString('hex'), id = randomBytes(16).toString('hex');
    this.db.prepare('INSERT INTO sessions(id,token_hash,expires) VALUES(?,?,?)').run(id, digest(token), Date.now() + 86_400_000);
    return { id, token };
  }
  saveRoom(code: string, data: unknown, terminal: boolean) { this.db.prepare('INSERT INTO matches VALUES(?,?,?,?) ON CONFLICT(code) DO UPDATE SET updated=excluded.updated,terminal=excluded.terminal,data=excluded.data').run(code, Date.now(), Number(terminal), JSON.stringify(data)); }
  chunk(code: string, part: number, data: unknown) { this.db.prepare('INSERT INTO replay_chunks VALUES(?,?,?)').run(code, part, JSON.stringify(data)); }
  match(code: string) { const row = this.db.prepare('SELECT data FROM matches WHERE code=?').get(code) as { data: string } | undefined; return row ? JSON.parse(row.data) : null; }
  close() { this.db.close(); }
}
