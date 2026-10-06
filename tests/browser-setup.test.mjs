import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareOffline} from '../public/offline.js';

const preparing='Preparing offline use…';
const ready='Ready offline · saved on this phone';
const failed='Offline setup failed. Reopen while online.';

async function flush(){for(let i=0;i<12;i++)await Promise.resolve();}
async function settled(task){
 let finished=false;
 task.then(()=>{finished=true;});
 await flush();
 assert.equal(finished,true,'Offline setup must settle without waiting indefinitely');
 await task;
}

function browserHarness({reply=true,secure=true,initialState='installing'}={}){
 const timers=new Map(),channels=[],registrationCalls=[],messages=[];
 let timerId=0,persistCalls=0,readyReads=0;
 class Port extends EventTarget{
  closed=false;onmessage=null;
  postMessage(data){
   const target=this.peer;
   queueMicrotask(()=>{
    if(this.closed||target.closed)return;
    const event=new MessageEvent('message',{data});
    target.onmessage?.(event);target.dispatchEvent(event);
   });
  }
  close(){this.closed=true;}
  start(){}
 }
 class Channel{
  constructor(){
   this.port1=new Port();this.port2=new Port();
   this.port1.peer=this.port2;this.port2.peer=this.port1;
   channels.push(this);
  }
 }
 const worker=new EventTarget();worker.state=initialState;
 worker.postMessage=(message,ports)=>{
  messages.push(message);
  if(reply!==null)ports[0].postMessage({ready:reply});
 };
 worker.advance=state=>{worker.state=state;worker.dispatchEvent(new Event('statechange'));};
 const registration=new EventTarget();
 Object.assign(registration,{installing:initialState==='installing'?worker:null,waiting:null,active:initialState==='activated'?worker:null});
 const serviceWorker=new EventTarget();
 serviceWorker.register=async(...parameters)=>{registrationCalls.push(parameters);return registration;};
 Object.defineProperty(serviceWorker,'ready',{get(){readyReads++;return new Promise(()=>{});}});
 const browser={
  location:{origin:'https://workshop.test'},isSecureContext:secure,MessageChannel:Channel,
  navigator:{serviceWorker,storage:{persist:async()=>{persistCalls++;return true;}}},
  setTimeout(callback,delay){const id=++timerId;timers.set(id,{callback,delay});return id;},
  clearTimeout(id){timers.delete(id);},
 };
 return {
  browser,worker,registration,registrationCalls,messages,channels,timers,
  get persistCalls(){return persistCalls;},get readyReads(){return readyReads;},
  fireTimer(delay){
   const timer=[...timers].find(([,entry])=>entry.delay===delay);
   assert.ok(timer,`Expected an outstanding ${delay}ms timeout`);
   timers.delete(timer[0]);timer[1].callback();
  },
 };
}

test('First browser installation waits for activation and advertises offline readiness only after the cache reply',async()=>{
 const h=browserHarness(),statuses=[];
 const task=prepareOffline(value=>statuses.push(value),h.browser);
 await flush();
 assert.deepEqual(h.registrationCalls,[['/sw.js',{scope:'/'}]]);
 assert.deepEqual(statuses,[preparing]);
 assert.equal(h.messages.length,0);

 h.registration.installing=null;h.registration.waiting=h.worker;h.worker.advance('installed');
 await flush();assert.equal(h.messages.length,0);
 h.registration.waiting=null;h.registration.active=h.worker;h.worker.advance('activating');
 await flush();assert.deepEqual(statuses,[preparing]);assert.equal(h.messages.length,0);
 h.worker.advance('activated');
 await settled(task);

 assert.deepEqual(h.messages,[{type:'OFFLINE_STATUS'}]);
 assert.deepEqual(statuses,[preparing,ready]);
 assert.equal(h.persistCalls,1);
 assert.equal(h.readyReads,0,'First installation must not depend on navigator.serviceWorker.ready');
 assert.equal(h.timers.size,0);
 assert.ok(h.channels[0].port1.closed&&h.channels[0].port2.closed);
});

test('A first installation that becomes redundant reports failure and settles without an active worker',async()=>{
 const h=browserHarness(),statuses=[];
 const task=prepareOffline(value=>statuses.push(value),h.browser);
 await flush();h.worker.advance('redundant');
 await settled(task);
 assert.deepEqual(statuses,[preparing,failed]);
 assert.equal(h.messages.length,0);
 assert.equal(h.channels.length,0);
 assert.equal(h.timers.size,0);
 assert.equal(h.persistCalls,0);
});

test('An active worker that never answers times out, reports failure, and closes both message ports',async()=>{
 const h=browserHarness({initialState:'activated',reply:null}),statuses=[];
 const task=prepareOffline(value=>statuses.push(value),h.browser);
 await flush();
 assert.deepEqual(h.messages,[{type:'OFFLINE_STATUS'}]);
 assert.deepEqual(statuses,[preparing]);
 assert.equal(h.channels[0].port1.closed,false);
 assert.equal(h.channels[0].port2.closed,false);
 h.fireTimer(5000);
 await settled(task);
 assert.deepEqual(statuses,[preparing,failed]);
 assert.ok(h.channels[0].port1.closed&&h.channels[0].port2.closed);
 assert.equal(h.channels[0].port1.onmessage,null);
 assert.equal(h.timers.size,0);
 assert.equal(h.persistCalls,0);
});

test('Insecure browser contexts show the fallback without registering a worker',async()=>{
 const h=browserHarness({secure:false}),statuses=[];
 await prepareOffline(value=>statuses.push(value),h.browser);
 assert.deepEqual(statuses,['Open the secure app link to enable offline use']);
 assert.equal(h.registrationCalls.length,0);
 assert.equal(h.channels.length,0);
 assert.equal(h.timers.size,0);
});

test('An incomplete cache is reported without claiming offline readiness or requesting persistence',async()=>{
 const h=browserHarness({initialState:'activated',reply:false}),statuses=[];
 await settled(prepareOffline(value=>statuses.push(value),h.browser));
 assert.deepEqual(statuses,[preparing,'Offline setup is incomplete. Reopen while online.']);
 assert.equal(h.persistCalls,0);
 assert.ok(h.channels[0].port1.closed&&h.channels[0].port2.closed);
 assert.equal(h.timers.size,0);
});

test('A registration with no worker eventually fails instead of waiting forever for serviceWorker.ready',async()=>{
 const h=browserHarness({initialState:null}),statuses=[];
 const task=prepareOffline(value=>statuses.push(value),h.browser);
 await flush();h.fireTimer(30000);
 await settled(task);
 assert.deepEqual(statuses,[preparing,failed]);
 assert.equal(h.readyReads,0);
 assert.equal(h.channels.length,0);
 assert.equal(h.timers.size,0);
});
