import test from 'node:test';
import assert from 'node:assert/strict';
import * as cameraModule from '../public/scanner.js';

async function flush(){for(let i=0;i<20;i++)await Promise.resolve();}
async function settled(promise,message){
 let completed=false;
 promise.then(()=>{completed=true;},()=>{completed=true;});
 await flush();assert.equal(completed,true,message);return promise;
}

function harness({devices=[],enumerate,enumerationAvailable=true,settings={deviceId:'active-camera'},capabilities={},applyConstraints}={}){
 const readers=[];let enumerationCalls=0,legacyEnumerationCalls=0,time=0;
 class Reader{
  constructor(){readers.push(this);this.isScanning=false;this.stops=0;this.clears=0;this.applied=[];}
  async start(selection,options,success){this.selection=selection;this.success=success;this.isScanning=true;}
  getRunningTrackSettings(){return settings;}
  getRunningTrackCapabilities(){if(capabilities instanceof Error)throw capabilities;return capabilities;}
  applyVideoConstraints(constraints){
   assert.equal(this.isScanning,true,'Focus constraints must be applied after camera startup');
   this.applied.push(constraints);return applyConstraints?applyConstraints(constraints):Promise.resolve();
  }
  async stop(){this.stops++;this.isScanning=false;}
  clear(){this.clears++;}
  static getCameras(){legacyEnumerationCalls++;throw new Error('Use mediaDevices.enumerateDevices without opening another stream');}
 }
 const mediaDevices={getUserMedia(){throw new Error('The reader owns camera startup');}};
 if(enumerationAvailable)mediaDevices.enumerateDevices=async()=>{enumerationCalls++;return enumerate?enumerate():devices;};
 const browser={
  isSecureContext:true,navigator:{mediaDevices},performance:{now:()=>time},Html5Qrcode:Reader,
  Html5QrcodeSupportedFormats:{CODE_128:1,CODE_39:2,EAN_13:3,EAN_8:4,UPC_A:5,UPC_E:6,ITF:7,QR_CODE:8},
 };
 return {
  browser,readers,get enumerationCalls(){return enumerationCalls;},get legacyEnumerationCalls(){return legacyEnumerationCalls;},
  open(cameraId){
   const values=[];
   const scanner=cameraModule.createCameraScanner({hostId:'scan',cameraId,onCode:value=>values.push(value),browser});
   return {scanner,values,reader:readers.at(-1)};
  },
  emit(reader,code,at){time=at;reader.success(code,{decodedText:code,result:{text:code,format:{formatName:'EAN_13'}}});},
 };
}

test('An explicit camera ID starts that exact device; the default continues to request the rear camera',async()=>{
 const h=harness();
 const selected=h.open('main-id');await selected.scanner.ready;
 assert.equal(selected.reader.selection,'main-id');await selected.scanner.stop();
 const automatic=h.open();await automatic.scanner.ready;
 assert.deepEqual(automatic.reader.selection,{facingMode:'environment'});await automatic.scanner.stop();
});

test('Camera choices use browser device enumeration, filter invalid entries, deduplicate IDs, and identify the running camera',async()=>{
 const h=harness({settings:{deviceId:'main-id'},devices:[
  {kind:'audioinput',deviceId:'microphone',label:'Mic'},
  {kind:'videoinput',deviceId:'main-id',label:'Back main'},
  {kind:'videoinput',deviceId:'wide-id',label:''},
  {kind:'videoinput',deviceId:'main-id',label:'Duplicate main'},
  {kind:'videoinput',deviceId:'',label:'Unavailable camera'},
  {kind:'videoinput',label:'Missing ID'},
 ]});
 const session=h.open('wide-id');assert.equal(h.enumerationCalls,0);await session.scanner.ready;
 try{
  assert.equal(typeof session.scanner.cameraChoices,'function');
  assert.deepEqual(await session.scanner.cameraChoices(),{
   cameras:[{id:'main-id',label:'Back main'},{id:'wide-id',label:'Camera 2'}],selectedId:'main-id',
  });
  assert.equal(h.enumerationCalls,1);assert.equal(h.legacyEnumerationCalls,0);
 }finally{await session.scanner.stop();}
});

test('The selected ID falls back to the requested camera when track settings do not include a device ID',async()=>{
 const h=harness({settings:{},devices:[{kind:'videoinput',deviceId:'main-id',label:'Main'}]});
 const session=h.open('main-id');await session.scanner.ready;
 try{assert.equal((await session.scanner.cameraChoices()).selectedId,'main-id');}finally{await session.scanner.stop();}
 const automatic=h.open();await automatic.scanner.ready;
 try{assert.equal((await automatic.scanner.cameraChoices()).selectedId,'');}finally{await automatic.scanner.stop();}
});

test('Unavailable or rejected device enumeration is nonfatal and returns no camera choices',async()=>{
 for(const options of [{enumerationAvailable:false},{enumerate:()=>{throw new DOMException('Device list denied','NotAllowedError');}}]){
  const h=harness(options),session=h.open();await session.scanner.ready;
  try{
   assert.deepEqual((await session.scanner.cameraChoices()).cameras,[]);
   h.emit(session.reader,'5901234123457',0);h.emit(session.reader,'5901234123457',150);h.emit(session.reader,'5901234123457',300);
   assert.deepEqual(session.values,['5901234123457']);
  }finally{await session.scanner.stop();}
 }
});

