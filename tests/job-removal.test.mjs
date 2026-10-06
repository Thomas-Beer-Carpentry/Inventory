import test from 'node:test';
import assert from 'node:assert/strict';
import {createPhoneStore} from '../public/phone-store.js';
import {IDBFactory,IDBKeyRange,IDBObjectStore} from './vendor/fake-indexeddb/esm/index.js';

const movement=(itemId,type,quantity,jobId=null)=>({id:crypto.randomUUID(),itemId,type,quantity,jobId});
const emptyStore=()=>createPhoneStore({indexedDB:new IDBFactory(),IDBKeyRange,databaseName:crypto.randomUUID()});

async function fixture(){
 const indexedDB=new IDBFactory(),databaseName=crypto.randomUUID(),connections=[];
 let timestamp='2026-10-06T08:00:00.000Z';
 const connect=()=>{
  const store=createPhoneStore({indexedDB,IDBKeyRange,databaseName,now:()=>timestamp});connections.push(store);return store;
 };
 const store=connect();await store.request('operator',{name:'Eryk'});
 const item=(await store.request('items',{name:'90mm Galvanised Nails',barcode:'0123456789012',unit:'boxes'})).id;
 const job=(await store.request('jobs',{client:'Caroline',name:'Fence Replacement',address:'123 Workshop Road'})).id;
 const otherJob=(await store.request('jobs',{client:'Andrew',name:'Bathroom Repairs'})).id;
 await store.request('movements',movement(item,'STOCK_IN',7));
 const taken=movement(item,'TAKEN_TO_JOB',2,job);await store.request('movements',taken);
 timestamp='2026-10-06T09:00:00.000Z';
 return {
  store,item,job,otherJob,taken,connect,
  get timestamp(){return timestamp;},set timestamp(value){timestamp=value;},
  async close(){for(const connection of connections)await connection.close();},
 };
}

test('Removing a job retains the complete catalogue, Workshop stock, saved barcode, and permanent audit records',async()=>{
 const f=await fixture();
 try{
  const before=await f.store.request('state');
  await f.store.request('jobs/'+f.job+'/delete');
  const after=await f.store.request('state'),removed=after.jobs.find(job=>job.id===f.job);
  assert.deepEqual(after.items,before.items);assert.equal(after.items[0].quantity,5);assert.equal(after.items[0].barcode,'0123456789012');
  assert.deepEqual(after.movements,before.movements);assert.deepEqual(after.user,before.user);
  assert.equal(after.jobs.length,2);assert.equal(removed.status,'Completed');assert.equal(removed.deleted_at,f.timestamp);
  assert.equal(removed.client,'Caroline');assert.equal(removed.name,'Fence Replacement');assert.equal(removed.address,'123 Workshop Road');
  assert.deepEqual(after.jobs.find(job=>job.id===f.otherJob),before.jobs.find(job=>job.id===f.otherJob));
  assert.ok(after.movements.filter(m=>m.job_id).every(m=>after.jobs.some(job=>job.id===m.job_id)));
 }finally{await f.close();}
});

test('Repeated removal preserves its first timestamp and confirmed stock-out retries remain idempotent',async()=>{
 const f=await fixture();
 try{
  await f.store.request('jobs/'+f.job+'/delete');const removed=await f.store.request('state');
  f.timestamp='2026-10-07T10:00:00.000Z';await f.store.request('jobs/'+f.job+'/delete');
  assert.deepEqual(await f.store.request('state'),removed);
  const replay=await f.store.request('movements',f.taken);
  assert.deepEqual(replay.movement,removed.movements.find(m=>m.id===f.taken.id));
  assert.deepEqual(await f.store.request('state'),removed);
 }finally{await f.close();}
});

