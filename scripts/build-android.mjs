import {access,cp,mkdir,readdir,rm,writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Uses only already-installed tools. Never downloads an SDK or dependencies.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
function option(name){const i=args.indexOf(name);if(i<0)return undefined;if(!args[i+1]||args[i+1].startsWith('--'))throw new Error('Missing value for '+name);return args[i+1];}
const known=new Set(['--check','--sdk','--version-code','--version-name']);
for(let i=0;i<args.length;i++){if(!known.has(args[i]))throw new Error('Unknown argument '+args[i]);if(args[i]!=='--check')i++;}
const sdk=option('--sdk')||process.env.ANDROID_SDK_ROOT||process.env.ANDROID_HOME;
const versionCode=option('--version-code')||'1',versionName=option('--version-name')||'1.0';
if(!/^[1-9][0-9]*$/.test(versionCode)||Number(versionCode)>2100000000)throw new Error('Use a positive Android version code below 2100000001.');
async function present(path){try{await access(path,constants.R_OK);return true;}catch{return false;}}
async function executable(name){for(const folder of (process.env.PATH||'').split(':')){const path=join(folder,name);try{await access(path,constants.X_OK);return path;}catch{}}return null;}
async function entries(path){try{return await readdir(path,{withFileTypes:true});}catch{return [];}}
const missing=[];
const java=await executable('java'),zip=await executable('zip');
if(!java)missing.push('Java JDK');if(!zip)missing.push('zip');
if(java&&spawnSync(java,['com.sun.tools.javac.Main','-version'],{stdio:'ignore'}).status!==0)missing.push('Java compiler module (jdk.compiler)');
if(java&&spawnSync(java,['sun.security.tools.keytool.Main','-help'],{stdio:'ignore'}).status!==0)missing.push('Java keytool module');
if(!sdk)missing.push('Android SDK path (--sdk or ANDROID_SDK_ROOT)');
const platforms=sdk?(await entries(join(sdk,'platforms'))).filter(e=>e.isDirectory()&&/^android-[0-9]+$/.test(e.name)&&Number(e.name.slice(8))>=35).sort((a,b)=>Number(b.name.slice(8))-Number(a.name.slice(8))):[];
const platform=platforms.length?join(sdk,'platforms',platforms[0].name,'android.jar'):null;
if(!platform||!await present(platform))missing.push('installed Android SDK platform 35 or later (android.jar)');
const versions=sdk?(await entries(join(sdk,'build-tools'))).filter(e=>e.isDirectory()&&/^[0-9]+\.[0-9]+\.[0-9]+$/.test(e.name)).sort((a,b)=>b.name.localeCompare(a.name,undefined,{numeric:true})):[];
let tools=null;
for(const entry of versions){const folder=join(sdk,'build-tools',entry.name);if((await Promise.all(['aapt2','d8','zipalign','apksigner'].map(name=>present(join(folder,name))))).every(Boolean)){tools=folder;break;}}
if(!tools)missing.push('installed Android build tools (aapt2, d8, zipalign, apksigner)');
if(missing.length){console.error('APK build blocked. Missing locally installed tools:\n'+missing.map(item=>'  '+item).join('\n')+'\nNo downloads or network requests were attempted.');process.exit(2);}
if(args.includes('--check')){console.log('Local Android tools found: '+platform+'; '+tools);process.exit(0);}
function run(command,parameters){const result=spawnSync(command,parameters,{cwd:root,stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)throw new Error('Local build command failed: '+command+' (exit '+result.status+')');}
// Java exposes javac/keytool through modules even when shell launchers are absent.
run(java,['com.sun.tools.javac.Main','-version']);
run(process.execPath,['scripts/build.mjs']);
const build=join(root,'android','build'),stage=join(build,'workshop');
await rm(stage,{recursive:true,force:true});
for(const directory of ['assets/www','generated','classes','dex'])await mkdir(join(stage,directory),{recursive:true});
await cp(join(root,'dist','client'),join(stage,'assets','www'),{recursive:true});
// Native asset interception is already offline; it must not use an old PWA cache.
await rm(join(stage,'assets','www','sw.js'),{force:true});
const compiled=join(stage,'resources.zip'),unsigned=join(stage,'unsigned.apk'),aligned=join(stage,'aligned.apk');
run(join(tools,'aapt2'),['compile','--dir',join(root,'android','res'),'-o',compiled]);
run(join(tools,'aapt2'),['link','-I',platform,'--manifest',join(root,'android','AndroidManifest.xml'),'--java',join(stage,'generated'),'-A',join(stage,'assets'),'-o',unsigned,'--min-sdk-version','26','--target-sdk-version','35','--version-code',versionCode,'--version-name',versionName,compiled]);
async function files(folder,extension){const found=[];for(const entry of await readdir(folder,{withFileTypes:true})){const path=join(folder,entry.name);if(entry.isDirectory())found.push(...await files(path,extension));else if(entry.name.endsWith(extension))found.push(path);}return found;}
run(java,['com.sun.tools.javac.Main','-source','8','-target','8','-encoding','UTF-8','-bootclasspath',platform,'-d',join(stage,'classes'),...await files(join(root,'android','src'),'.java'),...await files(join(stage,'generated'),'.java')]);
run(join(tools,'d8'),['--lib',platform,'--min-api','26','--output',join(stage,'dex'),...await files(join(stage,'classes'),'.class')]);
run(zip,['-j',unsigned,...await files(join(stage,'dex'),'.dex')]);
run(join(tools,'zipalign'),['-p','-f','4',unsigned,aligned]);
const signing=join(root,'android','signing'),keystore=join(signing,'workshop.p12'),passwordFile=join(signing,'password.txt');
await mkdir(signing,{recursive:true,mode:0o700});
if(!await present(keystore)){
 if(await present(passwordFile))throw new Error('A signing password exists without its key. Restore the original signing key rather than replace it.');
 await writeFile(passwordFile,randomBytes(32).toString('hex'),{mode:0o600,flag:'wx'});
 run(java,['sun.security.tools.keytool.Main','-genkeypair','-keystore',keystore,'-storetype','PKCS12','-alias','workshop','-keyalg','RSA','-keysize','2048','-sigalg','SHA256withRSA','-validity','10000','-dname','CN=Workshop Inventory','-storepass:file',passwordFile,'-keypass:file',passwordFile]);
}
if(!await present(passwordFile))throw new Error('The original signing password file is required to build an update.');
const apk=join(build,'workshop.apk');
run(join(tools,'apksigner'),['sign','--ks',keystore,'--ks-key-alias','workshop','--ks-pass','file:'+passwordFile,'--key-pass','file:'+passwordFile,'--out',apk,aligned]);
run(join(tools,'apksigner'),['verify','--verbose',apk]);
await writeFile(join(build,'BUILD.txt'),'Workshop Android APK\nVersion: '+versionName+' ('+versionCode+')\nPackage: com.workshop.inventory\nOrigin: https://workshop.local/ (bundled assets only)\nKeep android/signing/ private and preserve it for updates.\n');
console.log('Signed local APK: '+apk+'\nKeep the original signing key for updates. No network access was used.');
