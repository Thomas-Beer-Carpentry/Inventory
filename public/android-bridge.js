export function isAndroidApp(browser=globalThis){
 try{return browser.location?.origin==='https://workshop.local'&&browser.WorkshopAndroid?.isLocalApp()===true;}catch{return false;}
}
let pending=false;
export function androidBackup(operation,{filename,json}={},browser=globalThis){
 if(!isAndroidApp(browser))return Promise.reject(new Error('Open the installed Workshop Android app.'));
 if(pending)return Promise.reject(new Error('Finish the current backup operation first.'));
 if(!['save','restore'].includes(operation))return Promise.reject(new Error('Unknown backup operation.'));
 if(operation==='save'&&(typeof json!=='string'||new TextEncoder().encode(json).byteLength>20*1024*1024))return Promise.reject(new Error('Workshop backups must be smaller than 20 MB.'));
 pending=true;
 return new Promise((resolve,reject)=>{
  const finish=(error,result)=>{pending=false;browser.removeEventListener('workshop-native-backup',receive);if(error)reject(error);else resolve(result);};
  const receive=event=>{
   const result=event.detail;
   if(result?.operation!==operation)return;
   if(result.canceled){finish(null,{canceled:true});return;}
   if(!result.ok){finish(new Error(result.error||'The backup could not be saved or opened.'));return;}
   if(operation==='restore'&&typeof result.json!=='string'){finish(new Error('The selected backup could not be read.'));return;}
   finish(null,result);
  };
  browser.addEventListener('workshop-native-backup',receive);
  try{
   const accepted=operation==='save'?browser.WorkshopAndroid.saveBackup(filename,json):browser.WorkshopAndroid.chooseBackup();
   if(accepted!==true)finish(new Error('Finish the current backup operation first.'));
  }catch(error){finish(error);}
 });
}
