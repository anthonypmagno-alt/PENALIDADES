/* Facturación PDV V2.0 - trabajo local y cierre multiusuario con RLS en Supabase. */
(()=>{'use strict';
const M=window.FacturacionMotor,Cloud=window.FacturacionCloud,$=id=>document.getElementById(id),money=n=>n==null?'—':new Intl.NumberFormat('es-PE',{style:'currency',currency:'PEN'}).format(n),fnum=(n,dp=2)=>n==null?'—':new Intl.NumberFormat('es-PE',{minimumFractionDigits:0,maximumFractionDigits:dp}).format(n),safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),csvSafe=v=>typeof v==='string'&&/^[=+@\-\t\r]/.test(v)?"'"+v:v;
let publishedList=[],publishedSummary=[],publishedCurrent=null,pubPage=0,pubCount=0,pubBusy=false;
let db=null,config=null,rows=[],referenceRows=[],sourceStats=null,result=null,view={details:[],summary:[],totals:null},sumPage=0,detPage=0,currentTimeKey=null,currentTariffPDV=null,selectedPDVs=new Set(),allPDVs=[],periods=[],currentSnapshot=null,filterTimer=null,importing=false,dbReady=false;
const todayMonth=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;};
function notify(msg,error=false){const el=$('toast');el.hidden=false;el.textContent=msg;el.classList.toggle('error',error);clearTimeout(notify.timeout);notify.timeout=setTimeout(()=>el.hidden=true,4500)}
function setStatus(msg){$('importStatus').textContent=msg}
function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open('facturacion_pdv_v1',1);req.onupgradeneeded=()=>{const d=req.result;for(const name of ['dataset','kv','snapshots'])if(!d.objectStoreNames.contains(name))d.createObjectStore(name,{keyPath:'id'});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
function put(store,obj){return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(obj);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
function get(store,id){return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly'),q=tx.objectStore(store).get(id);q.onsuccess=()=>resolve(q.result??null);q.onerror=()=>reject(q.error);});}
function getAll(store){return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly'),q=tx.objectStore(store).getAll();q.onsuccess=()=>resolve(q.result||[]);q.onerror=()=>reject(q.error);});}
function initialConfig(){return{rule:{rate:10,step:24,maxExcess:120},minGuides:10,times:{},tariffs:{}};}
async function saveConfig(){throw Error('Configuración compartida: usa guardar tiempos, tarifas o reglas en Supabase.');}
function selectedPeriod(){return $('period').value||todayMonth();}
function th(v){return v==null?'—':fnum(v,2)+' h'}
function renderExamples(){const rule=config.rule,base=72;const list=[72,80,96,120,192,192.1].map(t=>({t,...M.discount(t,base,rule)}));$('ruleExamples').innerHTML=list.map(o=>`<div class="rule-example"><strong class="${o.payPct===0?'bad':o.payPct===100?'ok':''}">${fnum(o.payPct)}%</strong>${fnum(o.t,1)} h</div>`).join('');}
async function updateAvailablePeriods(){
 const data=await getAll('dataset');periods=data.map(x=>x.id).sort().reverse();
 const current=selectedPeriod(),previous=config?.refPeriod||current;
 const opts=[...new Set([current,previous,...periods])];
 $('refPeriod').innerHTML=opts.map(p=>`<option value="${safe(p)}">${safe(p)}${p===current?' · periodo actual':''}${p===previous&&p!==current?' · referencia guardada':''}</option>`).join('');
 $('refPeriod').value=opts.includes(previous)?previous:current;
}
async function loadPeriod(){
 if(!Cloud.profile())return;
 const p=selectedPeriod();
 $('period').dataset.periodLoaded=p;
 config={...initialConfig(),...await Cloud.loadConfig(p)};
 config.rule={...initialConfig().rule,...(config.rule||{})};
 config.times=config.times||{};config.tariffs=config.tariffs||{};
 $('rate').value=config.rule.rate;$('step').value=config.rule.step;
 $('maxExcess').value=config.rule.maxExcess;$('minGuides').value=config.minGuides;
 renderExamples();
 const src=await get('dataset',p);rows=src?.rows||[];sourceStats=src?.stats||null;
 selectedPDVs.clear();
 for(const id of ['fDept','fProv','fDist','fSearch','fEstado'])$(id).value='';
 await updateAvailablePeriods();await calculate();
 setStatus(src?`Borrador local: ${src.file||'archivo'} · ${src.uploadedAt||''}`:`Sin archivo local para ${p}. Importa MODULADOR.xlsx.`);
 $('srcBadge').textContent=src?`${fnum(rows.length,0)} guías · ${src.stats?.duplicates||0} duplicadas omitidas · ${src.stats?.high||0} >720 h`:'Sin registros';
}
async function chooseReferenceRows(){
 const rp=$('refPeriod').value||selectedPeriod();if(rp===selectedPeriod())return rows;
 const src=await get('dataset',rp);
 if(!src?.rows?.length)throw Error('Falta importar localmente el periodo de referencia '+rp+' para calcular el ranking de tiempos. No se utilizará silenciosamente otro periodo.');
 return src.rows;
}
async function calculate(){if(!rows.length){result=null;view={details:[],summary:[],totals:null};allPDVs=[];renderAll();return;}try{referenceRows=await chooseReferenceRows();result=M.run(rows,{period:selectedPeriod(),...config},referenceRows);allPDVs=[...new Set(result.summary.map(x=>x.pdv))].sort();renderPDVFilter();populateGeoOptions();applyFilters();}catch(e){result=null;view={details:[],summary:[],totals:null};renderAll();setStatus(e.message);notify('Error calculando resultados: '+e.message,true);console.error(e);}}
function renderPDVFilter(){selectedPDVs=new Set([...selectedPDVs].filter(p=>allPDVs.includes(p)));const zone=$('pdvChecks');zone.innerHTML=`<label class="pdv-option"><input type="checkbox" data-pdv-all ${selectedPDVs.size===0?'checked':''}> Todos los PDV</label>`+allPDVs.map(p=>`<label class="pdv-option"><input type="checkbox" data-pdv="${safe(p)}" ${selectedPDVs.has(p)?'checked':''}> ${safe(p)}</label>`).join('');$('pdvLabel').textContent=selectedPDVs.size?`${selectedPDVs.size} PDV seleccionados`:'Todos los PDV';}
function populateGeoOptions(){const s=result?.summary||[];const oldD=$('fDept').value,oldP=$('fProv').value,oldZ=$('fDist').value;
 for(const [id,key,fn] of [['fDept','dept',()=>true],['fProv','prov',x=>!$('fDept').value||x.dept===$('fDept').value],['fDist','dist',x=>(!$('fDept').value||x.dept===$('fDept').value)&&(!$('fProv').value||x.prov===$('fProv').value)]]){const el=$(id),old={fDept:oldD,fProv:oldP,fDist:oldZ}[id],items=[...new Set(s.filter(fn).map(x=>x[key]))].sort();el.innerHTML=`<option value="">${id==='fProv'?'Todas':'Todos'}</option>`+items.map(x=>`<option value="${safe(x)}">${safe(x)}</option>`).join('');if(items.includes(old))el.value=old;}}
function filteredDetailRows(){if(!result)return[];const d=$('fDept').value,p=$('fProv').value,z=$('fDist').value,s=M.norm($('fSearch').value),e=$('fEstado').value;
 return result.details.filter(r=>(!d||r.dept===d)&&(!p||r.prov===p)&&(!z||r.dist===z)&&(!selectedPDVs.size||selectedPDVs.has(r.pdv))&&(!s||r.guia.includes(s)||r.pdv.includes(s)||r.dist.includes(s))&&(!e||(e==='CERO POR EXCESO'?r.ceroMax:r.estado===e)));
}
function accumulate(filtered){const groups=new Map(),look=new Map((result?.summary||[]).map(g=>[g.key,g]));const tot={guias:0,bruto:0,descuentos:0,neto:0,calculadas:0,pendientes:0,fuera:0,cero:0};
 for(const r of filtered){const k=M.localKey(selectedPeriod(),r.dept,r.prov,r.dist,r.pdv);let g=groups.get(k);if(!g){const source=look.get(k);if(!source)continue;g={...source,count:0,timeSum:0,promedio:0,gross:0,discount:0,net:0,billable:0,excluded:0,breached:0,zero:0};groups.set(k,g);}g.count++;g.timeSum+=r.horas;tot.guias++;
  if(r.neto!=null){g.gross=M.money(g.gross+r.tarifa);g.discount=M.money(g.discount+r.descuento);g.net=M.money(g.net+r.neto);g.billable++;tot.bruto=M.money(tot.bruto+r.tarifa);tot.descuentos=M.money(tot.descuentos+r.descuento);tot.neto=M.money(tot.neto+r.neto);tot.calculadas++;if(r.exceso>0){tot.fuera++;g.breached++;}if(r.pagoPct===0){tot.cero++;g.zero++;}}else{g.excluded++;tot.pendientes++;}
 }
 const summary=[...groups.values()].map(g=>({...g,promedio:g.timeSum/g.count})).sort((a,b)=>a.dept.localeCompare(b.dept)||a.prov.localeCompare(b.prov)||a.dist.localeCompare(b.dist)||a.pdv.localeCompare(b.pdv));return {summary,tot};}
function applyFilters(){const det=filteredDetailRows(),data=accumulate(det);view={details:det,summary:data.summary,totals:data.tot};sumPage=0;detPage=0;renderAll();}
function renderAll(){renderKPIs();renderSummary();renderDetail();renderTariffs();renderCloseStatus();}
function renderKPIs(){const t=view.totals;$('kGuias').textContent=t?fnum(t.guias,0):'—';$('kBruto').textContent=t?money(t.bruto):'—';$('kDescuento').textContent=t?money(t.descuentos):'—';$('kNeto').textContent=t?money(t.neto):'—';$('kPendientes').textContent=t?fnum(t.pendientes,0):'—';}
function renderSummary(){const list=view.summary,per=40,n=Math.max(1,Math.ceil(list.length/per));sumPage=Math.min(sumPage,n-1);$('summaryCount').textContent=`${fnum(list.length,0)} filas · ${fnum(view.details.length,0)} guías`;
 $('summaryBody').innerHTML=list.length?list.slice(sumPage*per,(sumPage+1)*per).map(g=>`<tr><td>${safe(g.dept)}</td><td>${safe(g.prov)}</td><td>${safe(g.dist)}</td><td><b>${safe(g.pdv)}</b></td><td>${fnum(g.count,0)}</td><td>${th(g.promedio)}</td><td>${g.bestPDV?safe(g.bestPDV):'<span class="bad">Muestra insuficiente</span>'}</td><td>${th(g.bestHours)}</td><td>${th(g.umbral)}</td><td>${th(g.consolidacion)}</td><td>${th(g.retraslado)}</td><td>${th(g.adicional)}</td><td>${th(g.necesario)}</td><td>${th(g.establecido)}</td><td class="${g.umbralEst==null?'bad':'warn'}">${th(g.umbralEst)}</td><td>${safe(g.tariffOrigin)}</td><td>${money(g.gross)}</td><td>${money(g.discount)}</td><td class="amount">${money(g.net)}</td><td class="truncate" title="${safe(g.observaciones)}">${safe(g.observaciones)}</td><td><button class="btn-mini" data-time="${safe(g.key)}">Configurar</button></td></tr>`).join(''):`<tr><td colspan="21" class="empty">Sin registros para estos filtros.</td></tr>`;
 const t=view.totals;$('summaryFoot').innerHTML=t&&t.guias?`<tr><td colspan="4">TOTAL FILTRADO</td><td>${fnum(t.guias,0)}</td><td colspan="11"></td><td>${money(t.bruto)}</td><td>${money(t.descuentos)}</td><td>${money(t.neto)}</td><td colspan="2"></td></tr>`:'';$('sumPage').textContent=`Página ${sumPage+1} de ${n}`;$('sumPrev').disabled=sumPage<=0;$('sumNext').disabled=sumPage>=n-1;
}
function renderDetail(){const list=view.details,per=100,n=Math.max(1,Math.ceil(list.length/per));detPage=Math.min(detPage,n-1);
 $('detailBody').innerHTML=list.length?list.slice(detPage*per,(detPage+1)*per).map(r=>`<tr><td><b>${safe(r.guia)}</b></td><td>${safe(r.pdv)}</td><td>${safe(r.dept)}</td><td>${safe(r.prov)}</td><td>${safe(r.dist)}</td><td>${safe(r.fecha)}</td><td>${th(r.horas)}</td><td>${th(r.establecido)}</td><td class="${r.umbralEst==null?'bad':'warn'}">${th(r.umbralEst)}</td><td>${th(r.exceso)}</td><td>${money(r.tarifa)}</td><td class="${r.reduccion>0?'bad':''}">${r.reduccion==null?'—':fnum(r.reduccion)+'%'}</td><td class="${r.pagoPct===0?'bad':'ok'}">${r.pagoPct==null?'—':fnum(r.pagoPct)+'%'}</td><td>${money(r.descuento)}</td><td class="amount">${money(r.neto)}</td><td>${r.ceroMax?'<span class="bad">CERO POR EXCESO</span>':safe(r.estado)}</td></tr>`).join(''):`<tr><td colspan="16" class="empty">Sin guías para estos filtros.</td></tr>`;
 $('detPage').textContent=`Página ${detPage+1} de ${n} · ${fnum(list.length,0)} registros`;$('detPrev').disabled=detPage<=0;$('detNext').disabled=detPage>=n-1;
}
function renderTariffs(){const list=[...new Set((result?.summary||[]).map(g=>g.pdv))].sort();$('tariffBody').innerHTML=list.length?list.map(p=>{const t=config.tariffs[p]||{},zones=Object.keys(t.zones||{}).filter(k=>M.num(t.zones[k])!==null);return `<tr><td><b>${safe(p)}</b></td><td>${safe(t.mode||'NO DEFINIDA')}</td><td>${money(M.num(t.standard))}</td><td>${zones.length}</td><td><button class="btn-mini" data-tariff="${safe(p)}">Configurar</button></td></tr>`}).join(''):'<tr><td colspan="5" class="empty">No hay PDV cargados.</td></tr>';}
function renderCloseStatus(){const t=result?.totals||null;if(!t){$('closeTitle').textContent='Sin guías cargadas';$('closeMessage').textContent='Carga un archivo para comenzar.';$('btnClose').disabled=true;return;}
 $('closeTitle').textContent=`Periodo ${selectedPeriod()} · ${fnum(t.guias,0)} guías`;$('closeMessage').textContent=(sourceStats?.pdvConflicts>0)?`Existen ${sourceStats.pdvConflicts} guías con más de un PDV en el Excel. Corrige esos casos en el archivo original y vuelve a importar antes del cierre.`:t.pendientes?`${fnum(t.pendientes,0)} guías no tienen tarifa o tiempo base. Debes resolverlas antes de finalizar. El cierre usa TODAS las guías del periodo, no solo los filtros visibles.`:`Todas las ${fnum(t.calculadas,0)} guías tienen tarifa y tiempo base. Puedes congelar una versión final de esta liquidación.`;$('btnClose').disabled=t.pendientes>0||(sourceStats?.pdvConflicts||0)>0||importing;
}
function openTime(k){const g=result?.summary.find(x=>x.key===k);if(!g)return;currentTimeKey=k;const t=config.times[k]||{};$('timeIdentity').textContent=`${g.pdv} · ${g.dept} / ${g.prov} / ${g.dist} · Mejor tiempo: ${th(g.bestHours)}`;
 for(const [id,prop] of [['tConsolidacion','consolidacion'],['tRetraslado','retraslado'],['tAdicional','adicional'],['tNecesario','necesario'],['tManual','manualBase']])$(id).value=t[prop]??'';$('tObs').value=t.observaciones||'';$('timeDialog').showModal();}
async function saveTime(){
 if(!Cloud.admin())throw Error('No autorizado.');
 const g=result?.summary.find(x=>x.key===currentTimeKey);if(!g)throw Error('No se encuentra el PDV/distrito.');
 const fields={consolidacion:$('tConsolidacion').value,retraslado:$('tRetraslado').value,
  adicional:$('tAdicional').value,necesario:$('tNecesario').value,manualBase:$('tManual').value};
 for(const [k,v] of Object.entries(fields))if(v!==''&&(!Number.isFinite(Number(v))||Number(v)<0))throw Error('Valor negativo o inválido en '+k);
 const value={...Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v===''?null:Number(v)])),observaciones:$('tObs').value.trim()};
 await Cloud.saveTime(selectedPeriod(),g,value);
 config.times[currentTimeKey]=value;await calculate();notify('Tiempos compartidos guardados en Supabase.');
}
function openTariff(pdv){currentTariffPDV=pdv;const t=config.tariffs[pdv]||{mode:'ESTANDAR',standard:null,zones:{}};$('tariffIdentity').textContent=pdv;$('tMode').value=t.mode||'ESTANDAR';$('tStandard').value=t.standard??'';
 const distinct=new Map();for(const r of rows)if(r.pdv===pdv){const key=M.districtKey(r.dept,r.prov,r.dist);distinct.set(key,`${r.dept} / ${r.prov} / ${r.dist}`);}
 for(const k of Object.keys(t.zones||{}))if(!distinct.has(k))distinct.set(k,k.replaceAll('|',' / '));
 $('zoneRates').innerHTML=[...distinct.entries()].sort((a,b)=>a[1].localeCompare(b[1])).map(([key,name])=>`<div class="zone-row"><label>${safe(name)}</label><input data-zone-key="${safe(key)}" type="number" step="0.01" min="0" placeholder="Estándar" value="${t.zones?.[key]??''}"></div>`).join('');toggleZones();$('tariffDialog').showModal();}
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
 config.tariffs[currentTariffPDV]=value;await calculate();notify('Tarifario guardado en Supabase para '+currentTariffPDV);
}
async function saveRules(){
 if(!Cloud.admin())throw Error('No autorizado.');
 const rate=M.num($('rate').value),step=M.num($('step').value),maxExcess=M.num($('maxExcess').value),min=M.num($('minGuides').value);
 if(rate==null||rate<0||rate>100||step==null||step<=0||maxExcess==null||maxExcess<0||min==null||min<1||!Number.isInteger(min))throw Error('Revisa valores (0-100%, bloque positivo, máximo >=0, mínimo entero >=1).');
 const rule={rate,step,maxExcess},ref=$('refPeriod').value||selectedPeriod();
 await Cloud.saveRules(selectedPeriod(),rule,min,ref);
 config.rule=rule;config.minGuides=min;config.refPeriod=ref;
 renderExamples();await calculate();notify('Reglas sincronizadas en Supabase.');
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
  await put('dataset',{id:destPeriod,rows:parsed.rows,stats:parsed.stats,headers:parsed.headers,file:file.name,uploadedAt:new Date().toLocaleString('es-PE')});
  setStatus('Importación finalizada: '+file.name);await loadPeriod();notify(`${fnum(parsed.stats.valid,0)} guías importadas · ${parsed.stats.invalid} filas inválidas · ${parsed.stats.duplicates} duplicadas.`,false);
 }catch(e){setStatus('Error de carga: '+e.message);notify('No se pudo cargar: '+e.message,true);console.error(e);}finally{importing=false;$('fileInput').value='';renderCloseStatus();}}
