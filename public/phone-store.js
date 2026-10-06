const FORMAT='workshop-phone-v1';
const TYPES=['STOCK_IN','TAKEN_TO_JOB','RETURNED_TO_WORKSHOP'];
const requestValue=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
const text=(value,label,max=160)=>{if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw new Error('Enter a valid '+label+'.');return value.trim();};
const identifier=(value,label)=>{if(typeof value!=='string'||!/^[a-zA-Z0-9-]{10,80}$/.test(value))throw new Error('The backup contains an invalid '+label+'.');return value;};
const positive=value=>{if(!Number.isSafeInteger(value)||value<1||value>1000000)throw new Error('Enter a whole quantity greater than zero.');return value;};
const stamp=value=>{if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))throw new Error('The backup contains an invalid date.');return value;};
function validateBackup(backup){
 if(backup?.format!==FORMAT||!Array.isArray(backup.items)||!Array.isArray(backup.jobs)||!Array.isArray(backup.movements))throw new Error('Choose a Workshop phone backup.');
 const itemMap=new Map(),jobMap=new Map(),barcodes=new Set(),movementIds=new Set(),sequences=new Set(),quantities=new Map(),held=new Map();
 const items=backup.items.map(raw=>{
  const item={id:identifier(raw.id,'item ID'),name:text(raw.name,'material name'),barcode:text(raw.barcode,'barcode',100),unit:text(raw.unit,'unit',30),quantity:raw.quantity,created_at:stamp(raw.created_at)};
  if(itemMap.has(item.id)||barcodes.has(item.barcode)||!Number.isSafeInteger(item.quantity)||item.quantity<0)throw new Error('The backup has invalid or duplicate materials.');
  itemMap.set(item.id,item);barcodes.add(item.barcode);quantities.set(item.id,0);return item;
 });
 const jobs=backup.jobs.map(raw=>{
  const job={id:identifier(raw.id,'job ID'),client:text(raw.client,'client name'),name:text(raw.name,'job description'),address:raw.address?text(raw.address,'address',300):null,status:raw.status,created_at:stamp(raw.created_at)};
  if(raw.deleted_at!=null)job.deleted_at=stamp(raw.deleted_at);
  if(jobMap.has(job.id)||!['Active','Completed'].includes(job.status))throw new Error('The backup has invalid or duplicate jobs.');jobMap.set(job.id,job);return job;
 });
 const movements=backup.movements.map(raw=>{
  const movement={id:identifier(raw.id,'transaction ID'),item_id:identifier(raw.item_id,'material ID'),job_id:raw.job_id?identifier(raw.job_id,'job ID'):null,type:raw.type,quantity:positive(raw.quantity),created_at:stamp(raw.created_at),sequence:raw.sequence,user_id:identifier(raw.user_id,'scanning user ID'),user_name:text(raw.user_name,'scanning user'),item_name:text(raw.item_name,'material name'),unit:text(raw.unit,'unit',30),client_name:raw.client_name||null,job_name:raw.job_name||null,before:raw.before,after:raw.after};
  if(!itemMap.has(movement.item_id)||!TYPES.includes(movement.type)||movementIds.has(movement.id)||!Number.isSafeInteger(movement.sequence)||movement.sequence<1||sequences.has(movement.sequence))throw new Error('The backup has invalid or duplicate transactions.');
  if(movement.type==='STOCK_IN'?movement.job_id!==null:!jobMap.has(movement.job_id))throw new Error('A backup transaction is missing its job.');
  if(movement.type!=='STOCK_IN'){movement.client_name=text(movement.client_name,'client name');movement.job_name=text(movement.job_name,'job name');}
  movementIds.add(movement.id);sequences.add(movement.sequence);return movement;
 }).sort((a,b)=>a.sequence-b.sequence);
 for(const movement of movements){
  const before=quantities.get(movement.item_id),after=before+(movement.type==='TAKEN_TO_JOB'?-movement.quantity:movement.quantity);
  if(movement.before!==before||movement.after!==after||!Number.isSafeInteger(after)||after<0)throw new Error('The backup stock history does not match its quantities.');
  quantities.set(movement.item_id,after);
  if(movement.job_id){const key=JSON.stringify([movement.job_id,movement.item_id]);const net=(held.get(key)||0)+(movement.type==='TAKEN_TO_JOB'?movement.quantity:-movement.quantity);if(net<0)throw new Error('A backup return exceeds the materials held by its job.');held.set(key,net);}
 }
 for(const item of items)if(item.quantity!==quantities.get(item.id))throw new Error('The backup inventory does not match its transaction history.');
 const operator=backup.operator?.id&&backup.operator?.name?{id:identifier(backup.operator.id,'user ID'),name:text(backup.operator.name,'your name')}:null;
 return {items,jobs,movements,operator,sequence:movements.at(-1)?.sequence||0};
}
export function createPhoneStore({indexedDB=globalThis.indexedDB,IDBKeyRange=globalThis.IDBKeyRange,databaseName='workshop-phone-v1',now=()=>new Date().toISOString(),createId=()=>crypto.randomUUID()}={}){
 let opening=null;
 function open(){
  if(!indexedDB)throw new Error('Phone storage is unavailable. Open Workshop in Safari or Chrome outside private browsing.');
  if(!opening)opening=new Promise((resolve,reject)=>{
   const request=indexedDB.open(databaseName,1);
   request.onupgradeneeded=()=>{const database=request.result;const items=database.createObjectStore('items',{keyPath:'id'});items.createIndex('barcode','barcode',{unique:true});database.createObjectStore('jobs',{keyPath:'id'});const movements=database.createObjectStore('movements',{keyPath:'id'});movements.createIndex('job_item',['job_id','item_id']);database.createObjectStore('meta',{keyPath:'key'});};
   request.onsuccess=()=>{const database=request.result;database.onversionchange=()=>{database.close();opening=null;};resolve(database);};
   request.onerror=()=>{opening=null;reject(new Error('Phone storage could not be opened. Use Safari or Chrome outside private browsing.'));};
   request.onblocked=()=>{opening=null;reject(new Error('Close other Workshop tabs and open this app again.'));};
  });return opening;
 }
 async function transaction(mode,operation){
  const database=await open();
  return new Promise((resolve,reject)=>{
   const tx=database.transaction(['items','jobs','movements','meta'],mode);const stores=Object.fromEntries(['items','jobs','movements','meta'].map(name=>[name,tx.objectStore(name)]));let result,failure;
   tx.oncomplete=()=>resolve(result);
   tx.onabort=()=>reject(failure?.name==='QuotaExceededError'?new Error('The phone is out of storage. No inventory changes were saved.'):failure||new Error(tx.error?.name==='QuotaExceededError'?'The phone is out of storage. No inventory changes were saved.':'The change could not be saved on this phone. Please try again.'));
   tx.onerror=()=>{};
   Promise.resolve(operation(stores)).then(value=>{result=value;}).catch(error=>{failure=error;try{tx.abort();}catch{reject(error);}});
  });
 }
 async function readState(stores){
  const [items,jobs,movements,operator]=await Promise.all([requestValue(stores.items.getAll()),requestValue(stores.jobs.getAll()),requestValue(stores.movements.getAll()),requestValue(stores.meta.get('operator'))]);
  return {items:items.sort((a,b)=>a.name.localeCompare(b.name)),jobs:jobs.sort((a,b)=>b.created_at.localeCompare(a.created_at)),movements:movements.sort((a,b)=>a.sequence-b.sequence),user:operator?{...operator.value,configured:true}:{id:null,name:'Your name',configured:false}};
 }
 async function request(path,body){
  if(path==='state')return transaction('readonly',readState);
  if(path==='export')return transaction('readonly',async stores=>{const state=await readState(stores);return {format:FORMAT,exported_at:now(),items:state.items,jobs:state.jobs,movements:state.movements,operator:state.user.configured?{id:state.user.id,name:state.user.name}:null};});
  const restored=path==='restore'?validateBackup(body):null;
  return transaction('readwrite',async stores=>{
   if(path==='operator'){const old=await requestValue(stores.meta.get('operator'));const user={id:old?.value.id||createId(),name:text(body.name,'your name')};await requestValue(stores.meta.put({key:'operator',value:user}));return user;}
   if(path==='items'){
    const name=text(body.name,'material name'),barcode=text(body.barcode,'barcode',100),unit=text(body.unit,'unit',30);
    if(await requestValue(stores.items.index('barcode').get(barcode)))throw new Error('That barcode already belongs to an item.');
    const item={id:createId(),name,barcode,unit,quantity:0,created_at:now()};await requestValue(stores.items.add(item));return {id:item.id};
   }
   if(path==='jobs'){const job={id:createId(),client:text(body.client,'client name'),name:text(body.name,'job description'),address:body.address?text(body.address,'address',300):null,status:'Active',created_at:now()};await requestValue(stores.jobs.add(job));return {id:job.id};}
   const status=path.match(/^jobs\/([^/]+)\/status$/);
   if(status){if(!['Active','Completed'].includes(body.status))throw new Error('Choose a valid job status.');const job=await requestValue(stores.jobs.get(status[1]));if(!job)throw new Error('Job not found.');if(job.deleted_at)throw new Error('Restore this deleted job before changing its status.');await requestValue(stores.jobs.put({...job,status:body.status}));return {ok:true};}
   const jobRemoval=path.match(/^jobs\/([^/]+)\/(delete|restore)$/);
   if(jobRemoval){
    const job=await requestValue(stores.jobs.get(jobRemoval[1]));if(!job)throw new Error('Job not found.');
    if(jobRemoval[2]==='delete'){
     if(!job.deleted_at)await requestValue(stores.jobs.put({...job,status:'Completed',deleted_at:now()}));
    }else if(job.deleted_at){
     const restoredJob={...job,status:'Completed'};delete restoredJob.deleted_at;await requestValue(stores.jobs.put(restoredJob));
    }
    return {ok:true};
   }
   if(path==='movements'){
    const {id,itemId,jobId=null,type,quantity}=body;
    if(!/^[a-zA-Z0-9-]{10,80}$/.test(id||''))throw new Error('Please start a new transaction.');
    positive(quantity);if(!TYPES.includes(type))throw new Error('Choose a valid stock movement.');
    const operator=await requestValue(stores.meta.get('operator'));if(!operator)throw new Error('Set your scanning name in Phone data before saving a movement.');
    const existing=await requestValue(stores.movements.get(id));
    if(existing){if(existing.item_id!==itemId||existing.job_id!==jobId||existing.type!==type||existing.quantity!==quantity||existing.user_id!==operator.value.id)throw new Error('This transaction reference is already in use.');return {movement:existing};}
    if(type==='STOCK_IN'&&jobId)throw new Error('Use Return Stock to return materials from a job.');
    if(type!=='STOCK_IN'&&!jobId)throw new Error('Select a destination job.');
    const item=await requestValue(stores.items.get(itemId));if(!item)throw new Error('This item could not be found.');
    const job=jobId?await requestValue(stores.jobs.get(jobId)):null;
    if(jobId&&!job)throw new Error('Select a valid job.');
    if(type==='TAKEN_TO_JOB'&&job.deleted_at)throw new Error('This job was deleted. Select an active destination job.');
    if(type==='TAKEN_TO_JOB'&&job.status!=='Active')throw new Error('Select an active destination job.');
    if(type==='TAKEN_TO_JOB'&&quantity>item.quantity)throw new Error('Insufficient Workshop stock.');
    if(type==='RETURNED_TO_WORKSHOP'){const history=await requestValue(stores.movements.index('job_item').getAll(IDBKeyRange.only([jobId,itemId])));const held=history.reduce((sum,m)=>sum+(m.type==='TAKEN_TO_JOB'?m.quantity:-m.quantity),0);if(quantity>held)throw new Error('Return exceeds materials held by this job.');}
    const after=item.quantity+(type==='TAKEN_TO_JOB'?-quantity:quantity);if(!Number.isSafeInteger(after)||after<0)throw new Error('The resulting stock quantity is invalid.');
    const sequence=(await requestValue(stores.meta.get('sequence')))?.value||0;
    const movement={id,item_id:itemId,job_id:jobId,type,quantity,created_at:now(),sequence:sequence+1,user_id:operator.value.id,user_name:operator.value.name,item_name:item.name,unit:item.unit,client_name:job?.client||null,job_name:job?.name||null,before:item.quantity,after};
    await requestValue(stores.items.put({...item,quantity:after}));await requestValue(stores.movements.add(movement));await requestValue(stores.meta.put({key:'sequence',value:sequence+1}));return {movement};
   }
   if(path==='restore'){
    const counts=await Promise.all([requestValue(stores.items.count()),requestValue(stores.jobs.count()),requestValue(stores.movements.count())]);if(counts.some(Boolean))throw new Error('Restore a backup into an empty phone inventory. Existing history stays unchanged.');
    for(const item of restored.items)await requestValue(stores.items.add(item));for(const job of restored.jobs)await requestValue(stores.jobs.add(job));for(const movement of restored.movements)await requestValue(stores.movements.add(movement));
    if(restored.operator)await requestValue(stores.meta.put({key:'operator',value:restored.operator}));await requestValue(stores.meta.put({key:'sequence',value:restored.sequence}));return {ok:true};
   }
   throw new Error('Action not found.');
  });
 }
 return {request,async close(){if(opening){const database=await opening;database.close();opening=null;}}};
}
export function phoneDatabaseName(moduleUrl=import.meta.url){
 const base=new URL('./',moduleUrl).pathname;
 return base==='/'?'workshop-phone-v1':'workshop-phone-v1:'+base;
}
export const phoneInventory=createPhoneStore({databaseName:phoneDatabaseName()});