test('Removed jobs reject fresh stock-outs and status changes but accept bounded returns with permanent snapshots',async()=>{
 const f=await fixture();
 try{
  await f.store.request('jobs/'+f.job+'/delete');const before=await f.store.request('state');
  await assert.rejects(f.store.request('movements',movement(f.item,'TAKEN_TO_JOB',1,f.job)),/deleted|removed/i);
  for(const status of ['Active','Completed'])await assert.rejects(f.store.request('jobs/'+f.job+'/status',{status}),/deleted|removed|restore/i);
  assert.deepEqual(await f.store.request('state'),before);
  const returned=(await f.store.request('movements',movement(f.item,'RETURNED_TO_WORKSHOP',1,f.job))).movement;
  assert.deepEqual([returned.before,returned.after,returned.client_name,returned.job_name,returned.user_name],[5,6,'Caroline','Fence Replacement','Eryk']);
  assert.equal(returned.type,'RETURNED_TO_WORKSHOP');assert.equal(returned.job_id,f.job);
  const after=await f.store.request('state');assert.equal(after.jobs.find(job=>job.id===f.job).deleted_at,f.timestamp);
  assert.equal(after.movements.filter(m=>m.job_id===f.job).reduce((net,m)=>net+(m.type==='TAKEN_TO_JOB'?m.quantity:-m.quantity),0),1);
  await assert.rejects(f.store.request('movements',movement(f.item,'RETURNED_TO_WORKSHOP',2,f.job)),/exceeds/);
  assert.deepEqual(await f.store.request('state'),after);
 }finally{await f.close();}
});

test('Explicit job restoration retains stock and history, leaves the job Completed, and permits a later normal reopening',async()=>{
 const f=await fixture();
 try{
  await f.store.request('jobs/'+f.job+'/delete');const removed=await f.store.request('state');
  await f.store.request('jobs/'+f.job+'/restore');await f.store.request('jobs/'+f.job+'/restore');
  const restored=await f.store.request('state'),job=restored.jobs.find(job=>job.id===f.job);
  assert.equal(Object.hasOwn(job,'deleted_at'),false);assert.equal(job.status,'Completed');
  assert.deepEqual(restored.items,removed.items);assert.deepEqual(restored.movements,removed.movements);
  await assert.rejects(f.store.request('movements',movement(f.item,'TAKEN_TO_JOB',1,f.job)),/active destination/i);
  await f.store.request('jobs/'+f.job+'/status',{status:'Active'});
  const taken=(await f.store.request('movements',movement(f.item,'TAKEN_TO_JOB',1,f.job))).movement;
  assert.deepEqual([taken.before,taken.after],[5,4]);assert.equal(taken.sequence,3);
 }finally{await f.close();}
});

test('Restoring an imported removed job marked Active still requires explicit reopening before stock-out',async()=>{
 const f=await fixture(),destination=emptyStore();
 try{
  await f.store.request('jobs/'+f.job+'/delete');const backup=await f.store.request('export');
  const importedJob=backup.jobs.find(job=>job.id===f.job);importedJob.status='Active';
  assert.equal(importedJob.deleted_at,f.timestamp);
  await destination.request('restore',backup);const before=await destination.request('state');
  assert.equal(before.jobs.find(job=>job.id===f.job).status,'Active');
  await assert.rejects(destination.request('movements',movement(f.item,'TAKEN_TO_JOB',1,f.job)),/deleted|removed/i);
  await destination.request('jobs/'+f.job+'/restore');
  const restored=await destination.request('state'),job=restored.jobs.find(job=>job.id===f.job);
  assert.equal(Object.hasOwn(job,'deleted_at'),false);assert.equal(job.status,'Completed');
  assert.deepEqual(restored.items,before.items);assert.deepEqual(restored.movements,before.movements);
  await assert.rejects(destination.request('movements',movement(f.item,'TAKEN_TO_JOB',1,f.job)),/active destination/i);
  await destination.request('jobs/'+f.job+'/status',{status:'Active'});
  const taken=(await destination.request('movements',movement(f.item,'TAKEN_TO_JOB',1,f.job))).movement;
  assert.deepEqual([taken.before,taken.after,taken.sequence],[5,4,3]);
 }finally{await f.close();await destination.close();}
});

test('Phone backups preserve removed-job metadata and every material-history reference across restore',async()=>{
 const f=await fixture(),destination=emptyStore();
 try{
  await f.store.request('jobs/'+f.job+'/delete');const sourceState=await f.store.request('state'),backup=await f.store.request('export');
  assert.equal(backup.format,'workshop-phone-v1');assert.equal(backup.jobs.find(job=>job.id===f.job).deleted_at,f.timestamp);
  await destination.request('restore',backup);assert.deepEqual(await destination.request('state'),sourceState);
  const exported=await destination.request('export');assert.deepEqual(exported.jobs,backup.jobs);assert.deepEqual(exported.movements,backup.movements);
  assert.ok(exported.movements.filter(m=>m.job_id).every(m=>exported.jobs.some(job=>job.id===m.job_id)));
  const returned=(await destination.request('movements',movement(f.item,'RETURNED_TO_WORKSHOP',2,f.job))).movement;
  assert.deepEqual([returned.before,returned.after],[5,7]);
 }finally{await f.close();await destination.close();}
});

