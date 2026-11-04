import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
export class CoordinationCache {
 readonly db:DatabaseSync;
 constructor(file:string=':memory:'){if(file!==':memory:')fs.mkdirSync(path.dirname(path.resolve(file)),{recursive:true});this.db=new DatabaseSync(file);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS github_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS github_locks (name TEXT PRIMARY KEY,owner TEXT NOT NULL,expires INTEGER NOT NULL)');}
 get<T>(key:string):T|undefined{const row=this.db.prepare('SELECT value FROM github_cache WHERE key=?').get(key) as {value:string}|undefined;return row?JSON.parse(row.value):undefined;}
 set(key:string,value:unknown){this.db.prepare('INSERT INTO github_cache VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));}
 delete(key:string){this.db.prepare('DELETE FROM github_cache WHERE key=?').run(key);}
 keys(prefix:string){return (this.db.prepare('SELECT key FROM github_cache WHERE substr(key,1,?)=?').all(prefix.length,prefix) as {key:string}[]).map(row=>row.key);}
 transaction<T>(fn:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
 async locked<T>(name:string,fn:()=>Promise<T>,ttl=240000):Promise<T>{const owner=randomUUID();this.transaction(()=>{this.db.prepare('DELETE FROM github_locks WHERE expires<?').run(Date.now());try{this.db.prepare('INSERT INTO github_locks VALUES (?,?,?)').run(name,owner,Date.now()+ttl);}catch{throw new Error('Another connector owns this cursor/workspace; retry after its bounded run finishes');}});try{return await fn();}finally{this.db.prepare('DELETE FROM github_locks WHERE name=? AND owner=?').run(name,owner);}}
 close(){this.db.close();}
}
