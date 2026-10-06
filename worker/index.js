import html from '../public/index.html';
import css from '../public/style.css';
import client from '../public/app.js';
import scanner from '../public/scanner.js';
import barcodeDecoder from '../public/vendor/html5-qrcode.min.js';
import {db,state,move} from './db.js';
function identity(request,env){
 const id=request.headers.get('oai-authenticated-user-id');
 if(!id){if(env.LOCAL_PREVIEW==='1') return {id:env.LOCAL_USER_ID||'local-eryk',name:env.LOCAL_USER_NAME||'Eryk',email:'local@workshop.local'}; return null;}
 const email=request.headers.get('oai-authenticated-user-email')||'Workshop user';
 let name=email;
 if(request.headers.get('oai-authenticated-user-full-name-encoding')==='percent-encoded-utf-8'){try{name=decodeURIComponent(request.headers.get('oai-authenticated-user-full-name')||email);}catch{}}
 return {id,name,email};
}
function json(data,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store'}});}
function field(value,label,max=160){if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw new Error(`Enter a valid ${label}.`);return value.trim();}
function knownError(error){const msg=String(error.message);for(const key of ['Insufficient Workshop stock','Return exceeds materials held by this job','Select an active destination job','Select a valid job','Movement quantities are inconsistent'])if(msg.includes(key))return key; if(!/D1_ERROR|SQLITE|constraint/i.test(msg))return msg;return 'The stock movement could not be saved. Refresh and try again.';}
export default {async fetch(request,env){
 const url=new URL(request.url);
 if(url.pathname==='/style.css') return new Response(css,{headers:{'Content-Type':'text/css; charset=utf-8'}});
 if(url.pathname==='/scanner.js') return new Response(scanner,{headers:{'Content-Type':'text/javascript; charset=utf-8'}});
 if(url.pathname==='/vendor/html5-qrcode.min.js') return new Response(barcodeDecoder,{headers:{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'public, max-age=86400'}});
 if(url.pathname==='/app.js') return new Response(client,{headers:{'Content-Type':'text/javascript; charset=utf-8'}});
 if(url.pathname==='/favicon.svg') return new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#143b32"/><path d="M8 11h16v14H8zM6 9l10-5 10 5M12 15v10m8-10v10" fill="none" stroke="#b7ee7e" stroke-width="2"/></svg>',{headers:{'Content-Type':'image/svg+xml'}});
 if(!url.pathname.startsWith('/api/'))return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
 const user=identity(request,env); if(!user)return json({error:'Sign in to access Workshop inventory.'},401);
 try{
 if(request.method==='GET'&&url.pathname==='/api/state')return json(await state(env,user));
 if(request.method!=='POST')return json({error:'This action is unavailable.'},405);
 if(request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return json({error:'Open this action from Workshop.'},403);
 if(!request.headers.get('content-type')?.includes('application/json'))return json({error:'Invalid request.'},400);
 const body=await request.json();
 if(url.pathname==='/api/movements')return json({movement:await move(env,body,user)},201);
 if(url.pathname==='/api/items'){
 const id=crypto.randomUUID(); const name=field(body.name,'item name'),barcode=field(body.barcode,'barcode',100),unit=field(body.unit,'unit',30);
 await db(env).prepare('INSERT INTO items(id,name,barcode,unit,quantity,created_at) VALUES(?,?,?,?,0,?)').bind(id,name,barcode,unit,new Date().toISOString()).run();return json({id},201);
 }
 if(url.pathname==='/api/jobs'){
 const id=crypto.randomUUID();await db(env).prepare('INSERT INTO jobs(id,client,name,address,status,created_at) VALUES(?,?,?,?,\'Active\',?)').bind(id,field(body.client,'client name'),field(body.name,'job description'),typeof body.address==='string'?body.address.trim().slice(0,300):null,new Date().toISOString()).run();return json({id},201);
 }
 const match=url.pathname.match(/^\/api\/jobs\/([^/]+)\/status$/);
 if(match){if(!['Active','Completed'].includes(body.status))throw new Error('Choose a valid job status.');const r=await db(env).prepare('UPDATE jobs SET status=? WHERE id=?').bind(body.status,match[1]).run();if(!r.meta.changes)throw new Error('Job not found.');return json({ok:true});}
 return json({error:'Action not found.'},404);
 }catch(error){console.error('Workshop action failed:',error.message);return json({error:String(error.message).includes('idx_items_barcode')||String(error.message).includes('items.barcode')?'That barcode already belongs to an item.':knownError(error)},400);}
}};
