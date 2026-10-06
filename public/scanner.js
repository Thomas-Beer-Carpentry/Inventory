import {isAndroidApp} from './android-bridge.js';
const SUPPORTED_FORMATS=['CODE_128','CODE_39','EAN_13','EAN_8','UPC_A','UPC_E','ITF','QR_CODE'];
function validGs1(code,length){
 if(code.length!==length||!/^\d+$/.test(code))return false;
 let sum=Number(code.at(-1)),weight=3;
 for(let i=code.length-2;i>=0;i--){sum+=Number(code[i])*weight;weight=4-weight;}
 return sum%10===0;
}
function validBarcode(code,format){
 if(typeof code!=='string'||!code.length||!SUPPORTED_FORMATS.includes(format))return false;
 const length={EAN_13:13,EAN_8:8,UPC_A:12}[format];
 if(length)return validGs1(code,length);
 if(format==='UPC_E'){
  if(!/^[01]\d{7}$/.test(code))return false;
  const [n,a,b,c,d,e,f,k]=code;
  // UPC-E stores a compressed UPC-A number. Validate its expanded check digit.
  const expanded='012'.includes(f)?n+a+b+f+'0000'+c+d+e+k:
   f==='3'?n+a+b+c+'00000'+d+e+k:
   f==='4'?n+a+b+c+d+'00000'+e+k:n+a+b+c+d+e+'0000'+f+k;
  return validGs1(expanded,12);
 }
 return true;
}
export function cameraError(error,browser=globalThis){
 const description=typeof error==='string'?error:error?.message||'';
 if(error?.name==='NotAllowedError'||/NotAllowedError|Permission denied/i.test(description))return isAndroidApp(browser)?'Camera access was denied. Allow Workshop camera access in Android Settings → Apps → Workshop → Permissions, then tap Scan again.':'Camera access was denied. Allow camera access for this site in your browser settings, then try again.';
 if(error?.name==='NotFoundError'||/NotFoundError/i.test(description))return 'No camera was found on this device.';
 if(error?.name==='NotReadableError'||/NotReadableError/i.test(description))return 'The camera is in use. Close other camera apps, then try again.';
 return typeof error==='string'?error:error?.message||'The camera could not be started. Please try again.';
}
function cameraPreferenceKey(moduleUrl){return 'workshop-camera-v1:'+new URL('./',moduleUrl).pathname;}
export function readCameraPreference(browser=globalThis,moduleUrl=import.meta.url){
 try{return browser.localStorage?.getItem(cameraPreferenceKey(moduleUrl))||'';}catch{return '';}
}
export function saveCameraPreference(cameraId,browser=globalThis,moduleUrl=import.meta.url){
 try{
  if(cameraId)browser.localStorage?.setItem(cameraPreferenceKey(moduleUrl),cameraId);
  else browser.localStorage?.removeItem(cameraPreferenceKey(moduleUrl));
 }catch{}
}
export function createCameraScanner({hostId,onCode,onProgress=()=>{},cameraId='',browser=globalThis}){
 if(!browser.isSecureContext||!browser.navigator?.mediaDevices?.getUserMedia)throw new Error('Phone camera access needs a secure HTTPS address. Open the secure Workshop link on your phone.');
 if(!browser.Html5Qrcode)throw new Error('The barcode scanner did not load. Reload Workshop and try again.');
 const formats=browser.Html5QrcodeSupportedFormats;
 const reader=new browser.Html5Qrcode(hostId,{verbose:false,formatsToSupport:SUPPORTED_FORMATS.map(f=>formats[f])});
 const now=()=>browser.performance?.now?.()??Date.now();
 let canceled=false,reported=false,closing=null,candidate=null;
 const started=Promise.resolve().then(()=>{
  if(canceled)return;
  return reader.start(cameraId||{facingMode:'environment'},{fps:10,qrbox:(width,height)=>({width:Math.min(Math.floor(width*.9),340),height:Math.min(Math.floor(height*.45),160)})},(code,result)=>{
   if(canceled||reported)return;
   const format=result?.result?.format?.formatName;
   if(!validBarcode(code,format)){
    candidate=null;onProgress('Could not verify the barcode. Keep the full bars inside the frame.');return;
   }
   const at=now(),changed=candidate&&(candidate.code!==code||candidate.format!==format);
   if(!candidate||changed||at-candidate.lastAt>1500||at<candidate.lastAt){
    candidate={code,format,hits:1,firstAt:at,lastAt:at};
    onProgress(changed?'Reading changed. Hold the barcode steady.':'Checking barcode… hold steady.');return;
   }
   // Repeated callbacks from one instant cannot confirm a scan.
   if(at-candidate.lastAt<75)return;
   candidate.hits++;candidate.lastAt=at;
   if(candidate.hits<3||at-candidate.firstAt<250){onProgress('Checking barcode… hold steady.');return;}
   reported=true;onCode(code);
  },()=>{});
 });
 function stop(){
  canceled=true;
  if(!closing)closing=(async()=>{
   try{await started;}catch{}
   if(reader.isScanning)await reader.stop();
   reader.clear();
  })();
  return closing;
 }
 const ready=started.then(async()=>{
  if(canceled){await stop();return;}
  // Focus is optional. Its completion must never delay stopping the camera.
  try{
   const modes=reader.getRunningTrackCapabilities?.().focusMode;
   if(Array.isArray(modes)&&modes.includes('continuous')){
    Promise.resolve(reader.applyVideoConstraints({advanced:[{focusMode:'continuous'}]})).catch(()=>{});
   }
  }catch{}
 });
 async function cameraChoices(){
  await ready;
  const empty={cameras:[],selectedId:''};
  if(canceled)return empty;
  let selectedId=cameraId||'';
  try{selectedId=reader.getRunningTrackSettings?.().deviceId||selectedId;}catch{}
  try{
   // The active stream already granted permission; enumeration opens no stream.
   const devices=await browser.navigator.mediaDevices.enumerateDevices?.()||[];
   if(canceled)return empty;
   const cameras=[],seen=new Set();
   for(const device of devices){
    if(device.kind!=='videoinput'||!device.deviceId||seen.has(device.deviceId))continue;
    seen.add(device.deviceId);cameras.push({id:device.deviceId,label:device.label||'Camera '+(cameras.length+1)});
   }
   return {cameras,selectedId};
  }catch{return canceled?empty:{cameras:[],selectedId};}
 }
 return {ready,stop,cameraChoices};
}
