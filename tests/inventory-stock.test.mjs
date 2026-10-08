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
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
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
  this.disabled='disabled' in attributes;this.readOnly='readonly' in attributes;this.isConnected=true;this.text='';
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
 change(id,value){const target=this.querySelector('#'+id);assert.ok(target,'The actual app must render '+id);target.value=value;this.dispatch('change',{target});}
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
 const document=new Document(),apiCalls=[],scanners=[],stockInPlans=[];
 const windowHandlers=new Map();let hash='';
 const location={href:'https://workshop.test/Inventory/',get hash(){return hash;},set hash(value){hash=value?'#'+String(value).replace(/^#/,''):'';}};
 const window={addEventListener(name,handler){if(!windowHandlers.has(name))windowHandlers.set(name,[]);windowHandlers.get(name).push(handler);}};
 const collaborators={
  document,window,console,crypto,URL,Intl,Date,
  location,setTimeout(){return 1;},clearTimeout(){},
  phoneInventory:{async request(path,body){
   apiCalls.push({path,body});const plan=path==='items/stock-in'?stockInPlans.shift():null;
   if(plan?.gate)await plan.gate.promise;if(plan?.beforeError)throw plan.beforeError;
   const result=await f.store.request(path,body);if(plan?.afterError)throw plan.afterError;return result;
  }},
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
 return {...f,document,controller,apiCalls,scanners,planStockIn(plan){stockInPlans.push(plan);},navigate(hash){location.hash='#'+hash;for(const handler of windowHandlers.get('hashchange')||[])handler();},submit(){const form=document.querySelector('#modal-form');assert.ok(form,'The actual app must render its form');return form.requestSubmit();},forceSubmit(){const form=document.querySelector('#modal-form');assert.ok(form);document.dispatch('submit',{target:form,preventDefault(){}});}};
}
const stockIds=h=>Array.from(h.controller.visibleStockItems(),item=>item.id).sort();
const stockRows=h=>h.document.querySelector('#inventory-results').querySelectorAll('.stock-row');
const options=h=>h.document.querySelector('#manual-item').querySelectorAll('option').map(option=>option.value).filter(Boolean).sort();
const itemWrites=h=>h.apiCalls.filter(call=>call.path==='items');
const materialStockIns=h=>h.apiCalls.filter(call=>call.path==='items/stock-in');
const writes=h=>h.apiCalls.filter(call=>!['state','export'].includes(call.path));
function fillMaterial(h,{name='',barcode:code='',unit='boxes',quantity=1}={}){
 h.document.clickRendered('newitem');assert.equal(h.controller.currentDraft().kind,'item');assert.equal(h.controller.currentDraft().step,1);
 assert.equal(h.document.querySelector('#item-qty').value,'1');assert.equal(h.document.querySelector('#item-barcode').required,false);
 h.document.input('item-name',name);h.document.input('item-barcode',code);h.document.input('item-unit',unit);h.document.input('item-qty',String(quantity));
}
async function reviewMaterial(h){assert.equal(h.submit(),true);await until(()=>h.controller.currentDraft()?.kind==='item'&&h.controller.currentDraft()?.step===2);}
async function saveMaterial(h){
 const id=h.controller.currentDraft().id;assert.equal(h.controller.currentDraft().step,2);assert.equal(h.submit(),true);
 await until(()=>!h.controller.currentDraft()&&h.controller.state().movements.some(movement=>movement.id===id),'Confirm must save the material and close its review without a success popup');
 assert.equal(h.document.querySelector('#modal-root').innerHTML,'');return h.store.request('state');
}
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
 assert.equal(stockRows(h).length,2);
 assert.deepEqual(stockIds(h),positive);
 h.document.input('inventory-search','GaLvAnIsEd');assert.deepEqual(stockIds(h),[]);
 assert.equal(stockRows(h).length,0);assert.doesNotMatch(rows(),/90mm Galvanised Nails/);assertStockCounts(h,2);
 h.document.input('inventory-search','TiMbEr');assert.deepEqual(stockIds(h),[h.timber]);
 assert.equal(stockRows(h).length,1);
 assert.match(rows(),/90x45 Timber/);assert.doesNotMatch(rows(),/Numeric alias|Galvanised/);
 h.document.input('inventory-search',barcode);assert.deepEqual(stockIds(h),[]);assert.equal(stockRows(h).length,0);
 h.document.input('inventory-search','');assert.deepEqual(stockIds(h),positive);
 assert.equal((await h.store.request('state')).items.length,4);
});

test('Workshop stock puts quantities first without displaying barcodes and keeps barcode search and row Stock In working',async t=>{
 const h=await app(t),results=h.document.querySelector('#inventory-results'),list=results.querySelector('.stock-list');
 assert.ok(list,'Workshop inventory must render its compact stock list');assert.equal(list.tagName,'ul');assert.equal(results.querySelector('table'),null);
 const state=await h.store.request('state');assert.equal(stockRows(h).length,2);
 for(const row of stockRows(h)){
  assert.equal(row.tagName,'li');const children=row.children.filter(child=>child.tagName!=='#text');
  const quantity=row.querySelector('.stock-quantity'),material=row.querySelector('.stock-material'),button=row.querySelector('button');
  assert.equal(children[0],quantity,'Quantity must precede the material and action in each row');
  const item=state.items.find(item=>item.id===button.dataset.item);assert.ok(item);assert.equal(button.dataset.action,'stockin');
  assert.match(quantity.textContent.trim(),new RegExp('^'+item.quantity+'\\s*'+item.unit+'$'));
  assert.equal(material.querySelector('strong').textContent,item.name);assert.ok(children.indexOf(material)>children.indexOf(quantity));
  const last=state.movements.filter(movement=>movement.item_id===item.id).at(-1);
  assert.ok(material.textContent.includes(new Intl.DateTimeFormat(undefined,{day:'numeric',month:'short',year:'numeric'}).format(new Date(last.created_at))));
  assert.equal(row.textContent.includes(item.barcode),false,'Barcode is retained for matching, without appearing in the stock row');
 }
 h.document.input('inventory-search',aliasBarcode);assert.equal(stockRows(h).length,1);
 const row=stockRows(h)[0];assert.match(row.textContent,/Numeric alias/);assert.equal(row.textContent.includes(aliasBarcode),false);
 const action=row.querySelector('button');h.document.dispatch('click',{target:action});
 assert.deepEqual([h.controller.currentDraft().kind,h.controller.currentDraft().type,h.controller.currentDraft().itemId,h.controller.currentDraft().step],['move','STOCK_IN',h.alias,2]);
 await confirmQuantity(h,2);
 const replenished=await h.store.request('state');assert.equal(replenished.items.find(item=>item.id===h.alias).quantity,3);
 assert.equal(replenished.items.find(item=>item.id===h.alias).barcode,aliasBarcode);assert.equal(itemWrites(h).length,0);
 assert.equal(stockRows(h).length,1);assert.equal(stockRows(h)[0].querySelector('.stock-quantity').textContent.replace(/\s/g,''),'3packs');
});

for(const {unit,title,label,code} of [{unit:'bottles',title:'Bottle',label:/^bottles?$/i,code:'BOTTLE-NEW-0001'},{unit:'tubs',title:'Tub',label:/^tubs?$/i,code:'TUB-NEW-0001'}]){
 test('Adding a '+title+' material saves its plural unit through Stock In, job take, return and reopen',async t=>{
  const h=await app(t);h.document.clickRendered('newitem');
  assert.equal(h.controller.currentDraft().step,1);
  const option=h.document.querySelector('#item-unit').querySelectorAll('option').find(option=>option.value===unit);
  assert.ok(option,title+' must be selectable in Add Material');assert.match(option.textContent.trim(),label);
  h.document.input('item-name',title+' material');h.document.input('item-barcode',code);h.document.input('item-unit',option.value);h.document.input('item-qty','3');await reviewMaterial(h);
  assert.equal(writes(h).length,0);assert.equal((await h.store.request('state')).items.length,4);
  let state=await saveMaterial(h);const itemId=state.items.find(item=>item.barcode===code).id;
  assert.deepEqual([state.items.find(item=>item.id===itemId).unit,state.items.find(item=>item.id===itemId).quantity],[unit,3]);
  let row=stockRows(h).find(row=>row.querySelector('button').dataset.item===itemId);assert.ok(row);
  assert.equal(row.querySelector('.stock-quantity').textContent.replace(/\s/g,''),'3'+unit);assert.equal(row.textContent.includes(code),false);
  h.document.click('stockout');h.document.input('manual-item',itemId);assert.equal(h.submit(),true);
  await until(()=>h.controller.currentDraft()?.step===2);h.document.input('move-job',h.job);await confirmQuantity(h,1);h.document.clickRendered('done');
  h.navigate('job/'+h.job);h.document.clickRendered('return');h.document.input('manual-item',itemId);assert.equal(h.submit(),true);
  await until(()=>h.controller.currentDraft()?.step===2);await confirmQuantity(h,1);
  state=await h.store.request('state');assert.equal(state.items.find(item=>item.id===itemId).unit,unit);assert.equal(state.items.find(item=>item.id===itemId).quantity,3);
  assert.deepEqual(state.movements.filter(movement=>movement.item_id===itemId).map(movement=>[movement.type,movement.unit,movement.before,movement.after]),[['STOCK_IN',unit,0,3],['TAKEN_TO_JOB',unit,3,2],['RETURNED_TO_WORKSHOP',unit,2,3]]);
  const backup=await h.store.request('export');assert.equal(backup.items.find(item=>item.id===itemId).unit,unit);
  await h.store.close();const reopened=createPhoneStore({indexedDB:h.indexedDB,IDBKeyRange,databaseName:h.databaseName});t.after(()=>reopened.close());
  const remembered=await reopened.request('state');assert.deepEqual(remembered.items,state.items);assert.deepEqual(remembered.movements,state.movements);
 });
}

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

test('Typing a remembered exact barcode reviews its saved description and replenishes the same material on confirmation',async t=>{
 const h=await app(t);fillMaterial(h,{barcode,quantity:4});
 assert.equal(h.document.querySelector('#item-name').required,false,'Known barcode must pass browser form validation without a name');
 await reviewMaterial(h);
 const draft=h.controller.currentDraft();assert.deepEqual([draft.name,draft.barcode,draft.unit,draft.quantity],['90mm Galvanised Nails',barcode,'boxes',4]);
 assert.equal(writes(h).length,0,'Reviewing a known barcode must not save stock');
 assert.equal(h.document.invalidSubmissions,0);assert.match(h.document.querySelector('#modal-root').innerHTML,/90mm Galvanised Nails/);
 assert.equal((await h.store.request('state')).items.find(item=>item.id===h.nails).quantity,0);
 const state=await saveMaterial(h),item=state.items.find(item=>item.id===h.nails);
 assert.deepEqual([item.name,item.barcode,item.unit,item.quantity],['90mm Galvanised Nails',barcode,'boxes',4]);
 assert.equal(state.items.length,4);assert.ok(stockIds(h).includes(h.nails));assertStockCounts(h,3);
 assert.equal(materialStockIns(h).length,1);assert.equal(itemWrites(h).length,0);
 assert.deepEqual(state.movements.at(-1).item_id,h.nails);assert.deepEqual([state.movements.at(-1).before,state.movements.at(-1).after],[0,4]);
});

test('Scanning a remembered barcode fills the first popup and keeps the typed quantity until review and confirmation',async t=>{
 const h=await app(t);fillMaterial(h,{unit:'tubs',quantity:7});const id=h.controller.currentDraft().id;await h.controller.startCamera();
 assert.equal(h.scanners.length,1);await h.scanners[0].options.onCode(barcode);
 assert.deepEqual([h.controller.currentDraft().kind,h.controller.currentDraft().step,h.controller.currentDraft().id],['item',1,id]);
 assert.deepEqual(['item-name','item-barcode','item-unit','item-qty'].map(field=>h.document.querySelector('#'+field).value),['90mm Galvanised Nails',barcode,'boxes','7']);
 assert.equal(h.scanners[0].stops,1);assert.equal(writes(h).length,0);
 assert.equal((await h.store.request('state')).items.find(item=>item.id===h.nails).quantity,0);
 await reviewMaterial(h);assert.equal(h.controller.currentDraft().quantity,7);assert.equal(h.controller.currentDraft().id,id);assert.equal(writes(h).length,0);
 const state=await saveMaterial(h);assert.equal(state.items.find(item=>item.id===h.nails).quantity,7);assert.equal(state.items.length,4);
});

test('Leading-zero barcode identity and existing material details survive a known typed barcode with other form details',async t=>{
 const h=await app(t);fillMaterial(h,{name:'Do not overwrite',unit:'bags',barcode:aliasBarcode,quantity:2});await reviewMaterial(h);
 assert.deepEqual([h.controller.currentDraft().name,h.controller.currentDraft().barcode,h.controller.currentDraft().unit],['Numeric alias',aliasBarcode,'packs']);assert.equal(writes(h).length,0);
 const state=await saveMaterial(h);assert.deepEqual(state.items.filter(item=>[h.nails,h.alias].includes(item.id)).map(item=>[item.id,item.name,item.barcode,item.unit]).sort(),[[h.nails,'90mm Galvanised Nails',barcode,'boxes'],[h.alias,'Numeric alias',aliasBarcode,'packs']].sort());
 assert.equal(state.items.find(item=>item.id===h.alias).quantity,3);assert.equal(state.items.find(item=>item.id===h.nails).quantity,0);assert.equal(state.items.length,4);
});

test('A new barcode needs a description and creates its material and opening stock only after the review confirmation',async t=>{
 const h=await app(t);fillMaterial(h,{barcode:'UNSEEN-00042',quantity:3});h.forceSubmit();
 await until(()=>h.controller.currentDraft()?.error);
 assert.match(h.controller.currentDraft().error,/material name/i);assert.equal((await h.store.request('state')).items.length,4);
 assert.equal(writes(h).length,0);h.document.input('item-name','New concrete');h.document.input('item-unit','bags');await reviewMaterial(h);
 assert.equal(writes(h).length,0);assert.equal((await h.store.request('state')).items.length,4);assert.equal(h.document.querySelector('#item-qty'),null);
 const state=await saveMaterial(h),added=state.items.find(item=>item.barcode==='UNSEEN-00042');
 assert.ok(added);assert.deepEqual([added.name,added.unit,added.quantity],['New concrete','bags',3]);assert.ok(stockIds(h).includes(added.id));
 assert.equal(state.items.length,5);assert.equal(state.movements.length,5);assert.equal(materialStockIns(h).length,1);assert.equal(itemWrites(h).length,0);
 assert.deepEqual([state.movements.at(-1).type,state.movements.at(-1).item_id,state.movements.at(-1).before,state.movements.at(-1).after],['STOCK_IN',added.id,0,3]);
});

test('A material without a barcode saves in two popups and remains selectable for later takes, returns and restocking',async t=>{
 const h=await app(t);fillMaterial(h,{name:'Loose concrete',unit:'bags',quantity:2});await reviewMaterial(h);
 const confirmationId=h.controller.currentDraft().id;assert.equal(writes(h).length,0);assert.equal((await h.store.request('state')).items.length,4);
 let state=await saveMaterial(h),item=state.items.find(item=>item.name==='Loose concrete');assert.ok(item);const itemId=item.id;
 assert.ok(item.barcode==null||item.barcode==='');assert.equal(item.quantity,2);assert.equal(state.movements.at(-1).id,confirmationId);
 assert.equal(materialStockIns(h).length,1);assert.equal(itemWrites(h).length,0);
 h.document.click('stockout',{job:h.job});assert.ok(options(h).includes(itemId));h.document.input('manual-item',itemId);assert.equal(h.submit(),true);
 await until(()=>h.controller.currentDraft()?.step===2);await confirmQuantity(h,2);h.document.clickRendered('done');assert.equal(stockIds(h).includes(itemId),false);
 h.navigate('job/'+h.job);h.document.clickRendered('return');assert.ok(options(h).includes(itemId));h.document.input('manual-item',itemId);assert.equal(h.submit(),true);
 await until(()=>h.controller.currentDraft()?.step===2);await confirmQuantity(h,1);h.document.clickRendered('done');h.navigate('inventory');
 h.document.click('stockin');assert.ok(options(h).includes(itemId));h.document.input('manual-item',itemId);assert.equal(h.submit(),true);
 await until(()=>h.controller.currentDraft()?.step===2);await confirmQuantity(h,3);h.document.clickRendered('done');
 state=await h.store.request('state');assert.equal(state.items.find(item=>item.id===itemId).quantity,4);
 assert.deepEqual(state.movements.filter(movement=>movement.item_id===itemId).map(movement=>[movement.type,movement.quantity,movement.before,movement.after]),[['STOCK_IN',2,0,2],['TAKEN_TO_JOB',2,2,0],['RETURNED_TO_WORKSHOP',1,0,1],['STOCK_IN',3,1,4]]);
 fillMaterial(h,{name:'Another manual material',unit:'pieces',quantity:1});await reviewMaterial(h);state=await saveMaterial(h);
 const another=state.items.find(item=>item.name==='Another manual material');assert.ok(another);assert.notEqual(another.id,itemId);
 assert.equal(state.items.length,6);assert.equal(state.items.find(item=>item.id===itemId).name,'Loose concrete');
});

test('Back keeps all Add Material inputs and cancellation at either popup leaves stock and history untouched',async t=>{
 const h=await app(t),before=await h.store.request('state');fillMaterial(h,{name:'Loose screws',unit:'pieces',quantity:9});const id=h.controller.currentDraft().id;
 await reviewMaterial(h);h.document.clickRendered('backstep');
 assert.deepEqual([h.controller.currentDraft().kind,h.controller.currentDraft().step,h.controller.currentDraft().id],['item',1,id]);
 assert.deepEqual(['item-name','item-barcode','item-unit','item-qty'].map(field=>h.document.querySelector('#'+field).value),['Loose screws','','pieces','9']);
 h.document.input('item-name','Edited screws');h.document.input('item-qty','8');await reviewMaterial(h);
 assert.equal(h.controller.currentDraft().id,id);assert.deepEqual([h.controller.currentDraft().name,h.controller.currentDraft().quantity],['Edited screws',8]);
 h.document.clickRendered('close');assert.equal(h.controller.currentDraft(),null);assert.equal(writes(h).length,0);
 assert.deepEqual(await h.store.request('state'),before);
 fillMaterial(h,{name:'Discard this',barcode:'UNSAVED-001',quantity:5});h.document.clickRendered('close');
 assert.equal(writes(h).length,0);assert.deepEqual(await h.store.request('state'),before);
});

test('Invalid Add Material quantities cannot reach review or save; the upper bound remains valid',async t=>{
 const h=await app(t),before=await h.store.request('state');fillMaterial(h,{name:'Validation material',barcode:'VALIDATION-42'});
 for(const quantity of ['',0,-1,.5,1000001]){
  h.document.input('item-qty',String(quantity));h.forceSubmit();await until(()=>h.controller.currentDraft()?.error);
  assert.equal(h.controller.currentDraft().step,1);assert.match(h.controller.currentDraft().error,/quantity/i);assert.equal(writes(h).length,0);
 }
 assert.deepEqual(await h.store.request('state'),before);
 h.document.input('item-qty','1000000');await reviewMaterial(h);assert.equal(h.controller.currentDraft().quantity,1000000);
 assert.equal(writes(h).length,0);h.document.clickRendered('close');assert.deepEqual(await h.store.request('state'),before);
});

test('Busy double-confirm and retries before or after a committed response failure save one material and one movement',async t=>{
 const h=await app(t),before=await h.store.request('state');fillMaterial(h,{name:'Retry material',barcode:'RETRY-NEW-43',unit:'bags',quantity:2});await reviewMaterial(h);
 const id=h.controller.currentDraft().id,gate=deferred();h.planStockIn({gate,beforeError:new Error('Storage is unavailable')});assert.equal(h.submit(),true);
 await until(()=>materialStockIns(h).length===1);h.forceSubmit();assert.equal(materialStockIns(h).length,1);assert.equal(h.controller.currentDraft().busy,true);
 gate.resolve();await until(()=>h.controller.currentDraft()?.error);
 assert.deepEqual([h.controller.currentDraft().step,h.controller.currentDraft().id,h.controller.currentDraft().busy],[2,id,false]);
 assert.match(h.controller.currentDraft().error,/Storage is unavailable/);assert.deepEqual(await h.store.request('state'),before);
 h.planStockIn({afterError:new Error('Saved response interrupted')});assert.equal(h.submit(),true);
 await until(()=>h.controller.currentDraft()?.error==='Saved response interrupted');assert.equal(h.controller.currentDraft().id,id);assert.equal(h.controller.currentDraft().step,2);
 const committed=await h.store.request('state');assert.equal(committed.items.length,5);assert.equal(committed.movements.length,5);
 assert.equal(committed.movements.at(-1).id,id);assert.equal(committed.items.find(item=>item.barcode==='RETRY-NEW-43').quantity,2);
 const state=await saveMaterial(h);assert.deepEqual(state.items,committed.items);assert.deepEqual(state.movements,committed.movements);
 assert.equal(materialStockIns(h).length,3);assert.ok(materialStockIns(h).every(call=>call.body.id===id));
 assert.ok(materialStockIns(h).every(call=>call.body.quantity===2&&call.body.barcode==='RETRY-NEW-43'));
 assert.equal(itemWrites(h).length,0);
});

const previewStock=h=>h.document.querySelector('.stock-change').querySelectorAll('b').map(value=>value.textContent);
const materialFields=h=>['item-name','item-unit','item-barcode','item-qty'].map(field=>h.document.querySelector('#'+field).value);

test('Saved-material dropdown includes zero stock, locks saved details, and Back or New material preserves quantity without saving',async t=>{
 const h=await app(t),before=await h.store.request('state');fillMaterial(h,{name:'Unsaved name',barcode:'UNSAVED-ALIAS',unit:'tubs',quantity:6});
 let select=h.document.querySelector('#item-existing');assert.ok(select,'Add Material must offer saved materials');
 assert.equal(select.name,'selectedItemId');assert.equal(select.value,'');assert.equal(select.querySelectorAll('option')[0].textContent,'New material');
 assert.deepEqual(select.querySelectorAll('option').map(option=>option.value).filter(Boolean).sort(),before.items.map(item=>item.id).sort());
 h.document.change('item-existing',h.nails);
 assert.deepEqual(materialFields(h),['90mm Galvanised Nails','boxes',barcode,'6']);
 assert.equal(h.document.querySelector('#item-name').readOnly,true);assert.equal(h.document.querySelector('#item-unit').disabled,true);
 assert.equal(h.document.querySelector('#item-existing').value,h.nails);await reviewMaterial(h);
 assert.deepEqual(previewStock(h),['0','6']);assert.equal(writes(h).length,0);
 h.document.clickRendered('backstep');assert.equal(h.document.querySelector('#item-existing').value,h.nails);
 assert.deepEqual(materialFields(h),['90mm Galvanised Nails','boxes',barcode,'6']);assert.equal(h.document.querySelector('#item-unit').disabled,true);
 h.document.change('item-existing','');assert.deepEqual(materialFields(h),['','boxes','','6']);
 assert.equal(h.document.querySelector('#item-name').readOnly,false);assert.equal(h.document.querySelector('#item-unit').disabled,false);
 h.document.change('item-existing',h.unused);await reviewMaterial(h);h.document.clickRendered('close');
 assert.equal(writes(h).length,0);assert.deepEqual(await h.store.request('state'),before);
});

test('Confirming selected manual or depleted saved materials adds stock to their existing IDs and closes the review',async t=>{
 const h=await app(t,{setup:async f=>{f.manual=(await f.store.request('items',{name:'Saved manual material',barcode:null,unit:'pieces'})).id;}});
 fillMaterial(h,{quantity:9});h.document.change('item-existing',h.manual);assert.deepEqual(materialFields(h),['Saved manual material','pieces','','9']);
 await reviewMaterial(h);assert.equal(writes(h).length,0);assert.deepEqual(previewStock(h),['0','9']);
 let state=await saveMaterial(h);assert.equal(state.items.length,5);assert.equal(state.items.find(item=>item.id===h.manual).quantity,9);
 assert.equal(materialStockIns(h)[0].body.itemId,h.manual);assert.equal(state.movements.at(-1).item_id,h.manual);
 fillMaterial(h,{quantity:2});h.document.change('item-existing',h.nails);await reviewMaterial(h);state=await saveMaterial(h);
 assert.equal(state.items.length,5);assert.equal(state.items.find(item=>item.id===h.nails).quantity,2);assert.equal(state.items.find(item=>item.id===h.nails).barcode,barcode);
 assert.equal(materialStockIns(h)[1].body.itemId,h.nails);assert.deepEqual([state.movements.at(-1).before,state.movements.at(-1).after], [0,2]);
 assertStockCounts(h,4);
});

test('Manual names match saved name and unit after Unicode, case and whitespace normalization while another unit stays separate',async t=>{
 const h=await app(t);fillMaterial(h,{name:'　Ｎｕｍｅｒｉｃ　　ＡＬＩＡＳ　',unit:'packs',quantity:3});await reviewMaterial(h);
 assert.deepEqual([h.controller.currentDraft().itemId,h.controller.currentDraft().name,h.controller.currentDraft().unit],[h.alias,'Numeric alias','packs']);
 assert.deepEqual(previewStock(h),['1','4']);assert.equal(writes(h).length,0);
 let state=await saveMaterial(h);assert.equal(state.items.length,4);assert.equal(state.items.find(item=>item.id===h.alias).quantity,4);
 assert.equal(state.items.find(item=>item.id===h.alias).barcode,aliasBarcode);assert.deepEqual([state.movements.at(-1).item_name,state.movements.at(-1).unit],['Numeric alias','packs']);
 fillMaterial(h,{name:'　９０ｍｍ　ＧＡＬＶＡＮＩＳＥＤ　ＮＡＩＬＳ　',unit:'boxes',quantity:2});await reviewMaterial(h);
 assert.equal(h.controller.currentDraft().itemId,h.nails);assert.deepEqual(previewStock(h),['0','2']);state=await saveMaterial(h);
 assert.equal(state.items.length,4);assert.deepEqual([state.items.find(item=>item.id===h.nails).name,state.items.find(item=>item.id===h.nails).barcode],['90mm Galvanised Nails',barcode]);
 fillMaterial(h,{name:' numeric　alias ',unit:'bags',quantity:5});await reviewMaterial(h);
 assert.equal(h.controller.currentDraft().itemId,null);assert.deepEqual(previewStock(h),['0','5']);state=await saveMaterial(h);
 const separate=state.items.find(item=>item.unit==='bags');assert.ok(separate);assert.notEqual(separate.id,h.alias);assert.equal(separate.quantity,5);
 assert.equal(state.items.length,5);assert.equal(state.items.find(item=>item.id===h.alias).quantity,4);
});

test('A new code for a matching material becomes a hidden searchable alias and works for scanning, taking, returning and restocking',async t=>{
 const code='0005901234123001',lookalike='5901234123001';
 const h=await app(t,{setup:async f=>{f.lookalike=(await f.store.request('items',{name:'Alias lookalike',barcode:lookalike,unit:'pieces'})).id;await f.store.request('movements',move(f.lookalike,'STOCK_IN',1));}});
 fillMaterial(h,{name:' ９０ｍｍ　Galvanised  NAILS ',unit:'boxes',barcode:code,quantity:4});await reviewMaterial(h);
 assert.equal(h.controller.currentDraft().itemId,h.nails);assert.deepEqual(previewStock(h),['0','4']);assert.equal(writes(h).length,0);
 let state=await saveMaterial(h),item=state.items.find(item=>item.id===h.nails);
 assert.equal(state.items.length,5);assert.equal(item.barcode,barcode);assert.ok(item.barcode_aliases.includes(code));assert.equal(item.quantity,4);
 h.document.input('inventory-search',code);assert.deepEqual(stockIds(h),[h.nails]);assert.equal(stockRows(h).length,1);
 assert.equal(stockRows(h)[0].textContent.includes(code),false);assert.equal(stockRows(h)[0].textContent.includes(barcode),false);h.document.input('inventory-search','');
 for(const [scanCode,itemId,name,unit] of [[code,h.nails,'90mm Galvanised Nails','boxes'],[lookalike,h.lookalike,'Alias lookalike','pieces']]){
  fillMaterial(h,{quantity:3});await h.controller.startCamera();await h.scanners.at(-1).options.onCode(scanCode);
  assert.equal(h.document.querySelector('#item-existing').value,itemId);assert.equal(h.document.querySelector('#item-name').value,name);
  assert.equal(h.document.querySelector('#item-unit').value,unit);assert.equal(h.document.querySelector('#item-qty').value,'3');
  assert.equal(h.document.querySelector('#item-name').readOnly,true);assert.equal(h.document.querySelector('#item-unit').disabled,true);h.document.clickRendered('close');
 }
 h.document.click('stockout',{job:h.job});await h.controller.startCamera();await h.scanners.at(-1).options.onCode(code);
 await until(()=>h.controller.currentDraft()?.step===2);assert.equal(h.controller.currentDraft().itemId,h.nails);await confirmQuantity(h,2);h.document.clickRendered('done');
 h.navigate('job/'+h.job);h.document.clickRendered('return');await h.controller.startCamera();await h.scanners.at(-1).options.onCode(code);
 await until(()=>h.controller.currentDraft()?.step===2);assert.equal(h.controller.currentDraft().itemId,h.nails);await confirmQuantity(h,1);h.document.clickRendered('done');
 h.navigate('inventory');h.document.click('stockin');await h.controller.startCamera();await h.scanners.at(-1).options.onCode(code);
 await until(()=>h.controller.currentDraft()?.step===2);assert.equal(h.controller.currentDraft().itemId,h.nails);await confirmQuantity(h,2);
 state=await h.store.request('state');item=state.items.find(item=>item.id===h.nails);assert.equal(state.items.length,5);
 assert.equal(item.barcode,barcode);assert.ok(item.barcode_aliases.includes(code));assert.equal(item.quantity,5);assert.equal(state.items.find(item=>item.id===h.lookalike).quantity,1);
 assert.deepEqual(state.movements.filter(movement=>movement.item_id===h.nails).slice(-4).map(movement=>[movement.type,movement.quantity,movement.before,movement.after]),[['STOCK_IN',4,0,4],['TAKEN_TO_JOB',2,4,2],['RETURNED_TO_WORKSHOP',1,2,3],['STOCK_IN',2,3,5]]);
 assert.ok((await h.store.request('export')).items.find(item=>item.id===h.nails).barcode_aliases.includes(code));
});

test('A stale selection or a selected material with another saved barcode cannot advance or write stock',async t=>{
 const h=await app(t),before=await h.store.request('state');fillMaterial(h,{quantity:2});h.document.change('item-existing',h.nails);
 h.document.input('item-barcode',aliasBarcode);h.forceSubmit();await until(()=>h.controller.currentDraft()?.error);
 assert.equal(h.controller.currentDraft().step,1);assert.match(h.controller.currentDraft().error,/different material|correct material/i);assert.equal(writes(h).length,0);
 const staleId=crypto.randomUUID(),select=h.document.querySelector('#item-existing');
 select.innerHTML+='<option value="'+staleId+'">Stale saved material</option>';select.value=staleId;h.document.input('item-barcode',barcode);h.forceSubmit();
 assert.equal(h.controller.currentDraft().step,1);assert.match(h.controller.currentDraft().error,/saved material|dropdown/i);assert.equal(writes(h).length,0);
 assert.deepEqual(await h.store.request('state'),before);
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