function exportData(summary,details,name,settings,stats){if(!window.XLSX)throw Error('No se cargó el exportador XLSX. Verifica la conexión a internet.');const clean=arr=>arr.map(row=>row.map(csvSafe));
 const resHeaders=['DEPARTAMENTO','PROVINCIA','DISTRITO','PDV','GUIAS','PROMEDIO LOGRADO H','MEJOR PDV','MEJOR TIEMPO H','UMBRAL H','CONSOLIDACION H','RETRASLADO H','TIEMPO ADICIONAL H','NECESARIO DESPACHO H','TIEMPO ESTABLECIDO H','UMBRAL ESTABLECIDO H','ORIGEN BASE','BRUTO S/','DESCUENTOS S/','NETO S/','OBSERVACIONES'];
 const drHeaders=['GUIA','PDV','DEPARTAMENTO','PROVINCIA','DISTRITO','DIA REPARTO','TIEMPO LOGRADO H','TIEMPO ESTABLECIDO H','UMBRAL ESTABLECIDO H','EXCESO H','TARIFA S/','TIPO TARIFA','REDUCCION %','PAGO %','DESCUENTO S/','NETO S/','ESTADO'];
 const summaryRows=[resHeaders,...summary.map(g=>[g.dept,g.prov,g.dist,g.pdv,g.count,g.promedio,g.bestPDV,g.bestHours,g.umbral,g.consolidacion,g.retraslado,g.adicional,g.necesario,g.establecido,g.umbralEst,g.origen,g.gross,g.discount,g.net,g.observaciones])];
 const detailRows=[drHeaders,...details.map(r=>[r.guia,r.pdv,r.dept,r.prov,r.dist,r.fecha,r.horas,r.establecido,r.umbralEst,r.exceso,r.tarifa,r.tarifaTipo,r.reduccion,r.pagoPct,r.descuento,r.neto,r.ceroMax?'CERO POR EXCESO':r.estado])];
 const tarifRows=[['PDV','MODALIDAD','TARIFA ESTANDAR S/','DEPARTAMENTO/PROVINCIA/DISTRITO','TARIFA ZONAL S/']];for(const [pdv,t] of Object.entries(settings.tariffs||{})){tarifRows.push([pdv,t.mode,t.standard,'','']);for(const [key,value] of Object.entries(t.zones||{}))tarifRows.push([pdv,t.mode,t.standard,key.replaceAll('|',' / '),value]);}
 const ruleRows=[['PARAMETRO','VALOR'],['Periodo',settings.period||selectedPeriod()],['Periodo referencia',settings.refPeriod||selectedPeriod()],['Porcentaje reducción (%)',settings.rule.rate],['Horas por bloque',settings.rule.step],['Exceso máximo permitido (h)',settings.rule.maxExcess],['Mínimo guías mejor PDV',settings.minGuides],['Guías fuente',stats?.valid||''],['Duplicados descartados',stats?.duplicates||0],['Conflictos entre PDV',stats?.pdvConflicts||0],['Guías de otros meses excluidas',stats?.excludedOtherMonths||0],['Filas inválidas',stats?.invalid||0],['Regla exceso máximo','Pago 0% si horas excedentes > máximo (no >=)'],['Primera reducción','Inmediatamente al superar umbral; en cada frontera adicional, siguiente descuento']];
 const book=XLSX.utils.book_new();for(const [sheetName,data] of [['RESUMEN',summaryRows],['DETALLE',detailRows],['TARIFAS',tarifRows],['REGLAS',ruleRows]]){const sh=XLSX.utils.aoa_to_sheet(clean(data));sh['!cols']=data[0].map(v=>({wch:Math.min(34,Math.max(13,String(v).length+2))}));XLSX.utils.book_append_sheet(book,sh,sheetName);}XLSX.writeFile(book,name+'.xlsx',{compression:true});}
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
  stats:structuredClone(sourceStats||{}),summary:result.summary,details:result.details,
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
 $('period').addEventListener('change',loadPeriod);$('fileInput').addEventListener('change',e=>importFile(e.target.files?.[0]));$('btnExport').addEventListener('click',exportCurrent);
 for(const id of ['fDept','fProv','fDist'])$(id).addEventListener('change',()=>{if(id==='fDept'){$('fProv').value='';$('fDist').value='';}if(id==='fProv')$('fDist').value='';populateGeoOptions();applyFilters();});$('fEstado').addEventListener('change',applyFilters);$('fSearch').addEventListener('input',()=>{clearTimeout(filterTimer);filterTimer=setTimeout(applyFilters,140)});$('btnClear').addEventListener('click',()=>{for(const id of ['fDept','fProv','fDist','fSearch','fEstado'])$(id).value='';selectedPDVs.clear();renderPDVFilter();populateGeoOptions();applyFilters();});
 $('pdvChecks').addEventListener('change',e=>{if(!e.target.matches('input'))return;if(e.target.hasAttribute('data-pdv-all'))selectedPDVs.clear();else{const p=e.target.dataset.pdv;if(e.target.checked)selectedPDVs.add(p);else selectedPDVs.delete(p);}renderPDVFilter();applyFilters();});
 $('sumPrev').addEventListener('click',()=>{sumPage=Math.max(0,sumPage-1);renderSummary();});$('sumNext').addEventListener('click',()=>{sumPage++;renderSummary();});$('detPrev').addEventListener('click',()=>{detPage=Math.max(0,detPage-1);renderDetail();});$('detNext').addEventListener('click',()=>{detPage++;renderDetail();});
 $('summaryBody').addEventListener('click',e=>{const b=e.target.closest('[data-time]');if(b)openTime(b.dataset.time);});$('tariffBody').addEventListener('click',e=>{const b=e.target.closest('[data-tariff]');if(b)openTariff(b.dataset.tariff);});$('tMode').addEventListener('change',toggleZones);
 $('timeDialog').addEventListener('close',async()=>{if($('timeDialog').returnValue==='save')try{await saveTime();}catch(e){notify(e.message,true);}});$('tariffDialog').addEventListener('close',async()=>{if($('tariffDialog').returnValue==='save')try{await saveTariff();}catch(e){notify(e.message,true);}});$('btnSaveRules').addEventListener('click',async()=>{try{await saveRules();}catch(e){notify(e.message,true);}});$('refPeriod').addEventListener('change',calculate);$('btnClose').addEventListener('click',closePeriod);$('historyList').addEventListener('click',e=>{
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
 if(Cloud.admin())await loadPeriod();
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