test('A camera that advertises continuous focus receives the best-effort focus constraint after startup',async()=>{
 const h=harness({capabilities:{focusMode:['manual','continuous']}}),session=h.open();await session.scanner.ready;
 assert.deepEqual(session.reader.applied,[{advanced:[{focusMode:'continuous'}]}]);
 await session.scanner.stop();
});

test('Unsupported or inaccessible focus capabilities do not prevent camera startup and trigger no focus request',async()=>{
 for(const capabilities of [{},{focusMode:['manual']},new Error('Capabilities unsupported')]){
  const h=harness({capabilities}),session=h.open();await session.scanner.ready;
  assert.deepEqual(session.reader.applied,[]);await session.scanner.stop();
 }
});

test('A rejected autofocus request is nonfatal; a pending request cannot block readiness or camera shutdown',async()=>{
 for(const applyConstraints of [()=>Promise.reject(new Error('Focus rejected')),()=>new Promise(()=>{})]){
  const h=harness({capabilities:{focusMode:['continuous']},applyConstraints}),session=h.open();
  await settled(session.scanner.ready,'Autofocus must not block scanner readiness');
  assert.equal(session.reader.applied.length,1);
  await settled(session.scanner.stop(),'Autofocus must not block camera shutdown');
  assert.equal(session.reader.stops,1);assert.equal(session.reader.clears,1);
 }
});

test('Camera preferences persist by deployment path, isolate root and sibling apps, and support clearing a choice',()=>{
 assert.equal(typeof cameraModule.readCameraPreference,'function');assert.equal(typeof cameraModule.saveCameraPreference,'function');
 const values=new Map();
 const browser={localStorage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}};
 const root='https://workshop.test/scanner.js',project='https://workshop.test/Inventory/scanner.js?v=2',sibling='https://workshop.test/Other/scanner.js';
 assert.equal(cameraModule.readCameraPreference(browser,project),'');
 cameraModule.saveCameraPreference('root-main',browser,root);cameraModule.saveCameraPreference('project-main',browser,project);
 assert.equal(values.get('workshop-camera-v1:/'),'root-main');assert.equal(values.get('workshop-camera-v1:/Inventory/'),'project-main');
 assert.equal(cameraModule.readCameraPreference(browser,root),'root-main');assert.equal(cameraModule.readCameraPreference(browser,project),'project-main');
 assert.equal(cameraModule.readCameraPreference(browser,sibling),'');
 cameraModule.saveCameraPreference('',browser,project);
 assert.equal(values.has('workshop-camera-v1:/Inventory/'),false);
 assert.equal(cameraModule.readCameraPreference(browser,project),'');assert.equal(cameraModule.readCameraPreference(browser,root),'root-main');
});

test('Unavailable or blocked preference storage cannot interrupt scanning or throw during reads, writes, or removal',()=>{
 assert.equal(typeof cameraModule.readCameraPreference,'function');assert.equal(typeof cameraModule.saveCameraPreference,'function');
 const blocked={localStorage:{getItem(){throw new Error('Storage denied');},setItem(){throw new Error('Storage denied');},removeItem(){throw new Error('Storage denied');}}};
 const deniedGetter={get localStorage(){throw new Error('Storage denied');}};
 for(const browser of [{},blocked,deniedGetter]){
  const moduleUrl='https://workshop.test/Inventory/scanner.js';
  assert.equal(cameraModule.readCameraPreference(browser,moduleUrl),'');
  assert.doesNotThrow(()=>cameraModule.saveCameraPreference('main-id',browser,moduleUrl));
  assert.doesNotThrow(()=>cameraModule.saveCameraPreference('',browser,moduleUrl));
 }
});

test('Canceled scanners do not enumerate devices and discard late enumeration results without blocking stop',async()=>{
 const stoppedHarness=harness(),stopped=stoppedHarness.open();await stopped.scanner.ready;await stopped.scanner.stop();
 assert.deepEqual(await stopped.scanner.cameraChoices(),{cameras:[],selectedId:''});assert.equal(stoppedHarness.enumerationCalls,0);
 let release;const devices=new Promise(resolve=>release=resolve);
 const h=harness({enumerate:()=>devices}),session=h.open('old-id');await session.scanner.ready;
 const choices=session.scanner.cameraChoices();await flush();assert.equal(h.enumerationCalls,1);
 await settled(session.scanner.stop(),'Pending device enumeration must not block camera shutdown');
 release([{kind:'videoinput',deviceId:'late-id',label:'Late camera'}]);
 assert.deepEqual(await choices,{cameras:[],selectedId:''});
 assert.equal(session.reader.stops,1);assert.equal(session.reader.clears,1);
});

test('A camera switch ignores decoder callbacks from the closed session and confirms only the new session',async()=>{
 const h=harness(),old=h.open('old-id');await old.scanner.ready;
 h.emit(old.reader,'5901234123457',0);h.emit(old.reader,'5901234123457',150);await old.scanner.stop();
 const current=h.open('main-id');await current.scanner.ready;
 try{
  h.emit(old.reader,'5901234123457',300);h.emit(old.reader,'5901234123457',450);h.emit(old.reader,'5901234123457',600);
  assert.deepEqual(old.values,[]);assert.deepEqual(current.values,[]);
  h.emit(current.reader,'4006381333931',700);h.emit(current.reader,'4006381333931',850);assert.deepEqual(current.values,[]);
  h.emit(current.reader,'4006381333931',1000);assert.deepEqual(current.values,['4006381333931']);
  assert.equal(current.reader.selection,'main-id');
 }finally{await current.scanner.stop();}
});
