import test from 'node:test';
import assert from 'node:assert/strict';
import {createPhoneStore} from '../public/phone-store.js';
import {IDBFactory,IDBKeyRange,IDBObjectStore} from './vendor/fake-indexeddb/esm/index.js';

const timestamp='2026-10-07T08:14:00.000Z';
function fixture(){
 const indexedDB=new IDBFactory(),databaseName=crypto.randomUUID(),connections=[];
 const connect=()=>{const store=createPhoneStore({indexedDB,IDBKeyRange,databaseName,now:()=>timestamp});connections.push(store);return store;};
 return {store:connect(),connect,async close(){for(const store of connections)await store.close();}};
}
const entry=(overrides={})=>({id:crypto.randomUUID(),name:'90mm Galvanised Nails',barcode:null,unit:'boxes',quantity:3,...overrides});
const stockIn=(itemId,quantity)=>({id:crypto.randomUUID(),itemId,type:'STOCK_IN',quantity});

test('Optional catalogue barcodes normalize to null without conflicting in the existing v1 unique index',async()=>{
 const f=fixture();
 try{
  for(const value of [undefined,null,'','   ','\t\n']){
   const body={name:'Unlabelled material',unit:'pieces'};if(value!==undefined)body.barcode=value;
   await f.store.request('items',body);
  }
  await f.store.request('items',{name:'Code with zeros',barcode:'00123',unit:'pieces'});
  await f.store.request('items',{name:'Exact padded code',barcode:' 00123 ',unit:'pieces'});
  const state=await f.store.request('state');assert.equal(state.items.length,7);assert.equal(state.movements.length,0);
  assert.equal(state.items.filter(item=>item.barcode===null).length,5);assert.ok(state.items.every(item=>item.quantity===0));
  assert.ok(state.items.some(item=>item.barcode==='00123'));assert.ok(state.items.some(item=>item.barcode===' 00123 '));
  assert.equal((await f.store.request('export')).format,'workshop-phone-v1');
 }finally{await f.close();}
});

test('Nonempty catalogue codes remain unique and nonstring codes are rejected without adding records',async()=>{
 const f=fixture();
 try{
  await f.store.request('items',{name:'Saved nails',barcode:'00123',unit:'boxes'});
  const before=await f.store.request('state');
  await assert.rejects(f.store.request('items',{name:'Duplicate',barcode:'00123',unit:'bags'}),/barcode.*belongs|duplicate/i);
  for(const barcode of [123,true,{},['00123'],'x'.repeat(101)]){
   await assert.rejects(f.store.request('items',{name:'Invalid code',barcode,unit:'boxes'}),/barcode/i);
  }
  assert.deepEqual(await f.store.request('state'),before);
 }finally{await f.close();}
});

test('Confirming a new material atomically saves its quantity and complete stock-in audit snapshot',async()=>{
 const f=fixture();
 try{
  await f.store.request('operator',{name:'Eryk'});const body=entry();
  const result=await f.store.request('items/stock-in',body),state=await f.store.request('state');
  assert.equal(state.items.length,1);assert.equal(state.items[0].id,result.id);assert.equal(state.items[0].barcode,null);assert.equal(state.items[0].quantity,3);
  assert.deepEqual(result.movement,state.movements[0]);
  assert.deepEqual([result.movement.id,result.movement.item_id,result.movement.type,result.movement.quantity,result.movement.before,result.movement.after,result.movement.sequence],[body.id,result.id,'STOCK_IN',3,0,3,1]);
  assert.equal(result.movement.job_id,null);assert.equal(result.movement.client_name,null);assert.equal(result.movement.job_name,null);
  assert.equal(result.movement.item_name,body.name);assert.equal(result.movement.unit,'boxes');assert.equal(result.movement.user_name,'Eryk');assert.equal(result.movement.user_id,state.user.id);
  assert.equal(result.movement.created_at,timestamp);
 }finally{await f.close();}
});

test('A known exact barcode stocks in its saved material and ignores incoming replacement name and unit',async()=>{
 const f=fixture();
 try{
  await f.store.request('operator',{name:'Eryk'});
  const item=(await f.store.request('items',{name:'Saved 90mm Nails',barcode:'00123',unit:'boxes'})).id;
  await f.store.request('movements',stockIn(item,4));
  const body=entry({barcode:'00123',name:'',unit:null}),result=await f.store.request('items/stock-in',body);
  const state=await f.store.request('state');assert.equal(result.id,item);assert.equal(state.items.length,1);assert.equal(state.items[0].quantity,7);
  assert.equal(state.items[0].name,'Saved 90mm Nails');assert.equal(state.items[0].unit,'boxes');assert.equal(state.items[0].barcode,'00123');
  assert.deepEqual([result.movement.before,result.movement.after,result.movement.item_name,result.movement.unit],[4,7,'Saved 90mm Nails','boxes']);
  assert.deepEqual(await f.store.request('items/stock-in',{...body,name:'Ignored again',unit:'bags'}),result);
 }finally{await f.close();}
});

