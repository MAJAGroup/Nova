import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
export class Store {
  db: Database.Database;
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.db = new Database(path.join(dir, "cosmic.sqlite"));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(`
 CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY);
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,preferences TEXT NOT NULL DEFAULT '{}',created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users ON DELETE CASCADE,token TEXT UNIQUE NOT NULL,label TEXT,expires INTEGER NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users ON DELETE CASCADE,name TEXT NOT NULL,panes TEXT NOT NULL DEFAULT '[]',layout TEXT NOT NULL DEFAULT 'horizontal',ratio REAL NOT NULL DEFAULT 50,storage TEXT);
 CREATE TABLE IF NOT EXISTS tabs(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces ON DELETE CASCADE,url TEXT NOT NULL DEFAULT 'about:blank',title TEXT NOT NULL DEFAULT 'New tab',current_visit TEXT,closed INTEGER NOT NULL DEFAULT 0,opener TEXT);
 CREATE TABLE IF NOT EXISTS visits(id TEXT PRIMARY KEY,tab_id TEXT NOT NULL REFERENCES tabs ON DELETE CASCADE,url TEXT NOT NULL,title TEXT NOT NULL,parent TEXT,kind TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users ON DELETE CASCADE,tab_id TEXT NOT NULL REFERENCES tabs ON DELETE CASCADE,goal TEXT NOT NULL,status TEXT NOT NULL,background INTEGER NOT NULL,steps INTEGER NOT NULL DEFAULT 0,result TEXT NOT NULL DEFAULT '',created INTEGER NOT NULL,error TEXT);
 CREATE TABLE IF NOT EXISTS steps(id INTEGER PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks ON DELETE CASCADE,message TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks ON DELETE CASCADE,action TEXT NOT NULL,snapshot TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',expires INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS tabs_workspace ON tabs(workspace_id);
 CREATE INDEX IF NOT EXISTS visits_tab ON visits(tab_id);
 CREATE INDEX IF NOT EXISTS tasks_user ON tasks(user_id,status);
 INSERT OR IGNORE INTO migrations VALUES(1);
 UPDATE tasks SET status='paused',error='Server restarted; inspect the recovered page before resuming.' WHERE status IN ('queued','running','planning','recovering');
 UPDATE approvals SET status='expired' WHERE status='pending' AND expires < ${Date.now()};
 `);
  }
  run(sql: string, ...args: unknown[]) {
    return this.db.prepare(sql).run(...args);
  }
  get<T = Record<string, unknown>>(sql: string, ...args: unknown[]) {
    return this.db.prepare(sql).get(...args) as T | undefined;
  }
  all<T = Record<string, unknown>>(sql: string, ...args: unknown[]) {
    return this.db.prepare(sql).all(...args) as T[];
  }
}
