import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import vm from 'node:vm';
import * as phoneStorage from '../public/phone-store.js';
import {IDBFactory,IDBKeyRange} from './vendor/fake-indexeddb/esm/index.js';

const origin='https://workshop.test';
const project=new URL('/Inventory/',origin);

function assetFile(directory,value,base=project){
 const url=new URL(value,base);
 assert.equal(url.origin,project.origin,'App assets must remain on the app origin');
 assert.ok(url.pathname.startsWith(project.pathname),`${url.href} escapes the Pages project path`);
 const relative=url.pathname.slice(project.pathname.length)||'index.html';
 const filename=join(directory,relative);
 assert.ok(existsSync(filename),`Missing project asset: ${filename}`);
 return {url,filename};
}

test('Source and built HTML, module imports, and manifest assets resolve inside /Inventory/',()=>{
 for(const directory of ['public','dist/client']){
  const html=readFileSync(join(directory,'index.html'),'utf8');
  const resources=[...html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)].map(match=>match[1]);
  assert.ok(resources.length>=6);
  for(const resource of resources)assetFile(directory,resource);
  for(const moduleName of ['app.js','phone-store.js','scanner.js','offline.js','android-bridge.js']){
   const moduleUrl=new URL(moduleName,project);
   const source=readFileSync(join(directory,moduleName),'utf8');
   const imports=[...source.matchAll(/^\s*import\s+(?:[^'";]*?\s+from\s*)?["']([^"']+)["']/gm)].map(match=>match[1]);
   for(const imported of imports)assetFile(directory,imported,moduleUrl);
  }
  const manifestUrl=new URL('manifest.webmanifest',project);
  const manifest=JSON.parse(readFileSync(join(directory,'manifest.webmanifest'),'utf8'));
  assert.equal(new URL(manifest.start_url,manifestUrl).href,project.href);
  assert.equal(new URL(manifest.scope,manifestUrl).href,project.href);
  assert.equal(Object.hasOwn(manifest,'id'),false,'The project must not claim the origin-root app identity');
  for(const icon of manifest.icons)assetFile(directory,icon.src,manifestUrl);
 }
});

test('Root and native deployments retain the legacy database name and existing inventory records',async()=>{
 assert.equal(typeof phoneStorage.phoneDatabaseName,'function');
 assert.equal(phoneStorage.phoneDatabaseName(origin+'/phone-store.js'),'workshop-phone-v1');
 assert.equal(phoneStorage.phoneDatabaseName('https://workshop.local/phone-store.js'),'workshop-phone-v1');
 const indexedDB=new IDBFactory();
 const legacy=phoneStorage.createPhoneStore({indexedDB,IDBKeyRange});
 await legacy.request('operator',{name:'Eryk'});
 const item=await legacy.request('items',{name:'90mm Nails',barcode:'12345',unit:'boxes'});
 await legacy.request('movements',{id:crypto.randomUUID(),itemId:item.id,type:'STOCK_IN',quantity:7});
 const before=await legacy.request('state');await legacy.close();
 for(const moduleUrl of [origin+'/phone-store.js','https://workshop.local/phone-store.js']){
  const reopened=phoneStorage.createPhoneStore({indexedDB,IDBKeyRange,databaseName:phoneStorage.phoneDatabaseName(moduleUrl)});
  try{assert.deepEqual(await reopened.request('state'),before);}finally{await reopened.close();}
 }
});

test('Project databases isolate materials, user names, and audit history from the root and sibling projects',async()=>{
 assert.equal(typeof phoneStorage.phoneDatabaseName,'function');
 const indexedDB=new IDBFactory();
 const names=['/','/Inventory/','/Other/'].map(base=>phoneStorage.phoneDatabaseName(origin+base+'phone-store.js'));
 assert.deepEqual(names,['workshop-phone-v1','workshop-phone-v1:/Inventory/','workshop-phone-v1:/Other/']);
 const stores=names.map(databaseName=>phoneStorage.createPhoneStore({indexedDB,IDBKeyRange,databaseName}));
 try{
  for(const [index,quantity] of [[0,7],[1,3]]){
   const store=stores[index];await store.request('operator',{name:index?'Project operator':'Root operator'});
   const item=await store.request('items',{name:'Nails',barcode:'same-barcode',unit:'boxes'});
   await store.request('movements',{id:crypto.randomUUID(),itemId:item.id,type:'STOCK_IN',quantity});
  }
  const root=await stores[0].request('state'),inventory=await stores[1].request('state'),other=await stores[2].request('state');
  assert.equal(root.items[0].quantity,7);assert.equal(root.user.name,'Root operator');
  assert.equal(inventory.items[0].quantity,3);assert.equal(inventory.user.name,'Project operator');
  assert.notEqual(root.movements[0].id,inventory.movements[0].id);
  assert.equal(other.items.length,0);assert.equal(other.movements.length,0);assert.equal(other.user.configured,false);
  await stores[1].close();
  const reopened=phoneStorage.createPhoneStore({indexedDB,IDBKeyRange,databaseName:names[1]});
  try{assert.deepEqual(await reopened.request('state'),inventory);}finally{await reopened.close();}
 }finally{for(const store of stores)await store.close();}
});

test('The production singleton chooses storage from its deployed module URL',async()=>{
 assert.equal(typeof phoneStorage.phoneDatabaseName,'function');
 const indexedDB=new IDBFactory();
 const evaluate=moduleUrl=>{
  const source=readFileSync('public/phone-store.js','utf8').replace(/\bexport\s+/g,'').replace(/import\.meta\.url/g,JSON.stringify(moduleUrl));
  return vm.runInNewContext(source+'\nphoneInventory;',{indexedDB,IDBKeyRange,crypto,URL,TextEncoder});
 };
 const root=evaluate(origin+'/phone-store.js'),inventory=evaluate(project.href+'phone-store.js');
 try{
  await root.request('operator',{name:'Root user'});
  await root.request('items',{name:'Root material',barcode:'root-only',unit:'boxes'});
  const projectState=await inventory.request('state');
  assert.equal(projectState.items.length,0);assert.equal(projectState.user.configured,false);
  await inventory.request('operator',{name:'Inventory user'});
  assert.equal((await root.request('state')).user.name,'Root user');
 }finally{await root.close();await inventory.close();}
});

function workerHarness(scope,storage=new Map()){
 const handlers=new Map(),requested=[];let skipped=false,claimed=false,networkCalls=0;
 const key=value=>new URL(typeof value==='string'?value:value.url,scope).href;
 const caches={
  async open(name){
   if(!storage.has(name))storage.set(name,new Map());
   const entries=storage.get(name);
   return {
    async addAll(requests){
     const responses=requests.map(request=>{
      const url=new URL(request.url);requested.push(url.href);
      assert.equal(url.origin,origin);
      assert.ok(url.pathname.startsWith(new URL(scope).pathname),`${url.href} escapes service-worker scope`);
      const relative=url.pathname.slice(new URL(scope).pathname.length)||'index.html';
      const filename=join('dist/client',relative);
      assert.ok(existsSync(filename),`Missing scoped offline asset ${url.href}`);
      return [key(request),new Response(readFileSync(filename))];
     });
     for(const [url,response] of responses)entries.set(url,response);
    },
    async match(request){return entries.get(key(request))?.clone();},
   };
  },
  async keys(){return [...storage.keys()];},
  async delete(name){return storage.delete(name);},
 };
 class ScopedRequest extends Request{constructor(path,options){super(new URL(path,scope),options);}}
 const self={
  location:{origin,href:new URL('sw.js',scope).href},registration:{scope},
  addEventListener(name,handler){handlers.set(name,handler);},
  async skipWaiting(){skipped=true;},clients:{async claim(){claimed=true;}},
 };
 vm.runInNewContext(readFileSync('dist/client/sw.js','utf8'),{
  self,caches,Request:ScopedRequest,URL,
  fetch:async()=>{networkCalls++;throw new Error('Offline');},
 });
 async function lifetime(name,extra={}){
  let completion;handlers.get(name)({...extra,waitUntil(promise){completion=promise;}});await completion;
 }
 return {
  storage,requested,get networkCalls(){return networkCalls;},
  async install(){await lifetime('install');assert.equal(skipped,true);},
  async activate(){await lifetime('activate');assert.equal(claimed,true);},
  async status(){let message;await lifetime('message',{data:{type:'OFFLINE_STATUS'},ports:[{postMessage(value){message=value;}}]});return message;},
  async fetch(path,mode='cors',method='GET'){
   let response;
   handlers.get('fetch')({request:{url:new URL(path,scope).href,method,mode},respondWith(promise){response=promise;}});
   return response;
  },
 };
}

test('The Pages service worker caches its project entry and decoder and serves both without network access',async()=>{
 const h=workerHarness(project.href);await h.install();
 assert.equal((await h.status()).ready,true);
 assert.ok(h.requested.every(url=>new URL(url).pathname.startsWith('/Inventory/')));
 const entry=await h.fetch('/Inventory/','navigate');assert.match(await entry.text(),/Workshop/);
 const navigation=await h.fetch('/Inventory/job/123','navigate');assert.match(await navigation.text(),/Workshop/);
 const decoder=await h.fetch('/Inventory/vendor/html5-qrcode.min.js');assert.ok((await decoder.text()).length>300000);
 const database=await h.fetch('/Inventory/phone-store.js');assert.match(await database.text(),/indexedDB/);
 assert.equal(h.networkCalls,0);
 for(const path of ['/','/Other/','/Inventory-other/','https://another.test/Inventory/']){
  assert.equal(await h.fetch(path,'navigate'),undefined,`Must not intercept ${path}`);
 }
 assert.equal(await h.fetch('/Inventory/','cors','POST'),undefined);
});

test('Activating a project update removes only its old caches and preserves root and sibling offline apps',async()=>{
 const storage=new Map();
 const root=workerHarness(origin+'/',storage);await root.install();
 const rootKeys=[...storage.keys()];
 const sibling=workerHarness(origin+'/Other/',storage);await sibling.install();
 const otherKeys=[...storage.keys()].filter(name=>!rootKeys.includes(name));assert.equal(otherKeys.length,1);
 const projectWorker=workerHarness(project.href,storage);await projectWorker.install();
 const projectKeys=[...storage.keys()].filter(name=>!rootKeys.includes(name)&&!otherKeys.includes(name));assert.equal(projectKeys.length,1);
 const oldProject=projectKeys[0]+':previous-build';storage.set(oldProject,new Map());
 const legacyRoot='workshop-phone-legacy-root';storage.set(legacyRoot,new Map());
 storage.set('unrelated-offline-app',new Map());
 await projectWorker.activate();
 assert.equal(storage.has(oldProject),false);
 for(const name of [...rootKeys,...otherKeys,...projectKeys,legacyRoot,'unrelated-offline-app']){
  assert.equal(storage.has(name),true,`Project update must preserve ${name}`);
 }
 assert.equal((await root.status()).ready,true);
 assert.equal((await sibling.status()).ready,true);
 assert.equal((await projectWorker.status()).ready,true);
});