test('Identical new-material retries do not create extra catalogue items or movements and conflicting requests are rejected',async()=>{
 for(const barcode of [null,'00123']){
  const f=fixture();
  try{
   await f.store.request('operator',{name:'Eryk'});const body=entry({barcode});
   const first=await f.store.request('items/stock-in',body),before=await f.store.request('state');
   assert.deepEqual(await f.store.request('items/stock-in',body),first);assert.deepEqual(await f.store.request('state'),before);
   for(const changes of [{quantity:4},{barcode:'different-code'},{type:'TAKEN_TO_JOB'}]){
    await assert.rejects(f.store.request('items/stock-in',{...body,...changes}),/reference.*use|transaction|stock/i);
   }
   if(barcode===null){
    for(const changes of [{name:'Different material'},{unit:'bags'}])await assert.rejects(f.store.request('items/stock-in',{...body,...changes}),/reference.*use|transaction/i);
    assert.deepEqual(await f.store.request('items/stock-in',{...body,barcode:'   '}),first);
   }
   assert.deepEqual(await f.store.request('state'),before);
  }finally{await f.close();}
 }
});

test('A transaction belonging to another operator or movement type cannot be reused for material entry',async()=>{
 const f=fixture(),destination=fixture();
 try{
  await f.store.request('operator',{name:'Eryk'});const body=entry({barcode:'00123'});
  await f.store.request('items/stock-in',body);const backup=await f.store.request('export');
  backup.operator={id:crypto.randomUUID(),name:'Caroline'};await destination.store.request('restore',backup);
  const imported=await destination.store.request('state');
  await assert.rejects(destination.store.request('items/stock-in',body),/reference.*use|transaction/i);
  assert.deepEqual(await destination.store.request('state'),imported);
  const job=(await f.store.request('jobs',{client:'Caroline',name:'Fence Replacement'})).id;
  const item=(await f.store.request('state')).items[0].id;
  const out={id:crypto.randomUUID(),itemId:item,jobId:job,type:'TAKEN_TO_JOB',quantity:1};await f.store.request('movements',out);
  const before=await f.store.request('state');
  await assert.rejects(f.store.request('items/stock-in',entry({id:out.id,barcode:'00123',quantity:1})),/reference.*use|transaction/i);
  assert.deepEqual(await f.store.request('state'),before);
 }finally{await f.close();await destination.close();}
});

test('Renaming the same operator preserves an idempotent confirmation and its original scanning-name snapshot',async()=>{
 const f=fixture();
 try{
  await f.store.request('operator',{name:'Eryk'});const body=entry();
  const first=await f.store.request('items/stock-in',body),before=await f.store.request('state');
  await f.store.request('operator',{name:'Caroline'});
  assert.deepEqual(await f.store.request('items/stock-in',body),first);
  const after=await f.store.request('state');assert.equal(after.user.id,before.user.id);assert.equal(after.user.name,'Caroline');
  assert.deepEqual(after.items,before.items);assert.deepEqual(after.movements,before.movements);assert.equal(after.movements[0].user_name,'Eryk');
 }finally{await f.close();}
});

test('Concurrent identical confirmations create and stock each new or known material exactly once',async()=>{
 for(const kind of ['new-without-code','new-with-code','known-code']){
  const f=fixture();
  try{
   await f.store.request('operator',{name:'Eryk'});const barcode=kind==='new-without-code'?null:'00123';
   if(kind==='known-code'){
    const item=(await f.store.request('items',{name:'Saved nails',barcode,unit:'boxes'})).id;
    await f.store.request('movements',stockIn(item,4));
   }
   const second=f.connect();await second.request('state');const body=entry({barcode});
   const results=await Promise.all([f.store.request('items/stock-in',body),second.request('items/stock-in',body)]);
   assert.deepEqual(results[0],results[1]);
   const state=await f.store.request('state');assert.equal(state.items.length,1);assert.equal(state.items[0].quantity,kind==='known-code'?7:3);
   assert.equal(state.movements.length,kind==='known-code'?2:1);
   assert.equal(state.movements.filter(m=>m.id===body.id).length,1);
  }finally{await f.close();}
 }
});

test('Distinct concurrent stock-in confirmations for a new barcode share one material and preserve a contiguous stock ledger',async()=>{
 const f=fixture();
 try{
  await f.store.request('operator',{name:'Eryk'});const second=f.connect();await second.request('state');
  const results=await Promise.all([f.store.request('items/stock-in',entry({barcode:'00123',quantity:2})),second.request('items/stock-in',entry({barcode:'00123',quantity:3}))]);
  assert.equal(results[0].id,results[1].id);const state=await f.store.request('state');
  assert.equal(state.items.length,1);assert.equal(state.items[0].quantity,5);assert.equal(state.movements.length,2);
  assert.equal(state.movements[0].before,0);assert.equal(state.movements[1].before,state.movements[0].after);assert.equal(state.movements[1].after,5);
  assert.deepEqual(state.movements.map(m=>m.sequence),[1,2]);
 }finally{await f.close();}
});

