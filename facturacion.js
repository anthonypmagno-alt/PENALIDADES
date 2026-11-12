/* Facturación PDV V2.6 - resumen filtrado por PDV y buscadores de opciones. */
(()=>{'use strict';
const M=window.FacturacionMotor,Cloud=window.FacturacionCloud,Drafts=window.FacturacionBorradores,$=id=>document.getElementById(id),money=n=>n==null?'—':new Intl.NumberFormat('es-PE',{style:'currency',currency:'PEN'}).format(n),fnum=(n,dp=2)=>n==null?'—':new Intl.NumberFormat('es-PE',{minimumFractionDigits:0,maximumFractionDigits:dp}).format(n),safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),csvSafe=v=>typeof v==='string'&&/^[=+@\-\t\r]/.test(v)?"'"+v:v;
let publishedList=[],publishedSummary=[],publishedCurrent=null,pubPage=0,pubCount=0,pubBusy=false;
let reviews=new Map(),fullRows=new Map(),sourceSignatures=new Map(),db=null,config=null,rows=[],referenceRows=[],sourceStats=null,result=null,view={details:[],summary:[],totals:null},sumPage=0,detPage=0,currentTimeKey=null,currentTariffPDV=null,selectedPDVs=new Set(),allPDVs=[],periods=[],currentSnapshot=null,filterTimer=null,simulationTimer=null,simulationHours=48,importing=false,dbReady=false,cloudDraftBusy=false,cloudMeta=null,selectedSummaryKeys=new Set(),bulkSaving=false;
const todayMonth=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;};
function notify(msg,error=false){const el=$('toast');el.hidden=false;el.textContent=window.FacturacionI18n?.translateMessage(msg)||msg;el.classList.toggle('error',error);clearTimeout(notify.timeout);notify.timeout=setTimeout(()=>el.hidden=true,4500)}
function setStatus(msg){$('importStatus').textContent=msg}
function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open('facturacion_pdv_v1',1);req.onupgradeneeded=()=>{const d=req.result;for(const name of ['dataset','kv','snapshots'])if(!d.objectStoreNames.contains(name))d.createObjectStore(name,{keyPath:'id'});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
function put(store,obj){return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(obj);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
function get(store,id){return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly'),q=tx.objectStore(store).get(id);q.onsuccess=()=>resolve(q.result??null);q.onerror=()=>reject(q.error);});}
function getAll(store){return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly'),q=tx.objectStore(store).getAll();q.onsuccess=()=>resolve(q.result||[]);q.onerror=()=>reject(q.error);});}
function getKeys(store){return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly'),q=tx.objectStore(store).getAllKeys();q.onsuccess=()=>resolve(q.result||[]);q.onerror=()=>reject(q.error);});}
const LAST_PERIOD_PREFIX='facturacion_pdv_periodo_v23:',LAST_SIM_PREFIX='facturacion_pdv_sim_v23:';
function accountKey(prefix){const uid=Cloud.user()?.id;return uid?prefix+uid:null;}
function readSetting(prefix){try{const key=accountKey(prefix);return key?localStorage.getItem(key):null;}catch{return null;}}
function storeSetting(prefix,value){try{const key=accountKey(prefix);if(key)localStorage.setItem(key,String(value));}catch{/* Navegador puede bloquear storage; IndexedDB sigue siendo el borrador. */}}
function rememberWorkingState(){storeSetting(LAST_PERIOD_PREFIX,selectedPeriod());storeSetting(LAST_SIM_PREFIX,simulationHours);}
async function restoreWorkingState(){
 const last=readSetting(LAST_PERIOD_PREFIX),keys=(await getKeys('dataset')).filter(p=>/^\d{4}-(?:0[1-9]|1[0-2])$/.test(String(p))).sort().reverse();
 $('period').value=(last&&/^\d{4}-(?:0[1-9]|1[0-2])$/.test(last)?last:null)||keys[0]||todayMonth();
 const sim=M.num(readSetting(LAST_SIM_PREFIX));if(sim!==null&&sim>0){simulationHours=sim;$('simHours').value=String(sim);}
}
function syncStatus(message,error=false){const badge=$('syncBadge');if(!badge)return;badge.textContent=message;badge.classList.toggle('is-error',error);}
function draftStatus(message,error=false){const b=$('draftCloudStatus');if(!b)return;b.textContent=message;b.classList.toggle('is-error',error);}
function freezeDraftButtons(busy){for(const id of ['btnSaveCloudDraft','btnLoadCloudDraft']){const el=$(id);if(el)el.disabled=!!busy;}}
function safeDraftSource(src,period){
 if(!src||!Array.isArray(src.rows)||src.rows.length>500000)throw Error('Cantidad de guías inválida.');
 const clean=src.rows.map(r=>({guia:M.norm(r.guia),pdv:M.normalizePDV(r.pdv),dept:M.norm(r.dept),
   prov:M.norm(r.prov),dist:M.norm(r.dist),horas:M.num(r.horas),fecha:String(r.fecha||''),period}));
 if(clean.some(r=>!r.guia||!r.pdv||!r.dept||!r.prov||!r.dist||r.horas===null||r.horas<0))throw Error('Borrador contiene filas incompletas o inválidas.');
 return {id:period,rows:clean,stats:{...src.stats,valid:clean.length},headers:src.headers||[],
   file:src.file||'Borrador Supabase',uploadedAt:src.uploadedAt||'',remoteVersion:src.remoteVersion||0,sourceId:src.sourceId||('remote-'+Date.now())};
}
async function fetchDraftMeta(period){cloudMeta=await Drafts.meta(period);return cloudMeta;}
async function restoreCloudDraft({automatic=false}={}){
 if(!Cloud.admin()||cloudDraftBusy)return;
 const p=selectedPeriod();cloudDraftBusy=true;freezeDraftButtons(true);
 try{
  draftStatus('Consultando borrador de '+p+'…');
  const current=await Drafts.meta(p);cloudMeta=current;
  if(!current){draftStatus('No hay borrador guardado en Supabase para '+p);if(!automatic)notify('No existe borrador en Supabase para '+p,true);return;}
  const local=await get('dataset',p);
  if(local?.rows?.length){
    if(automatic){
      if((local.remoteVersion||0)<current.version)draftStatus('Hay una versión nueva en Supabase (v'+current.version+'). Pulsa Recuperar para reemplazar la copia local.',true);
      else draftStatus('Borrador sincronizado v'+current.version+' · '+current.filas+' guías');
      return;
    }
    if(!confirm('La recuperación reemplazará tu borrador LOCAL de '+p+' ('+local.rows.length+' guías) con la versión v'+current.version+' de Supabase. ¿Continuar?'))return;
  }
  draftStatus('Descargando versión '+current.version+'…');
  const src=await Drafts.download(current);if(selectedPeriod()!==p)throw Error('El periodo cambió durante la descarga. Repite la operación.');
  const clean=safeDraftSource(src,p);clean.remoteVersion=current.version;
  await put('dataset',clean);draftStatus('Borrador recuperado v'+current.version+' · '+clean.rows.length+' guías');
  notify('Borrador recuperado desde Supabase: '+clean.rows.length+' guías.');
  await loadPeriod({skipRemote:true});
 }catch(e){draftStatus('No se recuperó: '+e.message,true);notify('Recuperación Supabase: '+e.message,true);console.error(e);}
 finally{cloudDraftBusy=false;freezeDraftButtons(false);}
}
async function saveCloudDraft({automatic=false}={}){
 if(!Cloud.admin()||cloudDraftBusy)return;
 const p=selectedPeriod(),src=await get('dataset',p);
 if(!src?.rows?.length){if(!automatic)notify('No hay guías para guardar en '+p,true);return;}
 cloudDraftBusy=true;freezeDraftButtons(true);
 try{
  draftStatus('Comprobando versión remota…');
  const server=await Drafts.meta(p);cloudMeta=server;
  const expected=src.remoteVersion||0;
  // No reemplazar silenciosamente un cambio remoto: bloqueo optimista.
  if(server&&expected&&server.version!==expected)throw Error('Otra persona guardó la versión v'+server.version+'; recupera el borrador o revisa las diferencias antes de guardar.');
  if(server&&!expected){
    if(automatic){draftStatus('Borrador remoto v'+server.version+' ya existe. Confirma manualmente el reemplazo para evitar sobrescribirlo.',true);return;}
    if(!confirm('Ya existe un borrador compartido v'+server.version+' de '+p+'. ¿Quieres REEMPLAZARLO con tu copia local?'))return;
  }
  draftStatus('Comprimiendo y subiendo '+src.rows.length+' guías a Supabase…');
  const saved=await Drafts.save(p,src,server?.version||0);
  const now=await get('dataset',p);
  if(now&&now.rows?.length===src.rows.length&&now.file===src.file&&now.uploadedAt===src.uploadedAt&&now.sourceId===src.sourceId){
    await put('dataset',{...now,remoteVersion:saved.version,remotePath:saved.objeto});
  }else{draftStatus('Se guardó la versión anterior, pero el borrador local cambió durante la subida. Vuelve a guardar.',true);}
  draftStatus('Guardado en Supabase · v'+saved.version+' · '+saved.filas+' guías');
  syncStatus('Borrador de '+p+' guardado en Supabase v'+saved.version);
  notify('Borrador guardado en Supabase ('+saved.filas+' guías).');
  // Limpieza selectiva de la versión anterior para ahorrar espacio, después del commit.
  // NO borrar si existe la mínima duda de que ahora es el objeto vigente.
  if(server?.objeto&&server.objeto!==saved.objeto){
    try{const latest=await Drafts.meta(p);if(latest?.objeto===saved.objeto){
      await Cloud.create().storage.from('facturacion-borradores').remove([server.objeto]);
    }}catch(e){console.warn('Archivo de borrador anterior no eliminado',e);}
  }
 }catch(e){draftStatus('No se guardó: '+e.message,true);syncStatus('Borrador local sin sincronizar',true);notify('Error borrador remoto: '+e.message,true);console.error(e);}
 finally{cloudDraftBusy=false;freezeDraftButtons(false);}
}


function initialConfig(){return{rule:{rate:10,step:24,maxExcess:120},minGuides:10,times:{},tariffs:{}};}
async function saveConfig(){throw Error('Configuración compartida: usa guardar tiempos, tarifas o reglas en Supabase.');}
function selectedPeriod(){return $('period').value||todayMonth();}
function th(v){return v==null?'—':fnum(v,2)+' h'}
function renderExamples(){const rule=config.rule,base=72;const list=[72,80,96,120,192,192.1].map(t=>({t,...M.discount(t,base,rule)}));$('ruleExamples').innerHTML=list.map(o=>`<div class="rule-example"><strong class="${o.payPct===0?'bad':o.payPct===100?'ok':''}">${fnum(o.payPct)}%</strong>${fnum(o.t,1)} h</div>`).join('');}
async function updateAvailablePeriods(){
 periods=(await getKeys('dataset')).map(String).sort().reverse();
 const current=selectedPeriod(),previous=config?.refPeriod||current;
 const opts=[...new Set([current,previous,...periods])];
 $('refPeriod').innerHTML=opts.map(p=>`<option value="${safe(p)}">${safe(p)}${p===current?' · periodo actual':''}${p===previous&&p!==current?' · referencia guardada':''}</option>`).join('');
 $('refPeriod').value=opts.includes(previous)?previous:current;
}
async function loadPeriod({skipRemote=false}={}){
 if(!Cloud.profile())return;
 const p=selectedPeriod();
 syncStatus('Cargando configuración de '+p+' desde Supabase…');
 $('period').dataset.periodLoaded=p;
 config={...initialConfig(),...await Cloud.loadConfig(p)};
 config.rule={...initialConfig().rule,...(config.rule||{})};
 config.times=config.times||{};config.tariffs=config.tariffs||{};
 reviews=new Map((await Cloud.loadReviews(p)).map(x=>[x.clave,x]));
 selectedSummaryKeys.clear();
 $('rate').value=config.rule.rate;$('step').value=config.rule.step;
 $('maxExcess').value=config.rule.maxExcess;$('minGuides').value=config.minGuides;
 renderExamples();
 let src=await get('dataset',p);
 if(!skipRemote&&!cloudDraftBusy){
   try{const remote=await Drafts.meta(p);cloudMeta=remote;
     if(remote){
       if(!src?.rows?.length){
         draftStatus('Recuperando automáticamente v'+remote.version+' desde Supabase…');
         const data=await Drafts.download(remote);
         if(selectedPeriod()!==p)return;
         src=safeDraftSource(data,p);src.remoteVersion=remote.version;await put('dataset',src);
         draftStatus('Borrador remoto v'+remote.version+' recuperado · '+remote.filas+' guías');
       } else if(src.remoteVersion===remote.version){
         draftStatus('Borrador sincronizado v'+remote.version+' · '+remote.filas+' guías');
       } else if(!src.remoteVersion||src.remoteVersion<remote.version){
         draftStatus('Existe un borrador remoto v'+remote.version+' diferente del local. Usa Recuperar o Guardar con confirmación.',true);
       }else{draftStatus('Borrador local más reciente: revisa la sincronización.',true);}
     }else draftStatus(src?.rows?.length?'Borrador solo local; guarda en Supabase.':'Aún no existe borrador remoto.');
   }catch(e){draftStatus('No se pudo consultar el borrador remoto: '+e.message,true);}
 }
 rows=src?.rows||[];sourceStats=src?.stats||null;
 selectedPDVs.clear();
 for(const id of ['fDept','fProv','fDist','fSearch','fEstado',...summaryFilterIds])$(id).value='';
 await updateAvailablePeriods();await calculate();
 setStatus(src?`Borrador local: ${src.file||'archivo'} · ${src.uploadedAt||''}`:`Sin archivo local para ${p}. Importa MODULADOR.xlsx.`);
 $('srcBadge').textContent=src?`${fnum(rows.length,0)} guías · ${src.stats?.duplicates||0} duplicadas omitidas · ${src.stats?.high||0} >720 h`:'Sin registros';
 rememberWorkingState();syncStatus('Configuración de '+p+' recuperada de Supabase');
}
async function chooseReferenceRows(){
 const rp=$('refPeriod').value||selectedPeriod();if(rp===selectedPeriod())return rows;
 const src=await get('dataset',rp);
 if(!src?.rows?.length)throw Error('Falta importar localmente el periodo de referencia '+rp+' para calcular el ranking de tiempos. No se utilizará silenciosamente otro periodo.');
 return src.rows;
}
async function calculate(){if(!rows.length){result=null;view={details:[],summary:[],totals:null};allPDVs=[];fullRows.clear();sourceSignatures.clear();renderAll();return;}try{referenceRows=await chooseReferenceRows();result=M.run(rows,{period:selectedPeriod(),...config},referenceRows);fullRows=new Map(result.summary.map(x=>[x.key,x]));indexSourceSignatures();allPDVs=[...new Set(result.summary.map(x=>x.pdv))].sort();renderPDVFilter();populateGeoOptions();populateSummaryOptions();applyFilters();}catch(e){result=null;view={details:[],summary:[],totals:null};renderAll();setStatus(e.message);notify('Error calculando resultados: '+e.message,true);console.error(e);}}
function searchNorm(v){return String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();}
function filterPDVOptions(){
 const input=$('pdvSearch');if(!input)return;
 const q=searchNorm(input.value),choices=$('pdvChecks'),options=[...choices.querySelectorAll('label[data-pdv-option]')];let visible=0;
 for(const label of options){const matched=!q||searchNorm(label.dataset.pdvOption).includes(q);label.hidden=!matched;if(matched)visible++;}
 $('pdvSearchCount').textContent=q?`${visible} de ${options.length} PDV`:`${options.length} PDV disponibles`;
}
function renderPDVFilter(){
 selectedPDVs=new Set([...selectedPDVs].filter(p=>allPDVs.includes(p)));
 const zone=$('pdvChecks');zone.innerHTML=`<label class="pdv-option"><input type="checkbox" data-pdv-all ${selectedPDVs.size===0?'checked':''}> Todos los PDV</label>`+allPDVs.map(p=>`<label class="pdv-option" data-pdv-option="${safe(p)}"><input type="checkbox" data-pdv="${safe(p)}" ${selectedPDVs.has(p)?'checked':''}> ${safe(p)}</label>`).join('');
 $('pdvLabel').textContent=selectedPDVs.size?`${selectedPDVs.size} PDV seleccionados`:'Todos los PDV';filterPDVOptions();
}
// Buscador de listas que no cambia el valor del filtro hasta elegir una opción.
// Se construye sobre el SELECT existente: siguen funcionando todos los listeners originales.
function installFilterSearches(){
 const ids=['fDept','fProv','fDist','fMuestra','fMejorPDV','fOK','fUmbral','fTiempo','fTarifa','fObs','fEstado','pubSettlement','pubPDV'];
 let opened=null;
 function close(){if(opened){opened.wrapper.classList.remove('search-open');opened.button.setAttribute('aria-expanded','false');opened.menu.hidden=true;opened=null;}}
 for(const id of ids){
  const sel=$(id);if(!sel||sel.closest('.filter-search-wrap'))continue;
  const label=sel.closest('label.field');if(!label)continue;
  const wrapper=document.createElement('div');wrapper.className='filter-search-wrap';label.before(wrapper);wrapper.appendChild(label);
  const button=document.createElement('button');button.type='button';button.className='filter-search-toggle';button.textContent='⌕';button.title='Buscar opción en '+(label.querySelector('span')?.textContent||id);button.setAttribute('aria-label',button.title);button.setAttribute('aria-expanded','false');wrapper.appendChild(button);
  const menu=document.createElement('div');menu.className='filter-search-menu';menu.hidden=true;
  const search=document.createElement('input');search.type='search';search.className='filter-search-input';search.autocomplete='off';search.placeholder='Escribe para buscar…';search.setAttribute('aria-label','Buscar opción de '+id);menu.appendChild(search);
  const items=document.createElement('div');items.className='filter-search-results';items.setAttribute('role','listbox');menu.appendChild(items);wrapper.appendChild(menu);
  function draw(){
   const q=searchNorm(search.value),opts=Array.from(sel.options).filter(o=>!o.disabled),matched=opts.filter(o=>!q||searchNorm(o.textContent).includes(q)||searchNorm(o.value).includes(q));
   items.replaceChildren();const limit=100;
   for(const option of matched.slice(0,limit)){
    const item=document.createElement('button');item.type='button';item.className='filter-search-result';item.setAttribute('role','option');item.setAttribute('aria-selected',String(sel.value===option.value));item.textContent=option.textContent||option.value;
    item.addEventListener('click',()=>{sel.value=option.value;sel.dispatchEvent(new Event('change',{bubbles:true}));close();sel.focus();});items.appendChild(item);
   }
   if(!matched.length||matched.length>limit){const hint=document.createElement('p');hint.className='filter-search-note';hint.textContent=!matched.length?'Sin coincidencias.':`Mostrando ${limit} de ${matched.length}. Escribe para afinar.`;items.appendChild(hint);}
  }
  button.addEventListener('click',e=>{e.preventDefault();if(opened?.wrapper===wrapper){close();return;}close();opened={wrapper,button,menu};wrapper.classList.add('search-open');button.setAttribute('aria-expanded','true');menu.hidden=false;search.value='';draw();search.focus();});
  search.addEventListener('input',draw);
  search.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close();button.focus();}if(e.key==='Enter'){const first=items.querySelector('.filter-search-result');if(first){e.preventDefault();first.click();}}});
 }
 document.addEventListener('pointerdown',e=>{if(opened&&!opened.wrapper.contains(e.target))close();});
 document.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
}

function populateGeoOptions(){const s=result?.summary||[];const oldD=$('fDept').value,oldP=$('fProv').value,oldZ=$('fDist').value;
 for(const [id,key,fn] of [['fDept','dept',()=>true],['fProv','prov',x=>!$('fDept').value||x.dept===$('fDept').value],['fDist','dist',x=>(!$('fDept').value||x.dept===$('fDept').value)&&(!$('fProv').value||x.prov===$('fProv').value)]]){const el=$(id),old={fDept:oldD,fProv:oldP,fDist:oldZ}[id],items=[...new Set(s.filter(fn).map(x=>x[key]))].sort();el.innerHTML=`<option value="">${id==='fProv'?'Todas':'Todos'}</option>`+items.map(x=>`<option value="${safe(x)}">${safe(x)}</option>`).join('');if(items.includes(old))el.value=old;}}
const summaryFilterIds=['fMuestra','fMejorPDV','fOK','fUmbral','fTiempo','fTarifa','fObs'];
// Firma estable por guia y tiempo: no depende del orden del Excel ni de cuando se importó.
// Así, un OK aparece en otro navegador que importó exactamente los mismos datos.
function hashRow(row){let h=2166136261;const v=String(row.guia)+'|'+String(row.horas)+'|'+String(row.fecha||'');for(let i=0;i<v.length;i++){h^=v.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
function indexSourceSignatures(){
 const states=new Map();for(const r of rows){const k=M.localKey(selectedPeriod(),r.dept,r.prov,r.dist,r.pdv),h=hashRow(r),v=states.get(k)||{sum:0,xor:0};v.sum=(v.sum+h)>>>0;v.xor=(v.xor^h)>>>0;states.set(k,v);}
 sourceSignatures=new Map([...states].map(([k,v])=>[k,v.sum.toString(16)+'-'+v.xor.toString(16)]));
}

function stableStringify(v){
 if(Array.isArray(v))return '['+v.map(stableStringify).join(',')+']';
 if(v!==null&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stableStringify(v[k])).join(',')+'}';
 return JSON.stringify(v===undefined?null:v);
}
function reviewFingerprint(g){
 const row=fullRows.get(g.key)||g;
 const round=v=>v==null?null:Math.round(v*1000000)/1000000;
 return stableStringify([selectedPeriod(),sourceSignatures.get(row.key)||'',row.key,row.count,round(row.promedio),row.bestPDV,
 round(row.bestHours),round(row.establecido),row.umbralEst,row.tariffOrigin,config.refPeriod,config.rule,
 config.tariffs[row.pdv]||null,config.times[row.key]||null]);
}
function approvalFor(g){
 const r=reviews.get(g.key);return r?.aprobado_ok===true && r.huella===reviewFingerprint(g)?r:null;
}
function filterPresence(value,selector){return !selector||(selector==='CON'?!!value:!value);}
function summaryMatches(g){
 if(!g)return false;
 const sample=$('fMuestra').value,ok=$('fOK').value,threshold=$('fUmbral').value,best=$('fMejorPDV').value;
 if(!filterPresence(!!g.bestPDV,sample))return false;
 if(best==='SIN'&&g.bestPDV)return false;
 if(best&&best!=='SIN'&&best!==g.bestPDV)return false;
 if(!filterPresence(!!approvalFor(g),ok))return false;
 if(threshold==='SIN' && g.umbralEst!=null)return false;
 if(threshold && threshold!=='SIN' && String(g.umbralEst)!==threshold)return false;
 if(!filterPresence(g.establecido!=null,$('fTiempo').value))return false;
 if(!filterPresence(g.tariffOrigin!=='SIN_TARIFA',$('fTarifa').value))return false;
 if(!filterPresence(!!String(g.observaciones||'').trim(),$('fObs').value))return false;
 return true;
}
function populateSummaryOptions(){
 $('muestraMinLabel').textContent=`Muestra mínima (${config.minGuides||10} guías)`;
 const best=$('fMejorPDV'),oldBest=best.value;
 const opts=[...new Set((result?.summary||[]).map(g=>g.bestPDV).filter(Boolean))].sort();
 best.innerHTML='<option value="">Todos</option><option value="SIN">Sin mejor PDV</option>'+opts.map(p=>`<option value="${safe(p)}">${safe(p)}</option>`).join('');
 if(oldBest==='SIN'||opts.includes(oldBest))best.value=oldBest;
 const el=$('fUmbral'),old=el.value;
 const values=[...new Set((result?.summary||[]).map(g=>g.umbralEst).filter(x=>x!=null))].sort((a,b)=>a-b);
 el.innerHTML='<option value="">Todos los umbrales</option><option value="SIN">Sin umbral</option>'+values.map(h=>`<option value="${safe(h)}">${safe(h)} h</option>`).join('');
 if(old==='SIN'||values.some(v=>String(v)===old))el.value=old;
}
async function toggleReview(key,approved,checkbox){
 const g=fullRows.get(key);if(!g)return;
 const previous=approvalFor(g);
 if(approved&&(g.umbralEst==null||g.tariffOrigin==='SIN_TARIFA')){
  checkbox.checked=false;notify('No se puede aprobar una fila sin umbral establecido o sin tarifa.',true);return;
 }
 checkbox.disabled=true;
 try{
  const saved=await Cloud.saveReview(selectedPeriod(),g,approved,approved?reviewFingerprint(g):'');
  reviews.set(key,saved);
  applyFilters();notify(approved?'OK registrado en Supabase.':'OK retirado.');
 }catch(e){checkbox.checked=!!previous;checkbox.disabled=false;notify('No se guardó el OK: '+e.message,true);}
}
function filteredDetailRows(){if(!result)return[];const d=$('fDept').value,p=$('fProv').value,z=$('fDist').value,s=M.norm($('fSearch').value),e=$('fEstado').value;
 const enabledGroups=new Set(result.summary.filter(summaryMatches).map(g=>g.key));
 return result.details.filter(r=>(!d||r.dept===d)&&(!p||r.prov===p)&&(!z||r.dist===z)&&(!selectedPDVs.size||selectedPDVs.has(r.pdv))&&(!s||r.guia.includes(s)||r.pdv.includes(s)||r.dist.includes(s))&&(!e||(e==='CERO POR EXCESO'?r.ceroMax:r.estado===e))&&enabledGroups.has(M.localKey(selectedPeriod(),r.dept,r.prov,r.dist,r.pdv)));
}
function accumulate(filtered){const groups=new Map(),look=new Map((result?.summary||[]).map(g=>[g.key,g]));const tot={guias:0,bruto:0,descuentos:0,simNet:0,diffNet:0,neto:0,calculadas:0,pendientes:0,fuera:0,cero:0};
 for(const r of filtered){const k=M.localKey(selectedPeriod(),r.dept,r.prov,r.dist,r.pdv);let g=groups.get(k);if(!g){const source=look.get(k);if(!source)continue;g={...source,count:0,timeSum:0,promedio:0,gross:0,discount:0,simNet:0,diffNet:0,net:0,billable:0,excluded:0,breached:0,zero:0};groups.set(k,g);}g.count++;g.timeSum+=r.horas;tot.guias++;
  if(r.neto!=null){const simulated=M.simulatedNet(r,simulationHours,config.rule),difference=simulated==null?null:M.money(r.neto-simulated);
   if(simulated!==null){g.simNet=M.money(g.simNet+simulated);tot.simNet=M.money(tot.simNet+simulated);g.diffNet=M.money(g.diffNet+difference);tot.diffNet=M.money(tot.diffNet+difference);}
   g.gross=M.money(g.gross+r.tarifa);g.discount=M.money(g.discount+r.descuento);g.net=M.money(g.net+r.neto);g.billable++;tot.bruto=M.money(tot.bruto+r.tarifa);tot.descuentos=M.money(tot.descuentos+r.descuento);tot.neto=M.money(tot.neto+r.neto);tot.calculadas++;if(r.exceso>0){tot.fuera++;g.breached++;}if(r.pagoPct===0){tot.cero++;g.zero++;}}else{g.excluded++;tot.pendientes++;}
 }
 const summary=[...groups.values()].map(g=>({...g,promedio:g.timeSum/g.count})).sort((a,b)=>a.dept.localeCompare(b.dept)||a.prov.localeCompare(b.prov)||a.dist.localeCompare(b.dist)||a.pdv.localeCompare(b.pdv));return {summary,tot};}
function applyFilters(){const det=filteredDetailRows(),data=accumulate(det);view={details:det,summary:data.summary,totals:data.tot};
 const permitted=new Set(data.summary.map(g=>g.key));for(const key of selectedSummaryKeys)if(!permitted.has(key))selectedSummaryKeys.delete(key);
 sumPage=0;detPage=0;renderAll();}
function refreshSimulation(){
 if(!view.details.length){renderSimulationInfo();return;}
 const data=accumulate(view.details);view.summary=data.summary;view.totals=data.tot;
 renderPDVSummary();renderSummary();renderDetail();renderSimulationInfo();
}
function renderSimulationInfo(){
 const label=fnum(simulationHours,2)+' h';
 $('colNetoSim').textContent='Neto simulación '+label;$('colDiferenciaSim').textContent='Diferencia vs '+label;
 $('colDetSim').textContent='Neto simulación '+label;$('colDetDiff').textContent='Diferencia vs '+label;
 const t=view.totals;
 $('simTotals').textContent=t&&t.guias?`Simulado ${label}: ${money(t.simNet)} · Diferencia: ${formatDifference(t.diffNet)}${t.pendientes?' · Solo guías con neto real':''}`:`Simulado ${label}: —`;
}
function formatDifference(n){return n==null?'—':(n>0?'+':'')+money(n);}
function differenceClass(n){return n>0?'diff-positive':n<0?'diff-negative':'diff-neutral';}
function renderAll(){renderKPIs();renderPDVSummary();renderSummary();renderDetail();renderSimulationInfo();renderTariffs();renderCloseStatus();}
function renderKPIs(){const t=view.totals;$('kGuias').textContent=t?fnum(t.guias,0):'—';$('kBruto').textContent=t?money(t.bruto):'—';$('kDescuento').textContent=t?money(t.descuentos):'—';$('kNeto').textContent=t?money(t.neto):'—';$('kPendientes').textContent=t?fnum(t.pendientes,0):'—';}
function pageSummaryRows(){return view.summary.slice(sumPage*40,(sumPage+1)*40);}
function updateSummarySelectionUI(){
 const page=pageSummaryRows(),pageKeys=page.map(g=>g.key),pageSelected=pageKeys.filter(k=>selectedSummaryKeys.has(k)).length;
 const head=$('summarySelectPage');head.disabled=!pageKeys.length;head.checked=!!pageKeys.length&&pageSelected===pageKeys.length;head.indeterminate=pageSelected>0&&pageSelected<pageKeys.length;
 $('summarySelectionCount').textContent=selectedSummaryKeys.size+' filas seleccionadas';
 $('btnBulkTime').textContent='Configurar selección ('+selectedSummaryKeys.size+')';$('btnBulkTime').disabled=!selectedSummaryKeys.size||bulkSaving;
 $('btnClearSummarySelection').disabled=!selectedSummaryKeys.size||bulkSaving;
 $('btnSelectSummaryPage').disabled=!pageKeys.length||bulkSaving;$('btnSelectSummaryFiltered').disabled=!view.summary.length||bulkSaving;
 for(const tr of $('summaryBody').querySelectorAll('[data-summary-row]')){
   const active=selectedSummaryKeys.has(tr.dataset.summaryRow);tr.classList.toggle('is-summary-selected',active);
   const box=tr.querySelector('[data-select-summary]');if(box)box.checked=active;
 }
}
// Agrupación a partir de las mismas filas del resumen filtrado. No sumamos promedio de promedios.
function summarizeByPDV(summary,overrideSim){
 const groups=new Map();
 for(const g of summary){
  let x=groups.get(g.pdv);
  if(!x){x={pdv:g.pdv,districts:new Set(),guias:0,hours:0,ok:0,pending:0,bruto:0,descuentos:0,simNet:0,diffNet:0,neto:0};groups.set(g.pdv,x);}
  x.districts.add([g.dept,g.prov,g.dist].join('|'));
  x.guias+=Number(g.count)||0;x.hours+=Number(g.timeSum??(g.promedio*g.count))||0;
  x.ok+=(approvalFor(g)||g.revisionOk===true)?1:0;
  x.pending+=Number(g.excluded)||0;
  x.bruto=M.money(x.bruto+(Number(g.gross)||0));x.descuentos=M.money(x.descuentos+(Number(g.discount)||0));x.neto=M.money(x.neto+(Number(g.net)||0));
  const sim=overrideSim?overrideSim.get(g.key):g;
  x.simNet=M.money(x.simNet+(Number(sim?.simNet)||0));x.diffNet=M.money(x.diffNet+(Number(sim?.diffNet)||0));
 }
 return [...groups.values()].map(x=>({...x,distritos:x.districts.size,promedio:x.guias?x.hours/x.guias:null})).sort((a,b)=>a.pdv.localeCompare(b.pdv));
}
function renderPDVSummary(){
 const list=summarizeByPDV(view.summary),total=view.totals;
 $('pdvSummaryCount').textContent=`${fnum(list.length,0)} PDV · ${fnum(total?.guias||0,0)} guías`;
 const h=fnum(simulationHours,2)+' h';$('pdvSimHeading').textContent='Neto simulación '+h;$('pdvDiffHeading').textContent='Diferencia vs '+h;
 $('pdvSummaryBody').innerHTML=list.length?list.map(g=>`<tr><td><b>${safe(g.pdv)}</b></td><td>${fnum(g.distritos,0)}</td><td>${fnum(g.guias,0)}</td><td>${th(g.promedio)}</td><td>${fnum(g.ok,0)}</td><td>${fnum(g.pending,0)}</td><td>${money(g.bruto)}</td><td>${money(g.descuentos)}</td><td class="simulated-amount">${money(g.simNet)}</td><td class="${differenceClass(g.diffNet)}">${formatDifference(g.diffNet)}</td><td class="amount">${money(g.neto)}</td><td><button type="button" class="btn-mini" data-pdv-drill="${safe(g.pdv)}">Ver distritos</button></td></tr>`).join(''):'<tr><td colspan="12" class="empty">Sin resultados para estos filtros.</td></tr>';
 const totalDistritos=list.reduce((a,g)=>a+g.distritos,0),totalOK=list.reduce((a,g)=>a+g.ok,0),totalHours=list.reduce((a,g)=>a+g.hours,0);
 $('pdvSummaryFoot').innerHTML=list.length?`<tr><td>TOTAL FILTRADO</td><td>${fnum(totalDistritos,0)}</td><td>${fnum(total.guias,0)}</td><td>${th(total.guias?totalHours/total.guias:null)}</td><td>${fnum(totalOK,0)}</td><td>${fnum(total.pendientes,0)}</td><td>${money(total.bruto)}</td><td>${money(total.descuentos)}</td><td class="simulated-amount">${money(total.simNet)}</td><td class="${differenceClass(total.diffNet)}">${formatDifference(total.diffNet)}</td><td class="amount">${money(total.neto)}</td><td></td></tr>`:'';
}
function renderSummary(){const list=view.summary,per=40,n=Math.max(1,Math.ceil(list.length/per));sumPage=Math.min(sumPage,n-1);const okCount=list.reduce((n,g)=>n+(approvalFor(g)?1:0),0);$('summaryCount').textContent=`${fnum(list.length,0)} filas · ${fnum(view.details.length,0)} guías · ${okCount} con OK`;
 $('summaryBody').innerHTML=list.length?list.slice(sumPage*per,(sumPage+1)*per).map(g=>`<tr data-summary-row="${safe(g.key)}" class="${selectedSummaryKeys.has(g.key)?'is-summary-selected':''}"><td class="summary-select-cell"><input type="checkbox" data-select-summary="${safe(g.key)}" aria-label="Seleccionar ${safe(g.pdv)} ${safe(g.dist)}" ${selectedSummaryKeys.has(g.key)?'checked':''}></td><td>${safe(g.dept)}</td><td>${safe(g.prov)}</td><td>${safe(g.dist)}</td><td><b>${safe(g.pdv)}</b></td><td class="summary-approval ${approvalFor(g)?'ok-row':reviews.get(g.key)?.aprobado_ok?'stale-row':''}" title="${approvalFor(g)?'Aprobado por '+safe(approvalFor(g).aprobado_por)+' el '+safe(approvalFor(g).aprobado_en):reviews.get(g.key)?.aprobado_ok?'Se modificó información. Requiere nuevo OK.':'Sin OK'}"><input type="checkbox" aria-label="OK ${safe(g.pdv)} ${safe(g.dist)}" data-review="${safe(g.key)}" ${approvalFor(g)?'checked':''} ${g.umbralEst==null||g.tariffOrigin==='SIN_TARIFA'?'disabled':''}></td><td>${fnum(g.count,0)}</td><td>${th(g.promedio)}</td><td>${g.bestPDV?safe(g.bestPDV):'<span class="bad">Muestra insuficiente</span>'}</td><td>${th(g.bestHours)}</td><td>${th(g.umbral)}</td><td>${th(g.consolidacion)}</td><td>${th(g.retraslado)}</td><td>${th(g.adicional)}</td><td>${th(g.necesario)}</td><td>${th(g.establecido)}</td><td class="${g.umbralEst==null?'bad':'warn'}">${th(g.umbralEst)}</td><td>${safe(g.tariffOrigin)}</td><td>${money(g.gross)}</td><td>${money(g.discount)}</td><td class="simulated-amount">${money(g.simNet)}</td><td class="${differenceClass(g.diffNet)}">${formatDifference(g.diffNet)}</td><td class="amount">${money(g.net)}</td><td class="truncate" title="${safe(g.observaciones)}">${safe(g.observaciones)}</td><td><button class="btn-mini" data-time="${safe(g.key)}">Configurar</button></td></tr>`).join(''):`<tr><td colspan="25" class="empty">Sin registros para estos filtros.</td></tr>`;
 const t=view.totals;$('summaryFoot').innerHTML=t&&t.guias?`<tr><td colspan="6">TOTAL FILTRADO</td><td>${fnum(t.guias,0)}</td><td colspan="11"></td><td>${money(t.bruto)}</td><td>${money(t.descuentos)}</td><td class="simulated-amount">${money(t.simNet)}</td><td class="${differenceClass(t.diffNet)}">${formatDifference(t.diffNet)}</td><td>${money(t.neto)}</td><td colspan="2"></td></tr>`:'';$('sumPage').textContent=`Página ${sumPage+1} de ${n}`;$('sumPrev').disabled=sumPage<=0;$('sumNext').disabled=sumPage>=n-1;
 updateSummarySelectionUI();
}

function renderDetail(){const list=view.details,per=100,n=Math.max(1,Math.ceil(list.length/per));detPage=Math.min(detPage,n-1);
 $('detailBody').innerHTML=list.length?list.slice(detPage*per,(detPage+1)*per).map(r=>{const sim=M.simulatedNet(r,simulationHours,config.rule),diff=sim==null?null:M.money(r.neto-sim);return `<tr><td><b>${safe(r.guia)}</b></td><td>${safe(r.pdv)}</td><td>${safe(r.dept)}</td><td>${safe(r.prov)}</td><td>${safe(r.dist)}</td><td>${safe(r.fecha)}</td><td>${th(r.horas)}</td><td>${th(r.establecido)}</td><td class="${r.umbralEst==null?'bad':'warn'}">${th(r.umbralEst)}</td><td>${th(r.exceso)}</td><td>${money(r.tarifa)}</td><td class="${r.reduccion>0?'bad':''}">${r.reduccion==null?'—':fnum(r.reduccion)+'%'}</td><td class="${r.pagoPct===0?'bad':'ok'}">${r.pagoPct==null?'—':fnum(r.pagoPct)+'%'}</td><td>${money(r.descuento)}</td><td class="simulated-amount">${money(sim)}</td><td class="${differenceClass(diff)}">${formatDifference(diff)}</td><td class="amount">${money(r.neto)}</td><td>${r.ceroMax?'<span class="bad">CERO POR EXCESO</span>':safe(r.estado)}</td></tr>`}).join(''):`<tr><td colspan="18" class="empty">Sin guías para estos filtros.</td></tr>`;
 $('detPage').textContent=`Página ${detPage+1} de ${n} · ${fnum(list.length,0)} registros`;$('detPrev').disabled=detPage<=0;$('detNext').disabled=detPage>=n-1;
}
function renderTariffs(){const list=[...new Set((result?.summary||[]).map(g=>g.pdv))].sort();$('tariffBody').innerHTML=list.length?list.map(p=>{const t=config.tariffs[p]||{},zones=Object.keys(t.zones||{}).filter(k=>M.num(t.zones[k])!==null);return `<tr><td><b>${safe(p)}</b></td><td>${safe(t.mode||'NO DEFINIDA')}</td><td>${money(M.num(t.standard))}</td><td>${zones.length}</td><td><button class="btn-mini" data-tariff="${safe(p)}">Configurar</button></td></tr>`}).join(''):'<tr><td colspan="5" class="empty">No hay PDV cargados.</td></tr>';}
function renderCloseStatus(){const t=result?.totals||null;if(!t){$('closeTitle').textContent='Sin guías cargadas';$('closeMessage').textContent='Carga un archivo para comenzar.';$('btnClose').disabled=true;return;}
 $('closeTitle').textContent=`Periodo ${selectedPeriod()} · ${fnum(t.guias,0)} guías`;$('closeMessage').textContent=(sourceStats?.pdvConflicts>0)?`Existen ${sourceStats.pdvConflicts} guías con más de un PDV en el Excel. Corrige esos casos en el archivo original y vuelve a importar antes del cierre.`:t.pendientes?`${fnum(t.pendientes,0)} guías no tienen tarifa o tiempo base. Debes resolverlas antes de finalizar. El cierre usa TODAS las guías del periodo, no solo los filtros visibles.`:`Todas las ${fnum(t.calculadas,0)} guías tienen tarifa y tiempo base. Puedes congelar una versión final de esta liquidación.`;$('btnClose').disabled=t.pendientes>0||(sourceStats?.pdvConflicts||0)>0||importing;
}
function openTime(k){const g=result?.summary.find(x=>x.key===k);if(!g)return;currentTimeKey=k;const t=config.times[k]||{};$('timeIdentity').textContent=`${g.pdv} · ${g.dept} / ${g.prov} / ${g.dist} · Mejor tiempo: ${th(g.bestHours)}`;
 for(const [id,prop] of [['tConsolidacion','consolidacion'],['tRetraslado','retraslado'],['tAdicional','adicional'],['tNecesario','necesario'],['tManual','manualBase']])$(id).value=t[prop]??'';$('tObs').value=t.observaciones||'';$('timeSaveStatus').textContent='';$('timeDialog').showModal();}
async function saveTime(){
 if(!Cloud.admin())throw Error('No autorizado.');
 const g=result?.summary.find(x=>x.key===currentTimeKey);if(!g)throw Error('No se encuentra el PDV/distrito.');
 const fields={consolidacion:$('tConsolidacion').value,retraslado:$('tRetraslado').value,
  adicional:$('tAdicional').value,necesario:$('tNecesario').value,manualBase:$('tManual').value};
 for(const [k,v] of Object.entries(fields))if(v!==''&&(!Number.isFinite(Number(v))||Number(v)<0))throw Error('Valor negativo o inválido en '+k);
 const value={...Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v===''?null:Number(v)])),observaciones:$('tObs').value.trim()};
 await Cloud.saveTime(selectedPeriod(),g,value);
 reviews.delete(currentTimeKey);config.times[currentTimeKey]=value;await calculate();syncStatus('Tiempos guardados en Supabase · '+selectedPeriod());notify('Tiempos compartidos guardados en Supabase.');
}
const BULK_TIME_FIELDS=[
 ['consolidacion','bulkApplyConsolidacion','bulkConsolidacion'],
 ['retraslado','bulkApplyRetraslado','bulkRetraslado'],
 ['adicional','bulkApplyAdicional','bulkAdicional'],
 ['necesario','bulkApplyNecesario','bulkNecesario'],
 ['manualBase','bulkApplyManual','bulkManual'],
 ['observaciones','bulkApplyObs','bulkObs']
];
function openBulkTime(){
 if(!Cloud.admin()||!selectedSummaryKeys.size||bulkSaving)return;
 const ids=new Set(view.summary.map(g=>g.key));for(const key of selectedSummaryKeys)if(!ids.has(key))selectedSummaryKeys.delete(key);
 if(!selectedSummaryKeys.size){updateSummarySelectionUI();return;}
 $('bulkTimeIdentity').textContent=selectedSummaryKeys.size+' filas del periodo '+selectedPeriod()+' · distintas combinaciones PDV / distrito';
 for(const [,applyId,inputId] of BULK_TIME_FIELDS){$(applyId).checked=false;$(inputId).disabled=true;$(inputId).value='';}
 $('bulkTimeSaveStatus').textContent='';$('bulkTimeSaveStatus').classList.remove('is-error');
 $('bulkTimeDialog').showModal();
}
function numEquals(a,b){return a==null&&b==null||a!=null&&b!=null&&Number(a)===Number(b);}
async function saveBulkTime(e){
 if(e.submitter?.value!=='save')return;
 e.preventDefault();if(bulkSaving)return;
 if(!Cloud.admin())throw Error('No tienes permisos de administrador.');
 const patches={};
 for(const [prop,applyId,inputId] of BULK_TIME_FIELDS){
   if(!$(applyId).checked)continue;
   const raw=$(inputId).value.trim();
   if(prop==='observaciones'){patches[prop]=raw;continue;}
   const value=raw===''?null:Number(raw);
   if(value!==null&&(!Number.isFinite(value)||value<0)){
     $('bulkTimeSaveStatus').textContent='Valor inválido en '+prop+'.';$('bulkTimeSaveStatus').classList.add('is-error');return;
   }
   patches[prop]=value;
 }
 if(!Object.keys(patches).length){$('bulkTimeSaveStatus').textContent='Marca al menos un campo «Aplicar».';$('bulkTimeSaveStatus').classList.add('is-error');return;}
 const chosen=[...selectedSummaryKeys],period=selectedPeriod(),entries=[];
 for(const key of chosen){
  const row=fullRows.get(key);if(!row)continue;
  const existing=config.times[key]||{};
  const value={...existing,...patches};
  let changed=false;
  for(const [prop,newValue] of Object.entries(patches)){
    if(prop==='observaciones'?String(existing[prop]??'')!==String(newValue):!numEquals(existing[prop],newValue)){changed=true;break;}
  }
  if(changed)entries.push({row,data:value});
 }
 const status=$('bulkTimeSaveStatus'),button=$('btnSaveBulkTimes');
 if(!entries.length){status.textContent='Las filas seleccionadas ya tienen esos valores; no se modificó nada.';status.classList.remove('is-error');return;}
 if(!confirm('Se actualizarán '+entries.length+' filas en Supabase. Los OK previos de esas filas dejarán de estar vigentes. ¿Confirmar?'))return;
 bulkSaving=true;button.disabled=true;status.classList.remove('is-error');status.textContent='Guardando 0 de '+entries.length+' filas en Supabase…';updateSummarySelectionUI();
 try{
  await Cloud.saveTimesBulk(period,entries,patches,(saved,total)=>{status.textContent='Guardando '+saved+' de '+total+' filas en Supabase…';});
  if(selectedPeriod()!==period)throw Error('Cambió el periodo mientras se guardaban los tiempos. Recarga antes de editar nuevamente.');
  // Releer la configuración compartida para mostrar incluso cambios concurrentes
  // de otros administradores sobre campos que no se seleccionaron.
  const latest=await Cloud.loadConfig(period);config.times=latest.times||{};
  for(const {row} of entries)reviews.delete(row.key);
  selectedSummaryKeys.clear();$('bulkTimeDialog').close('saved');
  await calculate();syncStatus('Configuración múltiple guardada · '+entries.length+' filas · '+period);
  notify(entries.length+' filas guardadas en Supabase.');
 }catch(err){
  status.classList.add('is-error');status.textContent='No se completó el guardado: '+err.message+' Se recuperará la configuración de Supabase.';
  syncStatus('Guardado masivo no confirmado: '+err.message,true);notify(err.message,true);
  try{const latest=await Cloud.loadConfig(period);if(selectedPeriod()===period){config.times=latest.times||{};await calculate();}}catch(reloadError){status.textContent+=' Error de recarga: '+reloadError.message;}
 }finally{bulkSaving=false;button.disabled=false;updateSummarySelectionUI();}
}
function toggleExpandedSummary(){
 const shell=$('summaryTableShell'),expanded=shell.classList.toggle('expanded');
 document.body.classList.toggle('summary-table-expanded',expanded);
 $('btnExpandSummary').textContent=expanded?'Cerrar vista ampliada':'Ampliar tabla';$('btnExpandSummary').setAttribute('aria-pressed',String(expanded));
}
function toggleCompactSummary(){
 const shell=$('summaryTableShell'),compact=shell.classList.toggle('compact');
 $('btnCompactSummary').textContent=compact?'Vista normal':'Vista compacta';$('btnCompactSummary').setAttribute('aria-pressed',String(compact));
}
function openTariff(pdv){currentTariffPDV=pdv;const t=config.tariffs[pdv]||{mode:'ESTANDAR',standard:null,zones:{}};$('tariffIdentity').textContent=pdv;$('tMode').value=t.mode||'ESTANDAR';$('tStandard').value=t.standard??'';
 const distinct=new Map();for(const r of rows)if(r.pdv===pdv){const key=M.districtKey(r.dept,r.prov,r.dist);distinct.set(key,`${r.dept} / ${r.prov} / ${r.dist}`);}
 for(const k of Object.keys(t.zones||{}))if(!distinct.has(k))distinct.set(k,k.replaceAll('|',' / '));
 $('zoneRates').innerHTML=[...distinct.entries()].sort((a,b)=>a[1].localeCompare(b[1])).map(([key,name])=>`<div class="zone-row"><label>${safe(name)}</label><input data-zone-key="${safe(key)}" type="number" step="0.01" min="0" placeholder="Estándar" value="${t.zones?.[key]??''}"></div>`).join('');toggleZones();$('tariffSaveStatus').textContent='';$('tariffDialog').showModal();}
function toggleZones(){$('zonesBox').hidden=$('tMode').value!=='ZONAL';}
async function saveTariff(){
 if(!Cloud.admin())throw Error('No autorizado.');
 const standard=M.num($('tStandard').value);
 if(standard==null||standard<0)throw Error('Debes definir una tarifa estándar (puede ser 0).');
 const zones={};if($('tMode').value==='ZONAL')for(const el of $('zoneRates').querySelectorAll('[data-zone-key]'))if(el.value.trim()){
  const n=M.num(el.value);if(n===null||n<0)throw Error('Tarifa zonal inválida');zones[el.dataset.zoneKey]=n;
 }
 const value={mode:$('tMode').value,standard,zones,updatedAt:new Date().toISOString()};
 await Cloud.saveTariff(selectedPeriod(),currentTariffPDV,value);
 for(const [k,g] of fullRows)if(g.pdv===currentTariffPDV)reviews.delete(k);
 config.tariffs[currentTariffPDV]=value;await calculate();syncStatus('Tarifas guardadas en Supabase · '+selectedPeriod());notify('Tarifario guardado en Supabase para '+currentTariffPDV);
}
async function saveRules(){
 if(!Cloud.admin())throw Error('No autorizado.');
 const rate=M.num($('rate').value),step=M.num($('step').value),maxExcess=M.num($('maxExcess').value),min=M.num($('minGuides').value);
 if(rate==null||rate<0||rate>100||step==null||step<=0||maxExcess==null||maxExcess<0||min==null||min<1||!Number.isInteger(min))throw Error('Revisa valores (0-100%, bloque positivo, máximo >=0, mínimo entero >=1).');
 const rule={rate,step,maxExcess},ref=$('refPeriod').value||selectedPeriod();
 await Cloud.saveRules(selectedPeriod(),rule,min,ref);
 reviews.clear();config.rule=rule;config.minGuides=min;config.refPeriod=ref;
 renderExamples();await calculate();syncStatus('Reglas guardadas en Supabase · '+selectedPeriod());notify('Reglas sincronizadas en Supabase.');
}
async function backupDraft(){
 if(!Cloud.admin())return notify('Solo el administrador puede respaldar el borrador.',true);
 const p=selectedPeriod(),src=await get('dataset',p);
 if(!src?.rows?.length)return notify('No hay un borrador local para respaldar en '+p+'.',true);
 const exportable={formato:'FACTURACION_PDV_BORRADOR_V23',periodo:p,generado_en:new Date().toISOString(),
   fuente:{id:p,rows:src.rows,stats:src.stats,headers:src.headers,file:src.file,uploadedAt:src.uploadedAt}};
 const blob=new Blob([JSON.stringify(exportable)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob);
 const link=document.createElement('a');link.href=url;link.download='RESPALDO_FACTURACION_'+p+'.json';document.body.appendChild(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),30000);notify('Respaldo JSON generado para '+p+'.');
}
async function restoreDraft(file){
 if(!Cloud.admin()||!file)return;
 if(file.size>100*1024*1024)throw Error('El respaldo supera 100 MB.');
 const data=JSON.parse(await file.text());
 if(data?.formato!=='FACTURACION_PDV_BORRADOR_V23'||!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(data.periodo))throw Error('El archivo no es un respaldo válido de Facturación V2.3.');
 const raw=data.fuente?.rows;
 if(!Array.isArray(raw)||!raw.length||raw.length>500000)throw Error('El respaldo no contiene una cantidad válida de guías.');
 const clean=raw.map(r=>({guia:M.norm(r.guia),pdv:M.normalizePDV(r.pdv),dept:M.norm(r.dept),prov:M.norm(r.prov),dist:M.norm(r.dist),
   horas:M.num(r.horas),fecha:String(r.fecha||''),period:data.periodo}));
 if(clean.some(r=>!r.guia||!r.pdv||!r.dept||!r.prov||!r.dist||r.horas===null||r.horas<0))throw Error('El respaldo contiene guías incompletas o inválidas.');
 const existing=await get('dataset',data.periodo);
 if(existing?.rows?.length&&!confirm('Ya existen '+existing.rows.length+' guías locales de '+data.periodo+'. ¿Deseas reemplazar el borrador de ese periodo con este respaldo?'))return;
 await put('dataset',{id:data.periodo,rows:clean,stats:{...data.fuente.stats,valid:clean.length},headers:data.fuente.headers||[],file:data.fuente.file||file.name,
   uploadedAt:'Restaurado '+new Date().toISOString(),remoteVersion:0,sourceId:crypto.randomUUID()});
 $('period').value=data.periodo;rememberWorkingState();await loadPeriod();notify('Borrador restaurado: '+clean.length.toLocaleString('es-PE')+' guías en '+data.periodo+'.');
 await saveCloudDraft({automatic:true});
}
async function saveDialog(e,id,callback,statusId){
 if(e.submitter?.value!=='save')return;
 e.preventDefault();const btn=e.submitter,status=$(statusId);btn.disabled=true;
 status.classList.remove('is-error');status.textContent='Guardando en Supabase, no cierres la pestaña…';
 try{await callback();status.textContent='Guardado en Supabase.';$(id).close('saved');}
 catch(err){status.classList.add('is-error');status.textContent='No se guardó: '+err.message;syncStatus('Error de guardado: '+err.message,true);notify('Error de guardado: '+err.message,true);console.error(err);}
 finally{btn.disabled=false;}
}
async function importFile(file){if(!Cloud.admin())return notify('Solo un administrador puede importar borradores.',true);if(!file||importing)return;const maxBytes=80*1024*1024;if(file.size>maxBytes){notify('Excel superior a 80 MB; divide en varios archivos.',true);return;}if(rows.length&&!confirm(`¿Reemplazar las ${rows.length.toLocaleString('es-PE')} guías del periodo ${selectedPeriod()}? Las liquidaciones finalizadas no se borrarán.`))return;
 importing=true;$('btnClose').disabled=true;setStatus(`Leyendo ${file.name}…`);await new Promise(r=>setTimeout(r,60));try{if(!window.XLSX)throw Error('No se cargó el lector Excel. Verifica el acceso a cdn.jsdelivr.net e intenta de nuevo.');
  const book=window.XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true,raw:true});const sh=book.Sheets[book.SheetNames[0]];if(!sh)throw Error('No se encontró la primera hoja de Excel.');setStatus('Analizando filas y validando columnas…');await new Promise(r=>setTimeout(r,20));const matrix=window.XLSX.utils.sheet_to_json(sh,{header:1,raw:true,defval:''});const parsed=M.parseMatrix(matrix,selectedPeriod());
  const sortedMonths=Object.entries(parsed.stats.months||{}).sort((a,b)=>b[1]-a[1]);let destPeriod=selectedPeriod();
  if(sortedMonths.length){const [mainMonth,mainCount]=sortedMonths[0];if(mainMonth!==destPeriod&&mainCount/parsed.stats.valid>=0.7){const yes=confirm(`Detecté ${mainCount.toLocaleString('es-PE')} guías con fecha de reparto en ${mainMonth}, pero el periodo seleccionado es ${destPeriod}.\n\n¿Deseas utilizar ${mainMonth} como periodo de facturación? (Recomendado para evitar asignar guías al mes incorrecto).`);if(yes){destPeriod=mainMonth;$('period').value=destPeriod;}}if(sortedMonths.length>1)notify('Atención: el archivo contiene reparto de varios meses. Comprueba el periodo antes de liquidar.',true);}
  if(destPeriod!==selectedPeriod())throw Error('No se pudo establecer el periodo detectado');
  const countBefore=parsed.rows.length;
  parsed.rows=parsed.rows.filter(r=>!/^\d{4}-\d{2}/.test(r.fecha)||r.fecha.slice(0,7)===destPeriod);
  parsed.stats.excludedOtherMonths=countBefore-parsed.rows.length;
  parsed.stats.valid=parsed.rows.length;
  if(parsed.stats.excludedOtherMonths)notify(`${parsed.stats.excludedOtherMonths} guías de meses distintos no se importarán en ${destPeriod}.`,true);
  if(!parsed.rows.length)throw Error('Ninguna guía corresponde al periodo seleccionado.');
  for(const r of parsed.rows)r.period=destPeriod;
  const previous=await get('dataset',destPeriod);if(previous&&(!rows.length||previous.id!==$('period').dataset.periodLoaded)&&!confirm(`Ya existen datos de ${destPeriod}. ¿Reemplazarlos?`))return;
  await put('dataset',{id:destPeriod,rows:parsed.rows,stats:parsed.stats,headers:parsed.headers,file:file.name,uploadedAt:new Date().toISOString(),remoteVersion:0,sourceId:crypto.randomUUID()});
  setStatus('Importación finalizada: '+file.name);await loadPeriod();notify(`${fnum(parsed.stats.valid,0)} guías importadas · ${parsed.stats.invalid} filas inválidas · ${parsed.stats.duplicates} duplicadas.`,false);
  // La carga local queda hecha aun si falla la nube. Estado visible y reintento manual.
  await saveCloudDraft({automatic:true});
 }catch(e){setStatus('Error de carga: '+e.message);notify('No se pudo cargar: '+e.message,true);console.error(e);}finally{importing=false;$('fileInput').value='';renderCloseStatus();}}