test('Older v1 backups without removal metadata remain compatible',async()=>{
 const f=await fixture(),destination=emptyStore();
 try{
  const backup=await f.store.request('export');for(const job of backup.jobs)delete job.deleted_at;
  await destination.request('restore',backup);
  const state=await destination.request('state');assert.equal(state.jobs.find(job=>job.id===f.job).status,'Active');
  assert.ok(state.jobs.every(job=>!job.deleted_at));assert.deepEqual(state.items,backup.items);assert.deepEqual(state.movements,backup.movements);
  const take=(await destination.request('movements',movement(f.item,'TAKEN_TO_JOB',1,f.job))).movement;assert.deepEqual([take.before,take.after],[5,4]);
 }finally{await f.close();await destination.close();}
});

test('Malformed removal timestamps reject backup restoration without partially importing records',async()=>{
 const f=await fixture();
 try{
  const backup=await f.store.request('export');
  for(const invalid of ['not-a-date','',123,true,{}]){
   const destination=emptyStore(),malformed=structuredClone(backup);malformed.jobs.find(job=>job.id===f.job).deleted_at=invalid;
   try{
    await assert.rejects(destination.request('restore',malformed),/date|timestamp|deleted|removed/i);
    const state=await destination.request('state');assert.equal(state.jobs.length,0);assert.equal(state.items.length,0);assert.equal(state.movements.length,0);
   }finally{await destination.close();}
  }
 }finally{await f.close();}
});

test('An aborted removal write rolls back its queued job update and leaves stock, history, and sequence unchanged',async()=>{
 const f=await fixture();
 try{
  const before=await f.store.request('state'),original=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(value,...keys){
   const request=original.call(this,value,...keys);
   if(this.name==='jobs'&&value.id===f.job&&value.deleted_at)throw new DOMException('Storage full','QuotaExceededError');
   return request;
  };
  try{await assert.rejects(f.store.request('jobs/'+f.job+'/delete'),/No inventory changes were saved/);}finally{IDBObjectStore.prototype.put=original;}
  assert.deepEqual(await f.store.request('state'),before);
  const taken=(await f.store.request('movements',movement(f.item,'TAKEN_TO_JOB',1,f.job))).movement;
  assert.deepEqual([taken.before,taken.after,taken.sequence],[5,4,3]);
 }finally{await f.close();}
});

test('Concurrent stock-out and removal serialize into a valid ledger with no unrecorded stock changes',async()=>{
 for(const removalFirst of [false,true]){
  const f=await fixture(),destination=emptyStore();
  try{
   const second=f.connect();await second.request('state');
   const take=movement(f.item,'TAKEN_TO_JOB',1,f.job);
   const operations=removalFirst?
    [second.request('jobs/'+f.job+'/delete'),f.store.request('movements',take)]:
    [f.store.request('movements',take),second.request('jobs/'+f.job+'/delete')];
   const results=await Promise.allSettled(operations),removal=results[removalFirst?0:1],out=results[removalFirst?1:0];
   assert.equal(removal.status,'fulfilled');
   const state=await f.store.request('state'),job=state.jobs.find(job=>job.id===f.job);
   assert.equal(job.status,'Completed');assert.equal(job.deleted_at,f.timestamp);
   assert.equal(state.items[0].quantity,out.status==='fulfilled'?4:5);
   assert.equal(state.movements.length,out.status==='fulfilled'?3:2);
   if(out.status==='fulfilled'){
    assert.deepEqual([out.value.movement.before,out.value.movement.after],[5,4]);
    assert.deepEqual((await second.request('movements',take)).movement,out.value.movement);
   }else{assert.match(out.reason.message,/deleted|removed|active/i);}
   await assert.rejects(second.request('movements',movement(f.item,'TAKEN_TO_JOB',1,f.job)),/deleted|removed/i);
   await destination.request('restore',await f.store.request('export'));assert.deepEqual(await destination.request('state'),state);
  }finally{await f.close();await destination.close();}
 }
});

test('Unknown-job removal and restoration fail without modifying existing records',async()=>{
 const f=await fixture();
 try{
  const before=await f.store.request('state');
  for(const action of ['delete','restore'])await assert.rejects(f.store.request('jobs/'+crypto.randomUUID()+'/'+action),/not found/i);
  assert.deepEqual(await f.store.request('state'),before);
 }finally{await f.close();}
});
