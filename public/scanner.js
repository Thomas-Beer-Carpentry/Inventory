import {isAndroidApp} from './android-bridge.js';
export function cameraError(error,browser=globalThis){
 const description=typeof error==='string'?error:error?.message||'';
 if(error?.name==='NotAllowedError'||/NotAllowedError|Permission denied/i.test(description))return isAndroidApp(browser)?'Camera access was denied. Allow Workshop camera access in Android Settings → Apps → Workshop → Permissions, then tap Scan again.':'Camera access was denied. Allow camera access for this site in your browser settings, then try again.';
 if(error?.name==='NotFoundError'||/NotFoundError/i.test(description))return 'No camera was found on this device.';
 if(error?.name==='NotReadableError'||/NotReadableError/i.test(description))return 'The camera is in use. Close other camera apps, then try again.';
 return typeof error==='string'?error:error?.message||'The camera could not be started. Please try again.';
}
export function createCameraScanner({hostId,onCode,browser=globalThis}){
 if(!browser.isSecureContext||!browser.navigator?.mediaDevices?.getUserMedia)throw new Error('Phone camera access needs a secure HTTPS address. Open the secure Workshop link on your phone.');
 if(!browser.Html5Qrcode)throw new Error('The barcode scanner did not load. Reload Workshop and try again.');
 const formats=browser.Html5QrcodeSupportedFormats;
 const reader=new browser.Html5Qrcode(hostId,{verbose:false,formatsToSupport:['CODE_128','CODE_39','EAN_13','EAN_8','UPC_A','UPC_E','ITF','QR_CODE'].map(f=>formats[f])});
 let canceled=false,reported=false,closing=null;
 const started=Promise.resolve().then(()=>{
  if(canceled)return;
  return reader.start({facingMode:'environment'},{fps:10,qrbox:(width,height)=>({width:Math.min(Math.floor(width*.9),340),height:Math.min(Math.floor(height*.45),160)})},code=>{
   if(canceled||reported||!code)return;
   reported=true;onCode(String(code));
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
 const ready=started.then(async()=>{if(canceled)await stop();});
 return {ready,stop};
}