function exportData(summary,details,name,settings,stats){
 const newBase=M.num($('simHours').value);if(newBase==null||newBase<=0)throw Error('Ingresa un umbral de simulación válido y mayor que cero antes de exportar.');
 if(!window.XLSX)throw Error('No se cargó el exportador XLSX. Verifica la conexión a internet.');
 const clean=arr=>arr.map(row=>row.map(csvSafe));
 const base=newBase,rule=settings.rule||initialConfig().rule;
 const simGroups=new Map();let totalSim=0,totalDiff=0;
 const rSim=new Map();
 for(const r of details){
  const sim=M.simulatedNet(r,base,rule);
  if(sim===null)continue;
  const diff=M.money(r.neto-sim),k=M.localKey(r.period||settings.period||selectedPeriod(),r.dept,r.prov,r.dist,r.pdv);
  let a=simGroups.get(k);if(!a){a={simNet:0,diffNet:0};simGroups.set(k,a);}
  a.simNet=M.money(a.simNet+sim);a.diffNet=M.money(a.diffNet+diff);
  totalSim=M.money(totalSim+sim);totalDiff=M.money(totalDiff+diff);
  rSim.set(r,{sim,diff});
 }
 const simLabel=`NETO SIMULACION ${fnum(base,2)} H S/`,diffLabel=`DIFERENCIA VS ${fnum(base,2)} H S/`;
 const resHeaders=['DEPARTAMENTO','PROVINCIA','DISTRITO','PDV','OK','OK POR','OK FECHA','GUIAS','PROMEDIO LOGRADO H','MEJOR PDV','MEJOR TIEMPO H','UMBRAL H','CONSOLIDACION H','RETRASLADO H','TIEMPO ADICIONAL H','NECESARIO DESPACHO H','TIEMPO ESTABLECIDO H','UMBRAL ESTABLECIDO H','ORIGEN BASE','BRUTO S/','DESCUENTOS S/',simLabel,diffLabel,'NETO S/','OBSERVACIONES'];
 const drHeaders=['GUIA','PDV','DEPARTAMENTO','PROVINCIA','DISTRITO','DIA REPARTO','TIEMPO LOGRADO H','TIEMPO ESTABLECIDO H','UMBRAL ESTABLECIDO H','EXCESO H','TARIFA S/','TIPO TARIFA','REDUCCION %','PAGO %','DESCUENTO S/',simLabel,diffLabel,'NETO S/','ESTADO'];
 const summaryRows=[resHeaders,...summary.map(g=>{const sim=simGroups.get(g.key)||{simNet:0,diffNet:0};return[g.dept,g.prov,g.dist,g.pdv,approvalFor(g)?'SI':'NO',approvalFor(g)?.aprobado_por||'',approvalFor(g)?.aprobado_en||'',g.count,g.promedio,g.bestPDV,g.bestHours,g.umbral,g.consolidacion,g.retraslado,g.adicional,g.necesario,g.establecido,g.umbralEst,g.origen,g.gross,g.discount,sim.simNet,sim.diffNet,g.net,g.observaciones];})];
 const pdvRows=summarizeByPDV(summary,simGroups);
 const pdvHeaders=['PDV','DISTRITOS CUBIERTOS','GUIAS','PROMEDIO LOGRADO H','FILAS CON OK','GUIAS SIN CALCULO','BRUTO S/','DESCUENTOS S/',simLabel,diffLabel,'NETO S/'];
 const pdvSheet=[pdvHeaders,...pdvRows.map(g=>[g.pdv,g.distritos,g.guias,g.promedio,g.ok,g.pending,g.bruto,g.descuentos,g.simNet,g.diffNet,g.neto])];
 if(pdvRows.length){pdvSheet.push(['TOTAL FILTRADO',pdvRows.reduce((a,g)=>a+g.distritos,0),details.length,details.length?details.reduce((a,r)=>a+(Number(r.horas)||0),0)/details.length:null,pdvRows.reduce((a,g)=>a+g.ok,0),pdvRows.reduce((a,g)=>a+g.pending,0),M.money(pdvRows.reduce((a,g)=>a+g.bruto,0)),M.money(pdvRows.reduce((a,g)=>a+g.descuentos,0)),totalSim,totalDiff,M.money(pdvRows.reduce((a,g)=>a+g.neto,0))]);}
 const detailRows=[drHeaders,...details.map(r=>{const sim=rSim.get(r);return[r.guia,r.pdv,r.dept,r.prov,r.dist,r.fecha,r.horas,r.establecido,r.umbralEst,r.exceso,r.tarifa,r.tarifaTipo,r.reduccion,r.pagoPct,r.descuento,sim?.sim??null,sim?.diff??null,r.neto,r.ceroMax?'CERO POR EXCESO':r.estado];})];
 // El total se obtiene de las mismas guías exportadas, no de resúmenes fuera del filtro.
 if(summary.length){summaryRows.push(['TOTAL FILTRADO','','','','','','',details.length,'','','','','','','','','','','',
  M.money(details.reduce((x,r)=>x+(r.neto==null?0:(r.tarifa??0)),0)),M.money(details.reduce((x,r)=>x+(r.descuento??0),0)),totalSim,totalDiff,M.money(details.reduce((x,r)=>x+(r.neto??0),0)),'']);}
 const tarifRows=[['PDV','MODALIDAD','TARIFA ESTANDAR S/','DEPARTAMENTO/PROVINCIA/DISTRITO','TARIFA ZONAL S/']];
 for(const [pdv,t] of Object.entries(settings.tariffs||{})){tarifRows.push([pdv,t.mode,t.standard,'','']);for(const [key,value] of Object.entries(t.zones||{}))tarifRows.push([pdv,t.mode,t.standard,key.replaceAll('|',' / '),value]);}
 const ruleRows=[['PARAMETRO','VALOR'],['Periodo',settings.period||selectedPeriod()],['Periodo referencia',settings.refPeriod||selectedPeriod()],['Porcentaje reducción (%)',rule.rate],['Horas por bloque',rule.step],['Exceso máximo permitido (h)',rule.maxExcess],['Mínimo guías mejor PDV',settings.minGuides],['Umbral simulado (h)',base],['Neto simulado del Excel (S/)',totalSim],['Diferencia neto real - simulado (S/)',totalDiff],['Guías fuente',stats?.valid||''],['Duplicados descartados',stats?.duplicates||0],['Conflictos entre PDV',stats?.pdvConflicts||0],['Guías de otros meses excluidas',stats?.excludedOtherMonths||0],['Filas inválidas',stats?.invalid||0],['Simulación','Comparación únicamente; NO modifica liquidaciones ni parámetros guardados. Se utilizan solo guías con neto real y tarifa calculados.'],['Regla exceso máximo','Pago 0% si horas excedentes > máximo (no >=)'],['Primera reducción','Inmediatamente al superar umbral; en cada frontera adicional, siguiente descuento']];
 const book=XLSX.utils.book_new();
 for(const [sheetName,data] of [['RESUMEN',summaryRows],['RESUMEN_PDV',pdvSheet],['DETALLE',detailRows],['TARIFAS',tarifRows],['REGLAS',ruleRows]]){
  const sh=XLSX.utils.aoa_to_sheet(clean(data));
  sh['!cols']=data[0].map(v=>({wch:Math.min(36,Math.max(13,String(v).length+2))}));
  XLSX.utils.book_append_sheet(book,sh,sheetName);
 }
 XLSX.writeFile(book,name+'.xlsx',{compression:true});
}
async function exportCurrent(){if(!view.details.length){notify('No hay información que exportar.',true);return;}setStatus(`Generando Excel de ${fnum(view.details.length,0)} guías filtradas…`);await new Promise(r=>setTimeout(r,50));try{const configSnapshot=structuredClone({...config,period:selectedPeriod(),refPeriod:$('refPeriod').value});exportData(view.summary,view.details,`FACTURACION_${selectedPeriod()}_${selectedPDVs.size?Array.from(selectedPDVs).join('_'):'SELECCION'}`,configSnapshot,sourceStats);setStatus(`Excel generado: ${fnum(view.details.length,0)} guías del filtro actual.`);}catch(e){setStatus('Error de exportación: '+e.message);notify(e.message,true);}}
async function closePeriod(){
 if(!Cloud.admin())return notify('Solo administrador puede cerrar liquidaciones.',true);
 if(!result||!result.details.length)return;
 const total=result.totals;
 if(total.pendientes){notify('Hay '+total.pendientes+' guías sin tiempo base o tarifa. No se puede finalizar.',true);return;}
 if(sourceStats?.pdvConflicts>0){notify('Corrige los conflictos de guías asignadas a varios PDV.',true);return;}
 const list=await Cloud.listSettlements(),version=list.filter(x=>x.periodo===selectedPeriod()).reduce((n,x)=>Math.max(n,x.version),0)+1;
 if(!confirm(`¿PUBLICAR CIERRE ${selectedPeriod()} (versión estimada ${version}) con ${total.guias} guías y NETO ${money(total.neto)}?

La publicación comparte datos SOLO con usuarios y PDV autorizados. Un cierre finalizado no se puede modificar.`))return;
 const payload={period:selectedPeriod(),config:structuredClone({...config,period:selectedPeriod(),refPeriod:$('refPeriod').value}),
  stats:structuredClone(sourceStats||{}),summary:result.summary.map(g=>({...g,revisionOk:!!approvalFor(g),revisionPor:approvalFor(g)?.aprobado_por||null,revisionEn:approvalFor(g)?.aprobado_en||null})),details:result.details,
  totals:structuredClone(total),source:'Excel local MODULADOR'};
 $('btnClose').disabled=true;
 try{
  setStatus('Publicando cierre en Supabase…');
  const published=await Cloud.publish(payload,(done,all,kind)=>setStatus(`Publicando ${kind}: ${fnum(done,0)} / ${fnum(all,0)}…`));
  setStatus(`Liquidación ${published.period} V${published.version} finalizada y compartida.`);
  notify('Cierre V'+published.version+' publicado correctamente.');
  await refreshPublishedList();await renderHistory();
 }catch(e){setStatus('Error al publicar cierre: '+e.message);notify(e.message,true);}
 finally{renderCloseStatus();}
}
async function renderHistory(){
 if(!Cloud.admin())return;
 try{
  const list=await Cloud.listSettlements();
  const local=(await getAll('snapshots')).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
  const published=list.length?list.map(x=>`<div class="history-card"><div><b>${safe(x.periodo)} · V${x.version} · FINALIZADO</b><small>${safe(new Date(x.finalizado_en||x.creado_en).toLocaleString('es-PE'))} · Histórico inmutable en Supabase</small></div><button class="btn-mini" data-export-snapshot="${safe(x.id)}">Excel histórico</button></div>`).join(''):'<p class="empty">Todavía no hay liquidaciones finalizadas en Supabase.</p>';
  const old=local.length?'<h3>Cierres anteriores guardados solo en este navegador (V1)</h3>'+local.map(x=>`<div class="history-card"><div><b>${safe(x.period)} · ${safe(x.id)}</b><small>${safe(x.createdAt)} · ${fnum(x.totals?.guias,0)} guías · ${money(x.totals?.neto)} · todavía NO compartido</small></div><button class="btn-mini" data-publish-local="${safe(x.id)}">Publicar en Supabase</button></div>`).join(''):'';
  $('historyList').innerHTML=published+old;
 }catch(e){$('historyList').textContent='Error consultando cierres: '+e.message;}
}
async function exportSnapshot(id){
 if(!Cloud.admin())return notify('Solo administrador puede exportar historiales completos.',true);
 try{
  setStatus('Preparando versión finalizada…');
  const list=await Cloud.listSettlements(),item=list.find(x=>x.id===id);
  if(!item)throw Error('Liquidación no encontrada.');
  const [summary,details,privateData]=await Promise.all([
   Cloud.readSummary(id),Cloud.readAllDetails(id,{},(n,total)=>setStatus(`Leyendo ${fnum(n,0)} / ${fnum(total,0)} guías…`)),Cloud.readPrivate(id)
  ]);
  exportData(summary,details,`FACTURACION_FINALIZADA_${item.periodo}_V${item.version}`,
   privateData.configuracion,privateData.estadisticas);
  setStatus('Histórico exportado: '+item.periodo+' V'+item.version);
 }catch(e){notify('Error exportando historial: '+e.message,true);}
}
async function migrateV1Config(){
 if(!Cloud.admin())return;
 const saved=(await get('kv','settings'))?.value;
 if(!saved)return notify('No se encontraron configuraciones locales guardadas por Facturación V1.',true);
 const period=selectedPeriod();
 const tariffs=Object.entries(saved.tariffs||{}),times=Object.entries(saved.times||{}).filter(([k])=>k.startsWith(period+'|'));
 if(!confirm(`¿Importar al periodo ${period} las reglas locales, ${tariffs.length} tarifas y ${times.length} tiempos V1?\n\nSi ya existen registros compartidos para el periodo, se reemplazarán únicamente las claves coincidentes. Las liquidaciones FINALIZADAS no cambian.`))return;
 try{
  const rule={...initialConfig().rule,...(saved.rule||{})};
  await Cloud.saveRules(period,rule,saved.minGuides||10,period);
  for(const [pdv,val] of tariffs)await Cloud.saveTariff(period,pdv,val);
  for(const [key,val] of times){const tokens=key.split('|');
   if(tokens.length!==5)throw Error('Clave de tiempo antiguo inválida: '+key);
   await Cloud.saveTime(period,{key,dept:tokens[1],prov:tokens[2],dist:tokens[3],pdv:tokens[4]},val);
  }
  await loadPeriod();notify('Configuración V1 importada al periodo '+period+' en Supabase.');
 }catch(e){notify('Error migrando configuración local: '+e.message,true);}
}
async function publishOldSnapshot(id){
 if(!Cloud.admin())return;
 const snap=await get('snapshots',id);if(!snap)return notify('Cierre local no encontrado.',true);
 if(!confirm(`¿Publicar copia de la liquidación local ${id} en Supabase?\nSe creará una NUEVA versión finalizada con los importes y reglas que ya estaban congelados en V1.`))return;
 try{
  const published=await Cloud.publish({...snap,source:'Migración local V1 · '+id},
   (n,total,kind)=>setStatus(`Migrando ${kind}: ${fnum(n,0)} / ${fnum(total,0)}…`));
  notify(`Cierre local publicado como ${published.period} · V${published.version}.`);
  await refreshPublishedList();await renderHistory();
 }catch(e){notify('Error migrando cierre local: '+e.message,true);}
}
// Acceso multiusuario y liquidaciones publicadas. Todas las lecturas pasan por RLS.
async function refreshPublishedList(){
 if(!Cloud.profile())return;
 try{
  const prior=$('pubSettlement').value;
  publishedList=await Cloud.listSettlements();
  $('pubSettlement').innerHTML=publishedList.length?publishedList.map(x=>
    `<option value="${safe(x.id)}">${safe(x.periodo)} · V${x.version} · ${safe(new Date(x.finalizado_en||x.creado_en).toLocaleDateString('es-PE'))}</option>`
  ).join(''):'<option value="">Sin cierres publicados para tu acceso</option>';
  $('pubSettlement').value=publishedList.some(x=>x.id===prior)?prior:publishedList[0]?.id||'';
  await loadPublished();
 }catch(e){$('publishedStatus').textContent='Error consultando liquidaciones: '+e.message;notify(e.message,true);}
}
async function loadPublished(){
 const id=$('pubSettlement').value;
 publishedCurrent=publishedList.find(x=>x.id===id)||null;
 pubPage=0;pubCount=0;
 if(!publishedCurrent){
  publishedSummary=[];$('pubPDV').innerHTML='<option value="">Todos los autorizados</option>';
  renderPublishedSummary();$('pubDetailBody').innerHTML='<tr><td colspan="10" class="empty">No hay cierres autorizados.</td></tr>';
  $('pubPage').textContent='—';$('publishedStatus').textContent='No hay liquidaciones publicadas disponibles.';return;
 }
 try{
  publishedSummary=await Cloud.readSummary(id);
  const options=[...new Set(publishedSummary.map(x=>x.pdv))].sort();
  $('pubPDV').innerHTML='<option value="">Todos los autorizados</option>'+
    options.map(x=>`<option value="${safe(x)}">${safe(x)}</option>`).join('');
  $('pubSearch').value='';
  renderPublishedSummary();await loadPublishedPage();
 }catch(e){notify('Error leyendo liquidación: '+e.message,true);$('publishedStatus').textContent=e.message;}
}
function filteredPublishedSummary(){
 const pdv=$('pubPDV').value;
 return publishedSummary.filter(x=>!pdv||x.pdv===pdv);
}
function renderPublishedSummary(){
 const list=filteredPublishedSummary();
 let guias=0,bruto=0,off=0,net=0;
 for(const g of list){guias+=Number(g.count)||0;bruto+=Number(g.gross)||0;off+=Number(g.discount)||0;net+=Number(g.net)||0;}
 $('pubGuides').textContent=fnum(guias,0);$('pubGross').textContent=money(bruto);
 $('pubOff').textContent=money(off);$('pubNet').textContent=money(net);
 $('pubSummaryBody').innerHTML=list.length?list.slice(0,500).map(g=>`<tr>
  <td>${safe(g.dept)}</td><td>${safe(g.prov)}</td><td>${safe(g.dist)}</td>
  <td><b>${safe(g.pdv)}</b></td><td>${fnum(g.count,0)}</td><td>${th(g.promedio)}</td>
  <td>${safe(g.bestPDV)}</td><td>${th(g.establecido)}</td><td>${th(g.umbralEst)}</td>
  <td>${money(g.gross)}</td><td>${money(g.discount)}</td><td class="amount">${money(g.net)}</td>
 </tr>`).join(''):'<tr><td colspan="12" class="empty">Sin distritos autorizados en este cierre.</td></tr>';
 $('publishedStatus').textContent=`${fnum(guias,0)} guías en ${fnum(list.length,0)} filas autorizadas${list.length>500?' (se muestran las primeras 500; el Excel contiene todas)':''}. La búsqueda de guía se aplica al detalle, no al resumen.`;
}
async function loadPublishedPage(){
 if(!publishedCurrent||pubBusy)return;
 pubBusy=true;
 try{
  const {rows:items,count}=await Cloud.readDetails(publishedCurrent.id,{
    pdv:$('pubPDV').value,guia:$('pubSearch').value.trim().toUpperCase(),offset:pubPage*100,limit:100
  });
  pubCount=count??items.length;
  $('pubDetailBody').innerHTML=items.length?items.map(r=>`<tr>
   <td><b>${safe(r.guia)}</b></td><td>${safe(r.pdv)}</td><td>${safe(r.dist)}</td>
   <td>${safe(r.fecha)}</td><td>${th(r.horas)}</td><td>${th(r.umbralEst)}</td><td>${th(r.exceso)}</td>
   <td>${money(r.tarifa)}</td><td class="${r.reduccion>0?'bad':''}">${fnum(r.reduccion)}%</td>
   <td class="amount">${money(r.neto)}</td></tr>`).join(''):
   '<tr><td colspan="10" class="empty">No hay guías con estos filtros.</td></tr>';
  $('pubPage').textContent=`Página ${pubPage+1} · ${fnum(pubCount,0)} guías`;
  $('pubPrev').disabled=pubPage===0;$('pubNext').disabled=(pubPage+1)*100>=pubCount;
 }catch(e){notify('Error leyendo detalle publicado: '+e.message,true);}finally{pubBusy=false;}
}
async function exportPublished(){
 if(!publishedCurrent)return notify('No hay liquidación seleccionada.',true);
 const btn=$('btnExportPublished');btn.disabled=true;
 try{
  const pdv=$('pubPDV').value,guia=$('pubSearch').value.trim().toUpperCase();
  const summary=filteredPublishedSummary();
  const details=await Cloud.readAllDetails(publishedCurrent.id,{pdv,guia},(n,t)=>{
   $('publishedStatus').textContent=`Preparando Excel autorizado: ${fnum(n,0)} / ${fnum(t,0)} guías…`;
  });
  if(!details.length)throw Error('No hay guías que exportar.');
  // Para roles limitados solo exportar datos de sus PDV, nunca configuraciones de otros.
  let settings={period:publishedCurrent.periodo,refPeriod:publishedCurrent.periodo,
    rule:publishedCurrent.regla_publica||initialConfig().rule,
    minGuides:publishedCurrent.minimo_guias||10,tariffs:{}};
  let stats={valid:details.length};
  if(Cloud.admin()){
   const priv=await Cloud.readPrivate(publishedCurrent.id);
   settings=priv.configuracion;stats=priv.estadisticas;
  }else{
   const seen=new Set();
   for(const r of details){if(seen.has(r.pdv))continue;seen.add(r.pdv);
    settings.tariffs[r.pdv]={mode:'SEGUN DETALLE HISTORICO',standard:null,zones:{}};
   }
  }
  exportData(summary,details,`FACTURACION_PUBLICADA_${publishedCurrent.periodo}_V${publishedCurrent.version}_${pdv||'MIS_PDV'}`,
    settings,stats);
  renderPublishedSummary();notify('Excel publicado generado para los PDV autorizados.');
 }catch(e){notify('Error exportando: '+e.message,true);}
 finally{btn.disabled=false;}
}
async function loadMembers(){
 if(!Cloud.admin())return;
 const data=await Cloud.listMembers();
 $('membersBody').innerHTML=data.length?data.map(x=>`<tr><td>${safe(x.user_id)}</td>
  <td>${safe(x.rol)}</td><td>${safe((x.pdvs||[]).join(', '))}</td>
  <td>${x.activo?'Habilitado':'Deshabilitado'}</td>
  <td><button class="btn-mini" data-member="${safe(x.user_id)}">Editar</button></td></tr>`).join(''):
  '<tr><td colspan="5" class="empty">Solo existe el administrador inicial o aún no hay registros.</td></tr>';
 window.__factMembers=data;
}
async function updateMember(event){
 event.preventDefault();
 if(!Cloud.admin())return notify('Acción restringida.',true);
 const entry={user_id:$('memberUID').value,rol:$('memberRole').value,
  pdvs:$('memberPDVs').value.split(/[,;\n]+/).map(x=>x.trim()).filter(Boolean),
  activo:$('memberActive').value==='true'};
 try{await Cloud.upsertMember(entry);notify('Acceso actualizado en Supabase.');await loadMembers();}
 catch(e){notify('No se pudo guardar acceso: '+e.message,true);}
}
function bindCloudEvents(){
 $('authForm').addEventListener('submit',async e=>{
  e.preventDefault();const btn=$('btnLoginCloud');btn.disabled=true;$('authStatus').textContent='Validando credenciales…';
  try{const p=await Cloud.login($('authUser').value,$('authPass').value);
   $('authPass').value='';$('authStatus').textContent='';await showApp(p);
  }catch(e){$('authStatus').textContent=e.message;notify('Acceso: '+e.message,true);}
  finally{btn.disabled=false;}
 });
 $('btnLogout').addEventListener('click',async()=>{try{await Cloud.logout();showAuth();}catch(e){notify(e.message,true);}});
 window.addEventListener('facturacion-sesion-cerrada',showAuth);
 $('btnRefreshPublished').addEventListener('click',refreshPublishedList);
 $('pubSettlement').addEventListener('change',loadPublished);
 $('pubPDV').addEventListener('change',async()=>{pubPage=0;renderPublishedSummary();await loadPublishedPage();});
 $('pubSearch').addEventListener('change',async()=>{pubPage=0;await loadPublishedPage();});
 $('pubPrev').addEventListener('click',async()=>{if(pubPage>0){pubPage--;await loadPublishedPage();}});
 $('pubNext').addEventListener('click',async()=>{if((pubPage+1)*100<pubCount){pubPage++;await loadPublishedPage();}});
 $('btnExportPublished').addEventListener('click',exportPublished);
 $('memberForm').addEventListener('submit',updateMember);
 $('membersBody').addEventListener('click',e=>{
  const b=e.target.closest('[data-member]');if(!b)return;
  const member=window.__factMembers?.find(x=>x.user_id===b.dataset.member);if(!member)return;
  $('memberUID').value=member.user_id;$('memberRole').value=member.rol;
  $('memberPDVs').value=(member.pdvs||[]).join(', ');$('memberActive').value=String(member.activo);
  $('memberUID').focus();
 });
 document.querySelector('[data-tab="accesos"]').addEventListener('click',async()=>{
  try{await loadMembers();}catch(e){notify('No se pudo listar accesos: '+e.message,true);}
 });
 document.querySelector('[data-tab="publicadas"]').addEventListener('click',refreshPublishedList);
}

