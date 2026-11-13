/*
 * PENALIDADES · EXPORTACION MASIVA POR AGRUPACION v2
 * Complemento de SOLO LECTURA. No crea tablas, no escribe en Supabase.
 * Obtiene liquidaciones/grupos desde penalidades_obtener_resumen y
 * detalle completo (paginado) desde penalidades_obtener_items.
 * Datos y permisos: sesión Supabase Auth del portal de Penalidades.
 */
(function (root) {
  'use strict';
  const IDS={box:'penalidadesGrupoExcelBox', group:'penalidadesGrupoExcelGrupo', period:'penalidadesGrupoExcelPeriodo', button:'penalidadesGrupoExcelBoton', status:'penalidadesGrupoExcelEstado',info:'penalidadesGrupoExcelInfo'};
  const PAGE_SIZE=500;
  const CURRENCY='"S/" #,##0.00;[Red]("S/" #,##0.00)';
  const clean=v=>String(v==null?'':v).replace(/\s+/g,' ').trim();
  const norm=v=>clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
  const filename=v=>norm(v).replace(/[^A-Z0-9_-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,65)||'GRUPO';
  const roundCents=n=>Math.round((Number(n)||0)*100);
  const moneyNum=cents=>cents/100;
  const fmt=n=>Number(n||0).toLocaleString('es-PE',{minimumFractionDigits:2,maximumFractionDigits:2});
  const choose=(...candidates)=>candidates.find(v=>v!==undefined&&v!==null&&v!=='');
  function getRecordGroupId(r){return clean(choose(r?.groupId,r?.group_id,r?.grupo_id));}
  function getRecordPeriod(r){return clean(choose(r?.period,r?.periodo));}
  function getRecordPdv(r){return clean(choose(r?.pdv,r?.pdv_key));}
  function getGroupId(g){return clean(choose(g?.id,g?.group_id));}
  function getGroupName(g){return clean(choose(g?.name,g?.nombre));}
  function getRecordId(r){return clean(choose(r?.id,r?.recordKey,r?.record_key));}
  function getItemPenalty(item){return clean(choose(item?.penalty,item?.penalizacion))||'Sin tipo';}
  function getItemReason(item){return clean(choose(item?.reason,item?.motivo_decision))||'Sin motivo de decisión';}
  function getItemCost(item){const n=Number(choose(item?.cost,item?.costo,0));if(!Number.isFinite(n))throw new Error('Importe no numérico en una penalidad. No se generó un Excel incompleto.');return n;}
  function getItemPercent(item){const n=Number(choose(item?.exemptionPercent,item?.porcentaje_exoneracion,item?.exonerated?100:0));return Number.isFinite(n)?Math.min(100,Math.max(0,n)):0;}
  function getItemGuide(item){return clean(choose(item?.tracking,item?.guia,item?.numero_guia));}
  function selectRecords(state,groupId,period=''){
    const groups=Array.isArray(state?.groups)?state.groups:[];
    const records=Array.isArray(state?.records)?state.records:[];
    const validGroupIds=new Set(groups.map(getGroupId));
    if(groupId!=='__SIN_GRUPO__'&&!validGroupIds.has(groupId))throw new Error('La agrupación seleccionada ya no existe. Actualiza la lista.');
    const selected=records.filter(r=>{
      const id=getRecordGroupId(r);
      return (groupId==='__SIN_GRUPO__'?(!id||!validGroupIds.has(id)):id===groupId)&&(!period||getRecordPeriod(r)===period);
    });
    const ids=new Set();
    for(const r of selected){const id=getRecordId(r);if(!id)throw new Error('Hay una liquidación sin ID. No se puede verificar la descarga completa.');if(ids.has(id))throw new Error('La lista contiene liquidaciones duplicadas. No se generó el Excel.');ids.add(id);}
    return selected.sort((a,b)=>getRecordPeriod(a).localeCompare(getRecordPeriod(b))||getRecordPdv(a).localeCompare(getRecordPdv(b),'es'));
  }
  function createAccumulator(){return {records:[],detail:[],consolidated:new Map(),recordSummaries:[],rowCount:0,initCents:0,finalCents:0};}
  function addRecord(acc,record,items,groupName){
    const byReason=new Map(),guideIds=new Set(),seenItems=new Set();
    for(const item of items){
      if(!item||typeof item!=='object')throw new Error('El detalle contiene una fila no válida.');
      const itemId=clean(item.id);
      if(itemId){if(seenItems.has(itemId))throw new Error('Una penalidad se repitió al paginar '+getRecordPdv(record)+'. Reintenta cuando termine la sincronización.');seenItems.add(itemId);}
      const guide=getItemGuide(item);if(guide)guideIds.add(guide);
      const penalty=getItemPenalty(item),reason=getItemReason(item),key=norm(penalty)+'\u0000'+norm(reason),cost=getItemCost(item),final=cost*(1-getItemPercent(item)/100);
      if(!byReason.has(key))byReason.set(key,{penalty,reason,cost:0,final:0,rows:0});
      const entry=byReason.get(key);entry.cost+=cost;entry.final+=final;entry.rows++;
    }
    let totalIni=0,totalFin=0;
    for(const entry of byReason.values()){
      // Redondeo igual que el resumen mostrado: una vez por combinación
      // penalidad/motivo de cada liquidación (no por guía individual).
      const ini=roundCents(entry.cost),fin=roundCents(entry.final);totalIni+=ini;totalFin+=fin;
      const detailRow={group:groupName,period:getRecordPeriod(record),pdv:getRecordPdv(record),penalty:entry.penalty,reason:entry.reason,initCents:ini,finalCents:fin,rows:entry.rows};
      acc.detail.push(detailRow);
      const key=norm(entry.penalty)+'\u0000'+norm(entry.reason);
      if(!acc.consolidated.has(key))acc.consolidated.set(key,{penalty:entry.penalty,reason:entry.reason,initCents:0,finalCents:0,rows:0});
      const combined=acc.consolidated.get(key);combined.initCents+=ini;combined.finalCents+=fin;combined.rows+=entry.rows;
    }
    acc.rowCount+=items.length;acc.initCents+=totalIni;acc.finalCents+=totalFin;
    acc.recordSummaries.push({group:groupName,period:getRecordPeriod(record),pdv:getRecordPdv(record),status:clean(choose(record.status,record.estado,'Pendiente')),rows:items.length,uniqueGuides:guideIds.size,initCents:totalIni,finalCents:totalFin});
    acc.records.push(getRecordId(record));
  }
  function workbookData(acc,groupName,period=''){
    const sorted=[...acc.consolidated.values()].sort((a,b)=>a.penalty.localeCompare(b.penalty,'es')||a.reason.localeCompare(b.reason,'es'));
    const consolidated=[['PENALIDAD','MOTIVO DE DECISIÓN','PENALIDAD INICIAL APLICADA (S/)','PENALIDAD FINAL (S/)'],...sorted.map(r=>[r.penalty,r.reason,moneyNum(r.initCents),moneyNum(r.finalCents)])];
    const consolidatedTotalIndex=consolidated.length;
    consolidated.push(['TOTAL GENERAL','',moneyNum(acc.initCents),moneyNum(acc.finalCents)]);
    const detail=[['GRUPO','PERIODO','PDV','PENALIDAD','MOTIVO DE DECISIÓN','PENALIDAD INICIAL (S/)','PENALIDAD FINAL (S/)','FILAS'],...acc.detail.sort((a,b)=>a.period.localeCompare(b.period)||a.pdv.localeCompare(b.pdv,'es')||a.penalty.localeCompare(b.penalty,'es')||a.reason.localeCompare(b.reason,'es')).map(r=>[r.group,r.period,r.pdv,r.penalty,r.reason,moneyNum(r.initCents),moneyNum(r.finalCents),r.rows])];
    const detailTotalIndex=detail.length;
    detail.push(['TOTAL GENERAL','','','','',moneyNum(acc.initCents),moneyNum(acc.finalCents),acc.rowCount]);
    const summary=[['GRUPO','PERIODO','PDV','ESTADO','FILAS DE PENALIDAD','GUÍAS ÚNICAS','PENALIDAD INICIAL (S/)','PENALIDAD FINAL (S/)'],...acc.recordSummaries.map(r=>[r.group,r.period,r.pdv,r.status,r.rows,r.uniqueGuides,moneyNum(r.initCents),moneyNum(r.finalCents)])];
    const summaryTotalIndex=summary.length;
    summary.push(['TOTAL GENERAL','','','',acc.rowCount,'—',moneyNum(acc.initCents),moneyNum(acc.finalCents)]);
    const control=[['CONTROL DE EXPORTACIÓN','VALOR'],['Agrupación',groupName],['Periodo',period||'Todos los periodos'],['Liquidaciones exportadas',acc.records.length],['Filas de penalidad',acc.rowCount],['Penalidad inicial (S/)',moneyNum(acc.initCents)],['Penalidad final (S/)',moneyNum(acc.finalCents)],['Origen','Supabase · estado confirmado al descargar'],['Criterio','Todas las penalidades de las liquidaciones del grupo/periodo, sin aplicar filtros del detalle individual'],['Notas','Una misma guía puede tener más de una penalidad. No se deduplican penalidades por guía.'],['Totales','Suma de importes mostrados a 2 decimales por penalidad/motivo de cada liquidación.']];
    return [{name:'RESUMEN_TABULAR',values:consolidated,totalIndex:consolidatedTotalIndex,currency:[2,3],widths:[48,62,30,27]},{name:'POR_LIQUIDACION',values:detail,totalIndex:detailTotalIndex,currency:[5,6],widths:[25,16,18,45,55,25,25,12]},{name:'RESUMEN_PDV',values:summary,totalIndex:summaryTotalIndex,currency:[6,7],widths:[25,16,18,20,20,17,27,27]},{name:'CONTROL',values:control,totalIndex:-1,currency:[5,6],widths:[48,98]}];
  }
  function style(cell,r,c,sheet){
    if(!cell)return;
    const header=r===0,total=r===sheet.totalIndex;
    const bg=header?'235986':total?'DCE8F3':r%2?'FFFFFF':'F5F8FB';
    cell.s={font:{name:'Aptos',sz:10,bold:header||total,color:{rgb:header?'FFFFFF':'243A50'}},fill:{patternType:'solid',fgColor:{rgb:bg}},alignment:{vertical:'center',horizontal:sheet.currency.includes(c)?'right':'left',wrapText:header},border:{bottom:{style:'thin',color:{rgb:'CCD7E2'}}}};
    if(r>0&&sheet.currency.includes(c)&&cell.t==='n')cell.z=CURRENCY;
  }
  function createWorkbook(XLSX,acc,groupName,period){
    if(!XLSX?.utils?.aoa_to_sheet||!XLSX?.utils?.book_new)throw new Error('Falta la biblioteca XLSX en Penalidades.');
    const wb=XLSX.utils.book_new();
    for(const tab of workbookData(acc,groupName,period)){
      const ws=XLSX.utils.aoa_to_sheet(tab.values);
      ws['!cols']=tab.widths.map(wch=>({wch}));
      ws['!rows']=tab.values.map((_,i)=>({hpt:i===0?34:i===tab.totalIndex?26:21}));
      if(tab.name!=='CONTROL'&&tab.values.length>2)ws['!autofilter']={ref:'A1:'+XLSX.utils.encode_cell({r:tab.totalIndex-1,c:tab.values[0].length-1})};
      for(let r=0;r<tab.values.length;r++)for(let c=0;c<tab.values[r].length;c++)style(ws[XLSX.utils.encode_cell({r,c})],r,c,tab);
      XLSX.utils.book_append_sheet(wb,ws,tab.name);
    }
    wb.Props={Title:'Penalidades - resumen masivo tabular por agrupacion',Subject:'Penalidad y motivo por liquidación y agrupación',Author:'Penalidades'};
    return wb;
  }
  async function getClient(){
    // Reutiliza exclusivamente la sesión del mismo portal; jamás usa service_role.
    let client;
    try{if(typeof exoSupabaseClient!=='undefined'&&exoSupabaseClient)client=exoSupabaseClient;}catch(_e){}
    if(!client){
      const cfg=root.V16_CONFIG;if(!root.supabase?.createClient||!cfg?.url||!cfg?.key)throw new Error('Abre Penalidades después de iniciar sesión en Revisión de Guías.');
      client=root.__penalidadesGrupoExcelClient||(root.__penalidadesGrupoExcelClient=root.supabase.createClient(cfg.url,cfg.key,{auth:{storageKey:'v16-replica-auth',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}}));
    }
    const {data,error}=await client.auth.getSession();if(error||!data?.session)throw new Error('Tu sesión caducó. Inicia sesión nuevamente en el portal.');
    return client;
  }
  async function rpc(client,name,params){const {data,error}=await client.rpc(name,params||{});if(error)throw new Error(name+': '+(error.message||String(error)));return data;}
  async function loadState(client){
    const state=await rpc(client,'penalidades_obtener_resumen');
    if(!state||!Array.isArray(state.records)||!Array.isArray(state.groups))throw new Error('El resumen Supabase no incluye grupos y liquidaciones en el formato esperado. No se generará una exportación parcial.');
    return state;
  }
  async function fetchAndAggregate(client,acc,record,groupName,update){
    let offset=0,items=[],page=0;
    while(true){
      const data=await rpc(client,'penalidades_obtener_items',{p_record_key:getRecordId(record),p_offset:offset,p_limit:PAGE_SIZE});
      if(!Array.isArray(data))throw new Error('Supabase no devolvió las penalidades como lista para '+getRecordPdv(record));
      items.push(...data);page++;
      if(data.length<PAGE_SIZE)break;
      offset+=PAGE_SIZE;
      if(page>=1000)throw new Error('Se alcanzó un límite preventivo de paginación. No se descargó un archivo parcial.');
      update?.(`Leyendo ${getRecordPdv(record)}: ${items.length.toLocaleString('es-PE')} penalidades…`);
    }
    addRecord(acc,record,items,groupName);
  }
  async function collectGroup(client,groupId,period,update){
    const state=await loadState(client);
    const groupName=groupId==='__SIN_GRUPO__'?'Sin grupo':getGroupName((state.groups||[]).find(g=>getGroupId(g)===groupId));
    if(!groupName)throw new Error('No se identificó el nombre del grupo.');
    const records=selectRecords(state,groupId,period);
    if(!records.length)throw new Error('La agrupación no contiene liquidaciones para ese periodo.');
    const acc=createAccumulator();
    // Evita una explosión de consultas concurrentes y recoge errores antes de exportar.
    let next=0,done=0;
    async function worker(){
      while(next<records.length){
        const record=records[next++];
        await fetchAndAggregate(client,acc,record,groupName,update);
        done++;update?.(`${done} de ${records.length} liquidaciones leídas · ${acc.rowCount.toLocaleString('es-PE')} penalidades`);
      }
    }
    await Promise.all(Array.from({length:Math.min(3,records.length)},()=>worker()));
    if(acc.records.length!==records.length)throw new Error('No se completaron todas las liquidaciones; se canceló la exportación.');
    return {acc,groupName,period,recordCount:records.length};
  }
  function message(doc,textValue,isError=false){
    const el=doc.getElementById(IDS.status);
    if(el){el.textContent=textValue;el.style.color=isError?'#a42820':'#35617d';}
  }
  async function renderGroups(doc){
    const selector=doc.getElementById(IDS.group),periods=doc.getElementById(IDS.period),info=doc.getElementById(IDS.info);
    if(!selector||!periods)return;
    const client=await getClient(),state=await loadState(client);
    const previous=selector.value,oldPeriod=periods.value;
    const groups=[...state.groups].filter(g=>getGroupId(g)&&getGroupName(g)).sort((a,b)=>getGroupName(a).localeCompare(getGroupName(b),'es'));
    selector.replaceChildren(new Option('Seleccionar agrupación',''),...groups.map(g=>new Option(getGroupName(g),getGroupId(g))));
    if(state.records.some(r=>!getRecordGroupId(r)))selector.add(new Option('Sin grupo','__SIN_GRUPO__'));
    if(previous&&[...selector.options].some(o=>o.value===previous))selector.value=previous;
    const selected=selector.value;
    const subset=selected?selectRecords(state,selected):[];
    const availablePeriods=[...new Set(subset.map(getRecordPeriod).filter(Boolean))].sort().reverse();
    periods.replaceChildren(new Option('Todos los periodos',''),...availablePeriods.map(p=>new Option(p,p)));
    if(availablePeriods.includes(oldPeriod))periods.value=oldPeriod;
    info.textContent=selected?`${subset.filter(r=>!periods.value||getRecordPeriod(r)===periods.value).length} liquidación(es) en el alcance seleccionado`:`${groups.length} agrupaciones disponibles`;
    doc.getElementById(IDS.button).disabled=!selected;
    return {state,client};
  }
  async function exportFromUI(doc){
    const groupId=doc.getElementById(IDS.group)?.value,period=doc.getElementById(IDS.period)?.value||'';
    if(!groupId)throw new Error('Selecciona una agrupación.');
    const button=doc.getElementById(IDS.button);button.disabled=true;
    const oldText=button.textContent;button.textContent='Leyendo liquidaciones…';
    try{
      message(doc,'Consultando los datos guardados en Supabase…');
      const client=await getClient();
      const {acc,groupName,recordCount}=await collectGroup(client,groupId,period,textValue=>message(doc,textValue));
      if(!acc.rowCount)throw new Error('Las liquidaciones seleccionadas no contienen penalidades para exportar.');
      const XLSX=root.__penalidadesExcelResumenStyleWriter||root.XLSX;
      const wb=createWorkbook(XLSX,acc,groupName,period);
      const fname=`PENALIDADES_GRUPO_${filename(groupName)}_${period||'TODOS_LOS_PERIODOS'}.xlsx`;
      XLSX.writeFile(wb,fname,{bookType:'xlsx',compression:true});
      message(doc,`Excel generado: ${recordCount} liquidaciones · ${acc.rowCount.toLocaleString('es-PE')} penalidades · Inicial S/ ${fmt(moneyNum(acc.initCents))} · Final S/ ${fmt(moneyNum(acc.finalCents))}.`);
      return {acc,wb,fname};
    }finally{button.textContent=oldText;button.disabled=false;}
  }
  function mount(doc){
    if(doc.getElementById(IDS.box))return true;
    const panel=doc.querySelector('#recordsTable')?.closest('section.panel');
    const anchor=panel?.querySelector('.group-management');
    if(!panel||!anchor)return false;
    const box=doc.createElement('div');box.id=IDS.box;
    box.style.cssText='padding:12px 14px;margin:10px 0 14px;border:1px solid #ccd8e4;border-radius:9px;background:#f7fafd;display:flex;gap:10px 14px;flex-wrap:wrap;align-items:flex-end';
    box.innerHTML=`<div style="flex:1 1 210px;max-width:290px"><label for="${IDS.group}" style="display:block;font-size:12px;font-weight:700;margin-bottom:5px">Excel masivo por agrupación</label><select id="${IDS.group}" style="width:100%;min-height:36px"><option value="">Cargar agrupaciones…</option></select></div>
      <div style="flex:1 1 190px;max-width:250px"><label for="${IDS.period}" style="display:block;font-size:12px;font-weight:700;margin-bottom:5px">Periodo</label><select id="${IDS.period}" style="width:100%;min-height:36px"><option value="">Todos los periodos</option></select></div>
      <button class="btn soft" type="button" id="penalidadesGrupoExcelActualizar" title="Recargar agrupaciones y liquidaciones desde Supabase">Actualizar grupos</button>
      <button class="btn primary" type="button" id="${IDS.button}" disabled>Descargar Excel del grupo</button>
      <div style="width:100%;font-size:12px;color:#47627e"><span id="${IDS.info}">Se incluyen todas las liquidaciones del grupo, no solo la liquidación abierta.</span><div id="${IDS.status}" role="status" aria-live="polite" style="margin-top:3px"></div></div>`;
    anchor.insertAdjacentElement('afterend',box);
    const b=doc.getElementById(IDS.button), group=doc.getElementById(IDS.group), periods=doc.getElementById(IDS.period);
    group.addEventListener('change',()=>renderGroups(doc).catch(e=>message(doc,e.message||String(e),true)));
    periods.addEventListener('change',()=>{renderGroups(doc).catch(e=>message(doc,e.message||String(e),true));});
    doc.getElementById('penalidadesGrupoExcelActualizar').addEventListener('click',()=>renderGroups(doc).then(()=>message(doc,'Agrupaciones actualizadas.')).catch(e=>message(doc,e.message||String(e),true)));
    b.addEventListener('click',()=>exportFromUI(doc).catch(e=>message(doc,'No se descargó un Excel parcial: '+(e.message||String(e)),true)));
    // Evita solicitar acceso a Supabase antes de que Penalidades termine de inicializar su sesión.
    setTimeout(()=>renderGroups(doc).catch(e=>message(doc,e.message||String(e),true)),500);
    return true;
  }
  function install(doc){
    if(mount(doc))return;
    const observer=new MutationObserver(()=>{if(mount(doc))observer.disconnect()});
    observer.observe(doc.documentElement,{childList:true,subtree:true});
  }
  const api={selectRecords,createAccumulator,addRecord,workbookData,createWorkbook,collectGroup,install,roundCents};
  root.PenalidadesExcelAgrupaciones=api;
  if(typeof module==='object'&&module?.exports)module.exports=api;
  if(typeof document!=='undefined'){
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>install(document),{once:true});else install(document);
  }
})(typeof window!=='undefined'?window:globalThis);
