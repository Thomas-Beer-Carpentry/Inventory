import {phoneInventory} from './phone-store.js';
import {prepareOffline} from './offline.js';
import {createCameraScanner,cameraError,readCameraPreference,saveCameraPreference} from './scanner.js';
import {isAndroidApp,androidBackup} from './android-bridge.js';
const paths={box:'M21 8l-9-5-9 5m18 0v9l-9 5-9-5V8m18 0-9 5-9-5m9 5v9m-4-17 9 5',jobs:'M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M3 6h18v14H3zM3 11l9 3 9-3M10 12h4v4h-4z',activity:'M3 12h4l3-8 4 16 3-8h4',scan:'M4 8V4h4m8 0h4v4m0 8v4h-4M8 20H4v-4M7 9v6m3-6v6m4-6v6m3-6v6',in:'M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5',out:'M12 15V3m-4 4 4-4 4 4M4 15v5h16v-5',return:'M9 4 4 9l5 5M4 9h10a6 6 0 0 1 0 12h-3',plus:'M12 5v14M5 12h14',search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',calendar:'M4 5h16v16H4zM7 3v4m10-4v4M4 10h16',home:'M3 10l9-7 9 7M5 9v12h14V9M9 21v-7h6v7',pin:'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0',close:'M6 6l12 12M6 18 18 6',check:'M5 12l4 4L19 6',clock:'M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',chevron:'M9 5l7 7-7 7',camera:'M3 7h4l2-3h6l2 3h4v14H3zM16 14a4 4 0 1 1-8 0 4 4 0 0 1 8 0',back:'M19 12H5m6-6-6 6 6 6',shield:'M12 3l8 3v6c0 5-8 10-8 10S4 17 4 12V6zM8 12l3 3 5-6'};
const icon=(name)=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]||paths.box}"/></svg>`;
const esc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let data={items:[],jobs:[],movements:[],user:{name:'Workshop user'}},loadError='',loading=true,search='',jobFilter='Active',materialFilter='Active',draft=null,cameraSession=null,cameraClosing=Promise.resolve(),cameraRequest=0,lastFocus=null,offlineStatus='Saved on this phone';
const $=(s)=>document.querySelector(s);
const date=(d,full=false)=>new Intl.DateTimeFormat(undefined,full?{day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'}:{day:'numeric',month:'short',year:'numeric'}).format(new Date(d));
const day=(d)=>new Date(d).toDateString();
const materialValue=value=>String(value||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
const readBarcode=value=>{const code=String(value??'');return code.trim()?code:'';};
const hasBarcode=(item,barcode)=>!!barcode&&(item.barcode===barcode||item.barcode_aliases?.includes(barcode));
const label={STOCK_IN:'STOCK IN',TAKEN_TO_JOB:'TAKEN TO JOB',RETURNED_TO_WORKSHOP:'RETURNED TO WORKSHOP'};
const tag=(t)=>`<span class="type-tag ${t==='TAKEN_TO_JOB'?'out':t==='STOCK_IN'?'in':'return'}">${icon(t==='TAKEN_TO_JOB'?'out':t==='STOCK_IN'?'in':'return')}${label[t]}</span>`;
const net=(jobId,itemId)=>data.movements.filter(m=>m.job_id===jobId&&m.item_id===itemId).reduce((n,m)=>n+(m.type==='TAKEN_TO_JOB'?m.quantity:-m.quantity),0);
async function api(path,body){return phoneInventory.request(path,body);}
async function refresh(){try{data=await api('state');loadError='';}catch(e){loadError=e.message;}loading=false;render();if(!loadError&&!data.user.configured&&!draft){draft={kind:'phone',name:'',error:''};showModal();}}
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),4000);}
function empty(title,description,action='',compact=false){return `<div class="empty ${compact?'compact':''}"><div class="empty-icon">${icon(compact?'jobs':'box')}</div><h3>${title}</h3><p>${description}</p>${action}</div>`;}
function button(action,text,ic='',cls='',extra=''){return `<button type="button" class="btn ${cls}" data-action="${action}" ${extra}>${ic?icon(ic):''}${text}</button>`;}
function route(){const r=location.hash.slice(1)||'inventory';return r.split('/');}
function render(){const [view,id]=route();const isJob=view==='job';const nav=view==='jobs'||isJob?'jobs':view==='activity'?'activity':'inventory';const activeJobs=data.jobs.filter(j=>!j.deleted_at&&j.status==='Active');const name=data.user.name||'Workshop user';
$('#app').innerHTML=`<div class="shell"><aside class="sidebar"><a class="brand" href="#inventory"><span class="brand-mark">${icon('home')}</span><div><strong>workshop</strong><small>STOCK & JOBS</small></div></a><div class="nav-label">ON THIS PHONE</div><nav class="nav" aria-label="Main navigation"><a href="#inventory" class="${nav==='inventory'?'active':''}">${icon('box')}<span>Workshop</span></a><a href="#jobs" class="${nav==='jobs'?'active':''}">${icon('jobs')}<span>Jobs</span><span class="count">${activeJobs.length}</span></a><a href="#activity" class="${nav==='activity'?'active':''}">${icon('activity')}<span>Activity</span></a></nav><div class="home-card">${icon('home')}<div><strong>Workshop</strong><span>Your home base</span></div></div><div class="profile"><div class="avatar">${esc(name.split(/[\s@]+/).slice(0,2).map(s=>s[0]).join('').toUpperCase())}</div><div class="who"><strong title="${esc(name)}">${esc(name)}</strong><small>Saved on this phone</small></div></div></aside><main class="main"><header class="topbar"><div class="mobile-brand"><span class="brand-mark">${icon('home')}</span>workshop</div><div class="breadcrumb">Workspace <span>/</span> <b>${nav==='inventory'?'Workshop':nav==='jobs'?'Jobs':'Activity'}</b>${isJob?'<span>/</span> Material record':''}</div><button type="button" class="phone-status" data-action="phonedata" title="Phone data and backups">${icon('shield')}<span id="offline-status">${esc(offlineStatus)}</span></button><div class="date">${icon('calendar')}${new Intl.DateTimeFormat(undefined,{weekday:'short',day:'numeric',month:'short',year:'numeric'}).format(new Date())}</div></header><div class="content">${loadError?`<div class="banner error-banner" role="alert">${esc(loadError)} ${button('refresh','Try again','','small')}</div>`:''}${loading?'<div class="loading">Loading inventory…</div>':view==='materials'?materialsView():isJob?jobDetail(id):nav==='jobs'?jobsView():nav==='activity'?activityView():inventoryView()}</div></main></div>`;}
function catalogItems(){return data.items.filter(item=>!item.deleted_at);}
function stockedItems(){return catalogItems().filter(item=>item.quantity>0);}
function visibleStockItems(){return stockedItems().filter(item=>[item.name,item.barcode||'',...(item.barcode_aliases||[])].join(' ').toLowerCase().includes(search.toLowerCase()));}
function inventoryView(){const active=data.jobs.filter(j=>!j.deleted_at&&j.status==='Active');const today=data.movements.filter(m=>day(m.created_at)===day(new Date()));const stock=stockedItems(),rows=visibleStockItems();
return `<div class="page-head"><div><div class="title-line"><h1>Workshop</h1><span class="location-tag">HOME BASE</span></div><p class="sub">Your stock, ready for the next job.</p></div><div class="actions">${button('stockin','Stock in','in')}${button('stockout','Stock out','out','primary')}</div></div><div class="stats">${stat('Materials in stock',stock.length,'Across your Workshop','box')}${stat('Active jobs',active.length,'Materials tracked by client','jobs')}${stat('Movements today',today.length,'Every movement accounted for','activity')}</div><div class="work-grid"><section class="panel"><div class="panel-title"><div><h2>Workshop inventory</h2><p class="meta">${stock.length} material${stock.length!==1?'s':''} in stock</p></div><div class="actions"><a class="btn quiet small" href="#materials">Manage materials</a>${button('newitem','Add item','plus','small')}</div></div><div class="toolbar"><label class="search">${icon('search')}<input id="inventory-search" type="search" placeholder="Search item or barcode…" aria-label="Search inventory" value="${esc(search)}"></label><span class="muted">${stock.length} items in stock</span></div><div id="inventory-results">${inventoryRows(rows)}</div><div class="table-foot"><span>Workshop is your stock location</span><span>${icon('shield').replace('<svg','<svg style="width:13px;height:13px;vertical-align:middle"')} Saved on this phone</span></div></section><div class="aside-panels"><section class="panel side-panel"><div class="panel-title"><h2>Active jobs <span class="muted">${active.length}</span></h2><a class="text-link" href="#jobs">View all</a></div>${active.length?`<div class="job-list">${active.slice(0,4).map(j=>`<a href="#job/${j.id}" class="mini-job"><div class="mini-job-top"><span class="job-icon">${icon('jobs')}</span><strong>${esc(j.client)}</strong></div><p>${esc(j.name)}</p><small>${data.movements.filter(m=>m.job_id===j.id).length} material movements</small></a>`).join('')}</div>`:empty('Your next job starts here','Create a job to assign materials to a client.',button('newjob','Create a job','plus','small'),true)}</section><div class="side-note">${icon('shield')}<h3>Every item has a destination</h3><p>Stock leaves the Workshop for a job. Unused materials come back through that job’s return record.</p></div></div></div>`;}
function stat(title,value,note,ic){return `<div class="stat"><div><span class="stat-label">${title}</span><strong>${value}</strong><span class="stat-note">${note}</span></div><span class="stat-icon">${icon(ic)}</span></div>`;}
function inventoryRows(rows){
 if(!data.items.length)return empty('A place for every material','Add your first material and its quantity to the Workshop. A barcode is optional.',button('newitem','Add your first item','plus','primary'));
 if(!catalogItems().length)return empty('No active materials','Open Manage materials to restore a deleted item or add a new material.','<a href="#materials" class="btn primary">Manage materials</a>');
 if(!stockedItems().length)return empty('No stock in the Workshop','Your saved materials and barcodes are kept. Scan stock in to add quantities.',button('stockin','Stock in','in','primary'));
 if(!rows.length)return empty('No matching materials','Try a different in-stock item name or barcode.');
 return `<ul class="stock-list" aria-label="Materials in stock">${rows.map(i=>{
  const last=data.movements.filter(m=>m.item_id===i.id).at(-1);
  return `<li class="stock-row"><div class="stock-quantity"><span class="quantity"><b>${i.quantity}</b><span>${esc(i.unit)}</span></span></div><div class="stock-material"><strong>${esc(i.name)}</strong><small>${last?'Last movement: '+date(last.created_at):'No movements'}</small></div><div class="stock-actions"><button class="row-action" aria-label="Stock in ${esc(i.name)}" title="Stock in" data-action="stockin" data-item="${i.id}">${icon('in')}</button><button class="row-action" aria-label="Manage ${esc(i.name)}" title="Manage item" data-action="materialmanage" data-item="${i.id}">${icon('box')}</button></div></li>`;
 }).join('')}</ul>`;
}
function jobsView(){const jobs=data.jobs.filter(j=>jobFilter==='Deleted'?!!j.deleted_at:!j.deleted_at&&j.status===jobFilter);return `<div class="page-head"><div><h1>Jobs</h1><p class="sub">A material record for every client and every job.</p></div><div class="actions">${button('newjob','New job','plus','primary')}</div></div><div class="tabs" role="group" aria-label="Job status"><button class="tab ${jobFilter==='Active'?'active':''}" data-action="jobfilter" data-status="Active">Active jobs · ${data.jobs.filter(j=>!j.deleted_at&&j.status==='Active').length}</button><button class="tab ${jobFilter==='Completed'?'active':''}" data-action="jobfilter" data-status="Completed">Completed · ${data.jobs.filter(j=>!j.deleted_at&&j.status==='Completed').length}</button><button class="tab ${jobFilter==='Deleted'?'active':''}" data-action="jobfilter" data-status="Deleted">Deleted · ${data.jobs.filter(j=>j.deleted_at).length}</button></div>${jobs.length?`<div class="jobs-grid">${jobs.map(j=>`<a class="job-card" href="#job/${j.id}"><div class="card-top"><span class="job-icon">${icon('jobs')}</span><span class="badge ${j.status==='Completed'?'completed':''}">${j.deleted_at?'Deleted':j.status}</span></div><h2>${esc(j.client)}</h2><p>${esc(j.name)}</p><div class="address">${j.address?icon('pin')+esc(j.address):''}</div><footer><span>${data.movements.filter(m=>m.job_id===j.id).length} material movements</span><span>Created ${date(j.created_at)}</span></footer></a>`).join('')}</div>`:`<section class="panel">${empty(jobFilter==='Active'?'Ready for your next job':jobFilter==='Deleted'?'No deleted jobs':'No completed jobs yet',jobFilter==='Active'?'Add a client and job description to start tracking materials.':jobFilter==='Deleted'?'Deleted jobs keep their permanent history here.':'Completed jobs and their material records will appear here.',jobFilter==='Active'?button('newjob','Create your first job','plus','primary'):'')}</section>`}`;}
function jobDetail(id){const j=data.jobs.find(j=>j.id===id);if(!j)return `<section class="panel">${empty('Job not found','Open Jobs to select a material record.','<a href="#jobs" class="btn">View jobs</a>')}</section>`;const movements=data.movements.filter(m=>m.job_id===id);const totals=new Map();for(const m of movements){if(!totals.has(m.item_id))totals.set(m.item_id,{name:m.item_name,unit:m.unit,taken:0,returned:0});totals.get(m.item_id)[m.type==='TAKEN_TO_JOB'?'taken':'returned']+=m.quantity;}
return `<a class="btn quiet small" href="#jobs">${icon('back')}All jobs</a><div class="page-head" style="margin-top:18px"><div><div class="title-line"><h1>${esc(j.client)}</h1><span class="badge ${j.status==='Completed'?'completed':''}">${j.deleted_at?'Deleted':j.status}</span></div><p class="sub">${esc(j.name)}</p></div><div class="actions">${button('return','Return stock','return','',`data-job="${id}"`)}${!j.deleted_at&&j.status==='Active'?button('stockout','Take materials','out','primary',`data-job="${id}"`):''}</div></div><div class="detail-info">${j.address?`<span>${icon('pin')}${esc(j.address)}</span>`:''}<span>${icon('calendar')}Created ${date(j.created_at)}</span>${j.deleted_at?`<span>Deleted ${date(j.deleted_at)}</span>${button('restorejob','Restore job','','small',`data-job="${id}"`)}`:`<button class="text-link" style="background:none;padding:0" data-action="jobstatus" data-job="${id}" data-status="${j.status==='Active'?'Completed':'Active'}">${j.status==='Active'?'Mark completed':'Reopen job'}</button>${button('deletejob','Delete job','','small',`data-job="${id}"`)}`}</div><div class="stack"><section class="panel"><div class="panel-title"><div><h2>Material summary</h2><p class="meta">Net materials used = taken to job − returned to Workshop</p></div><span class="muted">${totals.size} materials</span></div>${totals.size?`<div class="table-wrap"><table><thead><tr><th>Material</th><th>Taken to job</th><th>Returned</th><th>Net used</th></tr></thead><tbody>${Array.from(totals.values()).map(t=>`<tr><td class="item-cell"><div class="item"><span class="item-icon">${icon('box')}</span><strong>${esc(t.name)}</strong></div></td><td>${t.taken} <span class="muted">${esc(t.unit)}</span></td><td>${t.returned} <span class="muted">${esc(t.unit)}</span></td><td><span class="quantity"><b>${t.taken-t.returned}</b> ${esc(t.unit)}</span></td></tr>`).join('')}</tbody></table></div>`:empty('No materials taken yet','Stock assigned to this job will appear here.',!j.deleted_at&&j.status==='Active'?button('stockout','Take materials','out','primary',`data-job="${id}"`):'')}</section><section class="panel"><div class="panel-title"><div><h2>Material history</h2><p class="meta">The complete record, in chronological order</p></div><span class="muted">${movements.length} transactions</span></div>${historyTable(movements,true)}</section></div>`;}
function materialRows(items,deleted=false){return `<ul class="stock-list" aria-label="${deleted?'Deleted materials':'Saved materials'}">${items.map(item=>`<li class="stock-row"><div class="stock-quantity"><span class="quantity"><b>${item.quantity}</b><span>${esc(item.unit)}</span></span></div><div class="stock-material"><strong>${esc(item.name)}</strong><small>${deleted?'Deleted '+date(item.deleted_at,true)+(item.deleted_by?' by '+esc(item.deleted_by):''):'Saved material · '+(item.quantity?'In stock':'Out of stock')}</small></div><button class="row-action" aria-label="Manage ${esc(item.name)}" title="Manage item" data-action="materialmanage" data-item="${item.id}">${icon('box')}</button></li>`).join('')}</ul>`;}
function materialsView(){const deleted=materialFilter==='Deleted',items=data.items.filter(item=>deleted?!!item.deleted_at:!item.deleted_at);return `<a class="btn quiet small" href="#inventory">${icon('back')}Workshop</a><div class="page-head" style="margin-top:18px"><div><h1>Manage materials</h1><p class="sub">Save barcodes, delete items, or restore them with their history.</p></div>${button('newitem','Add item','plus','primary')}</div><div class="tabs" role="group" aria-label="Material status"><button class="tab ${!deleted?'active':''}" data-action="materialfilter" data-status="Active">Saved materials · ${catalogItems().length}</button><button class="tab ${deleted?'active':''}" data-action="materialfilter" data-status="Deleted">Deleted · ${data.items.filter(item=>item.deleted_at).length}</button></div><section class="panel">${items.length?materialRows(items,deleted):empty(deleted?'No deleted materials':'No saved materials',deleted?'Deleted items and their retained quantities will appear here.':'Add a material to start your inventory.')}</section>`;}
function activityView(){const deleted=data.items.filter(item=>item.deleted_at);return `<div class="page-head"><div><h1>Activity</h1><p class="sub">The permanent record of everything coming in and going out.</p></div></div><div class="stack"><section class="panel"><div class="panel-title"><h2>All stock movements</h2><span class="muted">${data.movements.length} transactions</span></div>${historyTable([...data.movements].reverse(),false)}</section>${deleted.length?`<section class="panel"><div class="panel-title"><h2>Deleted materials</h2><span class="muted">${deleted.length} materials · stock retained</span></div>${materialRows(deleted,true)}</section>`:''}</div>`;}
function historyTable(movements,onJob){if(!movements.length)return empty('No movements recorded','Every stock-in, stock-out and job return is saved here.');return `<div class="table-wrap"><table><thead><tr><th>Date & time</th><th>Movement</th><th>Material</th><th>Quantity</th>${onJob?'':'<th>Client / job</th>'}<th>Scanned by</th><th>Workshop stock</th></tr></thead><tbody>${movements.map(m=>`<tr><td class="muted">${date(m.created_at,true)}</td><td>${tag(m.type)}</td><td class="item-cell"><strong style="font-weight:500">${esc(m.item_name)}</strong></td><td>${m.quantity} <span class="muted">${esc(m.unit)}</span></td>${onJob?'':`<td>${m.job_id?`<a href="#job/${m.job_id}"><span>${esc(m.client_name)}</span><br><span class="muted">${esc(m.job_name)}</span></a>`:'<span class="muted">New stock / supplier</span>'}</td>`}<td>${esc(m.user_name)}</td><td>${m.before} <span class="muted">→</span> <strong>${m.after}</strong> <span class="muted">${esc(m.unit)}</span></td></tr>`).join('')}</tbody></table></div>`;}
function showModal(){lastFocus=document.activeElement;document.body.style.overflow='hidden';renderModal();}
function closeModal(){if(draft?.busy)return;stopCamera();draft=null;$('#modal-root').innerHTML='';document.body.style.overflow='';lastFocus?.focus();}
function modalFrame(title,subtitle,body,footer){stopCamera();$('#modal-root').innerHTML=`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-header"><div><h2 id="modal-title">${title}</h2><p>${subtitle}</p></div><button class="icon-btn" data-action="close" aria-label="Close dialog">${icon('close')}</button></div><form id="modal-form"><div class="modal-body">${draft.error?`<div class="form-error" role="alert">${esc(draft.error)}</div>`:''}${body}</div><div class="modal-footer">${footer}</div></form></section></div>`;setTimeout(()=>$('.modal input, .modal select, .modal-footer .primary, .modal-footer .lime')?.focus(),0);}
const field=(id,title,input,help='')=>`<div class="field"><label for="${id}">${title}</label>${input}${help?`<small>${help}</small>`:''}</div>`;
function openMove(type,jobId=null,itemId=null){draft={kind:'move',type,jobId,itemId,step:itemId?2:1,quantity:1,id:crypto.randomUUID(),error:'',busy:false};showModal();}
function captureMaterialFields(){
 if(draft?.kind!=='item'||draft.step!==1)return;
 for(const [key,id] of [['name','item-name'],['unit','item-unit'],['quantity','item-qty'],['barcode','item-barcode'],['selectedItemId','item-existing']]){
  const input=$('#'+id);if(input)draft[key]=input.value;
 }
}
function reuseSavedMaterial(item){
 draft.name=item.name;draft.unit=item.unit;draft.itemId=item.id;draft.selectedItemId=item.id;
 draft.materialRevision=(draft.materialRevision||0)+1;
 const name=$('#item-name'),unit=$('#item-unit'),existing=$('#item-existing');
 if(name){name.value=item.name;name.readOnly=true;}
 if(unit){
  if(!Array.from(unit.querySelectorAll('option')).some(option=>option.value===item.unit))unit.innerHTML+=`<option value="${esc(item.unit)}">${esc(item.unit)}</option>`;
  unit.value=item.unit;unit.disabled=true;
 }
 if(existing)existing.value=item.id;
}
function reuseSavedBarcode(code){
 const barcode=readBarcode(code);
 if(!barcode||draft?.kind!=='item'||draft.step!==1)return false;
 const item=data.items.find(item=>hasBarcode(item,barcode));
 if(!item||item.deleted_at)return false;
 reuseSavedMaterial(item);
 return true;
}
function renderModal(){if(!draft)return;const cancel=button('close','Cancel');const next=`<button type="submit" class="btn primary" ${draft.busy?'disabled':''}>${draft.busy?'Saving…':'Continue'}</button>`;
if(draft.kind==='material'){
 const item=data.items.find(item=>item.id===draft.itemId);
 if(!item){modalFrame('Material not found','Open Manage materials to select an item.','',button('close','Close'));return;}
 draft.materialRevision=(draft.materialRevision||0)+1;
 const codes=[...(item.barcode?[item.barcode]:[]),...(item.barcode_aliases||[])];
 const info=`<div class="summary-box"><div class="summary-row"><span>${item.deleted_at?'Retained stock':'Workshop stock'}</span><strong>${item.quantity} ${esc(item.unit)}</strong></div><div class="summary-row"><span>Status</span><strong>${item.deleted_at?'Deleted':'Saved material'}</strong></div></div><h3 class="barcode-title">Saved barcodes</h3>${codes.length?`<ul class="barcode-list">${codes.map(code=>`<li><code>${esc(code)}</code></li>`).join('')}</ul>`:'<p class="help">No barcode saved yet.</p>'}`;
 const barcode=item.deleted_at?'<p class="help">Restore this item to add stock or save another barcode. Its Activity and job history are kept.</p>':field('material-barcode','Add a barcode',`<div class="inline-field"><input id="material-barcode" name="barcode" required maxlength="100" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Scan or enter another brand’s barcode" value="${esc(draft.barcode||'')}"><button type="button" class="btn" data-action="camera" aria-label="Scan barcode with camera">${icon('camera')}Scan</button></div>`,'Every saved barcode identifies this same material. Saving a barcode leaves the stock quantity unchanged.')+'<div id="camera-area"></div>';
 modalFrame(esc(item.name),'Manage this material and its barcodes.',info+barcode,button(item.deleted_at?'restoreitem':'deleteitem',item.deleted_at?'Restore item':'Delete item','','small',`data-item="${item.id}"`)+button('close','Done')+(item.deleted_at?'':`<button type="submit" class="btn primary" ${draft.busy?'disabled':''}>${draft.busy?'Saving…':'Save barcode'}</button>`));return;
}
if(draft.kind==='materialremove'){
 const item=data.items.find(item=>item.id===draft.itemId);
 if(!item){modalFrame('Material not found','Open Manage materials to select an item.','',button('close','Close'));return;}
 modalFrame(draft.action==='delete'?'Delete this item?':'Restore this item?',esc(item.name),`<p class="help">${draft.action==='delete'?`The item will move to Deleted materials and leave your stock list and ordinary material selectors. Its ${item.quantity} ${esc(item.unit)}, barcodes, Activity and job history stay saved. You can restore it at any time.`:`Restore this item with its saved ${item.quantity} ${esc(item.unit)}, barcodes and history.`}</p>`,cancel+`<button type="submit" class="btn primary" ${draft.busy?'disabled':''}>${draft.busy?'Saving…':draft.action==='delete'?'Delete item':'Restore item'}</button>`);return;
}
if(draft.kind==='phone'){
modalFrame('Phone data','Your inventory and history stay on this phone.',field('operator-name','Name recorded on transactions',`<input id="operator-name" name="name" required maxlength="160" autocomplete="given-name" placeholder="e.g. Eryk" value="${esc(draft.name||'')}">`)+`<div class="summary-box"><p class="help" style="margin:0">${isAndroidApp()?'This Android app works without internet. Stock, jobs and scanning stay on this phone.':'Install Workshop on your Home Screen. Wait for “Ready offline” before using it without internet.'}</p><p class="help" style="margin:12px 0 0">Download a backup before switching phones or clearing browser data.</p></div><div class="phone-backups">${button('exportbackup',isAndroidApp()?'Save backup':'Download backup','out','')}${isAndroidApp()?button('restorebackup','Restore backup','in'):`<label class="btn" for="restore-backup">${icon('in')}Restore backup</label><input id="restore-backup" type="file" accept="application/json,.json" hidden>`}</div><p class="help" style="margin-top:12px;margin-bottom:0">Backups restore into an empty inventory. Existing history is kept.</p>`,cancel+`<button type="submit" class="btn primary" ${draft.busy?'disabled':''}>${draft.busy?'Saving…':'Save name'}</button>`);return;
}
if(draft.kind==='item'){
 draft.materialRevision=(draft.materialRevision||0)+1;
 if(draft.step===2){
  const before=data.items.find(item=>item.id===draft.itemId)?.quantity||0;
  modalFrame('Confirm material and stock','Review the material and quantity before saving.',`<div class="summary-box"><div class="summary-row"><span>Material</span><strong>${esc(draft.name)}</strong></div><div class="summary-row"><span>Quantity</span><strong>${draft.quantity} ${esc(draft.unit)}</strong></div><div class="summary-row"><span>Destination</span><strong>Workshop</strong></div><div class="summary-row"><span>Scanned by</span><strong>${esc(data.user.name)}</strong></div><div class="stock-change"><span>Workshop stock</span><div><b>${before}</b><span class="arrow">→</span><b>${before+draft.quantity}</b> ${esc(draft.unit)}</div></div></div><p class="help">The material and this stock-in transaction are saved together with the date and time.</p>`,button('backstep','Back')+`<button class="btn lime" type="submit" ${draft.busy?'disabled':''}>${icon('check')}${draft.busy?'Saving…':'Confirm stock in'}</button>`);
  return;
 }
 const units=['boxes','lengths','bags','rolls','pieces','sheets','packs','litres','metres','bottles','tubs'];
 if(draft.unit&&!units.includes(draft.unit))units.push(draft.unit);
 const saved=!!draft.selectedItemId;
 modalFrame('Add a material','Choose a saved material or enter a new one, then add the quantity.',field('item-existing','Material',`<select id="item-existing" name="selectedItemId"><option value="">New material</option>${catalogItems().map(item=>`<option value="${esc(item.id)}" ${draft.selectedItemId===item.id?'selected':''}>${esc(item.name)} · ${item.quantity} ${esc(item.unit)} in Workshop</option>`).join('')}</select>`,'Saved materials include those currently out of stock.')+field('item-name','Material name',`<input id="item-name" name="name" maxlength="160" ${saved?'readonly':''} placeholder="e.g. 90mm Galvanised Nails" value="${esc(draft.name||'')}">`)+field('item-unit','Unit',`<select id="item-unit" name="unit" ${saved?'disabled':''}>${units.map(u=>`<option value="${esc(u)}" ${draft.unit===u?'selected':''}>${esc(u)}</option>`).join('')}</select>`)+field('item-qty','Quantity',`<input id="item-qty" name="quantity" type="number" min="1" max="1000000" step="1" required value="${esc(draft.quantity??1)}">`,'Added to Workshop stock when you confirm.')+field('item-barcode','Barcode <span class="muted">(optional)</span>',`<div class="inline-field"><input id="item-barcode" name="barcode" maxlength="100" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Scan, enter, or leave blank" value="${esc(draft.barcode||'')}"><button type="button" class="btn" data-action="camera" aria-label="Scan barcode with camera">${icon('camera')}Scan</button></div>`,'Saved barcodes reuse their material name and unit.')+'<div id="camera-area"></div>',cancel+next);
 return;
}
if(draft.kind==='job'){modalFrame('Create a job','Track materials against a client and job.',field('job-client','Client name',`<input id="job-client" name="client" required maxlength="160" placeholder="e.g. Caroline" value="${esc(draft.client||'')}">`)+field('job-name','Job name / description',`<input id="job-name" name="name" required maxlength="160" placeholder="e.g. Fence Replacement" value="${esc(draft.name||'')}">`)+field('job-address','Job address <span class="muted">(optional)</span>',`<input id="job-address" name="address" maxlength="300" placeholder="Street address" value="${esc(draft.address||'')}">`),cancel+`<button class="btn primary" type="submit" ${draft.busy?'disabled':''}>${draft.busy?'Saving…':'Create job'}</button>`);return;}
if(draft.kind==='jobremove'){const j=data.jobs.find(j=>j.id===draft.jobId);modalFrame(draft.action==='delete'?'Delete this job?':'Restore this job?',esc(j.client)+' · '+esc(j.name),`<p class="help">${draft.action==='delete'?'The job and its material list will move to Deleted jobs. Workshop quantities stay unchanged. Permanent transactions remain in Activity, and unused materials can still be returned from its history.':'The job will move to Completed jobs with its material history. Reopen it to take new materials.'}</p>`,cancel+`<button class="btn primary" type="submit" ${draft.busy?'disabled':''}>${draft.busy?'Saving…':draft.action==='delete'?'Delete job':'Restore job'}</button>`);return;}
if(draft.kind==='status'){const j=data.jobs.find(j=>j.id===draft.jobId);modalFrame(draft.status==='Completed'?'Complete this job?':'Reopen this job?',esc(j.client)+' · '+esc(j.name),`<p class="help">${draft.status==='Completed'?'The job will move to Completed. Its material history stays available and you can still return unused stock.':'This job will be available for new stock-out transactions.'}</p>`,cancel+`<button class="btn primary" type="submit" ${draft.busy?'disabled':''}>${draft.busy?'Saving…':'Confirm'}</button>`);return;}
const titles={STOCK_IN:'Stock in',TAKEN_TO_JOB:'Stock out to a job',RETURNED_TO_WORKSHOP:'Return to Workshop'};const j=data.jobs.find(j=>j.id===draft.jobId);const item=data.items.find(i=>i.id===draft.itemId);const steps=`<div class="steps">${['Scan item','Quantity & job','Confirm'].map((s,i)=>`<div class="step ${draft.step===i+1?'active':''}"><span>${i+1}</span>${s}</div>`).join('')}</div>`;
if(draft.step===4){const m=draft.saved;modalFrame('Movement recorded','Saved to your Workshop history.',`<div class="success-content"><div class="success-mark">${icon('check')}</div><h3>${m.quantity} ${esc(m.unit)} ${m.type==='TAKEN_TO_JOB'?'taken to the job':m.type==='RETURNED_TO_WORKSHOP'?'returned to Workshop':'added to Workshop'}</h3><p>${esc(m.item_name)}${m.job_id?`<br>${esc(m.client_name)} · ${esc(m.job_name)}`:''}</p><div class="summary-box"><div class="stock-change"><span>Workshop stock</span><div><b>${m.before}</b><span class="arrow">→</span><b>${m.after}</b> ${esc(m.unit)}</div></div><div class="summary-row"><span>Scanned by</span><strong>${esc(m.user_name)}</strong></div><div class="summary-row"><span>Recorded</span><strong>${date(m.created_at,true)}</strong></div></div></div>`,button('done','Done','check','primary'));return;}
if(draft.step===1){const options=draft.type==='RETURNED_TO_WORKSHOP'?data.items.filter(i=>net(draft.jobId,i.id)>0):draft.type==='TAKEN_TO_JOB'?stockedItems():catalogItems();modalFrame(titles[draft.type],j?esc(j.client)+' · '+esc(j.name):draft.type==='STOCK_IN'?'New stock arriving at your home base.':'Every stock-out needs a destination job.',steps+field('scan-code','Scan barcode',`<div class="inline-field"><input id="scan-code" name="barcode" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Scan or type a barcode" value="${esc(draft.barcode||'')}"><button type="button" class="btn" data-action="camera" aria-label="Scan with camera">${icon('camera')}<span>Scan</span></button></div>`,'Use a barcode scanner, your camera, or type the barcode.')+'<div id="camera-area"></div>'+field('manual-item','Or select a material',`<select id="manual-item" name="itemId"><option value="">Choose a material…</option>${options.map(i=>`<option value="${i.id}">${esc(i.name)} · ${i.quantity} ${esc(i.unit)} in Workshop</option>`).join('')}</select>`)+(options.length?'':`<p class="help">${draft.type==='RETURNED_TO_WORKSHOP'?'This job has no materials available to return.':draft.type==='TAKEN_TO_JOB'?'No materials are in Workshop stock. Use Stock In to replenish saved materials.':'Add a material to your inventory before scanning stock.'}</p>`),cancel+next);return;}
const selected=`${item.deleted_at&&draft.type==='RETURNED_TO_WORKSHOP'?'<p class="help">Returning stock will restore this deleted material to your saved materials.</p>':''}<div class="selected-item"><span class="item-icon">${icon('box')}</span><div><strong>${esc(item.name)}</strong><p>${item.quantity} ${esc(item.unit)} in Workshop${item.barcode?' · '+esc(item.barcode):''}</p></div></div>`;
if(draft.step===2){const active=data.jobs.filter(j=>!j.deleted_at&&j.status==='Active');modalFrame(titles[draft.type],'Confirm the quantity and destination.',steps+selected+field('move-qty',`Quantity <span class="muted">(${esc(item.unit)})</span>`,`<input id="move-qty" name="quantity" type="number" min="1" max="1000000" step="1" required value="${draft.quantity}">`,draft.type==='RETURNED_TO_WORKSHOP'?`${net(draft.jobId,item.id)} ${esc(item.unit)} still assigned to this job.`:draft.type==='TAKEN_TO_JOB'?`Available: ${item.quantity} ${esc(item.unit)}`:'Stock will be added to the Workshop.')+(draft.type==='TAKEN_TO_JOB'?field('move-job','Destination job <span style="color:#987a47">*</span>',`<select id="move-job" name="jobId" required><option value="">Select a client / job…</option>${active.map(j=>`<option value="${j.id}" ${draft.jobId===j.id?'selected':''}>${esc(j.client)} — ${esc(j.name)}</option>`).join('')}</select>`,active.length?'':'Create an active job before taking stock out.'):draft.type==='RETURNED_TO_WORKSHOP'?`<div class="summary-box"><div class="summary-row"><span>Returned from</span><strong>${esc(j.client)}<br>${esc(j.name)}</strong></div></div>`:'<p class="help">Returning materials from a job? Use Return Stock in that job so its net total stays accurate.</p>'),button('backstep','Back')+next);return;}
const after=item.quantity+(draft.type==='TAKEN_TO_JOB'?-draft.quantity:draft.quantity);modalFrame(titles[draft.type],'Review this movement before saving.',steps+`<div class="summary-box"><div class="summary-row"><span>Material</span><strong>${esc(item.name)}</strong></div><div class="summary-row"><span>Quantity</span><strong>${draft.quantity} ${esc(item.unit)}</strong></div><div class="summary-row"><span>${draft.type==='TAKEN_TO_JOB'?'Destination':draft.type==='RETURNED_TO_WORKSHOP'?'Returned from':'Destination'}</span><strong>${j?esc(j.client)+'<br>'+esc(j.name):'Workshop'}</strong></div><div class="summary-row"><span>Scanned by</span><strong>${esc(data.user.name)}</strong></div><div class="stock-change"><span>Workshop stock</span><div><b>${item.quantity}</b><span class="arrow">→</span><b>${after}</b> ${esc(item.unit)}</div></div></div><p class="help">This movement will be saved with the date and time in your permanent transaction history.</p>`,button('backstep','Back')+`<button type="submit" class="btn lime" ${draft.busy?'disabled':''}>${icon('check')}${draft.busy?'Saving…':'Confirm '+(draft.type==='TAKEN_TO_JOB'?'stock out':draft.type==='RETURNED_TO_WORKSHOP'?'return':'stock in')}</button>`);}
async function submit(event){event.preventDefault();if(!draft||draft.busy||draft.step===4)return;const form=new FormData(event.target);draft.error='';try{
if(draft.kind==='move'&&draft.step===1){draft.barcode=readBarcode(form.get('barcode'));const i=draft.barcode?data.items.find(i=>hasBarcode(i,draft.barcode)):data.items.find(i=>i.id===form.get('itemId'));if(!i)throw new Error(draft.barcode?'Barcode not found. Add this material to the Workshop first.':'Scan a barcode or select a material.');if(i.deleted_at&&draft.type!=='RETURNED_TO_WORKSHOP')throw new Error('This material was deleted. Restore it in Manage materials first.');if(draft.type==='RETURNED_TO_WORKSHOP'&&net(draft.jobId,i.id)<1)throw new Error('This material has no quantity assigned to this job.');if(draft.type==='TAKEN_TO_JOB'&&i.quantity<1)throw new Error('This material has no Workshop stock. Use Stock In to replenish it.');draft.itemId=i.id;draft.step=2;stopCamera();renderModal();return;}
if(draft.kind==='move'&&draft.step===2){draft.quantity=Number(form.get('quantity'));if(!Number.isSafeInteger(draft.quantity)||draft.quantity<1)throw new Error('Enter a whole quantity greater than zero.');if(draft.type==='TAKEN_TO_JOB'){draft.jobId=String(form.get('jobId')||'');if(!draft.jobId)throw new Error('Select a destination job.');if(draft.quantity>data.items.find(i=>i.id===draft.itemId).quantity)throw new Error('This quantity exceeds available Workshop stock.');}if(draft.type==='RETURNED_TO_WORKSHOP'&&draft.quantity>net(draft.jobId,draft.itemId))throw new Error('This quantity exceeds the materials held by this job.');draft.step=3;renderModal();return;}
if(draft.kind==='item'&&draft.step===1){
 for(const [key,value] of form)draft[key]=value;
 draft.barcode=readBarcode(draft.barcode);draft.quantity=Number(draft.quantity);
 if(draft.barcode.length>100)throw new Error('Enter a barcode of 100 characters or fewer, or leave it blank.');
 if(!Number.isSafeInteger(draft.quantity)||draft.quantity<1||draft.quantity>1000000)throw new Error('Enter a whole quantity between 1 and 1000000.');
 const selected=draft.selectedItemId?data.items.find(item=>item.id===draft.selectedItemId):null;
 if(draft.selectedItemId&&!selected)throw new Error('Choose a saved material from the dropdown.');
 const barcodeItem=draft.barcode?data.items.find(item=>hasBarcode(item,draft.barcode)):null;
 if(selected?.deleted_at||barcodeItem?.deleted_at)throw new Error('This material was deleted. Restore it in Manage materials first.');
 if(selected&&barcodeItem&&selected.id!==barcodeItem.id)throw new Error('That barcode belongs to a different material. Choose the correct material.');
 draft.itemId=null;
 if(selected||barcodeItem){reuseSavedMaterial(selected||barcodeItem);}else{
  draft.name=String(draft.name||'').trim();draft.unit=String(draft.unit||'boxes').trim();
  if(!draft.name||draft.name.length>160)throw new Error('Enter a valid material name.');
  if(!draft.unit||draft.unit.length>30)throw new Error('Choose a valid unit.');
  const same=item=>materialValue(item.name)===materialValue(draft.name)&&materialValue(item.unit)===materialValue(draft.unit);
  const matches=catalogItems().filter(same);
  if(!matches.length&&data.items.some(item=>item.deleted_at&&same(item)))throw new Error('This material was deleted. Restore it in Manage materials first.');
  if(matches.length>1)throw new Error('More than one saved material matches. Choose it from the dropdown.');
  if(matches.length)reuseSavedMaterial(matches[0]);
 }
 draft.step=2;stopCamera();renderModal();return;
}
if(draft.kind==='job'||draft.kind==='phone'){for(const [key,value] of form)draft[key]=value;}
if(draft.kind==='material'){
 if(data.items.find(item=>item.id===draft.itemId)?.deleted_at)throw new Error('Restore this item before adding a barcode.');
 draft.barcode=readBarcode(form.get('barcode'));
 if(!draft.barcode||draft.barcode.length>100)throw new Error('Scan or enter a barcode of 100 characters or fewer.');
}
draft.busy=true;renderModal();
if(draft.kind==='material'){await api('items/'+draft.itemId+'/barcodes',{barcode:draft.barcode});await refresh();draft.busy=false;draft.barcode='';renderModal();toast('Barcode saved to this material');return;}
if(draft.kind==='materialremove'){const action=draft.action;await api('items/'+draft.itemId+'/'+action,{});draft.busy=false;closeModal();await refresh();if(action==='restore')materialFilter='Active';render();toast(action==='delete'?'Item deleted. Its stock and history stay saved.':'Item restored with its stock and history');return;}
if(draft.kind==='phone'){await api('operator',{name:draft.name});draft.busy=false;closeModal();await refresh();toast('Scanning name saved on this phone');return;}
if(draft.kind==='item'){const result=await api('items/stock-in',{id:draft.id,itemId:draft.itemId||null,name:draft.name,barcode:draft.barcode||null,unit:draft.unit,quantity:draft.quantity});draft.busy=false;closeModal();await refresh();toast(result.movement.quantity+' '+result.movement.unit+' added to Workshop');return;}
if(draft.kind==='job'){const result=await api('jobs',{client:draft.client,name:draft.name,address:draft.address});draft.busy=false;closeModal();await refresh();location.hash='job/'+result.id;toast('Job created');return;}
if(draft.kind==='jobremove'){const action=draft.action;await api('jobs/'+draft.jobId+'/'+action,{});draft.busy=false;closeModal();await refresh();jobFilter=action==='delete'?'Active':'Completed';if(action==='delete'){location.hash='jobs';render();}toast(action==='delete'?'Job deleted. Its permanent history is kept.':'Job restored to Completed jobs');return;}
if(draft.kind==='status'){await api('jobs/'+draft.jobId+'/status',{status:draft.status});draft.busy=false;closeModal();await refresh();toast('Job status updated');return;}
const result=await api('movements',{id:draft.id,type:draft.type,itemId:draft.itemId,jobId:draft.jobId||null,quantity:draft.quantity});draft.busy=false;draft.saved=result.movement;draft.step=4;await refresh();renderModal();
}catch(e){draft.busy=false;draft.error=e.message;renderModal();}}
function stopCamera(invalidate=true){
 if(invalidate)cameraRequest++;
 const session=cameraSession;
 if(!session)return cameraClosing;
 cameraSession=null;session.canceled=true;
 if(session.host.isConnected){session.host.style.cssText='position:fixed;left:-10000px;top:0;width:320px;height:320px;visibility:hidden';session.host.setAttribute('aria-hidden','true');document.body.append(session.host);}
 cameraClosing=session.scanner.stop().catch(error=>console.error('Camera cleanup failed:',error)).finally(()=>session.host.remove());
 return cameraClosing;
}
async function showCameraChoices(session,area,currentDraft,request){
 const {cameras,selectedId}=await session.scanner.cameraChoices();
 if(request!==cameraRequest||cameraSession!==session||session.canceled||draft!==currentDraft)return;
 const choices=area.querySelector('.camera-choices');
 if(!choices)return;
 if(!cameras.length){choices.innerHTML='<p class="help">Camera selection is unavailable in this browser.</p>';return;}
 const help=cameras.length===1?'This browser exposes one camera. Available lenses depend on your phone.':'Choose the main rear camera if the picture is wide or blurry. This phone remembers your choice.';
 choices.innerHTML=field('scan-camera','Camera',`<select id="scan-camera"><option value="">Automatic rear camera</option>${cameras.map(camera=>`<option value="${esc(camera.id)}" ${camera.id===selectedId?'selected':''}>${esc(camera.label)}</option>`).join('')}</select>`,help);
}
async function startCamera(cameraId=readCameraPreference(),remember=false,allowFallback=true){
 const request=++cameraRequest;
 const currentDraft=draft;
 await stopCamera(false);
 if(request!==cameraRequest||draft!==currentDraft||!(draft?.kind==='item'&&draft.step===1||draft?.kind==='move'&&draft.step===1||draft?.kind==='material'&&data.items.some(item=>item.id===draft.itemId&&!item.deleted_at)))return;
 const area=$('#camera-area');
 if(!area)return;
 const inputId=draft.kind==='item'?'item-barcode':draft.kind==='material'?'material-barcode':'scan-code';
 $('#'+inputId)?.blur();
 area.innerHTML='<div class="camera-choices"></div><div class="camera-view" id="camera-view-'+crypto.randomUUID()+'"></div><div class="camera-controls"><span role="status">Starting camera…</span>'+button('stopcamera','Stop camera','','small')+'</div>';
 const host=area.querySelector('.camera-view');
 const session={host,canceled:false,scanner:null};
 try{
  session.scanner=createCameraScanner({hostId:host.id,cameraId,onProgress:message=>{
   if(cameraSession===session&&!session.canceled){const status=area.querySelector('[role="status"]');if(status)status.textContent=message;}
  },onCode:async code=>{
   if(session.canceled||cameraSession!==session)return;
   const materialRevision=currentDraft.materialRevision;
   const input=$('#'+inputId);
   if(!input)return;
   input.value=code;draft.barcode=code;
   await stopCamera();
   if(draft!==currentDraft||(currentDraft.kind==='item'||currentDraft.kind==='material')&&(currentDraft.materialRevision!==materialRevision||currentDraft.kind==='item'&&currentDraft.step!==1)||currentDraft.kind==='material'&&!data.items.some(item=>item.id===currentDraft.itemId&&!item.deleted_at))return;
   area.innerHTML='';
   if(currentDraft.kind==='move')$('#modal-form')?.requestSubmit();else if(currentDraft.kind==='material')$('.modal-footer .primary')?.focus();else if(reuseSavedBarcode(code))$('#item-qty')?.focus();else{const name=$('#item-name');if(!name.value)name.focus();else $('#item-qty')?.focus();}
  }});
  cameraSession=session;
  await session.scanner.ready;
  if(request!==cameraRequest||cameraSession!==session||session.canceled||draft!==currentDraft)return;
  if(remember)saveCameraPreference(cameraId);
  area.querySelector('[role="status"]').textContent='Position the full bars inside the frame and hold steady.';
  showCameraChoices(session,area,currentDraft,request).catch(()=>{});
 }catch(error){
  if(session.canceled)return;
  if(cameraSession===session)await stopCamera(false);else host.remove();
  if(request!==cameraRequest||draft!==currentDraft)return;
  if(cameraId&&allowFallback&&/NotFoundError|OverconstrainedError/.test(String(error?.name||'')+' '+String(error?.message||error))){
   await startCamera('',true,false);return;
  }
  if(draft===currentDraft)area.innerHTML='<div class="form-error" role="alert">'+esc(cameraError(error))+'</div>';
 }
}
function pauseCamera(){if(cameraSession){stopCamera();const area=$('#camera-area');if(area)area.innerHTML='<p class="help">Camera paused. Tap Scan to start again.</p>';}}
document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseCamera();});
window.addEventListener('workshop-native-pause',pauseCamera);
document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b)return;const a=b.dataset.action;if(draft?.busy)return;switch(a){case 'refresh':refresh();break;case 'phonedata':draft={kind:'phone',name:data.user.configured?data.user.name:'',error:''};showModal();break;case 'exportbackup':exportBackup();break;case 'restorebackup':restoreAndroidBackup();break;case 'materialmanage':draft={kind:'material',itemId:b.dataset.item,barcode:'',error:'',busy:false};showModal();break;case 'deleteitem':case 'restoreitem':draft={kind:'materialremove',action:a==='deleteitem'?'delete':'restore',itemId:b.dataset.item,error:'',busy:false};showModal();break;case 'materialfilter':materialFilter=b.dataset.status;render();break;case 'newitem':draft={kind:'item',step:1,quantity:1,id:crypto.randomUUID(),error:'',busy:false};showModal();break;case 'newjob':draft={kind:'job',error:''};showModal();break;case 'stockin':openMove('STOCK_IN',null,b.dataset.item||null);break;case 'stockout':openMove('TAKEN_TO_JOB',b.dataset.job||null);break;case 'return':openMove('RETURNED_TO_WORKSHOP',b.dataset.job);break;case 'close':case 'done':closeModal();break;case 'backstep':draft.step--;draft.error='';renderModal();break;case 'camera':startCamera();break;case 'stopcamera':stopCamera();if($('#camera-area'))$('#camera-area').innerHTML='';break;case 'jobfilter':jobFilter=b.dataset.status;render();break;case 'deletejob':case 'restorejob':draft={kind:'jobremove',action:a==='deletejob'?'delete':'restore',jobId:b.dataset.job,error:''};showModal();break;case 'jobstatus':draft={kind:'status',jobId:b.dataset.job,status:b.dataset.status,error:''};showModal();break;}});
document.addEventListener('input',e=>{if(e.target.id==='inventory-search'){search=e.target.value;$('#inventory-results').innerHTML=inventoryRows(visibleStockItems());}});
document.addEventListener('submit',e=>{if(e.target.id==='modal-form')submit(e);});
document.addEventListener('keydown',e=>{if(!draft)return;if(e.key==='Escape'){e.preventDefault();closeModal();}if(e.key==='Tab'){const list=[...document.querySelectorAll('.modal button:not(:disabled),.modal input,.modal select,.modal a')].filter(el=>el.offsetParent!==null);const first=list[0],last=list.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
window.addEventListener('hashchange',()=>{search='';render();});
render();refresh();prepareOffline(status=>{offlineStatus=status;const label=$('#offline-status');if(label)label.textContent=status;});

async function exportBackup(){
 try{
  const backup=await api('export'),json=JSON.stringify(backup,null,2),filename='workshop-backup-'+new Date().toISOString().slice(0,10)+'.json';
  if(isAndroidApp()){
   const result=await androidBackup('save',{filename,json});
   if(!result.canceled)toast('Backup saved in the location you selected.');
   return;
  }
  const blob=new Blob([json],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);toast('Save the backup in Files or another safe place.');
 }catch(error){toast(error.message);}
}
async function restoreBackupText(json,currentDraft){
 if(draft!==currentDraft)return;
 if(json.length>20*1024*1024)throw new Error('Choose a Workshop backup smaller than 20 MB.');
 const backup=JSON.parse(json);
 draft.busy=true;renderModal();await api('restore',backup);
 if(draft!==currentDraft)return;
 draft.busy=false;closeModal();await refresh();toast('Backup restored on this phone');
}
function backupError(error,currentDraft){
 if(draft!==currentDraft)return;
 draft.busy=false;draft.error=error instanceof SyntaxError?'This file is not a valid Workshop backup.':error.message;renderModal();
}
async function restoreAndroidBackup(){
 if(draft?.kind!=='phone'||draft.busy)return;
 const currentDraft=draft;
 draft.busy=true;renderModal();
 try{
  const result=await androidBackup('restore');
  if(draft!==currentDraft)return;
  if(result.canceled){draft.busy=false;renderModal();return;}
  await restoreBackupText(result.json,currentDraft);
 }catch(error){backupError(error,currentDraft);}
}
document.addEventListener('change',async event=>{
 if(event.target.id==='item-existing'){
  if(draft?.kind!=='item'||draft.step!==1||draft.busy)return;
  captureMaterialFields();draft.error='';
  const item=catalogItems().find(item=>item.id===event.target.value);
  if(item){reuseSavedMaterial(item);draft.barcode=item.barcode||'';}
  else{draft.selectedItemId='';draft.itemId=null;draft.name='';draft.unit='boxes';draft.barcode='';}
  renderModal();return;
 }
 if(event.target.id==='item-barcode'){if(!draft?.busy)reuseSavedBarcode(event.target.value);return;}
 if(event.target.id==='scan-camera'){if(!draft?.busy)startCamera(event.target.value,true);return;}
 if(event.target.id!=='restore-backup'||!event.target.files[0]||draft?.busy)return;
 const file=event.target.files[0],currentDraft=draft;
 try{if(file.size>20*1024*1024)throw new Error('Choose a Workshop backup smaller than 20 MB.');await restoreBackupText(await file.text(),currentDraft);}catch(error){backupError(error,currentDraft);}
});