function bindEvents(){document.querySelectorAll('[data-tab]').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===btn));document.querySelectorAll('.tab-panel').forEach(x=>x.classList.toggle('active',x.id===`tab-${btn.dataset.tab}`));if(btn.dataset.tab==='historico')renderHistory();}));
 $('period').addEventListener('change',async()=>{rememberWorkingState();try{await loadPeriod();}catch(err){syncStatus('No se pudo recuperar el periodo: '+err.message,true);notify(err.message,true);}});$('fileInput').addEventListener('change',e=>importFile(e.target.files?.[0]));$('btnExport').addEventListener('click',exportCurrent);
 $('btnBackupDraft').addEventListener('click',()=>backupDraft().catch(e=>notify('Respaldo: '+e.message,true)));
 $('btnSaveCloudDraft').addEventListener('click',()=>saveCloudDraft());
 $('btnLoadCloudDraft').addEventListener('click',()=>restoreCloudDraft());
 $('backupFile').addEventListener('change',async e=>{try{await restoreDraft(e.target.files?.[0]);}catch(err){notify('Restauración: '+err.message,true);}finally{e.target.value='';}});
 $('simHours').addEventListener('input',()=>{
   const n=M.num($('simHours').value),invalid=n==null||n<=0;
   $('simHours').classList.toggle('is-invalid',invalid);
   $('simHours').setCustomValidity(invalid?'Ingresa una cantidad positiva de horas.':'');
   if(invalid){$('simTotals').textContent='Introduce un umbral válido mayor que cero.';return;}
   simulationHours=n;storeSetting(LAST_SIM_PREFIX,n);
   clearTimeout(simulationTimer);simulationTimer=setTimeout(refreshSimulation,140);
 });
 for(const id of ['fDept','fProv','fDist'])$(id).addEventListener('change',()=>{if(id==='fDept'){$('fProv').value='';$('fDist').value='';}if(id==='fProv')$('fDist').value='';populateGeoOptions();applyFilters();});$('fEstado').addEventListener('change',applyFilters);$('fSearch').addEventListener('input',()=>{clearTimeout(filterTimer);filterTimer=setTimeout(applyFilters,140)});$('btnClear').addEventListener('click',()=>{for(const id of ['fDept','fProv','fDist','fSearch','fEstado',...summaryFilterIds])$(id).value='';selectedPDVs.clear();renderPDVFilter();populateGeoOptions();applyFilters();});
 $('pdvSearch').addEventListener('input',filterPDVOptions);
 installFilterSearches();
 $('pdvSummaryBody').addEventListener('click',e=>{const b=e.target.closest('[data-pdv-drill]');if(!b)return;selectedPDVs=new Set([b.dataset.pdvDrill]);renderPDVFilter();applyFilters();$('summaryTableShell').scrollIntoView({behavior:'smooth',block:'start'});});
 $('pdvChecks').addEventListener('change',e=>{if(!e.target.matches('input'))return;if(e.target.hasAttribute('data-pdv-all'))selectedPDVs.clear();else{const p=e.target.dataset.pdv;if(e.target.checked)selectedPDVs.add(p);else selectedPDVs.delete(p);}renderPDVFilter();applyFilters();});
 for(const id of summaryFilterIds)$(id).addEventListener('change',applyFilters);
 $('btnClearSummary').addEventListener('click',()=>{for(const id of summaryFilterIds)$(id).value='';applyFilters();});
 $('summaryBody').addEventListener('change',e=>{const sel=e.target.closest('[data-select-summary]');if(sel){if(sel.checked)selectedSummaryKeys.add(sel.dataset.selectSummary);else selectedSummaryKeys.delete(sel.dataset.selectSummary);updateSummarySelectionUI();return;}const box=e.target.closest('[data-review]');if(box)toggleReview(box.dataset.review,box.checked,box);});
 $('summarySelectPage').addEventListener('change',e=>{for(const row of pageSummaryRows()){if(e.target.checked)selectedSummaryKeys.add(row.key);else selectedSummaryKeys.delete(row.key);}updateSummarySelectionUI();});
 $('btnSelectSummaryPage').addEventListener('click',()=>{for(const row of pageSummaryRows())selectedSummaryKeys.add(row.key);updateSummarySelectionUI();});
 $('btnSelectSummaryFiltered').addEventListener('click',()=>{for(const row of view.summary)selectedSummaryKeys.add(row.key);updateSummarySelectionUI();});
 $('btnClearSummarySelection').addEventListener('click',()=>{selectedSummaryKeys.clear();updateSummarySelectionUI();});
 $('btnBulkTime').addEventListener('click',openBulkTime);
 $('btnExpandSummary').addEventListener('click',toggleExpandedSummary);
 $('btnCompactSummary').addEventListener('click',toggleCompactSummary);
 for(const [,applyId,inputId] of BULK_TIME_FIELDS)$(applyId).addEventListener('change',()=>{$(inputId).disabled=!$(applyId).checked;if($(applyId).checked)$(inputId).focus();});
 $('bulkTimeForm').addEventListener('submit',saveBulkTime);
 $('bulkTimeDialog').addEventListener('cancel',e=>{if(bulkSaving)e.preventDefault();});
 $('sumPrev').addEventListener('click' ,()=>{sumPage=Math.max(0,sumPage-1);renderSummary();});$('sumNext').addEventListener('click',()=>{sumPage++;renderSummary();});$('detPrev').addEventListener('click',()=>{detPage=Math.max(0,detPage-1);renderDetail();});$('detNext').addEventListener('click',()=>{detPage++;renderDetail();});
 $('summaryBody').addEventListener('click',e=>{const b=e.target.closest('[data-time]');if(b)openTime(b.dataset.time);});$('tariffBody').addEventListener('click',e=>{const b=e.target.closest('[data-tariff]');if(b)openTariff(b.dataset.tariff);});$('tMode').addEventListener('change',toggleZones);
 $('timeForm').addEventListener('submit',e=>saveDialog(e,'timeDialog',saveTime,'timeSaveStatus'));
 $('tariffForm').addEventListener('submit',e=>saveDialog(e,'tariffDialog',saveTariff,'tariffSaveStatus'));
 $('btnSaveRules').addEventListener('click',async e=>{const btn=e.currentTarget,status=$('rulesSaveStatus');btn.disabled=true;status.classList.remove('is-error');status.textContent='Guardando reglas en Supabase…';try{await saveRules();status.textContent='Reglas guardadas en Supabase.';}catch(err){status.classList.add('is-error');status.textContent='No se guardaron: '+err.message;syncStatus('Error al guardar reglas: '+err.message,true);notify(err.message,true);}finally{btn.disabled=false;}});$('refPeriod').addEventListener('change',calculate);$('btnClose').addEventListener('click',closePeriod);$('historyList').addEventListener('click',e=>{
  const b=e.target.closest('[data-export-snapshot]');if(b)exportSnapshot(b.dataset.exportSnapshot);
  const old=e.target.closest('[data-publish-local]');if(old)publishOldSnapshot(old.dataset.publishLocal);
 });
 $('btnMigrateConfig').addEventListener('click',migrateV1Config);
 $('btnRefreshConfig').addEventListener('click',loadPeriod);}
