import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const barcode='0123456789012';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
async function flush(){for(let i=0;i<40;i++)await Promise.resolve();}
const decode=value=>value.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');

// Execute the actual app controller. This small DOM boundary models the modal,
// camera controls, and delegated events; camera streams and browser layout are
// separate boundaries and are not simulated as successful hardware tests.
class Element {
 constructor(document,tag='div',attributes={}){
  this.document=document;this.tagName=tag;this.children=[];this.style={};this.dataset={};
  this.id=attributes.id||'';this.name=attributes.name||'';this.value=attributes.value||'';
  this.className=attributes.class||'';this.role=attributes.role||'';this.textContent='';this.isConnected=true;
  this.classList={add(){},remove(){}};
  document.elements.add(this);if(this.id)document.nodes.set(this.id,this);
 }
 set innerHTML(value){
  this.html=value;for(const child of [...this.children])child.remove();
  // Bootstrap rendering is irrelevant to the camera boundary. Modal/control
  // rendering is parsed so selectors and removal operate on emitted elements.
  if(this.id==='app')return;
  for(const match of value.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)){
   const attributes={};for(const attribute of match[2].matchAll(/([\w-]+)="([^"]*)"/g))attributes[attribute[1]]=decode(attribute[2]);
   const child=new Element(this.document,match[1],attributes);child.parent=this;this.children.push(child);
  }
 }
 get innerHTML(){return this.html||'';}
 append(child){if(child.parent)child.parent.children=child.parent.children.filter(value=>value!==child);child.parent=this;child.isConnected=true;this.children.push(child);}
 remove(){for(const child of [...this.children])child.remove();this.children=[];this.isConnected=false;this.document.elements.delete(this);if(this.document.nodes.get(this.id)===this)this.document.nodes.delete(this.id);if(this.parent)this.parent.children=this.parent.children.filter(value=>value!==this);}
 matches(selector){if(selector.startsWith('#'))return this.id===selector.slice(1);if(selector.startsWith('.'))return this.className.split(' ').includes(selector.slice(1));if(selector==='[role="status"]')return this.role==='status';return this.tagName===selector;}
 querySelector(selector){return this.children.find(child=>child.matches(selector))||null;}
 setAttribute(name,value){if(name==='aria-hidden')this.hidden=value;}
 focus(){this.document.activeElement=this;}
 blur(){}
 requestSubmit(){this.document.dispatch('submit',{target:this,preventDefault(){}});}
}
class Document {
 constructor(){
  this.nodes=new Map();this.elements=new Set();this.handlers=new Map();this.hidden=false;
  this.body=new Element(this);this.activeElement=new Element(this);
  for(const id of ['app','modal-root','toast'])new Element(this,'div',{id});
 }
 addEventListener(name,handler){if(!this.handlers.has(name))this.handlers.set(name,[]);this.handlers.get(name).push(handler);}
 dispatch(name,event){for(const handler of this.handlers.get(name)||[])handler(event);}
 querySelector(selector){if(selector.startsWith('#'))return this.nodes.get(selector.slice(1))||null;return [...this.elements].find(element=>element.matches(selector))||null;}
 querySelectorAll(){return [];}
 click(action){const target={dataset:{action},closest(){return this;}};this.dispatch('click',{target});}
 changeCamera(id){const target=this.nodes.get('scan-camera');assert.ok(target,'The actual app must render its camera selector');target.value=id;this.dispatch('change',{target});}
}

