import {isAndroidApp} from './android-bridge.js';

function activeWorker(registration,browser){
 return new Promise((resolve,reject)=>{
  const watched=new Map();let settled=false;
  const finish=(error,worker)=>{
   if(settled)return;settled=true;
   browser.clearTimeout(timer);registration.removeEventListener('updatefound',check);
   for(const [worker,listener] of watched)worker.removeEventListener('statechange',listener);
   if(error)reject(error);else resolve(worker);
  };
  const check=()=>{
   const active=registration.active;
   if(active?.state==='activated'){finish(null,active);return;}
   const candidates=[registration.installing,registration.waiting,active].filter(Boolean);
   for(const worker of candidates)if(!watched.has(worker)){
    const listener=()=>check();watched.set(worker,listener);worker.addEventListener('statechange',listener);
   }
   if(watched.size&&[...watched.keys()].every(worker=>worker.state==='redundant'))finish(new Error('Offline installation failed.'));
  };
  const timer=browser.setTimeout(()=>finish(new Error('Offline installation timed out.')),30000);
  registration.addEventListener('updatefound',check);check();
 });
}
function cachedStatus(worker,browser){
 return new Promise((resolve,reject)=>{
  const channel=new browser.MessageChannel();let settled=false;
  const finish=(error,ready)=>{
   if(settled)return;settled=true;
   browser.clearTimeout(timer);channel.port1.onmessage=null;channel.port1.close();channel.port2.close();
   if(error)reject(error);else resolve(ready);
  };
  const timer=browser.setTimeout(()=>finish(new Error('Offline status timed out.')),5000);
  channel.port1.onmessage=event=>finish(null,event.data?.ready===true);
  try{worker.postMessage({type:'OFFLINE_STATUS'},[channel.port2]);}catch(error){finish(error);}
 });
}
export async function prepareOffline(onStatus,browser=globalThis){
 if(isAndroidApp(browser)){onStatus('Ready offline · saved on this phone');return;}
 const navigator=browser.navigator;
 if(!browser.isSecureContext||!navigator||!('serviceWorker' in navigator)){onStatus('Open the secure app link to enable offline use');return;}
 try{
  onStatus('Preparing offline use…');
  const registration=await navigator.serviceWorker.register('/sw.js',{scope:'/'});
  const worker=await activeWorker(registration,browser);
  const ready=await cachedStatus(worker,browser);
  onStatus(ready?'Ready offline · saved on this phone':'Offline setup is incomplete. Reopen while online.');
  if(ready&&navigator.storage?.persist)navigator.storage.persist().catch(()=>{});
 }catch{onStatus('Offline setup failed. Reopen while online.');}
}
