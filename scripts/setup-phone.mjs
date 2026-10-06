import {networkInterfaces} from 'node:os';
import {isIP} from 'node:net';
import {mkdirSync,existsSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

process.chdir(fileURLToPath(new URL('../',import.meta.url)));
process.umask(0o077);
const args=process.argv.slice(2);
const value=flag=>args.includes(flag)?args[args.indexOf(flag)+1]:null;
const explicitAddress=value('--address');
let candidates=[];
if(!explicitAddress){try{candidates=Object.values(networkInterfaces()).flat().filter(i=>i&&i.family==='IPv4'&&!i.internal).map(i=>i.address);}catch{}}
const address=explicitAddress||(candidates.length===1?candidates[0]:null);
const output=resolve(value('--output')||'.local');
if(!address||isIP(address)!==4){console.error('Choose your computer’s Wi-Fi IPv4 address: npm run setup:phone -- --address 192.168.1.50');if(candidates.length)console.error('Available addresses: '+candidates.join(', '));process.exit(1);}
const certDir=join(output,'tls');mkdirSync(certDir,{recursive:true});
const path=name=>join(certDir,name);
function openssl(args){const result=spawnSync('openssl',args,{stdio:'ignore'});if(result.status===0)return;if(result.error)throw new Error('OpenSSL could not run: '+result.error.message);throw new Error('Local HTTPS certificate setup failed during OpenSSL '+args[0]+'. Check your OpenSSL installation and try again.');}
try{
 const ca=path('workshop-ca.pem'),caKey=path('workshop-ca-key.pem');
 if(existsSync(ca)!==existsSync(caKey))throw new Error('The local certificate and its key do not match. Restore both files from your certificate backup.');
 if(!existsSync(ca))openssl(['req','-x509','-newkey','rsa:2048','-sha256','-days','3650','-nodes','-keyout',caKey,'-out',ca,'-subj','/CN=Workshop Local CA','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign']);
 openssl(['req','-newkey','rsa:2048','-nodes','-keyout',path('server-key.pem'),'-out',path('server.csr'),'-subj','/CN='+address]);
 writeFileSync(path('server.ext'),'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:'+address+',IP:127.0.0.1,DNS:localhost\n');
 openssl(['x509','-req','-in',path('server.csr'),'-CA',ca,'-CAkey',caKey,'-CAcreateserial','-out',path('server.pem'),'-days','365','-sha256','-extfile',path('server.ext')]);
 openssl(['x509','-in',ca,'-outform','DER','-out',path('workshop-root.cer')]);
 const origin='https://'+address+':5173';
 writeFileSync(join(output,'phone.json'),JSON.stringify({origin,cert:path('server.pem'),key:path('server-key.pem'),rootCertificate:path('workshop-root.cer')},null,2)+'\n');
 console.log('Phone HTTPS setup saved.\nInstall and trust this public certificate on your phone:\n'+path('workshop-root.cer')+'\n\nThen run npm run start:phone and open '+origin+' on the same Wi-Fi.\nPrivate certificate keys stay in '+certDir+'.');
}catch(error){console.error(error.message);process.exitCode=1;}