test('Failed ledger or sequence writes roll back new catalogue items and existing stock quantities',async()=>{
 for(const known of [false,true])for(const failure of ['movement','sequence']){
  const f=fixture();
  try{
   await f.store.request('operator',{name:'Eryk'});
   if(known){const item=(await f.store.request('items',{name:'Saved nails',barcode:'00123',unit:'boxes'})).id;await f.store.request('movements',stockIn(item,4));}
   const before=await f.store.request('state'),body=entry({barcode:known?'00123':null});
   const add=IDBObjectStore.prototype.add,put=IDBObjectStore.prototype.put;
   IDBObjectStore.prototype.add=function(...args){if(failure==='movement'&&this.name==='movements')throw new DOMException('Storage full','QuotaExceededError');return add.apply(this,args);};
   IDBObjectStore.prototype.put=function(...args){if(failure==='sequence'&&this.name==='meta'&&args[0]?.key==='sequence')throw new DOMException('Storage full','QuotaExceededError');return put.apply(this,args);};
   try{await assert.rejects(f.store.request('items/stock-in',body),/No inventory changes were saved/);}finally{IDBObjectStore.prototype.add=add;IDBObjectStore.prototype.put=put;}
   assert.deepEqual(await f.store.request('state'),before);
   const result=await f.store.request('items/stock-in',body);assert.equal(result.movement.sequence,known?2:1);
   assert.deepEqual([result.movement.before,result.movement.after],known?[4,7]:[0,3]);
  }finally{await f.close();}
 }
});

test('Stock-in quantity, operator, transaction ID, and new-material details are validated before any catalogue or stock change',async()=>{
 const f=fixture();
 try{
  await assert.rejects(f.store.request('items/stock-in',entry()),/name|operator|scanning/i);
  assert.equal((await f.store.request('state')).items.length,0);await f.store.request('operator',{name:'Eryk'});
  const before=await f.store.request('state');
  const invalid=[
   ...[0,-1,.5,1000001,'3',NaN].map(quantity=>({quantity})),
   {id:'bad'},{id:123456789012},
   {name:''},{name:null},{name:'x'.repeat(161)},
   {unit:''},{unit:null},{unit:'x'.repeat(31)},
   {barcode:123},{barcode:true},{barcode:{}},{barcode:'x'.repeat(101)},
  ];
  for(const changes of invalid){await assert.rejects(f.store.request('items/stock-in',entry(changes)));assert.deepEqual(await f.store.request('state'),before);}
 }finally{await f.close();}
});

test('Old and new backups round-trip exact codes and multiple optional-code materials without changing stock history',async()=>{
 const source=fixture(),destination=fixture(),legacyDestination=fixture();
 try{
  await source.store.request('operator',{name:'Eryk'});
  await source.store.request('items/stock-in',entry({name:'No code A'}));await source.store.request('items/stock-in',entry({name:'No code B',barcode:'   '}));
  await source.store.request('items/stock-in',entry({name:'Padded exact code',barcode:' 00123 '}));
  const state=await source.store.request('state'),backup=await source.store.request('export');
  assert.equal(backup.format,'workshop-phone-v1');assert.equal(backup.items.filter(item=>item.barcode===null).length,2);
  await destination.store.request('restore',backup);assert.deepEqual(await destination.store.request('state'),state);
  assert.deepEqual((await destination.store.request('export')).items,backup.items);
  const old=fixture();
  try{
   await old.store.request('operator',{name:'Eryk'});const item=(await old.store.request('items',{name:'Legacy nails',barcode:'0123456789012',unit:'boxes'})).id;
   await old.store.request('movements',stockIn(item,4));const oldBackup=await old.store.request('export');
   await legacyDestination.store.request('restore',oldBackup);assert.deepEqual(await legacyDestination.store.request('state'),await old.store.request('state'));
  }finally{await old.close();}
 }finally{await source.close();await destination.close();await legacyDestination.close();}
});

test('Backup barcode validation allows missing or blank codes but rejects duplicate exact codes and nonstring values atomically',async()=>{
 const source=fixture();
 try{
  await source.store.request('items',{name:'First',barcode:'first-code',unit:'pieces'});await source.store.request('items',{name:'Second',barcode:'second-code',unit:'pieces'});
  const backup=await source.store.request('export'),optional=structuredClone(backup);delete optional.items[0].barcode;optional.items[1].barcode='\t ';
  const empty=fixture();try{await empty.store.request('restore',optional);assert.ok((await empty.store.request('state')).items.every(item=>item.barcode===null));}finally{await empty.close();}
  for(const barcode of ['first-code',123,true,{}]){
   const malformed=structuredClone(backup);malformed.items[1].barcode=barcode;const destination=fixture();
   try{await assert.rejects(destination.store.request('restore',malformed),/barcode|duplicate|invalid/i);assert.equal((await destination.store.request('state')).items.length,0);}finally{await destination.close();}
  }
 }finally{await source.close();}
});
