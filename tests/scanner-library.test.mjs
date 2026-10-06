import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import vm from 'node:vm';
import {createCameraScanner} from '../public/scanner.js';

const source=readFileSync(new URL('../public/vendor/html5-qrcode.min.js',import.meta.url),'utf8');
const mediaBoundary='test: browser camera permission boundary reached';

// Execute the real pinned library. Replace only the DOM host and the browser
// permission boundary; no camera or rendering success is simulated.
function libraryBrowser(){
 const calls=[];
 const host={style:{},clientWidth:320,innerHTML:''};
 const browser={console,performance,isSecureContext:true,
  document:{getElementById:id=>id==='scan'?host:null},
  navigator:{mediaDevices:{getUserMedia(constraints){
   calls.push(JSON.parse(JSON.stringify(constraints)));
   return Promise.reject(new DOMException(mediaBoundary,'NotAllowedError'));
  }}}
 };
 browser.window=browser;
 vm.createContext(browser);
 vm.runInContext(source,browser,{filename:'html5-qrcode.min.js'});
 return {browser,calls};
}

test('Camera start reaches the real library media boundary with a rear-camera preference',async()=>{
 const {browser,calls}=libraryBrowser();
 const scanner=createCameraScanner({hostId:'scan',onCode(){},browser});
 try{
  // The only expected failure is the fake browser permission response. The
  // reported facingMode validation error must never occur before that boundary.
  await assert.rejects(scanner.ready,error=>{
   assert.ok(String(error).includes(mediaBoundary),String(error));
   return true;
  });
  assert.equal(calls.length,1,'Camera permission must reach getUserMedia.');
  assert.equal(calls[0].audio,false);
  // A DOM facingMode string is a preference; an exact constraint would forbid
  // the browser choosing an available camera when a rear camera is unavailable.
  assert.equal(calls[0].video.facingMode,'environment');
  assert.equal(calls[0].video.deviceId,undefined);
 }finally{
  await scanner.stop();
 }
});

test('An explicit lens reaches the real library media boundary as an exact device ID',async()=>{
 const {browser,calls}=libraryBrowser();
 const scanner=createCameraScanner({hostId:'scan',cameraId:'main-rear-lens',onCode(){},browser});
 try{
  await assert.rejects(scanner.ready,error=>String(error).includes(mediaBoundary));
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0],{audio:false,video:{deviceId:{exact:'main-rear-lens'}}});
 }finally{await scanner.stop();}
});

test('The pinned library rejects the unsupported ideal shortcut with the reported error',async()=>{
 const {browser,calls}=libraryBrowser();
 const reader=new browser.Html5Qrcode('scan',{verbose:false});
 await assert.rejects(reader.start({facingMode:{ideal:'environment'}},{fps:10},()=>{},()=>{}),error=>{
  assert.equal(String(error),"'facingMode' should be string or object with exact as key.");
  return true;
 });
 assert.equal(calls.length,0,'The reported failure occurs before browser camera permission.');
 reader.clear();
});
