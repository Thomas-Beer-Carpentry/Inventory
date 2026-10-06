import test from 'node:test';
import assert from 'node:assert/strict';
import {createCameraScanner} from '../public/scanner.js';

const ean='5901234123457';
const otherEan='4006381333931';

function camera(startGate){
 let instance,time=0;
 const values=[],progress=[];
 class Reader{
  constructor(){instance=this;this.isScanning=false;this.stops=0;this.clears=0;}
  async start(camera,options,success,failure){
   this.success=success;this.failure=failure;
   if(startGate)await startGate;
   this.isScanning=true;
  }
  async stop(){this.stops++;this.isScanning=false;}
  clear(){this.clears++;}
 }
 const browser={
  isSecureContext:true,navigator:{mediaDevices:{getUserMedia(){}}},
  performance:{now:()=>time},Html5Qrcode:Reader,
  Html5QrcodeSupportedFormats:{CODE_128:1,CODE_39:2,EAN_13:3,EAN_8:4,UPC_A:5,UPC_E:6,ITF:7,QR_CODE:8},
 };
 const scanner=createCameraScanner({hostId:'scan',onCode:value=>values.push(value),onProgress:value=>progress.push(value),browser});
 return {
  scanner,values,progress,get instance(){return instance;},
  read(code,at,format='EAN_13'){
   time=at;
   instance.success(code,{decodedText:code,result:{text:code,format:{formatName:format}}});
  },
  noRead(at){time=at;instance.failure('No barcode decoded');},
 };
}

async function running(operation){
 const h=camera();await h.scanner.ready;
 try{await operation(h);}finally{await h.scanner.stop();}
 assert.ok(h.progress.every(value=>typeof value==='string'),'Progress must contain display messages, not confirmed barcode values');
}

test('A transient read cannot reach onCode; three independent matches over 250ms confirm exactly once',async()=>{
 await running(h=>{
  h.read(ean,0);assert.deepEqual(h.values,[]);
  h.read(ean,100);assert.deepEqual(h.values,[]);
  h.read(ean,249);assert.deepEqual(h.values,[]);
  h.read(ean,350);assert.deepEqual(h.values,[ean]);
  h.read(ean,500);h.read(otherEan,650);assert.deepEqual(h.values,[ean]);
 });
});

test('Conflicting digits reset confirmation rather than accumulating votes across different items',async()=>{
 await running(h=>{
  h.read(ean,0);h.read(ean,150);h.read(otherEan,300);
  h.read(ean,450);h.read(ean,600);assert.deepEqual(h.values,[]);
  h.read(ean,750);assert.deepEqual(h.values,[ean]);
 });
});

test('Equal text from different barcode formats is not an exact matching reading',async()=>{
 await running(h=>{
  const code='00012-Workshop';
  h.read(code,0,'CODE_128');h.read(code,150,'QR_CODE');h.read(code,300,'CODE_128');
  h.read(code,450,'CODE_128');assert.deepEqual(h.values,[]);
  h.read(code,600,'CODE_128');assert.deepEqual(h.values,[code]);
 });
});

test('A stale candidate resets after a gap greater than 1500ms',async()=>{
 await running(h=>{
  h.read(ean,0);h.read(ean,150);
  h.read(ean,1800);assert.deepEqual(h.values,[]);
  h.read(ean,1950);assert.deepEqual(h.values,[]);
  h.read(ean,2100);assert.deepEqual(h.values,[ean]);
 });
});

test('Ordinary frames without a decode do not immediately discard a matching candidate',async()=>{
 await running(h=>{
  h.read(ean,0);h.noRead(75);h.read(ean,150);h.noRead(225);
  assert.deepEqual(h.values,[]);h.read(ean,300);assert.deepEqual(h.values,[ean]);
 });
});

test('Same-instant and less-than-75ms callbacks cannot masquerade as independent readings',async()=>{
 await running(h=>{
  h.read(ean,0);h.read(ean,0);h.read(ean,0);h.read(ean,250);
  assert.deepEqual(h.values,[]);
  h.read(ean,500);assert.deepEqual(h.values,[ean]);
 });
 await running(h=>{
  h.read(ean,0);h.read(ean,74);h.read(ean,260);assert.deepEqual(h.values,[]);
  h.read(ean,400);assert.deepEqual(h.values,[ean]);
 });
});

test('Valid EAN and UPC readings retain their exact digits, including leading zeros',async()=>{
 const fixtures=[
  ['EAN_13',ean],['EAN_13','0123456789012'],['EAN_8','96385074'],
  ['UPC_A','036000291452'],['UPC_A','012345678905'],
  ['UPC_E','04252614'],['UPC_E','14252611'],
  ['UPC_E','01234505'],['UPC_E','01234514'],['UPC_E','01234523'],
  ['UPC_E','01234531'],['UPC_E','01234543'],['UPC_E','01234558'],['UPC_E','01234565'],
 ];
 for(const [format,code] of fixtures){
  await running(h=>{
   h.read(code,0,format);h.read(code,150,format);assert.deepEqual(h.values,[],format+' must remain unconfirmed after two reads');
   h.read(code,300,format);assert.deepEqual(h.values,[code],format+' '+code+' must preserve its original text');
  });
 }
});

test('Repeated invalid GS1 lengths, characters, check digits, and UPC-E number systems never reach onCode',async()=>{
 const invalid=[
  ['EAN_13','590123412345'],['EAN_13','59012341234570'],['EAN_13','5901234123458'],['EAN_13','590123412345X'],
  ['EAN_8','9638507'],['EAN_8','963850740'],['EAN_8','96385075'],
  ['UPC_A','03600029145'],['UPC_A','0360002914520'],['UPC_A','036000291453'],
  ['UPC_E','4252614'],['UPC_E','042526140'],['UPC_E','04252615'],['UPC_E','24252618'],
 ];
 for(const [format,code] of invalid){
  await running(h=>{
   h.read(code,0,format);h.read(code,150,format);h.read(code,300,format);h.read(code,450,format);
   assert.deepEqual(h.values,[],format+' must reject '+code);
  });
 }
});

test('Non-GS1 barcode formats preserve arbitrary strings instead of applying numeric check-digit rules',async()=>{
 const fixtures=[['CODE_128','00012-A?x'],['CODE_39','0000-A/B$'],['ITF','00000123'],['QR_CODE','https://example.test/000001?material=nails']];
 for(const [format,code] of fixtures){
  await running(h=>{
   h.read(code,0,format);h.read(code,150,format);assert.deepEqual(h.values,[]);
   h.read(code,300,format);assert.deepEqual(h.values,[code]);
  });
 }
});

test('Cancellation discards an unconfirmed candidate and ignores callbacks after the camera closes',async()=>{
 const h=camera();await h.scanner.ready;
 h.read(ean,0);h.read(ean,150);assert.deepEqual(h.values,[]);
 await h.scanner.stop();h.read(ean,300);h.read(ean,450);h.read(ean,600);
 assert.deepEqual(h.values,[]);
 await h.scanner.stop();assert.equal(h.instance.stops,1);assert.equal(h.instance.clears,1);
});

test('Cancellation during pending camera permission ignores both early and late decoder callbacks',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve);
 const h=camera(gate);await Promise.resolve();
 const stopped=h.scanner.stop();
 h.read(ean,0);h.read(ean,150);h.read(ean,300);
 release();await stopped;await h.scanner.ready;
 h.read(ean,450);h.read(ean,600);h.read(ean,750);
 assert.deepEqual(h.values,[]);
 assert.equal(h.instance.stops,1);assert.equal(h.instance.clears,1);
});