async function app({preference=''}={}){
 const document=new Document(),plans=[],scanners=[],writes=[],active=new Set(),apiCalls=[];
 const state={items:[{id:'nails-item',name:'Nails',barcode,unit:'boxes',quantity:5}],jobs:[],movements:[],user:{name:'Eryk',configured:true}};
 const window={addEventListener(){}};
 const collaborators={
  document,window,console,crypto,URL,Intl,Date,
  location:{href:'https://workshop.test/Inventory/',hash:''},
  setTimeout(){return 1;},clearTimeout(){},
  phoneInventory:{async request(path){apiCalls.push(path);if(path==='state')return state;throw new Error('Unexpected stock mutation '+path);}},
  prepareOffline(){},isAndroidApp:()=>false,androidBackup(){throw new Error('Unexpected native backup');},
  readCameraPreference:()=>preference,saveCameraPreference:id=>{writes.push(id);preference=id;},
  cameraError:error=>error.message||String(error),
  createCameraScanner(options){
   const plan=plans.shift()||{},id=options.cameraId;
   const scanner={options,id,stops:0,choicesCalls:0};
   scanner.ready=(async()=>{if(plan.ready)await plan.ready.promise;if(plan.error)throw plan.error;active.add(scanner);})();
   scanner.stop=()=>{
    scanner.stops++;
    if(!scanner.closing)scanner.closing=(async()=>{try{await scanner.ready;}catch{}if(plan.stop)await plan.stop.promise;active.delete(scanner);})();
    return scanner.closing;
   };
   scanner.cameraChoices=()=>{scanner.choicesCalls++;return plan.choices?.promise||Promise.resolve({cameras:[{id:id||'rear-default',label:'Rear camera'}],selectedId:id||'rear-default'});};
   scanners.push(scanner);return scanner;
  },
  FormData:class{
   constructor(){this.entries=[...document.nodes.values()].filter(element=>element.name).map(element=>[element.name,element.value]);}
   get(name){return this.entries.find(entry=>entry[0]===name)?.[1]??null;}
   [Symbol.iterator](){return this.entries[Symbol.iterator]();}
  },
 };
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'');
 const controller=vm.runInNewContext(source+'\n;({startCamera,stopCamera,closeModal,openMove,currentDraft:()=>draft});',collaborators,{filename:'app.js'});
 await flush();document.click('newitem');
 return {document,controller,scanners,writes,active,apiCalls,plan:value=>plans.push(value),get preference(){return preference;}};
}

test('Rapid camera changes release the old stream before starting only the latest selection',async()=>{
 const h=await app(),oldStop=deferred();h.plan({stop:oldStop});
 await h.controller.startCamera('wide',true);await flush();
 h.document.changeCamera('front');await flush();h.document.changeCamera('main');await flush();
 assert.deepEqual(h.scanners.map(scanner=>scanner.id),['wide']);assert.equal(h.active.size,1);
 oldStop.resolve();await flush();
 assert.deepEqual(h.scanners.map(scanner=>scanner.id),['wide','main']);
 assert.deepEqual(h.writes,['wide','main']);assert.equal(h.active.size,1);assert.equal(h.scanners[0].stops,1);
 await h.scanners[0].options.onCode('late-old-camera');
 assert.equal(h.document.querySelector('#item-barcode').value,'');
 assert.equal(h.controller.currentDraft().barcode,undefined);
 await h.controller.stopCamera();assert.equal(h.active.size,0);
});

test('Closing a pending camera selection cannot add controls to the next modal',async()=>{
 const h=await app(),choices=deferred();h.plan({choices});
 await h.controller.startCamera();assert.equal(h.scanners[0].choicesCalls,1);
 h.controller.closeModal();h.document.click('newjob');const next=h.document.querySelector('#modal-root').innerHTML;
 choices.resolve({cameras:[{id:'late',label:'Late camera'}],selectedId:'late'});await flush();
 assert.equal(h.document.querySelector('#modal-root').innerHTML,next);assert.equal(h.document.querySelector('#scan-camera'),null);
 assert.deepEqual(h.writes,[]);assert.equal(h.active.size,0);
});

