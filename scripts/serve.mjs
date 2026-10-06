import http from 'node:http';
import https from 'node:https';
import {mkdirSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {binding} from './sqlite-binding.mjs';
import worker from '../dist/server/index.js';

process.chdir(fileURLToPath(new URL('../',import.meta.url)));
const phoneMode=process.argv.includes('--phone');
let phone;
if(phoneMode){try{phone=JSON.parse(readFileSync('.local/phone.json','utf8'));}catch{console.error('Run npm run setup:phone first to prepare the secure phone address.');process.exit(1);}}
const origin=new URL(phone?.origin||'http://127.0.0.1:5173');
if(phoneMode&&origin.protocol!=='https:'){console.error('Phone camera access requires HTTPS. Rerun setup:phone.');process.exit(1);}
const port=Number(origin.port||5173);
const allowedHosts=new Set([origin.host,'127.0.0.1:'+port,'localhost:'+port]);
mkdirSync('.local',{recursive:true});
const DB=binding('.local/workshop.sqlite');
const localUser=(process.env.WORKSHOP_USER||'Eryk').trim()||'Eryk';
const runtime={DB,LOCAL_PREVIEW:'1',LOCAL_USER_NAME:localUser,LOCAL_USER_ID:'local-'+localUser};
const handler=async(req,res)=>{
 try{
  if(!allowedHosts.has(req.headers.host)||!req.url.startsWith('/')){res.writeHead(421);res.end('Open Workshop using its configured address.');return;}
  const chunks=[];
  for await(const chunk of req)chunks.push(chunk);
  const body=Buffer.concat(chunks);
  const request=new Request(origin.protocol+'//'+req.headers.host+req.url,{
   method:req.method,headers:req.headers,...(body.length?{body}:{}),duplex:'half'
  });
  const result=await worker.fetch(request,runtime);
  res.writeHead(result.status,Object.fromEntries(result.headers));
  res.end(Buffer.from(await result.arrayBuffer()));
 }catch(error){res.writeHead(500);res.end('Workshop unavailable');console.error(error);}
};
let server;
try{server=phoneMode?https.createServer({cert:readFileSync(phone.cert),key:readFileSync(phone.key)},handler):http.createServer(handler);}catch(error){console.error('The HTTPS certificate files could not be opened. Rerun setup:phone.');DB.close();process.exit(1);}
server.on('error',error=>{
 console.error(error.code==='EADDRINUSE'?'Workshop port 5173 is already in use. Close the other instance and try again.':error.message);
 DB.close();process.exitCode=1;
});
server.listen(port,phoneMode?'0.0.0.0':'127.0.0.1',()=>console.log(`Workshop: ${origin.origin}\nScanning as: ${localUser}\nInventory saved in: .local/workshop.sqlite${phoneMode?'\nConnect your phone to the same Wi-Fi. Keep this computer running.':''}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{DB.close();process.exit(0);}));