function showAuth(){
 $('authPanel').hidden=false;$('appRoot').hidden=true;$('btnLogout').hidden=true;
 $('sessionLabel').textContent='SUPABASE AUTH · SIN SESIÓN';
}
async function showApp(profile){
 $('authPanel').hidden=true;$('appRoot').hidden=false;$('btnLogout').hidden=false;
 $('sessionLabel').textContent=`${profile.rol} · ${Cloud.user()?.email||''}`;
 for(const element of document.querySelectorAll('[data-admin-only]'))element.hidden=!Cloud.admin();
 for(const tab of document.querySelectorAll('[data-tab]'))tab.classList.remove('active');
 for(const panel of document.querySelectorAll('.tab-panel'))panel.classList.remove('active');
 const tabName=Cloud.admin()?'resumen':'publicadas';
 document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
 $(`tab-${tabName}`).classList.add('active');
 if(Cloud.admin()){await restoreWorkingState();await loadPeriod();}
 await refreshPublishedList();
 if(Cloud.admin())await renderHistory();
}
async function initialize(){
 showAuth();
 try{
  if(!('indexedDB'in window))throw Error('Tu navegador no tiene IndexedDB habilitado.');
  db=await openDB();dbReady=true;config=initialConfig();
  $('period').value=todayMonth();
  bindEvents();bindCloudEvents();
  const p=await Cloud.restore();
  if(p)await showApp(p);
  else $('authStatus').textContent='Inicia sesión con tu cuenta existente. Debes tener acceso al módulo Facturación.';
 }catch(e){$('authStatus').textContent=e.message;notify('Inicialización: '+e.message,true);console.error(e);}
}
window.addEventListener('DOMContentLoaded',initialize);
})();
