import test from 'node:test';
import assert from 'node:assert/strict';
import {createPhoneStore} from '../public/phone-store.js';
import {IDBFactory,IDBKeyRange,IDBObjectStore} from './vendor/fake-indexeddb/esm/index.js';

const timestamp='2026-10-07T08:14:00.000Z';
function fixture({now=()=>timestamp}={}){
 const indexedDB=new IDBFactory(),databaseName=crypto.randomUUID(),connections=[];
 const connect=()=>{const store=createPhoneStore({indexedDB,IDBKeyRange,databaseName,now});connections.push(store);return store;};
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

test('Dropdown selection adds stock to the chosen saved material with or without a barcode',async()=>{
 const f=fixture();
 try{
  await f.store.request('operator',{name:'Eryk'});
  for(const barcode of [null,'00123']){
   const selected=(await f.store.request('items',{name:'Saved concrete '+String(barcode),barcode,unit:'bags'})).id;
   const body=entry({itemId:selected,name:'',unit:null}),result=await f.store.request('items/stock-in',body);
   assert.equal(result.id,selected);assert.equal(result.movement.unit,'bags');assert.equal(result.movement.item_name,'Saved concrete '+String(barcode));
   assert.deepEqual(await f.store.request('items/stock-in',body),result);
  }
  const state=await f.store.request('state');assert.equal(state.items.length,2);assert.ok(state.items.every(item=>item.quantity===3));
 }finally{await f.close();}
});

test('Manual stock-in reuses canonical name and unit matches, preserving saved display metadata and audit history',async()=>{
 const f=fixture();
 try{
  await f.store.request('operator',{name:'Eryk'});
  const saved=(await f.store.request('items',{name:'90mm  Galvanised Nails',unit:'Boxes'})).id;
  const first=await f.store.request('items/stock-in',entry({name:' ９０ｍｍ\tGALVANISED  NAILS ',unit:' ｂｏｘｅｓ ',quantity:2}));
  const second=await f.store.request('items/stock-in',entry({name:'90MM GALVANISED nails',unit:'boxes',quantity:3}));
  const state=await f.store.request('state');assert.equal(first.id,saved);assert.equal(second.id,saved);assert.equal(state.items.length,1);assert.equal(state.items[0].quantity,5);
  assert.equal(state.items[0].name,'90mm  Galvanised Nails');assert.equal(state.items[0].unit,'Boxes');
  assert.deepEqual(state.movements.map(m=>[m.before,m.after,m.sequence]),[[0,2,1],[2,5,2]]);
  assert.ok(state.movements.every(m=>m.item_name==='90mm  Galvanised Nails'&&m.unit==='Boxes'));
 }finally{await f.close();}
});

test('The same material name in different units stays separate',async()=>{
 const f=fixture();
 try{
  await f.store.request('operator',{name:'Eryk'});
  const boxes=await f.store.request('items/stock-in',entry({name:'Nails',unit:'boxes'}));
  const bags=await f.store.request('items/stock-in',entry({name:'NAILS',unit:'bags'}));
  const moreBags=await f.store.request('items/stock-in',entry({name:' nails ',unit:' BAGS '}));
  assert.notEqual(boxes.id,bags.id);assert.equal(moreBags.id,bags.id);
  const state=await f.store.request('state');assert.equal(state.items.length,2);assert.equal(state.items.find(item=>item.id===boxes.id).quantity,3);assert.equal(state.items.find(item=>item.id===bags.id).quantity,6);
 }finally{await f.close();}
});

test('A merged material remembers its first barcode and additional exact aliases, which can be scanned after backup restore',async()=>{
 const f=fixture(),destination=fixture();
 try{
  await f.store.request('operator',{name:'Eryk'});
  const saved=(await f.store.request('items',{name:'Timber',unit:'lengths'})).id;
  const first=await f.store.request('items/stock-in',entry({name:'TIMBER',unit:'LENGTHS',barcode:'00123'}));
  const second=await f.store.request('items/stock-in',entry({name:'timber',unit:'lengths',barcode:' 00123 '}));
  assert.equal(first.id,saved);assert.equal(second.id,saved);
  const state=await f.store.request('state');assert.equal(state.items.length,1);assert.equal(state.items[0].barcode,'00123');assert.deepEqual(state.items[0].barcode_aliases,[' 00123 ']);
  assert.deepEqual(state.movements[0],first.movement);
  await assert.rejects(f.store.request('items',{name:'Alias collision',barcode:' 00123 ',unit:'boxes'}),/barcode.*belongs|duplicate/i);
  await destination.store.request('restore',await f.store.request('export'));assert.deepEqual(await destination.store.request('state'),state);
  const scan=await destination.store.request('items/stock-in',entry({barcode:' 00123 ',name:'',unit:null}));
  assert.equal(scan.id,saved);assert.deepEqual([scan.movement.before,scan.movement.after,scan.movement.item_name,scan.movement.unit],[6,9,'Timber','lengths']);
 }finally{await f.close();await destination.close();}
});

test('Legacy duplicate names require dropdown selection rather than guessing a target or modifying historical records',async()=>{
 const f=fixture();
 try{
  await f.store.request('operator',{name:'Eryk'});
  const first=(await f.store.request('items',{name:'Nails',unit:'boxes'})).id;
  const second=(await f.store.request('items',{name:' NAILS ',unit:'BOXES'})).id;
  const before=await f.store.request('state');
  await assert.rejects(f.store.request('items/stock-in',entry({name:'nails',unit:'boxes',barcode:'new-code'})),/choose.*dropdown|more than one|multiple.*material/i);
  assert.deepEqual(await f.store.request('state'),before);
  const selected=await f.store.request('items/stock-in',entry({itemId:second,barcode:'new-code',name:'',unit:null}));
  assert.equal(selected.id,second);const after=await f.store.request('state');assert.equal(after.items.length,2);
  assert.equal(after.items.find(item=>item.id===first).quantity,0);assert.equal(after.items.find(item=>item.id===second).quantity,3);
 }finally{await f.close();}
});

test('Concurrent separate manual entries merge once and cannot assign one new code to different saved items',async()=>{
 const f=fixture();
 try{
  await f.store.request('operator',{name:'Eryk'});const second=f.connect();await second.request('state');
  const results=await Promise.all([
   f.store.request('items/stock-in',entry({name:'Nails',unit:'boxes',quantity:2,barcode:'00123'})),
   second.request('items/stock-in',entry({name:' NAILS ',unit:' BOXES ',quantity:3,barcode:'00999'})),
  ]);
  assert.equal(results[0].id,results[1].id);const merged=await f.store.request('state');assert.equal(merged.items.length,1);assert.equal(merged.items[0].quantity,5);
  assert.deepEqual(merged.movements.map(m=>[m.before,m.after,m.sequence]),[[0,2,1],[2,5,2]]);
  const other=(await f.store.request('items',{name:'Concrete',unit:'bags'})).id;
  const conflicts=await Promise.allSettled([
   f.store.request('items/stock-in',entry({itemId:results[0].id,barcode:'shared-new-code'})),
   second.request('items/stock-in',entry({itemId:other,barcode:'shared-new-code'})),
  ]);
  assert.equal(conflicts.filter(result=>result.status==='fulfilled').length,1);assert.equal(conflicts.filter(result=>result.status==='rejected').length,1);
  assert.match(conflicts.find(result=>result.status==='rejected').reason.message,/barcode|belongs|conflict/i);
 }finally{await f.close();}
});

test('Retries preserve the original target after codes or duplicates are added and reject conflicting selections',async()=>{
 const f=fixture();
 try{
  await f.store.request('operator',{name:'Eryk'});const body=entry({name:'Nails',unit:'boxes'}),first=await f.store.request('items/stock-in',body);
  await f.store.request('items/stock-in',entry({itemId:first.id,barcode:'00123'}));
  const other=(await f.store.request('items',{name:'NAILS',unit:'BOXES'})).id;
  const before=await f.store.request('state');
  assert.deepEqual(await f.store.request('items/stock-in',{...body,name:' ｎａｉｌｓ ',unit:' BOXES '}),first);
  await assert.rejects(f.store.request('items/stock-in',{...body,itemId:other}),/reference.*use|transaction/i);
  await assert.rejects(f.store.request('items/stock-in',{...body,barcode:'unknown-code'}),/reference.*use|transaction/i);
  await assert.rejects(f.store.request('items/stock-in',{...body,jobId:crypto.randomUUID()}),/job|stock/i);
  await assert.rejects(f.store.request('items/stock-in',entry({itemId:other,barcode:'00123'})),/barcode|belongs|conflict/i);
  await assert.rejects(f.store.request('items/stock-in',entry({itemId:crypto.randomUUID()})),/material|item|not.*found/i);
  assert.deepEqual(await f.store.request('state'),before);
 }finally{await f.close();}
});

test('Alias and primary barcode additions roll back with a failed ledger write and are safe on retry',async()=>{
 for(const primary of [null,'00123']){
  const f=fixture();
  try{
   await f.store.request('operator',{name:'Eryk'});const item=(await f.store.request('items',{name:'Nails',unit:'boxes',barcode:primary})).id;
   await f.store.request('movements',stockIn(item,4));const before=await f.store.request('state'),body=entry({itemId:item,barcode:'00999'});
   const add=IDBObjectStore.prototype.add;IDBObjectStore.prototype.add=function(...args){if(this.name==='movements')throw new DOMException('Storage full','QuotaExceededError');return add.apply(this,args);};
   try{await assert.rejects(f.store.request('items/stock-in',body),/No inventory changes were saved/);}finally{IDBObjectStore.prototype.add=add;}
   assert.deepEqual(await f.store.request('state'),before);
   const result=await f.store.request('items/stock-in',body);assert.equal(result.id,item);assert.deepEqual([result.movement.before,result.movement.after,result.movement.sequence],[4,7,2]);
   const after=await f.store.request('state'),saved=after.items.find(value=>value.id===item);
   if(primary===null){assert.equal(saved.barcode,'00999');}else{assert.equal(saved.barcode,primary);assert.deepEqual(saved.barcode_aliases,['00999']);}
   assert.deepEqual(await f.store.request('items/stock-in',body),result);assert.deepEqual(await f.store.request('state'),after);
  }finally{await f.close();}
 }
});

test('Backup validation preserves optional alias arrays and rejects malformed or globally duplicated codes atomically',async()=>{
 const f=fixture();
 try{
  await f.store.request('operator',{name:'Eryk'});
  const item=(await f.store.request('items/stock-in',entry({name:'Nails',barcode:'00123'}))).id;
  await f.store.request('items/stock-in',entry({itemId:item,barcode:'00999'}));
  const other=(await f.store.request('items',{name:'Concrete',unit:'bags',barcode:'other-code'})).id;
  const backup=await f.store.request('export');
  const cases=[null,{},Array(1),[''],['   '],[null],[123],['00123'],['00999','00999'],['other-code']];
  for(const aliases of cases){
   const malformed=structuredClone(backup);malformed.items.find(value=>value.id===item).barcode_aliases=aliases;const destination=fixture();
   try{await assert.rejects(destination.store.request('restore',malformed),/barcode|alias|duplicate|invalid/i);assert.equal((await destination.store.request('state')).items.length,0);}finally{await destination.close();}
  }
  const duplicateAlias=structuredClone(backup);duplicateAlias.items.find(value=>value.id===other).barcode_aliases=['00999'];const destination=fixture();
  try{await assert.rejects(destination.store.request('restore',duplicateAlias),/barcode|duplicate|invalid/i);assert.equal((await destination.store.request('state')).items.length,0);}finally{await destination.close();}
 }finally{await f.close();}
});

test('Deleting zero and stocked materials preserves quantities, exact codes and the complete Activity ledger',async()=>{
 let clock=timestamp;const f=fixture({now:()=>clock});
 try{
  const operator=await f.store.request('operator',{name:'Eryk'});
  const empty=(await f.store.request('items',{name:'Unlabelled timber',unit:'lengths'})).id;
  const stocked=(await f.store.request('items/stock-in',entry({barcode:'00123',quantity:7}))).id;
  await f.store.request('items/stock-in',entry({itemId:stocked,barcode:' 00999 ',quantity:2}));
  const job=(await f.store.request('jobs',{client:'Caroline',name:'Fence Replacement'})).id;
  await f.store.request('movements',{id:crypto.randomUUID(),itemId:stocked,jobId:job,type:'TAKEN_TO_JOB',quantity:3});
  const before=await f.store.request('state');
  for(const id of [empty,stocked])await f.store.request('items/'+id+'/delete');
  const deleted=await f.store.request('state');
  assert.deepEqual(deleted.jobs,before.jobs);assert.deepEqual(deleted.movements,before.movements);assert.deepEqual(deleted.user,before.user);
  for(const item of before.items){
   assert.deepEqual(deleted.items.find(saved=>saved.id===item.id),{...item,deleted_at:timestamp,deleted_by:'Eryk',deleted_by_id:operator.id});
  }
  clock='2026-10-08T10:30:00.000Z';await f.store.request('operator',{name:'Renamed operator'});
  const renamed=await f.store.request('state');
  for(const id of [empty,stocked])await f.store.request('items/'+id+'/delete');
  assert.deepEqual(await f.store.request('state'),renamed);
  await f.store.close();assert.deepEqual(await f.connect().request('state'),renamed);
 }finally{await f.close();}
});

test('Deletion requires a configured operator and restoring only clears removal flags without adding ledger records',async()=>{
 const f=fixture();
 try{
  const item=(await f.store.request('items',{name:'Timber',barcode:'00123',unit:'lengths'})).id;
  const unconfigured=await f.store.request('state');
  await assert.rejects(f.store.request('items/'+item+'/delete'),/name|operator/i);assert.deepEqual(await f.store.request('state'),unconfigured);
  await f.store.request('operator',{name:'Eryk'});await f.store.request('movements',stockIn(item,4));
  await f.store.request('items/'+item+'/barcodes',{barcode:'00999'});const before=await f.store.request('state');
  await f.store.request('items/'+item+'/delete');await f.store.request('items/'+item+'/restore');
  assert.deepEqual(await f.store.request('state'),before);
  await f.store.request('items/'+item+'/restore');assert.deepEqual(await f.store.request('state'),before);
  const next=await f.store.request('movements',stockIn(item,2));assert.equal(next.movement.sequence,2);assert.equal(next.movement.after,6);
  const after=await f.store.request('state');
  for(const action of ['delete','restore','barcodes'])await assert.rejects(f.store.request('items/'+crypto.randomUUID()+'/'+action,{barcode:'new-code'}),/item|not.*found/i);
  assert.deepEqual(await f.store.request('state'),after);
 }finally{await f.close();}
});

test('Deleted-item backups preserve attribution, codes and history, including older timestamp-only records',async()=>{
 const f=fixture();
 try{
  await f.store.request('operator',{name:'Eryk'});const item=(await f.store.request('items/stock-in',entry({barcode:'00123',quantity:8}))).id;
  await f.store.request('items/'+item+'/barcodes',{barcode:' 00999 '});
  const job=(await f.store.request('jobs',{client:'Caroline',name:'Fence Replacement'})).id;
  await f.store.request('movements',{id:crypto.randomUUID(),itemId:item,jobId:job,type:'TAKEN_TO_JOB',quantity:2});
  await f.store.request('items/'+item+'/delete');const backup=await f.store.request('export'),state=await f.store.request('state');
  for(const legacy of [false,true]){
   const imported=structuredClone(backup),destination=fixture();
   if(legacy){delete imported.items[0].deleted_by;delete imported.items[0].deleted_by_id;}
   try{
    await destination.store.request('restore',imported);const restored=await destination.store.request('state');
    if(legacy){const expected=structuredClone(state);delete expected.items[0].deleted_by;delete expected.items[0].deleted_by_id;assert.deepEqual(restored,expected);}else assert.deepEqual(restored,state);
    assert.deepEqual((await destination.store.request('export')).items,imported.items);
    await assert.rejects(destination.store.request('items/stock-in',entry({barcode:' 00999 '})),/restore/i);
    await destination.store.close();assert.deepEqual(await destination.connect().request('state'),restored);
   }finally{await destination.close();}
  }
 }finally{await f.close();}
});

test('Backup deletion metadata is validated before importing any catalogue or ledger records',async()=>{
 const f=fixture();
 try{
  await f.store.request('operator',{name:'Eryk'});const item=(await f.store.request('items/stock-in',entry())).id;
  await f.store.request('items/'+item+'/delete');const backup=await f.store.request('export');
  const cases=[['deleted_at',null],['deleted_at','not a timestamp'],['deleted_at',42],['deleted_by',''],['deleted_by',42],['deleted_by','x'.repeat(161)],['deleted_by_id',null],['deleted_by_id','short'],['deleted_by_id',42]];
  for(const [key,value]of cases){
   const malformed=structuredClone(backup);malformed.items[0][key]=value;const destination=fixture();
   try{
    await assert.rejects(destination.store.request('restore',malformed),/date|user|invalid|valid/i);
    const state=await destination.store.request('state');assert.equal(state.items.length,0);assert.equal(state.jobs.length,0);assert.equal(state.movements.length,0);assert.equal(state.user.configured,false);
   }finally{await destination.close();}
  }
 }finally{await f.close();}
});

test('Deleted materials reject stale stock-in and take requests while confirmed retries preserve their original snapshots',async()=>{
 const f=fixture();
 try{
  await f.store.request('operator',{name:'Eryk'});const body=entry({barcode:'00123',quantity:8}),confirmed=await f.store.request('items/stock-in',body);
  await f.store.request('items/'+confirmed.id+'/barcodes',{barcode:'00999'});
  const incoming=stockIn(confirmed.id,1),inResult=await f.store.request('movements',incoming);
  const job=(await f.store.request('jobs',{client:'Caroline',name:'Fence Replacement'})).id;
  const taken={id:crypto.randomUUID(),itemId:confirmed.id,jobId:job,type:'TAKEN_TO_JOB',quantity:3},outResult=await f.store.request('movements',taken);
  await f.store.request('items/'+confirmed.id+'/delete');await f.store.request('operator',{name:'Eryk renamed'});const before=await f.store.request('state');
  assert.deepEqual(await f.store.request('items/stock-in',body),confirmed);
  assert.deepEqual(await f.store.request('movements',incoming),inResult);assert.deepEqual(await f.store.request('movements',taken),outResult);
  for(const overrides of [{itemId:confirmed.id},{barcode:'00123'},{barcode:'00999'},{name:body.name,unit:body.unit},{name:body.name,unit:body.unit,barcode:'new-code'}]){
   await assert.rejects(f.store.request('items/stock-in',entry(overrides)),/restore/i);
  }
  await assert.rejects(f.store.request('movements',stockIn(confirmed.id,1)),/restore/i);
  await assert.rejects(f.store.request('movements',{...taken,id:crypto.randomUUID(),quantity:1}),/restore/i);
  await assert.rejects(f.store.request('items/'+confirmed.id+'/barcodes',{barcode:'00123'}),/restore/i);
  await assert.rejects(f.store.request('items/stock-in',{...body,quantity:9}),/reference.*use|transaction/i);
  assert.deepEqual(await f.store.request('state'),before);
  await f.store.request('items/'+confirmed.id+'/restore');
  const stocked=await f.store.request('items/stock-in',entry({barcode:'00999',name:'',unit:null}));assert.equal(stocked.id,confirmed.id);assert.equal(stocked.movement.sequence,4);
 }finally{await f.close();}
});

test('Manual matching prefers one active material, rejects active ambiguity and prevents duplicating a deleted-only match',async()=>{
 const f=fixture();
 try{
  await f.store.request('operator',{name:'Eryk'});
  const removed=(await f.store.request('items',{name:'Timber',unit:'lengths'})).id;await f.store.request('items/'+removed+'/delete');
  const deleted=await f.store.request('state');
  await assert.rejects(f.store.request('items/stock-in',entry({name:' ＴＩＭＢＥＲ ',unit:' LENGTHS ',barcode:'00123'})),/restore/i);
  assert.deepEqual(await f.store.request('state'),deleted);
  const active=(await f.store.request('items',{name:'TIMBER',unit:'lengths'})).id;
  const result=await f.store.request('items/stock-in',entry({name:' timber ',unit:' LENGTHS ',barcode:'00123'}));assert.equal(result.id,active);
  const after=await f.store.request('state');assert.equal(after.items.length,2);assert.equal(after.items.find(item=>item.id===removed).quantity,0);assert.ok(after.items.find(item=>item.id===removed).deleted_at);
  assert.equal(after.items.find(item=>item.id===active).barcode,'00123');
  const duplicate=(await f.store.request('items',{name:' Timber ',unit:'Lengths'})).id,ambiguous=await f.store.request('state');
  await assert.rejects(f.store.request('items/stock-in',entry({name:'timber',unit:'lengths'})),/choose.*dropdown|more than one/i);assert.deepEqual(await f.store.request('state'),ambiguous);
  assert.equal((await f.store.request('items/stock-in',entry({itemId:duplicate,name:'',unit:null}))).id,duplicate);
 }finally{await f.close();}
});

test('Primary and brand alias codes on deleted materials remain reserved across every creation and attachment path',async()=>{
 const f=fixture();
 try{
  await f.store.request('operator',{name:'Eryk'});const removed=(await f.store.request('items/stock-in',entry({barcode:'00123'}))).id;
  await f.store.request('items/'+removed+'/barcodes',{barcode:' 00999 '});await f.store.request('items/'+removed+'/delete');
  const active=(await f.store.request('items',{name:'Concrete',unit:'bags'})).id,before=await f.store.request('state');
  for(const barcode of ['00123',' 00999 ']){
   await assert.rejects(f.store.request('items',{name:'Different material',unit:'bags',barcode}),/barcode.*belongs|duplicate/i);
   await assert.rejects(f.store.request('items/'+active+'/barcodes',{barcode}),/barcode.*belongs|duplicate/i);
   await assert.rejects(f.store.request('items/stock-in',entry({itemId:active,barcode})),/barcode.*belongs|duplicate/i);
   await assert.rejects(f.store.request('items/stock-in',entry({name:'Different material',unit:'bags',barcode})),/restore/i);
  }
  assert.deepEqual(await f.store.request('state'),before);
  await f.store.request('items/'+removed+'/restore');await f.store.request('items/'+removed+'/barcodes',{barcode:'00123'});
  const restored=await f.store.request('state');assert.equal(restored.items.find(item=>item.id===removed).barcode,'00123');assert.deepEqual(restored.items.find(item=>item.id===removed).barcode_aliases,[' 00999 ']);
 }finally{await f.close();}
});

test('A bounded physical return restores a deleted material, while invalid returns and old return retries cannot change removal metadata',async()=>{
 const f=fixture();
 try{
  await f.store.request('operator',{name:'Eryk'});const item=(await f.store.request('items/stock-in',entry({barcode:'00123',quantity:20}))).id;
  await f.store.request('items/'+item+'/barcodes',{barcode:'00999'});
  const job=(await f.store.request('jobs',{client:'Caroline',name:'Fence Replacement'})).id;
  await f.store.request('movements',{id:crypto.randomUUID(),itemId:item,jobId:job,type:'TAKEN_TO_JOB',quantity:8});
  await f.store.request('jobs/'+job+'/delete');await f.store.request('items/'+item+'/delete');
  const removed=await f.store.request('state'),returnBody={id:crypto.randomUUID(),itemId:item,jobId:job,type:'RETURNED_TO_WORKSHOP',quantity:4};
  await assert.rejects(f.store.request('movements',{...returnBody,quantity:9}),/exceeds|held/i);
  await assert.rejects(f.store.request('movements',{...returnBody,jobId:crypto.randomUUID()}),/job/i);
  await assert.rejects(f.store.request('movements',{...returnBody,quantity:0}),/quantity/i);
  assert.deepEqual(await f.store.request('state'),removed);
  const returned=await f.store.request('movements',returnBody),active=await f.store.request('state');
  assert.deepEqual(active.items[0],{...Object.fromEntries(Object.entries(removed.items[0]).filter(([key])=>!['deleted_at','deleted_by','deleted_by_id'].includes(key))),quantity:16});
  assert.deepEqual(active.jobs,removed.jobs);assert.deepEqual(active.movements.slice(0,2),removed.movements);
  assert.deepEqual([returned.movement.type,returned.movement.before,returned.movement.after,returned.movement.sequence,returned.movement.client_name,returned.movement.job_name],['RETURNED_TO_WORKSHOP',12,16,3,'Caroline','Fence Replacement']);
  await f.store.request('items/'+item+'/delete');const deletedAgain=await f.store.request('state');
  assert.deepEqual(await f.store.request('movements',returnBody),returned);assert.deepEqual(await f.store.request('state'),deletedAgain);
  await assert.rejects(f.store.request('movements',{...returnBody,id:crypto.randomUUID(),quantity:5}),/exceeds|held/i);assert.deepEqual(await f.store.request('state'),deletedAgain);
  const finalReturn=await f.store.request('movements',{...returnBody,id:crypto.randomUUID()});assert.equal(finalReturn.movement.after,20);assert.equal(finalReturn.movement.sequence,4);
  const final=await f.store.request('state');assert.equal(final.items[0].deleted_at,undefined);
  await assert.rejects(f.store.request('movements',{...returnBody,id:crypto.randomUUID(),quantity:1}),/exceeds|held/i);assert.deepEqual(await f.store.request('state'),final);
 }finally{await f.close();}
});

test('A failed return ledger or sequence write rolls back the restored flags, Workshop quantity and entire audit record',async()=>{
 for(const failureStore of ['movements','meta']){
  const f=fixture();
  try{
   await f.store.request('operator',{name:'Eryk'});const item=(await f.store.request('items/stock-in',entry({quantity:6}))).id;
   const job=(await f.store.request('jobs',{client:'Caroline',name:'Fence Replacement'})).id;
   await f.store.request('movements',{id:crypto.randomUUID(),itemId:item,jobId:job,type:'TAKEN_TO_JOB',quantity:4});
   await f.store.request('items/'+item+'/delete');const before=await f.store.request('state'),body={id:crypto.randomUUID(),itemId:item,jobId:job,type:'RETURNED_TO_WORKSHOP',quantity:2};
   const method=failureStore==='movements'?'add':'put',original=IDBObjectStore.prototype[method];
   IDBObjectStore.prototype[method]=function(...args){if(this.name===failureStore)throw new DOMException('Storage full','QuotaExceededError');return original.apply(this,args);};
   try{await assert.rejects(f.store.request('movements',body),/No inventory changes were saved/);}finally{IDBObjectStore.prototype[method]=original;}
   assert.deepEqual(await f.store.request('state'),before);
   const returned=await f.store.request('movements',body);assert.deepEqual([returned.movement.before,returned.movement.after,returned.movement.sequence],[2,4,3]);
   const after=await f.store.request('state');assert.equal(after.items[0].deleted_at,undefined);assert.equal(after.items[0].deleted_by,undefined);assert.equal(after.items[0].deleted_by_id,undefined);
   assert.deepEqual(await f.store.request('movements',body),returned);assert.deepEqual(await f.store.request('state'),after);
  }finally{await f.close();}
 }
});

test('Barcode attachment is metadata only, preserves exact brand codes and does not require a fake stock-in or consume ledger sequence',async()=>{
 const f=fixture(),destination=fixture();
 try{
  const item=(await f.store.request('items',{name:'Timber',unit:'lengths'})).id,before=await f.store.request('state');
  for(const barcode of [undefined,null,'',' \t ',123,true,{},'x'.repeat(101)]){
   await assert.rejects(f.store.request('items/'+item+'/barcodes',{barcode}),/barcode/i);
  }
  assert.deepEqual(await f.store.request('state'),before);
  for(const barcode of ['00123','00999',' 00999 '])await f.store.request('items/'+item+'/barcodes',{barcode});
  const attached=await f.store.request('state');assert.deepEqual(attached.items[0],{...before.items[0],barcode:'00123',barcode_aliases:['00999',' 00999 ']});
  assert.deepEqual(attached.movements,[]);assert.deepEqual(attached.jobs,before.jobs);assert.deepEqual(attached.user,before.user);
  for(const barcode of ['00123','00999',' 00999 '])await f.store.request('items/'+item+'/barcodes',{barcode});assert.deepEqual(await f.store.request('state'),attached);
  await destination.store.request('restore',await f.store.request('export'));assert.deepEqual(await destination.store.request('state'),attached);
  await f.store.request('operator',{name:'Eryk'});const first=await f.store.request('items/stock-in',entry({barcode:'00999',name:'',unit:null,quantity:4}));
  assert.equal(first.id,item);assert.equal(first.movement.sequence,1);
  const stocked=await f.store.request('state');await f.store.request('items/'+item+'/barcodes',{barcode:'different-brand'});
  const anotherBrand=await f.store.request('state');assert.deepEqual(anotherBrand.movements,stocked.movements);assert.equal(anotherBrand.items[0].quantity,4);assert.equal(anotherBrand.items[0].name,'Timber');assert.equal(anotherBrand.items[0].unit,'lengths');
  const second=await f.store.request('items/stock-in',entry({barcode:'different-brand',name:'',unit:null,quantity:1}));assert.equal(second.id,item);assert.equal(second.movement.sequence,2);assert.equal(second.movement.after,5);
 }finally{await f.close();await destination.close();}
});

test('Failed deletion, explicit restoration and barcode attachment roll back queued item writes without changing Activity',async()=>{
 const f=fixture();
 try{
  await f.store.request('operator',{name:'Eryk'});const item=(await f.store.request('items/stock-in',entry())).id;
  for(const [action,body]of [['delete',undefined],['barcodes',{barcode:'00123'}],['restore',undefined]]){
   if(action==='restore')await f.store.request('items/'+item+'/delete');
   const before=await f.store.request('state'),put=IDBObjectStore.prototype.put;
   IDBObjectStore.prototype.put=function(...args){const queued=put.apply(this,args);if(this.name==='items')throw new DOMException('Storage full','QuotaExceededError');return queued;};
   try{await assert.rejects(f.store.request('items/'+item+'/'+action,body),/No inventory changes were saved/);}finally{IDBObjectStore.prototype.put=put;}
   assert.deepEqual(await f.store.request('state'),before);
   await f.store.request('items/'+item+'/'+action,body);
   if(action==='delete')await f.store.request('items/'+item+'/restore');
  }
  const final=await f.store.request('state');assert.equal(final.items[0].quantity,3);assert.equal(final.items[0].barcode,'00123');assert.equal(final.items[0].deleted_at,undefined);assert.equal(final.movements.length,1);assert.equal(final.movements[0].sequence,1);
 }finally{await f.close();}
});

test('Concurrent brand-code attachments and stock confirmations serialize ownership without duplicates or lost codes',async()=>{
 const f=fixture();
 try{
  await f.store.request('operator',{name:'Eryk'});
  const first=(await f.store.request('items',{name:'Timber',unit:'lengths'})).id,other=(await f.store.request('items',{name:'Concrete',unit:'bags'})).id;
  const second=f.connect();await second.request('state');
  await Promise.all([f.store.request('items/'+first+'/barcodes',{barcode:'00123'}),second.request('items/'+first+'/barcodes',{barcode:'00999'})]);
  const branded=await f.store.request('state');assert.deepEqual([branded.items.find(item=>item.id===first).barcode,...branded.items.find(item=>item.id===first).barcode_aliases],['00123','00999']);assert.equal(branded.movements.length,0);
  const ownership=await Promise.allSettled([f.store.request('items/'+first+'/barcodes',{barcode:'shared-code'}),second.request('items/'+other+'/barcodes',{barcode:'shared-code'})]);
  assert.equal(ownership.filter(result=>result.status==='fulfilled').length,1);assert.equal(ownership.filter(result=>result.status==='rejected').length,1);assert.match(ownership.find(result=>result.status==='rejected').reason.message,/barcode.*belongs/i);
  const results=await Promise.all([f.store.request('items/'+first+'/barcodes',{barcode:'brand-three'}),second.request('items/stock-in',entry({itemId:first,barcode:'brand-four',quantity:2}))]);
  assert.equal(results[1].id,first);
  const state=await f.store.request('state'),saved=state.items.find(item=>item.id===first);assert.equal(state.items.length,2);assert.equal(saved.quantity,2);assert.ok(saved.barcode_aliases.includes('brand-three'));assert.ok(saved.barcode_aliases.includes('brand-four'));assert.equal(state.movements.length,1);assert.equal(state.movements[0].sequence,1);
 }finally{await f.close();}
});

test('Deleting and taking stock from separate tabs always leaves a valid retained ledger and blocks later stale saves',async()=>{
 for(const deleteFirst of [true,false]){
  const f=fixture();
  try{
   await f.store.request('operator',{name:'Eryk'});const item=(await f.store.request('items/stock-in',entry({quantity:5}))).id;
   const job=(await f.store.request('jobs',{client:'Caroline',name:'Fence Replacement'})).id,second=f.connect();await second.request('state');
   const take={id:crypto.randomUUID(),itemId:item,jobId:job,type:'TAKEN_TO_JOB',quantity:2};
   const calls=deleteFirst?[f.store.request('items/'+item+'/delete'),second.request('movements',take)]:[second.request('movements',take),f.store.request('items/'+item+'/delete')];
   const outcomes=await Promise.allSettled(calls),takeResult=outcomes[deleteFirst?1:0];assert.equal(outcomes[deleteFirst?0:1].status,'fulfilled');
   const state=await f.store.request('state');assert.ok(state.items[0].deleted_at);assert.equal(state.items[0].quantity,takeResult.status==='fulfilled'?3:5);assert.equal(state.movements.length,takeResult.status==='fulfilled'?2:1);
   if(takeResult.status==='rejected')assert.match(takeResult.reason.message,/restore/i);else assert.deepEqual(await second.request('movements',take),takeResult.value);
   await assert.rejects(second.request('movements',{...take,id:crypto.randomUUID()}),/restore/i);assert.deepEqual(await f.store.request('state'),state);
   const destination=fixture();try{await destination.store.request('restore',await f.store.request('export'));assert.deepEqual(await destination.store.request('state'),state);}finally{await destination.close();}
  }finally{await f.close();}
 }
});