test('Scan completion advances the real movement form and ignores delayed camera enumeration',async()=>{
 const h=await app(),choices=deferred();h.controller.openMove('STOCK_IN');h.plan({choices});
 await h.controller.startCamera();await h.scanners[0].options.onCode(barcode);await flush();
 assert.equal(h.controller.currentDraft().step,2);assert.equal(h.controller.currentDraft().barcode,barcode);
 const quantityModal=h.document.querySelector('#modal-root').innerHTML;
 choices.resolve({cameras:[{id:'late',label:'Late camera'}],selectedId:'late'});await flush();
 assert.equal(h.document.querySelector('#modal-root').innerHTML,quantityModal);assert.equal(h.document.querySelector('#scan-camera'),null);
 assert.deepEqual(h.apiCalls,['state']);assert.equal(h.active.size,0);
});

test('An unavailable saved device falls back once and clears its preference only after Auto starts',async()=>{
 const h=await app({preference:'retired'}),ready=deferred();
 h.plan({error:new DOMException('Device unavailable','NotFoundError')});h.plan({ready});
 const startup=h.controller.startCamera();await flush();
 assert.deepEqual(h.scanners.map(scanner=>scanner.id),['retired','']);assert.deepEqual(h.writes,[]);
 ready.resolve();await startup;assert.deepEqual(h.writes,['']);assert.equal(h.preference,'');
 await h.controller.stopCamera();
});

test('Choosing Auto through the rendered selector clears a saved preference only after startup succeeds',async()=>{
 const h=await app({preference:'main'}),ready=deferred();
 await h.controller.startCamera();await flush();h.plan({ready});h.document.changeCamera('');await flush();
 assert.deepEqual(h.scanners.map(scanner=>scanner.id),['main','']);assert.deepEqual(h.writes,[]);assert.equal(h.preference,'main');
 ready.resolve();await flush();assert.deepEqual(h.writes,['']);assert.equal(h.preference,'');
 await h.controller.stopCamera();
});

test('An unavailable Auto fallback does not trigger another retry or overwrite the saved preference',async()=>{
 const h=await app({preference:'retired'});
 h.plan({error:new DOMException('Saved camera unavailable','NotFoundError')});h.plan({error:new DOMException('No camera available','NotFoundError')});
 await h.controller.startCamera();
 assert.deepEqual(h.scanners.map(scanner=>scanner.id),['retired','']);assert.deepEqual(h.writes,[]);assert.equal(h.preference,'retired');
 assert.equal(h.active.size,0);assert.match(h.document.querySelector('#camera-area').innerHTML,/No camera available/);
});

test('Permission failure never retries another camera or changes the saved selection',async()=>{
 const h=await app({preference:'original'});h.plan({error:new DOMException('Permission denied','NotAllowedError')});
 await h.controller.startCamera('main',true);
 assert.deepEqual(h.scanners.map(scanner=>scanner.id),['main']);assert.deepEqual(h.writes,[]);assert.equal(h.preference,'original');
 assert.equal(h.active.size,0);assert.match(h.document.querySelector('#camera-area').innerHTML,/Permission denied/);
});

test('Closing while a selected camera starts suppresses late preference and UI writes',async()=>{
 const h=await app({preference:'original'}),ready=deferred();h.plan({ready});
 const startup=h.controller.startCamera('main',true);await flush();
 h.controller.closeModal();h.document.click('newjob');const next=h.document.querySelector('#modal-root').innerHTML;
 ready.resolve();await startup;await h.controller.stopCamera();await flush();
 assert.deepEqual(h.writes,[]);assert.equal(h.preference,'original');assert.equal(h.active.size,0);
 assert.equal(h.document.querySelector('#modal-root').innerHTML,next);
});

test('A newer selection supersedes stale-device fallback while failed-stream cleanup is pending',async()=>{
 const h=await app({preference:'retired'}),stop=deferred();h.plan({error:new DOMException('Device unavailable','OverconstrainedError'),stop});
 const stale=h.controller.startCamera();await flush();const selected=h.controller.startCamera('main',true);await flush();
 assert.deepEqual(h.scanners.map(scanner=>scanner.id),['retired']);stop.resolve();await stale;await selected;
 assert.deepEqual(h.scanners.map(scanner=>scanner.id),['retired','main']);assert.deepEqual(h.writes,['main']);
 await h.controller.stopCamera();
});
