import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';
export function binding(filename=':memory:'){
 const sqlite=new DatabaseSync(filename);sqlite.exec('PRAGMA foreign_keys=ON');
 if(!sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='items'").get())sqlite.exec(readFileSync(new URL('../drizzle/0000_workshop.sql',import.meta.url),'utf8'));
 const wrap=(sql,args=[])=>({bind(...values){return wrap(sql,values);},async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){const result=sqlite.prepare(sql).run(...args);return {meta:{changes:Number(result.changes)}};}});
 return {prepare:wrap,async batch(statements){sqlite.exec('BEGIN');try{const result=await Promise.all(statements.map(s=>s.all()));sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}},sqlite,close(){sqlite.close();}};
}
