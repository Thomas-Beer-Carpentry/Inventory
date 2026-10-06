import test from 'node:test';
import assert from 'node:assert/strict';
import {isAndroidApp,androidBackup} from '../public/android-bridge.js';
import {prepareOffline} from '../public/offline.js';
import {cameraError} from '../public/scanner.js';
function android(){
 const browser=new EventTarget();browser.location={origin:'https://workshop.local'};
 browser.WorkshopAndroid={isLocalApp:()=>true};
 browser.result=detail=>browser.dispatchEvent(new CustomEvent('workshop-native-backup',{detail}));
 return browser;
}
test('Android bundled assets are ready on the first offline launch without a service worker',async()=>{
 const browser=android(),statuses=[];
 browser.navigator={serviceWorker:{register(){throw new Error('Native app must not register a service worker');}}};
 await prepareOffline(status=>statuses.push(status),browser);
 assert.deepEqual(statuses,['Ready offline · saved on this phone']);
 assert.match(cameraError(new DOMException('Denied','NotAllowedError'),browser),/Android Settings/);
 assert.equal(isAndroidApp({...browser,location:{origin:'https://another.test'}}),false);
 assert.equal(isAndroidApp({location:{origin:'https://workshop.local'},WorkshopAndroid:{isLocalApp(){throw new Error('No bridge');}}}),false);
});
test('Saving a backup waits for the document write callback and ignores unrelated operations',async()=>{
 const browser=android();let parameters,finished=false;
 browser.WorkshopAndroid.saveBackup=(...values)=>{parameters=values;return true;};
 const result=androidBackup('save',{filename:'workshop.json',json:'{"stock":7}'},browser).then(value=>{finished=true;return value;});
 assert.deepEqual(parameters,['workshop.json','{"stock":7}']);
 browser.result({operation:'restore',ok:true,json:'{}'});await Promise.resolve();assert.equal(finished,false);
 browser.result({operation:'save',ok:true});assert.deepEqual(await result,{operation:'save',ok:true});
});
test('Native chooser cancel and write failure settle without reporting success and allow retry',async()=>{
 const browser=android();browser.WorkshopAndroid.chooseBackup=()=>true;
 const canceled=androidBackup('restore',{},browser);browser.result({operation:'restore',ok:false,canceled:true});
 assert.deepEqual(await canceled,{canceled:true});
 browser.WorkshopAndroid.saveBackup=()=>true;
 const failed=androidBackup('save',{filename:'workshop.json',json:'{}'},browser);
 browser.result({operation:'save',ok:false,error:'Storage is full'});await assert.rejects(failed,/Storage is full/);
 const retry=androidBackup('restore',{},browser);browser.result({operation:'restore',ok:true,json:'{"format":"workshop-phone-v1"}'});
 assert.equal((await retry).json,'{"format":"workshop-phone-v1"}');
});
test('Concurrent backup requests cannot replace the pending result handler',async()=>{
 const browser=android();browser.WorkshopAndroid.chooseBackup=()=>true;
 const original=androidBackup('restore',{},browser);
 await assert.rejects(androidBackup('restore',{},browser),/Finish the current backup/);
 browser.result({operation:'restore',ok:true,json:'{}'});assert.equal((await original).json,'{}');
 browser.WorkshopAndroid.chooseBackup=()=>false;await assert.rejects(androidBackup('restore',{},browser),/Finish the current backup/);
 browser.WorkshopAndroid.chooseBackup=()=>true;
 const retry=androidBackup('restore',{},browser);browser.result({operation:'restore',ok:false,canceled:true});await retry;
});
test('Malformed native restore results are rejected; callbacks can arrive during the bridge call',async()=>{
 const browser=android();browser.WorkshopAndroid.chooseBackup=()=>{browser.result({operation:'restore',ok:true,json:123});return true;};
 await assert.rejects(androidBackup('restore',{},browser),/could not be read/);
 browser.WorkshopAndroid.saveBackup=()=>{browser.result({operation:'save',ok:true});return true;};
 assert.equal((await androidBackup('save',{filename:'workshop.json',json:'{}'},browser)).ok,true);
});
