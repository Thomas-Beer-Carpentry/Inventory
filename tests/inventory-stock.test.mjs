import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {IDBFactory,IDBKeyRange} from './vendor/fake-indexeddb/esm/index.js';
import {createPhoneStore} from '../public/phone-store.js';

const appSource=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const barcode='0005901234123457';
const aliasBarcode='5901234123457';
const decode=value=>value.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const move=(itemId,type,quantity,jobId=null)=>({id:crypto.randomUUID(),itemId,type,quantity,jobId});
async function until(predicate,message='The actual app did not finish the expected transition'){
 for(let attempt=0;attempt<300;attempt++){if(predicate())return;await new Promise(setImmediate);}
 assert.ok(predicate(),message);
}

// Execute the actual app controller and actual IndexedDB store. The DOM below
// models emitted forms, selectors and delegated events, including the native
// required-field barrier. It does not model browser layout or camera hardware.
class Element {
 constructor(document,tag='div',attributes={}){
  this.document=document;this.tagName=tag;this.attributes=attributes;this.children=[];
  this.style={};this.dataset=Object.fromEntries(Object.entries(attributes).filter(([key])=>key.startsWith('data-')).map(([key,value])=>[key.slice(5),value]));
  this.id=attributes.id||'';this.name=attributes.name||'';this.value=attributes.value||'';
  this.className=attributes.class||'';this.role=attributes.role||'';this.required='required' in attributes;
  this.disabled='disabled' in attributes;this.isConnected=true;this.text='';
  this.classList={add(){},remove(){}};document.elements.add(this);
 }
 set innerHTML(value){
  this.html=value;this.text='';for(const child of [...this.children])child.remove();
  const stack=[this],voidTags=new Set(['input','path','br','img','meta','link','hr']);
  for(const token of value.matchAll(/<\/?[a-z][^>]*>|[^<]+/gi)){
   const part=token[0],current=stack.at(-1);
   if(!part.startsWith('<')){const node=new Element(this.document,'#text');node.text=decode(part);current.append(node);continue;}
   if(part.startsWith('</')){const tag=part.match(/^<\/([\w-]+)/)[1];while(stack.length>1){if(stack.pop().tagName===tag)break;}continue;}
   const tag=part.match(/^<([\w-]+)/)[1],attributes={};
   const raw=part.slice(tag.length+1,-1);
   for(const attribute of raw.matchAll(/([\w-]+)(?:="([^"]*)")?/g))attributes[attribute[1]]=decode(attribute[2]??'');
   const child=new Element(this.document,tag,attributes);current.append(child);
   if(!voidTags.has(tag)&&!part.endsWith('/>'))stack.push(child);
  }
  for(const select of this.querySelectorAll('select')){
   const options=select.querySelectorAll('option'),chosen=options.find(option=>'selected' in option.attributes)||options[0];
   for(const option of options)if(!('value' in option.attributes))option.value=option.textContent;
   if(chosen)select.value=chosen.value;
  }
 }
 get innerHTML(){return this.html??this.text+this.children.map(child=>child.outerHTML).join('');}
 get outerHTML(){return this.tagName==='#text'?this.text:'<'+this.tagName+Object.entries(this.attributes).map(([name,value])=>' '+name+'="'+value+'"').join('')+'>'+this.innerHTML+'</'+this.tagName+'>';}
 get textContent(){return this.text+this.children.map(child=>child.textContent).join('');}
 set textContent(value){this.text=String(value);for(const child of [...this.children])child.remove();}
 append(child){if(child.parent)child.parent.children=child.parent.children.filter(value=>value!==child);child.parent=this;child.isConnected=true;this.children.push(child);}
 remove(){for(const child of [...this.children])child.remove();this.children=[];this.isConnected=false;this.document.elements.delete(this);if(this.parent)this.parent.children=this.parent.children.filter(value=>value!==this);}
 matches(selector){
  if(selector.startsWith('#'))return this.id===selector.slice(1);
  if(selector.startsWith('.'))return this.className.split(' ').includes(selector.slice(1));
  if(selector==='[role="status"]')return this.role==='status';
  if(selector==='[data-action]')return !!this.dataset.action;
  return this.tagName===selector;
 }
 closest(selector){let element=this;while(element){if(element.matches(selector))return element;element=element.parent;}return null;}
 querySelectorAll(selector){
  const parts=selector.trim().split(/\s+/),found=[];
  const visit=element=>{for(const child of element.children){if(child.matches(parts.at(-1))){let ancestor=child.parent,index=parts.length-2;while(index>=0&&ancestor){if(ancestor.matches(parts[index]))index--;ancestor=ancestor.parent;}if(index<0)found.push(child);}visit(child);}};
  visit(this);return found;
 }
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 setAttribute(name,value){this.attributes[name]=String(value);}
 focus(){this.document.activeElement=this;}
 blur(){}
 requestSubmit(){
  const invalid=this.querySelectorAll('input').concat(this.querySelectorAll('select')).find(field=>field.required&&!field.disabled&&!field.value);
  if(invalid){invalid.focus();this.document.invalidSubmissions++;return false;}
  this.document.dispatch('submit',{target:this,preventDefault(){}});return true;
 }
}
class Document {
 constructor(){
  this.elements=new Set();this.handlers=new Map();this.hidden=false;this.invalidSubmissions=0;
  this.body=new Element(this,'body');this.activeElement=this.body;
  for(const id of ['app','modal-root','toast'])this.body.append(new Element(this,'div',{id}));
 }
 addEventListener(name,handler){if(!this.handlers.has(name))this.handlers.set(name,[]);this.handlers.get(name).push(handler);}
 dispatch(name,event){for(const handler of this.handlers.get(name)||[])handler(event);}
 querySelector(selector){return this.body.querySelector(selector);}
 querySelectorAll(selector){return this.body.querySelectorAll(selector);}
 click(action,extra={}){const target={dataset:{action,...extra},closest(){return this;}};this.dispatch('click',{target});}
 clickRendered(action){const target=this.querySelectorAll('button').find(element=>element.dataset.action===action);assert.ok(target,'The actual app must render '+action);this.dispatch('click',{target});}
 input(id,value){const target=this.querySelector('#'+id);assert.ok(target,'The actual app must render '+id);target.value=value;this.dispatch('input',{target});}
}

async function fixture(){
 const indexedDB=new IDBFactory(),databaseName=crypto.randomUUID();
 const store=createPhoneStore({indexedDB,IDBKeyRange,databaseName});
 await store.request('operator',{name:'Eryk'});
 const nails=(await store.request('items',{name:'90mm Galvanised Nails',barcode,unit:'boxes'})).id;
 const timber=(await store.request('items',{name:'90x45 Timber',barcode:'67890',unit:'lengths'})).id;
 const alias=(await store.request('items',{name:'Numeric alias',barcode:aliasBarcode,unit:'packs'})).id;
 const unused=(await store.request('items',{name:'Never stocked',barcode:'EMPTY-NEW',unit:'pieces'})).id;
 const job=(await store.request('jobs',{client:'Caroline',name:'Fence Replacement'})).id;
 await store.request('movements',move(nails,'STOCK_IN',3));
 await store.request('movements',move(nails,'TAKEN_TO_JOB',3,job));
 await store.request('movements',move(timber,'STOCK_IN',2));
 await store.request('movements',move(alias,'STOCK_IN',1));
 return {store,indexedDB,databaseName,nails,timber,alias,unused,job};
}
async function app(t,{source=appSource,setup=async()=>{}}={}){
 const f=await fixture();t.after(()=>f.store.close());
 await setup(f);
 const document=new Document(),apiCalls=[],scanners=[];
 const windowHandlers=new Map();let hash='';
 const location={href:'https://workshop.test/Inventory/',get hash(){return hash;},set hash(value){hash=value?'#'+String(value).replace(/^#/,''):'';}};
 const window={addEventListener(name,handler){if(!windowHandlers.has(name))windowHandlers.set(name,[]);windowHandlers.get(name).push(handler);}};
 const collaborators={
  document,window,console,crypto,URL,Intl,Date,
  location,setTimeout(){return 1;},clearTimeout(){},
  phoneInventory:{async request(path,body){apiCalls.push({path,body});return f.store.request(path,body);}},
  prepareOffline(){},isAndroidApp:()=>false,androidBackup(){throw new Error('Unexpected native backup');},
  readCameraPreference:()=>'',saveCameraPreference(){},cameraError:error=>error.message||String(error),
  createCameraScanner(options){const scanner={options,stops:0,ready:Promise.resolve(),async stop(){scanner.stops++;},async cameraChoices(){return {cameras:[],selectedId:''};}};scanners.push(scanner);return scanner;},
  FormData:class{
   constructor(form){this.entries=form.querySelectorAll('input').concat(form.querySelectorAll('select')).filter(element=>element.name&&!element.disabled).map(element=>[element.name,element.value]);}
   get(name){return this.entries.find(entry=>entry[0]===name)?.[1]??null;}
   [Symbol.iterator](){return this.entries[Symbol.iterator]();}
  },
 };
 const controller=vm.runInNewContext(source.replace(/^import[^\n]*\n/gm,'')+'\n;({startCamera,stopCamera,refresh,currentDraft:()=>draft,state:()=>data,isLoading:()=>loading,visibleStockItems:()=>visibleStockItems()});',collaborators,{filename:'app.js'});
 await until(()=>!controller.isLoading());assert.equal(controller.state().user.configured,true);
 t.after(()=>controller.stopCamera());
 return {...f,document,controller,apiCalls,scanners,navigate(hash){location.hash='#'+hash;for(const handler of windowHandlers.get('hashchange')||[])handler();},submit(){const form=document.querySelector('#modal-form');assert.ok(form,'The actual app must render its form');return form.requestSubmit();}};
}
const stockIds=h=>Array.from(h.controller.visibleStockItems(),item=>item.id).sort();
const options=h=>h.document.querySelector('#manual-item').querySelectorAll('option').map(option=>option.value).filter(Boolean).sort();
const itemWrites=h=>h.apiCalls.filter(call=>call.path==='items');
function assertStockCounts(h,count){
 const panel=h.document.querySelector('#app').querySelector('.panel');
 assert.match(panel.querySelector('.meta').textContent,new RegExp('^'+count+'\\b'));
 assert.match(panel.querySelector('.toolbar .muted').textContent,new RegExp('^'+count+'\\b'));
 assert.equal(h.document.querySelector('#app').querySelector('.stat strong').textContent,String(count));
}
async function confirmQuantity(h,quantity){
 h.document.input('move-qty',String(quantity));assert.equal(h.submit(),true);
 await until(()=>h.controller.currentDraft()?.step===3);
 assert.equal(h.submit(),true);await until(()=>h.controller.currentDraft()?.step===4);
 await until(()=>{const saved=h.controller.currentDraft().saved;return h.controller.state().items.find(item=>item.id===saved.item_id)?.quantity===saved.after;},'Saved movement must refresh Workshop quantities');
}

test('Taking the last stock retains the full barcode catalog and audit records after reopen and backup restore',async t=>{
 const f=await fixture();t.after(()=>f.store.close());
 const original=await f.store.request('state');assert.equal(original.items.find(item=>item.id===f.nails).quantity,0);
 await f.store.close();const reopened=createPhoneStore({indexedDB:f.indexedDB,IDBKeyRange,databaseName:f.databaseName});t.after(()=>reopened.close());
 const state=await reopened.request('state'),backup=await reopened.request('export');
 assert.deepEqual(state.items,original.items);assert.deepEqual(state.movements,original.movements);
 const remembered=backup.items.find(item=>item.id===f.nails);
 assert.deepEqual([remembered.name,remembered.barcode,remembered.unit,remembered.quantity],['90mm Galvanised Nails',barcode,'boxes',0]);
 assert.deepEqual(backup.movements.filter(movement=>movement.item_id===f.nails).map(movement=>[movement.type,movement.before,movement.after]),[['STOCK_IN',0,3],['TAKEN_TO_JOB',3,0]]);
 const restored=createPhoneStore({indexedDB:new IDBFactory(),IDBKeyRange,databaseName:crypto.randomUUID()});t.after(()=>restored.close());
 await restored.request('restore',backup);assert.deepEqual((await restored.request('state')).items,state.items);
});

test('Workshop render and live search show only positive stock while counts exclude remembered zero items',async t=>{
 const h=await app(t),positive=[h.timber,h.alias].sort();
 assertStockCounts(h,2);
 const rows=()=>h.document.querySelector('#inventory-results').innerHTML;
 assert.match(rows(),/90x45 Timber/);assert.match(rows(),/Numeric alias/);
 assert.doesNotMatch(rows(),/90mm Galvanised Nails|Never stocked/);
 assert.deepEqual(stockIds(h),positive);
 h.document.input('inventory-search','GaLvAnIsEd');assert.deepEqual(stockIds(h),[]);
 assert.doesNotMatch(rows(),/<tbody>|90mm Galvanised Nails/);assertStockCounts(h,2);
 h.document.input('inventory-search','TiMbEr');assert.deepEqual(stockIds(h),[h.timber]);
 assert.match(rows(),/90x45 Timber/);assert.doesNotMatch(rows(),/Numeric alias|Galvanised/);
 h.document.input('inventory-search',barcode);assert.deepEqual(stockIds(h),[]);assert.doesNotMatch(rows(),/<tbody>/);
 h.document.input('inventory-search','');assert.deepEqual(stockIds(h),positive);
 assert.equal((await h.store.request('state')).items.length,4);
});

test('Confirming the last Stock Out removes its Workshop row while Stock In keeps the entire catalog selectable',async t=>{
 const h=await app(t);h.document.click('stockout',{job:h.job});h.document.input('manual-item',h.alias);assert.equal(h.submit(),true);
 await until(()=>h.controller.currentDraft()?.step===2);await confirmQuantity(h,1);
 assert.deepEqual(stockIds(h),[h.timber]);assertStockCounts(h,1);
 assert.doesNotMatch(h.document.querySelector('#inventory-results').innerHTML,/Numeric alias/);
 const state=await h.store.request('state');assert.equal(state.items.length,4);
 assert.deepEqual([state.items.find(item=>item.id===h.alias).barcode,state.items.find(item=>item.id===h.alias).quantity],[aliasBarcode,0]);
 h.document.click('done');h.document.click('stockin');
 assert.deepEqual(options(h),[h.nails,h.timber,h.alias,h.unused].sort());
});

test('Typing a remembered exact barcode with no description opens Stock In for the same material and replenishes it',async t=>{
 const h=await app(t);h.document.click('newitem');
 assert.equal(h.document.querySelector('#item-name').required,false,'Known barcode must pass browser form validation without a name');
 h.document.input('item-barcode',barcode);assert.equal(h.submit(),true);
 await until(()=>h.controller.currentDraft()?.kind==='move'&&h.controller.currentDraft()?.step===2,'Known typed barcode must open its existing Stock In quantity form');
 const draft=h.controller.currentDraft();assert.deepEqual([draft.type,draft.itemId,draft.step],['STOCK_IN',h.nails,2]);
 assert.equal(itemWrites(h).length,0,'Known barcode must be found before any item creation request');
 assert.equal(h.document.invalidSubmissions,0);assert.match(h.document.querySelector('#modal-root').innerHTML,/90mm Galvanised Nails/);
 await confirmQuantity(h,4);
 const state=await h.store.request('state'),item=state.items.find(item=>item.id===h.nails);
 assert.deepEqual([item.name,item.barcode,item.unit,item.quantity],['90mm Galvanised Nails',barcode,'boxes',4]);
 assert.equal(state.items.length,4);assert.ok(stockIds(h).includes(h.nails));assertStockCounts(h,3);
 assert.deepEqual(state.movements.at(-1).item_id,h.nails);assert.deepEqual([state.movements.at(-1).before,state.movements.at(-1).after],[0,4]);
});

test('Scanning a remembered barcode in Add Material opens its quantity form without description or catalog writes',async t=>{
 const h=await app(t);h.document.click('newitem');await h.controller.startCamera();
 assert.equal(h.scanners.length,1);await h.scanners[0].options.onCode(barcode);
 await until(()=>h.controller.currentDraft()?.kind==='move'&&h.controller.currentDraft()?.step===2);
 assert.deepEqual([h.controller.currentDraft().type,h.controller.currentDraft().itemId],['STOCK_IN',h.nails]);
 assert.equal(h.scanners[0].stops,1);assert.equal(itemWrites(h).length,0);
 assert.equal(h.apiCalls.some(call=>call.path==='movements'),false,'Scanning only prepares a movement; confirmation is still required');
 assert.equal((await h.store.request('state')).items.find(item=>item.id===h.nails).quantity,0);
});

test('Leading-zero barcode identity and existing material details survive a known typed barcode with other form details',async t=>{
 const h=await app(t);h.document.click('newitem');
 h.document.input('item-name','Do not overwrite');h.document.input('item-unit','bags');h.document.input('item-barcode',aliasBarcode);assert.equal(h.submit(),true);
 await until(()=>h.controller.currentDraft()?.kind==='move');
 assert.equal(h.controller.currentDraft().itemId,h.alias);assert.notEqual(h.controller.currentDraft().itemId,h.nails);
 assert.equal(itemWrites(h).length,0);
 const state=await h.store.request('state');assert.deepEqual(state.items.filter(item=>[h.nails,h.alias].includes(item.id)).map(item=>[item.id,item.name,item.barcode,item.unit]).sort(),[[h.nails,'90mm Galvanised Nails',barcode,'boxes'],[h.alias,'Numeric alias',aliasBarcode,'packs']].sort());
});

test('An unknown barcode still needs a valid material name and unique catalog entry before Stock In',async t=>{
 const h=await app(t);h.document.click('newitem');h.document.input('item-barcode','UNSEEN-00042');assert.equal(h.submit(),true);
 await until(()=>h.controller.currentDraft()?.error);
 assert.match(h.controller.currentDraft().error,/material name/i);assert.equal((await h.store.request('state')).items.length,4);
 h.document.input('item-name','New concrete');h.document.input('item-unit','bags');assert.equal(h.submit(),true);
 await until(()=>h.controller.currentDraft()?.kind==='move'&&h.controller.currentDraft()?.step===2);
 const added=(await h.store.request('state')).items.find(item=>item.barcode==='UNSEEN-00042');
 assert.ok(added);assert.deepEqual([added.name,added.unit,added.quantity],['New concrete','bags',0]);
 assert.equal(h.controller.currentDraft().itemId,added.id);assert.equal(stockIds(h).includes(added.id),false);
 await assert.rejects(h.store.request('items',{name:'Duplicate material',barcode:'UNSEEN-00042',unit:'bags'}),/barcode already belongs/i);
 assert.equal((await h.store.request('state')).items.length,5);assert.equal((await h.store.request('state')).movements.length,4);
});

test('Stock Out offers positive quantities and a scanned depleted item fails before the quantity step',async t=>{
 const h=await app(t);h.document.click('stockout',{job:h.job});
 assert.deepEqual(options(h),[h.alias,h.timber].sort());
 await h.controller.startCamera();await h.scanners[0].options.onCode(barcode);
 await until(()=>h.controller.currentDraft()?.error);
 assert.equal(h.controller.currentDraft().step,1);assert.equal(h.controller.currentDraft().itemId,null);
 assert.match(h.controller.currentDraft().error,/stock|Workshop/i);assert.equal(h.document.querySelector('#move-qty'),null);
 assert.equal(h.apiCalls.some(call=>call.path==='movements'),false);assert.equal((await h.store.request('state')).movements.length,4);
});

test('Return Stock offers job-held materials even at Workshop zero and makes the same catalog item visible again',async t=>{
 const h=await app(t);h.document.click('return',{job:h.job});
 assert.deepEqual(options(h),[h.nails]);
 h.document.input('manual-item',h.nails);assert.equal(h.submit(),true);
 await until(()=>h.controller.currentDraft()?.step===2);assert.equal(h.controller.currentDraft().itemId,h.nails);
 await confirmQuantity(h,2);
 const state=await h.store.request('state'),last=state.movements.at(-1);
 assert.equal(state.items.length,4);assert.equal(state.items.find(item=>item.id===h.nails).quantity,2);
 assert.deepEqual([last.type,last.item_id,last.job_id,last.before,last.after],['RETURNED_TO_WORKSHOP',h.nails,h.job,0,2]);
 assert.ok(stockIds(h).includes(h.nails));assert.match(h.document.querySelector('#inventory-results').innerHTML,/90mm Galvanised Nails/);assertStockCounts(h,3);
 assert.equal(state.movements.filter(movement=>movement.item_id===h.nails&&movement.job_id===h.job).reduce((total,movement)=>total+(movement.type==='TAKEN_TO_JOB'?movement.quantity:-movement.quantity),0),1);
});

const renderedActions=(h,action)=>h.document.querySelector('#app').querySelectorAll('button').filter(button=>button.dataset.action===action);
const destinationOptions=h=>h.document.querySelector('#move-job').querySelectorAll('option').map(option=>option.value).filter(Boolean);
function assertJobTabs(h,{Active,Completed,Deleted}){
 for(const [status,count] of Object.entries({Active,Completed,Deleted})){
  const tab=h.document.querySelectorAll('button').find(button=>button.dataset.action==='jobfilter'&&button.dataset.status===status);
  assert.ok(tab,'The actual Jobs page must render the '+status+' tab');assert.match(tab.textContent,new RegExp('· '+count+'$'));
 }
}
async function chooseOutQuantity(h){
 h.document.click('stockout');h.document.input('manual-item',h.timber);assert.equal(h.submit(),true);
 await until(()=>h.controller.currentDraft()?.step===2);
}

test('Confirmed job deletion hides lists and destinations while keeping material history and returns available',async t=>{
 const h=await app(t),before=await h.store.request('state');h.navigate('job/'+h.job);
 assert.equal(renderedActions(h,'stockout').length,1);h.document.clickRendered('deletejob');
 assert.deepEqual([h.controller.currentDraft().kind,h.controller.currentDraft().action],['jobremove','delete']);
 assert.equal(h.apiCalls.some(call=>call.path==='jobs/'+h.job+'/delete'),false,'Opening confirmation must not delete the job');
 h.document.click('close');assert.equal((await h.store.request('state')).jobs.find(job=>job.id===h.job).deleted_at,undefined);
 h.document.clickRendered('deletejob');assert.equal(h.submit(),true);
 await until(()=>h.controller.state().jobs.find(job=>job.id===h.job)?.deleted_at&&h.document.querySelector('.tabs'));
 assert.equal(h.apiCalls.filter(call=>call.path==='jobs/'+h.job+'/delete').length,1);
 let state=await h.store.request('state');assert.deepEqual(state.items,before.items);assert.deepEqual(state.movements,before.movements);
 assertJobTabs(h,{Active:0,Completed:0,Deleted:1});
 assert.equal(h.document.querySelectorAll('button').find(button=>button.dataset.action==='jobfilter'&&button.dataset.status==='Active').className.includes('active'),true);
 assert.equal(h.document.querySelector('.job-card'),null,'Deletion returns to the ordinary Active jobs list');
 h.document.click('jobfilter',{status:'Active'});assert.equal(h.document.querySelector('.job-card'),null);
 h.document.click('jobfilter',{status:'Completed'});assert.equal(h.document.querySelector('.job-card'),null);
 h.document.click('jobfilter',{status:'Deleted'});assert.equal(h.document.querySelector('.job-card').attributes.href,'#job/'+h.job);assert.match(h.document.querySelector('.job-card').textContent,/Caroline.*Fence Replacement/s);
 await chooseOutQuantity(h);assert.deepEqual(destinationOptions(h),[]);h.document.click('close');
 h.navigate('job/'+h.job);assert.equal(renderedActions(h,'stockout').length,0);assert.equal(renderedActions(h,'return').length,1);
 const tables=h.document.querySelector('#app').querySelectorAll('tbody');
 assert.match(tables[0].textContent,/90mm Galvanised Nails/);assert.equal(tables[1].querySelectorAll('tr').length,1);
 assert.match(tables[1].textContent,/TAKEN TO JOB/);
 h.document.clickRendered('return');assert.deepEqual(options(h),[h.nails]);h.document.input('manual-item',h.nails);assert.equal(h.submit(),true);
 await until(()=>h.controller.currentDraft()?.step===2);await confirmQuantity(h,2);
 state=await h.store.request('state');assert.ok(state.jobs.find(job=>job.id===h.job).deleted_at);
 assert.deepEqual(state.movements.slice(0,before.movements.length),before.movements);assert.equal(state.items.find(item=>item.id===h.nails).quantity,2);
 assert.deepEqual([state.movements.at(-1).type,state.movements.at(-1).job_id],['RETURNED_TO_WORKSHOP',h.job]);
 h.document.click('done');h.navigate('job/'+h.job);
 const afterTables=h.document.querySelector('#app').querySelectorAll('tbody');
 assert.deepEqual(afterTables[0].querySelectorAll('td').slice(1).map(cell=>cell.textContent.trim()),['3 boxes','2 boxes','1 boxes']);
 assert.equal(afterTables[1].querySelectorAll('tr').length,2);assert.equal(renderedActions(h,'stockout').length,0);
});

test('Restoring a deleted job keeps it Completed until its separate Reopen confirmation succeeds',async t=>{
 const h=await app(t,{setup:async f=>{await f.store.request('jobs/'+f.job+'/delete',{});}}),before=await h.store.request('state');
 h.navigate('job/'+h.job);h.document.clickRendered('restorejob');
 assert.deepEqual([h.controller.currentDraft().kind,h.controller.currentDraft().action],['jobremove','restore']);
 assert.equal(h.apiCalls.some(call=>call.path==='jobs/'+h.job+'/restore'),false);
 assert.equal(h.submit(),true);await until(()=>!h.controller.currentDraft()&&!h.controller.state().jobs.find(job=>job.id===h.job)?.deleted_at);
 let job=h.controller.state().jobs.find(job=>job.id===h.job);assert.equal(job.status,'Completed');assert.equal(renderedActions(h,'stockout').length,0);
 assert.equal(h.apiCalls.filter(call=>call.path==='jobs/'+h.job+'/restore').length,1);
 h.navigate('jobs');assertJobTabs(h,{Active:0,Completed:1,Deleted:0});
 assert.equal(h.document.querySelectorAll('button').find(button=>button.dataset.action==='jobfilter'&&button.dataset.status==='Completed').className.includes('active'),true);
 assert.equal(h.document.querySelector('.job-card').attributes.href,'#job/'+h.job);
 await chooseOutQuantity(h);assert.deepEqual(destinationOptions(h),[]);h.document.click('close');
 h.navigate('job/'+h.job);assert.match(renderedActions(h,'jobstatus')[0].textContent,/Reopen job/);h.document.clickRendered('jobstatus');
 assert.equal(h.apiCalls.some(call=>call.path==='jobs/'+h.job+'/status'),false);assert.equal(h.submit(),true);
 await until(()=>!h.controller.currentDraft()&&h.controller.state().jobs.find(job=>job.id===h.job)?.status==='Active');
 assert.equal(renderedActions(h,'stockout').length,1);assert.deepEqual({...h.apiCalls.find(call=>call.path==='jobs/'+h.job+'/status').body},{status:'Active'});
 const state=await h.store.request('state');assert.deepEqual(state.items,before.items);assert.deepEqual(state.movements,before.movements);
 await chooseOutQuantity(h);assert.deepEqual(destinationOptions(h),[h.job]);
});

test('Imported deleted Active jobs never offer Take materials, including an empty summary, and restore to Completed',async t=>{
 const h=await app(t,{setup:async f=>{
  f.emptyJob=(await f.store.request('jobs',{client:'Andrew',name:'No materials yet'})).id;
  const backup=await f.store.request('export');for(const job of backup.jobs){job.deleted_at='2026-10-06T08:00:00Z';job.status='Active';}
  await f.store.close();f.databaseName=crypto.randomUUID();f.store=createPhoneStore({indexedDB:f.indexedDB,IDBKeyRange,databaseName:f.databaseName});await f.store.request('restore',backup);
 }});
 assert.equal(h.document.querySelectorAll('.stat')[1].querySelector('strong').textContent,'0');
 h.navigate('jobs');assertJobTabs(h,{Active:0,Completed:0,Deleted:2});h.document.click('jobfilter',{status:'Deleted'});
 assert.equal(h.document.querySelectorAll('.job-card').length,2);
 for(const jobId of [h.job,h.emptyJob]){
  h.navigate('job/'+jobId);assert.equal(renderedActions(h,'stockout').length,0,'Deleted Active jobs must not offer Take materials anywhere');
  assert.equal(renderedActions(h,'return').length,1);assert.equal(renderedActions(h,'restorejob').length,1);
 }
 h.navigate('job/'+h.job);h.document.clickRendered('restorejob');assert.equal(h.submit(),true);
 await until(()=>!h.controller.currentDraft()&&!h.controller.state().jobs.find(job=>job.id===h.job)?.deleted_at);
 assert.equal(h.controller.state().jobs.find(job=>job.id===h.job).status,'Completed');assert.equal(renderedActions(h,'stockout').length,0);
 assert.equal(renderedActions(h,'return').length,1);assert.match(renderedActions(h,'jobstatus')[0].textContent,/Reopen job/);
 h.navigate('jobs');assertJobTabs(h,{Active:0,Completed:1,Deleted:1});
});
