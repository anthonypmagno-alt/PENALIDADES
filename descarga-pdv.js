(()=>{'use strict';
const C=window.CentroCore,$=id=>document.getElementById(id);
const DB='centro-cobertura-v1',STORE='drafts';
const state={raw:[],decisions:{},files:[],invalid:[],compiled:[],conflicts:[],filters:{pdv:new Set(),department:new Set(),province:new Set(),district:new Set()},selected:new Set(),selectedGuides:new Set(),selectedGroups:new Set(),groups:[],groupDraft:new Set(),editingGroup:'',signed:{},signedFiles:[],excludeSigned:true,focused:'',drill:{pdv:'',geo:null,band:null,returns:false},page:0,loading:false};
const fields={pdv:'PDV',department:'Departamento',province:'Provincia',district:'Distrito'};
const safe=s=>String(s??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const fmt=n=>Number(n||0).toLocaleString('es-PE'),num=(x,d=1)=>Number(x||0).toLocaleString('es-PE',{minimumFractionDigits:d,maximumFractionDigits:d});
let ready=false, sharedClient=null, sharedVersion=null, sharedLoading=false;
let publishedSigned={}, publishedSignedFiles=[], personalSigned={}, personalSignedFiles=[], publishedPdvs=new Map(), publishedGuides=new Map();
const access={role:'',user:'',canView:false,canExecute:false,isAdmin:false};

/* V1.11: persisted operational notes independent of Centro and personal Excel. */
const ops={records:new Map(),scope:new Set(),loaded:false,busy:false};
const opsKey=r=>JSON.stringify([String(r.guia||'').trim().toUpperCase(),String(r.pdv||'').trim().toUpperCase()]);
const opsGet=r=>ops.records.get(opsKey(r))||{i1:false,i2:false,i3:false,comentario:''};
const opsCount=r=>['i1','i2','i3'].reduce((n,k)=>n+Number(!!opsGet(r)[k]),0);
const opsAllowed=r=>access.canExecute&&ops.loaded&&!ops.busy&&!state.loading&&!sharedLoading&&ops.scope.has(opsKey(r));
function opsStatus(text,error=false){$('opsStatus').textContent=text;$('opsStatus').classList.toggle('ops-error',error)}
async function opsRpc(accion,payload={}){if(!sharedClient)throw Error('Gestiones requieren Supabase.');const {data,error}=await sharedClient.rpc('v16_cobertura_gestiones',{p_accion:accion,p_payload:payload});if(error)throw Error(error.message);return data||{}}
function opsToolbar(){const enabled=access.canExecute&&ops.loaded&&!ops.busy&&!state.loading&&!sharedLoading&&state.selectedGuides.size>0;for(const id of ['opsApplyComment','opsMark','opsUnmark'])$(id).disabled=!enabled;$('opsReload').disabled=ops.busy||state.loading||sharedLoading;$('opsComment').disabled=!access.canExecute;$('opsAttempt').disabled=!access.canExecute;}
async function loadOps(){if(ops.busy)return false;ops.busy=true;ops.loaded=false;opsStatus('Consultando gestiones guardadas…');opsToolbar();try{const d=await opsRpc('listar');ops.records=new Map((d.registros||[]).map(r=>[opsKey(r),r]));ops.scope=new Set((d.alcance||[]).map(r=>opsKey(r)));ops.loaded=true;opsStatus(`${fmt(ops.records.size)} gestiones guardadas · ${access.canExecute?'edición de guías publicadas':'solo consulta'}`);return true}catch(e){opsStatus('No se pudieron consultar gestiones: '+e.message,true);return false}finally{ops.busy=false;if(state.raw.length||Object.keys(state.signed).length)renderDetail();opsToolbar()}}
function opsMatches(r){const attempts=$('df-attempts').value,comment=$('df-comment').value;return (!attempts||ops.loaded&&opsCount(r)===Number(attempts))&&(!comment||ops.loaded&&(comment==='yes')===!!opsGet(r).comentario.trim())}
function opsCells(r){const m=opsGet(r),key=safe(opsKey(r)),disabled=opsAllowed(r)?'':'disabled';return ['i1','i2','i3'].map((k,i)=>`<td class="ops-check"><input type="checkbox" data-ops-attempt="${k}" data-ops-key="${key}" aria-label="Intento ${i+1} · ${safe(r.guia)}" ${m[k]?'checked':''} ${disabled}></td>`).join('')+`<td class="ops-comment"><textarea rows="2" maxlength="2000" data-ops-note="${key}" aria-label="Comentario ${safe(r.guia)}" ${disabled}>${safe(m.comentario)}</textarea><button type="button" class="btn outline" data-ops-save="${key}" ${disabled}>Guardar</button>${opsCount(r)===3?'<small>3 intentos registrados</small>':''}</td>`}
// Keep edits not yet saved during pagination, selection and filtering in memory only.
const opsDrafts=new Map();
function opsRestoreDrafts(){for(const el of $('detailRows').querySelectorAll('[data-ops-note]'))if(opsDrafts.has(el.dataset.opsNote))el.value=opsDrafts.get(el.dataset.opsNote)}
function opsRows(){return [...new Map([...state.compiled,...signedAugmented()].map(r=>[opsKey(r),r])).values()]}
async function opsSave(rows,patch){if(!access.canExecute)return opsStatus('Tu usuario solo tiene permiso Ver.',true);if(!ops.loaded||ops.busy||state.loading||sharedLoading)return;if(!rows.length)return opsStatus('Selecciona al menos una guía.',true);if(rows.some(r=>!ops.scope.has(opsKey(r))))return opsStatus('Hay guías fuera de la publicación autorizada. Publica Centro o retira esas guías de la selección.',true);ops.busy=true;opsToolbar();let done=0;try{for(let i=0;i<rows.length;i+=300){const batch=rows.slice(i,i+300);opsStatus(`Guardando ${done}/${rows.length} guías…`);const res=await opsRpc('guardar',{registros:batch.map(r=>({guia:r.guia,pdv:r.pdv,...patch}))});if(!Array.isArray(res.registros)||res.registros.length!==batch.length)throw Error('Supabase no confirmó todas las guías del lote.');for(const m of res.registros){ops.records.set(opsKey(m),m);if(Object.hasOwn(patch,'comentario'))opsDrafts.delete(opsKey(m))}done+=batch.length;await new Promise(r=>setTimeout(r,0))}opsStatus(`${fmt(done)} gestión(es) confirmada(s).`)}catch(e){opsStatus(`Confirmadas ${done}/${rows.length}. ${e.message} · Actualiza gestiones antes de reintentar.`,true);ops.loaded=false}finally{ops.busy=false;renderDetail();opsToolbar()}}
function setupOps(){const refresh=()=>{state.page=0;renderDetail()};for(const id of ['df-attempts','df-comment'])$(id).onchange=refresh;$('df-reset').addEventListener('click',()=>{$('df-attempts').value='';$('df-comment').value='';refresh()});$('opsReload').onclick=()=>loadOps();$('detailRows').addEventListener('input',e=>{if(e.target.dataset.opsNote)opsDrafts.set(e.target.dataset.opsNote,e.target.value)});$('detailRows').addEventListener('change',e=>{const el=e.target;if(!el.dataset.opsAttempt)return;const r=opsRows().find(r=>opsKey(r)===el.dataset.opsKey);const value=el.checked;el.checked=!!(r&&opsGet(r)[el.dataset.opsAttempt]);if(r&&opsAllowed(r))opsSave([r],{[el.dataset.opsAttempt]:value})});$('detailRows').addEventListener('click',e=>{const b=e.target.closest('[data-ops-save]');if(!b)return;const r=opsRows().find(r=>opsKey(r)===b.dataset.opsSave),el=b.parentElement.querySelector('textarea');if(r&&opsAllowed(r))opsSave([r],{comentario:el.value.trim()})});const selected=()=>opsRows().filter(r=>state.selectedGuides.has(r.guia));$('opsApplyComment').onclick=()=>{const rows=selected(),text=$('opsComment').value.trim();if(rows.length&&confirm(`¿${text?'Reemplazar':'Borrar'} el comentario de ${rows.length} guías seleccionadas, incluso de otros filtros?`))opsSave(rows,{comentario:text})};for(const [id,value] of [['opsMark',true],['opsUnmark',false]])$(id).onclick=()=>{const rows=selected();if(rows.length&&confirm(`¿${value?'Marcar':'Desmarcar'} ${$('opsAttempt').selectedOptions[0].text} en ${rows.length} guías seleccionadas?`))opsSave(rows,{[$('opsAttempt').value]:value})};opsToolbar();}
const opsExcelCols=[['INTENTO 1',12],['INTENTO 2',12],['INTENTO 3',12],['TOTAL INTENTOS',16],['COMENTARIO DE GESTIÓN',48],['ACTUALIZADO EN (UTC)',27],['USUARIO GESTIÓN',38]];
function opsExcel(r){if(!ops.scope.has(opsKey(r)))return ['','','',null,'','',''];const m=opsGet(r);return [m.i1?'SÍ':'NO',m.i2?'SÍ':'NO',m.i3?'SÍ':'NO',opsCount(r),excelText(m.comentario),excelText(m.actualizado_en),excelText(m.usuario)]}
async function opsBeforeExport(){if(ops.busy)return false;if(opsDrafts.size&&!confirm('Hay comentarios escritos sin guardar. ¿Descargar únicamente las gestiones confirmadas?'))return false;if(!await loadOps()){message('No se pudo consultar las gestiones; se canceló el Excel para evitar datos incompletos.',true);return false}return true}

function message(s,error=false){$('message').textContent=s||'';$('message').classList.toggle('error',error)}
function setBusy(on,label='Procesar Excel') {state.loading=on;$('btnProcess').disabled=on||!$('filesInput').files.length;$('btnProcess').textContent=on?'Procesando…':label;$('btnZip').disabled=on;if($('btnZipGroups'))$('btnZipGroups').disabled=on;if($('btnExportProcess'))$('btnExportProcess').disabled=on||!$('exportInput').files.length;if(on){for(const id of ['btnCopyCheckedGuides','btnCopyFilteredGuides','btnPickAllGuides','btnClearGuideSelection'])if($(id))$(id).disabled=true}else if(state.raw.length&&$('selectPageGuides')){const rows=filteredDetailRows();updateGuideSelectionToolbar(rows,rows.slice(state.page*100,(state.page+1)*100))}refreshSignedControls();if($('opsReload'))opsToolbar()}
function dbOpen(){return new Promise((resolve,reject)=>{let r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE)};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function dbRead(){let db=await dbOpen();return new Promise((resolve,reject)=>{let t=db.transaction(STORE,'readonly');let store=t.objectStore(STORE),r=store.get(access.user?'base:'+access.user:'base');r.onsuccess=()=>{if(r.result||!access.isAdmin){resolve(r.result||null);return}const legacy=store.get('base');legacy.onsuccess=()=>resolve(legacy.result||null);legacy.onerror=()=>resolve(null)};r.onerror=()=>reject(r.error);t.oncomplete=()=>db.close()})}
async function dbWrite(data){let db=await dbOpen();return new Promise((resolve,reject)=>{let t=db.transaction(STORE,'readwrite');t.objectStore(STORE).put(data,access.user?'base:'+access.user:'base');t.oncomplete=()=>{db.close();resolve()};t.onerror=()=>reject(t.error)})}
function showData(){if($('legacyWarning'))$('legacyWarning').classList.toggle('hidden',!state.raw.some(r=>!r.error&&!Object.prototype.hasOwnProperty.call(r,'devolver')));if(!state.raw.length&&!Object.keys(state.signed).length){$('dashboard').classList.add('hidden');$('savedStatus').textContent='Sin información cargada';renderSignedInfo();return}$('dashboard').classList.remove('hidden');$('savedStatus').textContent=access.isAdmin?`${fmt(state.files.length)} archivo(s) · guardado local`:'Base compartida del administrador'}
function rebuild(){signedCache=null;const d=C.compile(state.raw,state.decisions);const validIds=new Set([...d.rows.map(r=>r.guia),...Object.keys(state.signed)]);state.selectedGuides=new Set([...state.selectedGuides].filter(g=>validIds.has(g)));state.compiled=d.rows;state.conflicts=d.conflicts;state.invalid=d.invalid;state.duplicatesExact=d.duplicatesExact;state.uniqueGuides=d.uniqueGuides;state.page=0;showData();refreshAll()}
function canUse(){return !state.loading&&access.isAdmin}
function isPersonalOperator(){return access.canExecute&&!access.isAdmin&&['PDV','ENCARGADO'].includes(access.role)}
function canCrossSigned(){return !state.loading&&!sharedLoading&&(access.isAdmin||(isPersonalOperator()&&sharedVersion!==null))}
function refreshSignedControls(){const allowed=canCrossSigned();$('exportInput').disabled=!allowed;$('btnExportProcess').disabled=!allowed||!$('exportInput').files.length;$('btnRestoreSigned').disabled=!allowed||(isPersonalOperator()&&!personalSignedFiles.length);$('excludeSigned').disabled=!allowed; if($('btnLoadShared'))$('btnLoadShared').disabled=state.loading||sharedLoading;}
function mergeSigned(base,extra){const result={...base};for(const r of Object.values(extra)){if(!Object.hasOwn(result,r.guia)||String(r.firma)>=String(result[r.guia].firma))result[r.guia]=r}return result}
function scopePersonalRecord(r){const known=publishedGuides.get(r.guia);if(known){return {...r,pdv:known.pdv,department:known.department||r.department,province:known.province||r.province,district:known.district||r.district}}const pdv=publishedPdvs.get(C.pdv(r.pdv));return pdv?{...r,pdv}:null}
function applyPersonalSigned(){state.signed=mergeSigned(publishedSigned,personalSigned);state.signedFiles=[...publishedSignedFiles,...personalSignedFiles];signedCache=null;}
function resetPersonalSigned(){personalSigned={};personalSignedFiles=[];applyPersonalSigned();$('exportInput').value='';$('exportFilesInfo').textContent='Sin Exportaciones personales seleccionadas.';state.excludeSigned=true;$('excludeSigned').checked=true;}

async function persist(){if(!access.isAdmin)return;try{await dbWrite({raw:state.raw,decisions:state.decisions,files:state.files,signed:state.signed,signedFiles:state.signedFiles,excludeSigned:state.excludeSigned,groups:state.groups,savedAt:new Date().toISOString()});$('savedStatus').textContent=`Guardado local: ${new Date().toLocaleString('es-PE')}`}catch(e){message('Los datos se procesaron, pero no se pudieron guardar en este navegador: '+e.message,true)}}
async function auth(){
 if(location.protocol==='file:'){access.canView=true;access.canExecute=true;access.isAdmin=true;access.user='prueba';$('sessionStatus').textContent='Prueba local';return true}
 const cfg=window.V16_CONFIG;
 if(!cfg?.url||!cfg?.key||!window.supabase?.createClient){$('authMessage').textContent='No se encontró config.js o el cliente Supabase.';return false}
 try{
  sharedClient=window.supabase.createClient(cfg.url,cfg.key,{auth:{storageKey:'v16-replica-auth',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  const {data:ss,error:se}=await sharedClient.auth.getSession();if(se)throw se;if(!ss.session){$('authMessage').textContent='Inicia sesión primero desde Gestión V2.';return false}
  const [{data,error},{data:permData,error:permError}]=await Promise.all([
   sharedClient.rpc('v16_call',{method:'inicio',payload:{}}),
   sharedClient.rpc('v16_gestion_modulos_usuario',{p_accion:'obtener',p_payload:{}})
  ]);
  if(error)throw error;
  const pf=data?.perfil;if(!pf||pf.activo===false)throw new Error('La cuenta no está activa.');
  if(permError)throw new Error('No se pudieron verificar los permisos. Ejecuta el SQL 13 del paquete. '+permError.message);
  access.role=String(pf.rol||'').toUpperCase();access.user=String(pf.usuario||'').toLowerCase();access.isAdmin=access.role==='ADMINISTRADOR';
  const rule=permData?.permisos?.descarga_pdv||{ver:false,ejecutar:false};
  access.canView=access.isAdmin||rule.ver===true;
  access.canExecute=access.isAdmin||(access.canView&&rule.ejecutar===true&&['PDV','ENCARGADO'].includes(access.role)); // Ejecutar no concede administración de Centro.
  if(!access.canView){$('authMessage').textContent='Tu usuario no tiene permiso para ver Descarga PDV. Solicítalo en Gestión V2 → Usuarios.';return false}
  $('sessionStatus').textContent=`${access.role} · ${pf.usuario||''} · ${access.isAdmin?'Administrador':isPersonalOperator()?'Base compartida · cruce personal temporal':'Solo ver · datos del administrador'}`;
  return true;
 }catch(e){$('authMessage').textContent='No se pudo validar el acceso: '+e.message;return false}
}
function applyReadOnly(){
 if(access.isAdmin)return;
 for(const id of ['filesInput','btnProcess','btnClear','exportInput','btnExportProcess','btnRestoreSigned','excludeSigned','groupName','groupPDVSearch','btnGroupAll','btnGroupNone','btnSaveGroup','btnCancelEdit']){const el=$(id);if(el)el.disabled=true}
 for(const el of document.querySelectorAll('#groupPDVOptions input'))el.disabled=true;
 for(const el of document.querySelectorAll('[data-edit-only]'))el.classList.add('hidden');
 if(isPersonalOperator()){
  $('signedSection').classList.remove('hidden');$('signedSectionTitle').textContent='2. Exportación de guías · Cruce personal temporal';$('signedSectionDesc').textContent='Cruza las guías firmadas de tus PDV autorizados con la base publicada. Solo cambia tu vista actual; no se modifica Centro ni la publicación.';$('signedStorageNote').textContent='Los datos personales se mantienen únicamente en memoria de esta página. Se pierden al recargar, cerrar o consultar nuevamente la base compartida. No se guardan en el navegador ni en Supabase.';$('btnRestoreSigned').textContent='Quitar mi carga temporal';
 }
 if($('readonlyNote')){$('readonlyNote').classList.remove('hidden');$('readonlyNote').textContent=isPersonalOperator()?'Modo operativo: consulta tu alcance, registra gestiones y cruza Exportaciones de forma personal y temporal. No puedes editar ni publicar la base compartida.':'Modo consulta: visualizas exclusivamente los PDV autorizados para tu cuenta. Centro y Exportación proceden de la última publicación del administrador. No tienes permiso Ejecutar para registrar gestiones ni realizar cruces temporales.'}
 refreshSignedControls();
}
async function sharedRpc(accion,payload={}){
 if(!sharedClient)throw new Error('La conexión compartida requiere Supabase.');
 const {data,error}=await sharedClient.rpc('v16_descarga_pdv_compartido',{p_accion:accion,p_payload:payload});
 if(error)throw new Error(error.message);
 return data||{};
}
async function loadSharedData(){
 const meta=await sharedRpc('estado');
 if(!meta.publicado){$('sharedStatus').textContent='Sin publicación compartida';if($('scopeStatus'))$('scopeStatus').textContent='El administrador debe publicar Centro y Exportaciones al menos una vez.';return false}
 const list=async(kind,count)=>{let rows=[];for(let i=0;i<count;i++){const res=await sharedRpc('leer',{tipo:kind,indice:i,version:meta.version});rows.push(...(res.datos||[]))}return rows};
 $('sharedStatus').textContent='Leyendo publicación compartida…';
 const [rows,firmadas,groups]=await Promise.all([
   list('guias',meta.lotes_guias||0),list('firmadas',meta.lotes_firmadas||0),list('grupos',meta.lotes_grupos||0)
 ]);
 state.selected.clear();state.selectedGroups.clear();state.selectedGuides.clear();Object.values(state.filters).forEach(s=>s.clear());resetDrill();
 state.raw=rows;state.decisions={};state.files=[{name:'Base compartida Supabase',total:rows.length}];
 state.signed=Object.fromEntries(firmadas.map(r=>[r.guia,r]));
 state.signedFiles=[{name:'Exportaciones compartidas',signed:firmadas.length}];
 if(isPersonalOperator()){
  publishedSigned={...state.signed};publishedSignedFiles=[...state.signedFiles];publishedPdvs=new Map();publishedGuides=new Map();
  for(const r of [...firmadas,...rows]){const p=C.pdv(r.pdv);if(!p||r.error)continue;publishedPdvs.set(p,r.pdv);if(r.guia)publishedGuides.set(r.guia,r);}
  resetPersonalSigned();
 }
 state.groups=groups;state.excludeSigned=true;$('excludeSigned').checked=true;
 signedCache=null;sharedVersion=meta.version;rebuild();
 $('sharedStatus').textContent=`Publicación compartida · ${fmt(rows.length)} guías Centro · ${fmt(firmadas.length)} firmadas`;
 const visiblePdvs=[...new Set([...rows,...firmadas].map(r=>String(r.pdv||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
 if($('scopeStatus'))$('scopeStatus').textContent=access.isAdmin?'Administrador · todos los PDV de la publicación':
   `${access.role==='PDV'?'Mi PDV':'Mis PDV y áreas'} · ${visiblePdvs.length} PDV con información${visiblePdvs.length<=12?' · '+visiblePdvs.join(', '):''}`;
 message('Base compartida cargada. Los permisos de alcance por PDV, área y región se verificaron en Supabase.');
 return true;
}
async function publishSharedData(){
 if(!access.isAdmin)return message('Solo un administrador puede publicar datos para todos los usuarios.',true);
 if(!state.compiled.length)return message('Carga y revisa Centro antes de publicar.',true);
 if(!confirm('¿Publicar las guías vigentes de Centro, las Exportaciones firmadas y las agrupaciones para los demás usuarios? La versión anterior seguirá activa hasta finalizar.'))return;
 setBusy(true);
 try{
  const {version}=await sharedRpc('iniciar');
  const centroByGuide=new Map(state.compiled.map(r=>[r.guia,r]));
  const resolvedSigned=Object.values(state.signed).map(r=>{const c=centroByGuide.get(r.guia);return c?{...r,pdv:c.pdv,department:c.department,province:c.province,district:c.district}:r;});
  const payloads=[['guias',state.compiled],['firmadas',resolvedSigned],['grupos',state.groups]];
  const totalBatches=payloads.reduce((a,[,rows])=>a+Math.ceil(rows.length/400),0);
  let completed=0;
  for(const [kind,rows] of payloads){
   for(let i=0;i<rows.length;i+=400){
    await sharedRpc('lote',{version,tipo:kind,indice:i/400,datos:rows.slice(i,i+400)});
    completed++;$('sharedStatus').textContent=`Publicando ${completed}/${totalBatches} lotes…`;
    await new Promise(resolve=>setTimeout(resolve,0));
   }
  }
  const done=await sharedRpc('finalizar',{version,guias:state.compiled.length});
  sharedVersion=done.version;
  $('sharedStatus').textContent=`Publicación compartida lista · ${fmt(done.guias)} guías`;
  message('Información publicada. Los usuarios con permiso Ver podrán abrirla desde sus equipos.');await loadOps();
 }catch(e){message('No se pudo completar la publicación: '+e.message+'. La última versión confirmada sigue disponible.',true);$('sharedStatus').textContent='Publicación incompleta, revisar.'}
 finally{setBusy(false)}
}
async function init(){
 if(!(await auth())){$('authGate').classList.remove('hidden');return}
 $('mainApp').classList.remove('hidden');$('sessionStatus').classList.remove('neutral');setup();setupExtra();setupDetailFilters();setupOps();applyReadOnly();sharedLoading=true;refreshSignedControls();
 if($('btnPublishShared')){$('btnPublishShared').hidden=!access.isAdmin;$('btnPublishShared').onclick=publishSharedData}
 if($('btnLoadShared'))$('btnLoadShared').onclick=async()=>{if(state.loading||sharedLoading||ops.busy)return;if((state.raw.length||personalSignedFiles.length)&&!confirm(isPersonalOperator()?'¿Consultar nuevamente la base compartida? Se quitará tu cruce temporal si la consulta se completa.':'¿Abrir la última base compartida y reemplazar la vista local actual?'))return;sharedLoading=true;refreshSignedControls();try{const ok=await loadSharedData();if(!ok)message('No hay publicación disponible. No se modificó la vista anterior.',true)}catch(e){message('No se pudo leer la base compartida: '+e.message,true)}finally{sharedLoading=false;refreshSignedControls();await loadOps()}};
 try{
  // Nunca se abre la antigua base local de administrador con otra cuenta.
  const obj=access.isAdmin?await dbRead():null;
  if(obj){state.raw=obj.raw||[];state.decisions=obj.decisions||{};state.files=obj.files||[];state.signed=obj.signed||{};state.signedFiles=obj.signedFiles||[];state.groups=Array.isArray(obj.groups)?obj.groups:[];state.excludeSigned=obj.excludeSigned!==false;$('excludeSigned').checked=state.excludeSigned;rebuild();message('Se recuperó la última carga local de tu cuenta. Usa Publicar para compartirla.');}
  else if(!access.isAdmin){await loadSharedData()}
  else{const available=await loadSharedData();if(!available)showData()}
 }catch(e){message('No se pudo recuperar la base: '+e.message,true)}
 sharedLoading=false;applyReadOnly();refreshSignedControls();renderSignedInfo();renderGroupManager();await loadOps();
 if(isPersonalOperator())window.addEventListener('pageshow',e=>{if(e.persisted)location.reload()});
}

function setup(){ $('filesInput').addEventListener('change',()=>{const fs=[...$('filesInput').files];$('fileList').textContent=fs.length?fs.map(f=>f.name).join(' · '):'No hay archivos seleccionados.';$('btnProcess').disabled=!fs.length});$('btnProcess').addEventListener('click',importFiles);$('btnClear').addEventListener('click',async()=>{if(!canUse())return;if(!confirm('¿Eliminar los archivos de Centro y las resoluciones locales? Los grupos y el historial de Exportación firmada se conservarán. No se modificará Supabase.'))return;state.raw=[];state.files=[];state.decisions={};resetDrill();state.selected.clear();state.selectedGuides.clear();rebuild();await persist();message('Base local eliminada.')});$('resetFilters').onclick=()=>{Object.values(state.filters).forEach(s=>s.clear());$('guideSearch').value='';$('pdvGroupFilter').value='';resetDrill();refreshAll()};$('guideSearch').addEventListener('input',()=>{state.page=0;refreshAll()});$('btnSelectFiltered').onclick=()=>{getGroups().forEach(g=>state.selected.add(g.pdv));refreshAll()};$('btnDeselect').onclick=()=>{state.selected.clear();refreshAll()};$('btnAllCharts').onclick=()=>{resetDrill();refreshAll()};$('btnZip').onclick=exportZip;$('prevPage').onclick=()=>{if(state.page>0)state.page--;renderDetail()};$('nextPage').onclick=()=>{state.page++;renderDetail()};$('detailRows').addEventListener('change',onGuideSelectionChanged);$('selectPageGuides').addEventListener('change',onSelectPageGuides);$('btnPickAllGuides').onclick=selectAllFilteredGuides;$('btnClearGuideSelection').onclick=()=>{state.selectedGuides.clear();renderDetail(applyDrill(getFiltered()))};$('btnCopyCheckedGuides').onclick=()=>copyGuides('selected');$('btnCopyFilteredGuides').onclick=()=>copyGuides('filtered');$('selectVisible').addEventListener('change',e=>{for(const p of getGroups().map(g=>g.pdv))e.target.checked?state.selected.add(p):state.selected.delete(p);refreshAll()});for(const el of document.querySelectorAll('.multi-filter'))setupPicker(el);document.addEventListener('click',e=>{if(!e.target.closest('.multi-filter'))document.querySelectorAll('.picker-panel').forEach(x=>x.hidden=true)});$('pdvRows').addEventListener('click',fromSummaryClick);$('pdvFoot').addEventListener('click',fromSummaryClick);$('coverageRows').addEventListener('click',fromSummaryClick);$('drillBar').addEventListener('click',onDrillBarClick);for(const id of ['chartBands','chartDistricts']){const canvas=$(id);canvas.addEventListener('click',chartClick);canvas.addEventListener('mousemove',chartHover);canvas.addEventListener('mouseleave',()=>{canvas.style.cursor='default';canvas.title=''})}}
async function importFiles(){if(!canUse())return;if(!window.XLSX){message('No se pudo cargar el lector Excel. Comprueba tu conexión a Internet y vuelve a abrir la página.',true);return}const files=[...$('filesInput').files];if(!files.length)return;const mode=document.querySelector('input[name="importMode"]:checked').value;
 setBusy(true);message('Leyendo '+files.length+' archivo(s)…');try{let collected=[],metadata=[],issues=[];for(let i=0;i<files.length;i++){const f=files[i];await new Promise(r=>setTimeout(r,0));const bytes=await f.arrayBuffer();const w=XLSX.read(bytes,{type:'array',cellDates:false,raw:true});const sheetName=w.SheetNames.find(n=>C.normKey(n)===C.normKey('tabla centro'))||w.SheetNames.find(n=>C.normKey(n).includes('TABLACENTRO'));if(!sheetName)throw Error(`El archivo ${f.name} no contiene la hoja «tabla centro».`);const grid=XLSX.utils.sheet_to_json(w.Sheets[sheetName],{header:1,defval:'',raw:true,blankrows:false});if(grid.length<2)throw Error(`${f.name}: hoja sin guías`);const idx=C.mapCols(grid[0]);const missing=C.required(idx);if(missing.length)throw Error(`${f.name}: faltan columnas ${missing.join(', ')}.`);let validN=0;for(let j=1;j<grid.length;j++){const row=C.parseRecord(grid[j],idx,f.name,j+1);collected.push(row);if(row.error)issues.push(row);else validN++}metadata.push({name:f.name,total:grid.length-1,valid:validN})}
 if(!collected.some(r=>!r.error))throw Error('No se encontraron guías válidas.');if(mode==='replace'){state.raw=collected;state.decisions={};state.files=metadata;state.selected.clear();state.selectedGuides.clear();resetDrill()}else{state.raw.push(...collected);state.files.push(...metadata)}rebuild();await persist();$('filesInput').value='';$('fileList').textContent='Sin archivos nuevos seleccionados';message(`${fmt(collected.length)} registros leídos. Base: ${fmt(state.compiled.length)} guías listas; ${fmt(state.conflicts.length)} guías con versiones contradictorias y ${fmt(state.duplicatesExact)} registros duplicados idénticos. Los conflictos se pueden resolver abajo y las filas inválidas aparecen en el Excel CONTROL_GENERAL.`)}catch(e){message('No se pudo procesar la carga: '+e.message,true)}finally{setBusy(false)}}
/* V1.3 — selección cruzada de tablas y gráficos. No modifica la información guardada. */
const emptyDrill=()=>({pdv:'',geo:null,band:null,returns:false,signed:false});
function resetDrill(){state.drill=emptyDrill();state.focused='';state.page=0}
function drillActive(){const d=state.drill;return Boolean(d.pdv||d.geo||d.band!==null||d.returns||d.signed)}
function applyDrill(rows,{ignoreBand=false,ignoreGeo=false,ignoreReturn=false,ignorePdv=false}={}){
 const d=state.drill;
 return rows.filter(r=>{
   if(!ignorePdv&&d.pdv&&r.pdv!==d.pdv)return false;
   if(!ignoreGeo&&d.geo&&(r.department!==d.geo.department||r.province!==d.geo.province||r.district!==d.geo.district))return false;
   if(!ignoreReturn&&d.returns&&!r.esDevolucion)return false;
   if(!ignoreBand&&d.band!==null&&(r.esDevolucion||r.band!==d.band))return false;
   return true;
 });
}
function selectDrill({pdv,geo,band,returns,all=false}={}){
 const d=state.drill;
 if(all){resetDrill();refreshAll();return}
 if(pdv!==undefined){
   const next=pdv===d.pdv?'':pdv;
   if(next!==d.pdv)d.geo=null;
   d.pdv=next;
   if(band===undefined&&returns===undefined){d.band=null;d.returns=false}
 }
 if(geo!==undefined){
   const same=d.geo&&geo&&['department','province','district'].every(k=>d.geo[k]===geo[k]);
   d.geo=same?null:geo;
 }
 if(band!==undefined){
   const next=band===null?null:Number(band);
   d.band=d.band===next?null:next;
   d.returns=false;
 }
 if(returns!==undefined){d.returns=returns?(d.returns?false:true):false;if(returns){d.band=null;d.signed=false}}
 if(arguments[0]&&Object.prototype.hasOwnProperty.call(arguments[0],'signed')){d.signed=!d.signed;d.band=null;d.returns=false}
 state.focused=d.pdv;state.page=0;refreshAll();
}
function currentDrillLabel(){const d=state.drill;const names=[];if(d.pdv)names.push('PDV '+d.pdv);if(d.geo)names.push([d.geo.department,d.geo.province,d.geo.district].join(' / '));if(d.band!==null)names.push(C.LABELS[d.band]+' · '+C.PAGOS[d.band]+'%');if(d.returns)names.push('Devolución');if(d.signed)names.push('Firmados');return names.join(' · ')||'Todos los filtrados'}
function renderDrillBar(rows){
 const el=$('drillBar');if(!el)return;
 const d=state.drill,parts=[];
 if(d.pdv)parts.push(`<button class="drill-chip" data-remove-drill="pdv" title="Quitar filtro PDV">PDV: ${safe(d.pdv)} <b>×</b></button>`);
 if(d.geo)parts.push(`<button class="drill-chip" data-remove-drill="geo" title="Quitar filtro de distrito">${safe(d.geo.department)} / ${safe(d.geo.province)} / ${safe(d.geo.district)} <b>×</b></button>`);
 if(d.band!==null)parts.push(`<button class="drill-chip" data-remove-drill="band" title="Quitar filtro de tramo">${safe(C.LABELS[d.band])} · ${C.PAGOS[d.band]}% <b>×</b></button>`);
 if(d.returns)parts.push('<button class="drill-chip return-chip" data-remove-drill="returns" title="Quitar filtro de devolución">Devolución <b>×</b></button>');
 if(d.signed)parts.push('<button class="drill-chip signed-chip" data-remove-drill="signed" title="Quitar filtro de firmadas">Firmados <b>×</b></button>');
 el.classList.toggle('drill-active',parts.length>0);
 el.innerHTML=`<div class="drill-intro"><strong>Filtro al pulsar tabla o gráfico</strong><span>${parts.length?`${fmt(rows.length)} guía(s) en el detalle · vista sincronizada`:'Haz clic en una cantidad, tramo o barra para filtrar el resumen y el detalle.'}</span></div>`+(parts.length?`<div class="drill-chips">${parts.join('')}</div><div class="drill-bar-actions"><button type="button" class="btn outline" id="btnJumpDetail">Ver detalle (${fmt(rows.length)}) ↓</button><button type="button" class="btn ghost" id="btnClearDrill">Quitar selección</button></div>`:'');
}
function readGeo(el){return{department:el.dataset.department,province:el.dataset.province,district:el.dataset.district}}
function fromSummaryClick(e){
 const el=e.target.closest('[data-drill-action]');
 if(!el){
   if(e.target.closest('input,button,a'))return;
   const tr=e.target.closest('tr');if(!tr)return;
   if(tr.dataset.rowPdv)return selectDrill({pdv:tr.dataset.rowPdv});
   if(tr.dataset.department)return selectDrill({geo:readGeo(tr)});
   return;
 }
 const action=el.dataset.drillAction,pdv=el.dataset.pdv||'';
 if(action==='pdv')return selectDrill({pdv});
 if(action==='all')return selectDrill({all:true});
 if(action==='band'){
   const band=Number(el.dataset.band);const d=state.drill;
   if(pdv&&d.pdv!==pdv){d.pdv=pdv;d.geo=null;d.band=null;d.returns=false}
   selectDrill({band});return;
 }
 if(action==='signed'||action==='geo-signed'){
   if(pdv&&state.drill.pdv!==pdv){state.drill.pdv=pdv;state.drill.geo=null}
   if(action==='geo-signed')state.drill.geo=readGeo(el);
   state.drill.band=null;state.drill.returns=false;state.drill.signed=true;state.page=0;refreshAll();return;
 }
 if(action==='returns'){
   const d=state.drill;
   if(pdv&&d.pdv!==pdv){d.pdv=pdv;d.geo=null;d.band=null;d.returns=false}
   selectDrill({returns:true});return;
 }
 if(action==='geo')return selectDrill({geo:readGeo(el)});
 if(action==='geo-band'||action==='geo-returns'){
   const geo=readGeo(el),d=state.drill;
   const same=d.geo&&['department','province','district'].every(k=>d.geo[k]===geo[k]);
   if(!same){d.geo=geo;d.band=null;d.returns=false}
   if(action==='geo-band')return selectDrill({band:Number(el.dataset.band)});
   return selectDrill({returns:true});
 }
}
function onDrillBarClick(e){const rem=e.target.closest('[data-remove-drill]');if(rem){const field=rem.dataset.removeDrill;if(field==='pdv')state.drill.pdv='';else if(field==='geo')state.drill.geo=null;else if(field==='band')state.drill.band=null;else if(field==='returns')state.drill.returns=false;else if(field==='signed')state.drill.signed=false;state.focused=state.drill.pdv;state.page=0;refreshAll();return}
 if(e.target.closest('#btnClearDrill')){resetDrill();refreshAll()}else if(e.target.closest('#btnJumpDetail'))$('detailSection').scrollIntoView({behavior:'smooth',block:'start'})}
function chartPointer(e){const canvas=e.currentTarget,rect=canvas.getBoundingClientRect(),w=canvas._logicalW||1060,h=canvas._logicalH||400;return{x:(e.clientX-rect.left)*w/Math.max(1,rect.width),y:(e.clientY-rect.top)*h/Math.max(1,rect.height)}}
function chartHit(e){const canvas=e.currentTarget,{x,y}=chartPointer(e);return(canvas._hits||[]).find(p=>x>=p.x1&&x<=p.x2&&y>=p.y1&&y<=p.y2)}
function chartClick(e){const hit=chartHit(e);if(!hit)return;if(hit.kind==='band')selectDrill({band:hit.band});else if(hit.kind==='geo')selectDrill({geo:hit.geo})}
function chartHover(e){const hit=chartHit(e);e.currentTarget.style.cursor=hit?'pointer':'default';e.currentTarget.title=hit?hit.title||'Ver guías correspondientes':''}

/* V1.6: firmadas confirmadas se muestran SIN sumarlas a las guías pendientes. */
let signedCache=null;
function signedAugmented(){
 if(signedCache)return signedCache;
 const centro=new Map(state.compiled.map(r=>[r.guia,r]));
 signedCache=Object.values(state.signed).map(r=>{
   const c=centro.get(r.guia);
   return {...r,pdv:c?.pdv||r.pdv||'',department:c?.department||r.department||'SIN UBICACIÓN',province:c?.province||r.province||'SIN UBICACIÓN',district:c?.district||r.district||'SIN UBICACIÓN',esFirmado:true,esDevolucion:false,horas:null,pago:null,band:-1,descarga:c?.descarga||'',estado:'FIRMADO',status:'FIRMADO',fuente:r.fuente||'',devolver:'',origenPct:'',origenRango:''};
 }).filter(r=>r.guia&&r.pdv);
 return signedCache;
}
function signedFiltered({ignoreDrill=false,ignoreGroup=false}={}){
 const q=$('guideSearch')?.value?.trim().toUpperCase()||'';
 const id=$('pdvGroupFilter')?.value||'';
 const group=state.groups.find(g=>g.id===id);
 const d=state.drill;
 return signedAugmented().filter(r=>{
  if(!C.passes(r,state.filters,q))return false;
  if(!ignoreGroup&&group&&!group.pdvs.includes(r.pdv))return false;
  if(!ignoreDrill){
   if(d.pdv&&r.pdv!==d.pdv)return false;
   if(d.geo&&(r.department!==d.geo.department||r.province!==d.geo.province||r.district!==d.geo.district))return false;
   if(d.band!==null||d.returns)return false;
  }
  return true;
 });
}
const signedByPDV=rows=>{const m=new Map();for(const r of rows)m.set(r.pdv,(m.get(r.pdv)||0)+1);return m};
const signedByGeo=rows=>{const m=new Map();for(const r of rows){const k=[r.department,r.province,r.district].join('¦');m.set(k,(m.get(k)||0)+1)}return m};

function getActiveRows(){return state.excludeSigned?state.compiled.filter(r=>!state.signed[r.guia]):state.compiled}
function getFilteredNoGroup(){const guide=$('guideSearch').value.trim().toUpperCase();return getActiveRows().filter(r=>C.passes(r,state.filters,guide))}
function getFiltered(){const rows=getFilteredNoGroup(),id=$('pdvGroupFilter').value;if(!id)return rows;const group=state.groups.find(g=>g.id===id);return group?rows.filter(r=>group.pdvs.includes(r.pdv)):rows}
function getGroups(){return C.groupPDV(applyDrill(getFiltered()))}
function syncKpi(rows){const s=C.stats(rows);const firmados=signedFiltered().length;const items=[['Guías pendientes',fmt(s.n),'Sin firmadas ni devoluciones'],['PDV',fmt(C.groupPDV(rows).length),'Con guías en el filtro'],['Distritos',fmt(s.districts),'Cobertura geográfica'],['Promedio (h)',s.n?num(s.avg,2)+' h':'–','Solo guías sin devolución'],['Pago promedio',s.n?num(s.payAvg,1)+'%':'–','Solo guías sin devolución'],['Devolución',fmt(s.devoluciones),'Excluidas del promedio y tramos'],['Firmados',fmt(firmados),'Confirmadas en Exportación; no suman a pendientes'],['Duplicados por revisar',fmt(state.conflicts.filter(c=>!state.excludeSigned||!state.signed[c.guia]).length),'Guías en revisión']];$('kpiGrid').innerHTML=items.map(([k,v,b])=>`<div class="kpi ${k==='Devolución'?'kpi-devolucion':''}"><span>${safe(k)}</span><strong>${safe(v)}</strong><small>${safe(b)}</small></div>`).join('')}
function updateOptions(){let raw=[...getActiveRows(),...signedAugmented()];const cfg=state.filters;for(const [field,title] of Object.entries(fields)){const allowed=raw.filter(r=>Object.entries(cfg).every(([other,sets])=>other===field||sets.size===0||sets.has(r[other])));const options=[...new Set(allowed.map(x=>x[field]))].sort((a,b)=>a.localeCompare(b,'es'));const filter=document.querySelector(`.multi-filter[data-field="${field}"]`);filter._options=options;filter.querySelector('.picker-trigger span').textContent=cfg[field].size?`${title} (${cfg[field].size})`:`Todos los ${title.toLowerCase()}s`;renderPickerOptions(filter)}}
function setupPicker(el){const field=el.dataset.field;const title=fields[field];el.innerHTML=`<label>${safe(title)}</label><button class="picker-trigger" type="button"><span>Todos</span>⌄</button><div class="picker-panel" hidden><input class="picker-search" type="search" placeholder="Buscar ${safe(title.toLowerCase())}…"><div class="picker-actions"><button type="button" class="pick-all">Marcar encontrados</button><button type="button" class="pick-clear">Limpiar</button></div><div class="picker-options"></div><div class="tiny muted picker-meta"></div></div>`;el.querySelector('.picker-trigger').onclick=()=>{const p=el.querySelector('.picker-panel');const open=p.hidden;document.querySelectorAll('.picker-panel').forEach(x=>x.hidden=true);p.hidden=!open;if(open)el.querySelector('.picker-search').focus()};el.querySelector('.picker-search').addEventListener('input',()=>renderPickerOptions(el));el.querySelector('.pick-all').onclick=()=>{const q=C.normGeo(el.querySelector('.picker-search').value);el._options.filter(x=>!q||C.normGeo(x).includes(q)).forEach(x=>state.filters[field].add(x));refreshAll()};el.querySelector('.pick-clear').onclick=()=>{state.filters[field].clear();refreshAll()};el._options=[]}
function renderPickerOptions(el){const field=el.dataset.field,p=el.querySelector('.picker-options'),query=C.normGeo(el.querySelector('.picker-search').value);const vals=(el._options||[]).filter(x=>!query||C.normGeo(x).includes(query));p.innerHTML=vals.slice(0,350).map(v=>`<label class="picker-option"><input type="checkbox" value="${safe(v)}" ${state.filters[field].has(v)?'checked':''}><span>${safe(v)}</span></label>`).join('')||'<div class="empty">Sin resultados</div>';el.querySelector('.picker-meta').textContent=`${fmt(vals.length)} opciones${vals.length>350?' · mostrando primeras 350':''}`;p.querySelectorAll('input[type=checkbox]').forEach(inp=>inp.addEventListener('change',()=>{inp.checked?state.filters[field].add(inp.value):state.filters[field].delete(inp.value);refreshAll()}))}
function renderSummary(rows){
 const pending=state.drill.signed?[]:rows;
 const groupStats=C.groupPDV(pending),byPDV=new Map(groupStats.map(g=>[g.pdv,g]));
 const signedRows=signedFiltered(),signedCounts=signedByPDV(signedRows);
 for(const pdv of signedCounts.keys())if(!byPDV.has(pdv))byPDV.set(pdv,{pdv,rows:[],...C.stats([])});
 const gs=[...byPDV.values()].sort((a,b)=>a.pdv.localeCompare(b.pdv,'es'));
 const tot=C.stats(pending),sel=state.selected;
 const cnt=(v,action,pdv='',band)=>v?`<button type="button" class="drill-cell" data-drill-action="${action}" ${pdv?`data-pdv="${safe(pdv)}"`:''} ${band!==undefined?`data-band="${band}"`:''}>${fmt(v)}</button>`:'–';
 $('pdvRows').innerHTML=gs.map(g=>{
  const p=safe(g.pdv),sign=signedCounts.get(g.pdv)||0;
  return `<tr data-row-pdv="${p}" class="${state.drill.pdv===g.pdv?'active-pdv':''}"><td><input type="checkbox" data-select-pdv="${p}" ${sel.has(g.pdv)?'checked':''}> <button class="pdv-link" data-drill-action="pdv" data-pdv="${p}">${p}</button></td><td>${cnt(g.n,'pdv',p)}</td><td class="firmados-num">${cnt(sign,'signed',p)}</td><td class="devolucion-num">${cnt(g.devoluciones,'returns',p)}</td><td>${g.depts||0}</td><td>${g.provinces||0}</td><td>${g.districts||0}</td><td>${g.n?num(g.avg,2):'–'}</td>${g.bands.map((n,i)=>`<td>${cnt(n,'band',p,i)}</td>`).join('')}<td>${g.n?num(g.payAvg,1)+'%':'–'}</td></tr>`;
 }).join('')||'<tr><td colspan="17" class="empty">Sin guías para esta selección.</td></tr>';
 $('pdvFoot').innerHTML=`<tr><td>TOTAL GENERAL</td><td>${cnt(tot.n,'all')}</td><td class="firmados-num">${cnt(signedRows.length,'signed')}</td><td class="devolucion-num">${cnt(tot.devoluciones,'returns')}</td><td>${tot.depts}</td><td>${tot.provinces}</td><td>${tot.districts}</td><td>${tot.n?num(tot.avg,2):'–'}</td>${tot.bands.map((n,i)=>`<td>${cnt(n,'band','',i)}</td>`).join('')}<td>${tot.n?num(tot.payAvg,1)+'%':'–'}</td></tr>`;
 $('selectedCount').textContent=`${sel.size} PDV seleccionados`;
 const cb=$('selectVisible');cb.checked=gs.length>0&&gs.every(g=>sel.has(g.pdv));cb.indeterminate=gs.some(g=>sel.has(g.pdv))&&!cb.checked;$('btnZip').disabled=!sel.size||state.loading;
 $('pdvRows').querySelectorAll('[data-select-pdv]').forEach(e=>e.onchange=()=>{e.checked?sel.add(e.dataset.selectPdv):sel.delete(e.dataset.selectPdv);renderSummary(rows)});
}
function renderCoverage(rows){
 const pending=state.drill.signed?[]:rows;
 const geoStats=C.groupGeo(pending),map=new Map(geoStats.map(g=>[[g.department,g.province,g.district].join('¦'),g]));
 const signRows=signedFiltered(),signedCounts=signedByGeo(signRows);
 for(const key of signedCounts.keys())if(!map.has(key)){
  const [department,province,district]=key.split('¦');map.set(key,{department,province,district,rows:[],...C.stats([])});
 }
 const gr=[...map.values()].sort((a,b)=>a.department.localeCompare(b.department,'es')||a.province.localeCompare(b.province,'es')||a.district.localeCompare(b.district,'es'));
 $('coverageScope').textContent=currentDrillLabel();
 $('coverageRows').innerHTML=gr.slice(0,450).map(g=>{
  const attr=`data-department="${safe(g.department)}" data-province="${safe(g.province)}" data-district="${safe(g.district)}"`,geo=`${g.department} / ${g.province} / ${g.district}`;
  const cell=(n,action,band)=>n?`<button class="drill-cell" data-drill-action="${action}" ${attr} ${band!==undefined?`data-band="${band}"`:''} title="Ver ${safe(geo)}">${fmt(n)}</button>`:'–';
  const firmados=signedCounts.get([g.department,g.province,g.district].join('¦'))||0;
  return `<tr ${attr}><td><button class="drill-cell drill-geo" data-drill-action="geo" ${attr}>${safe(g.department)}</button></td><td><button class="drill-cell drill-geo" data-drill-action="geo" ${attr}>${safe(g.province)}</button></td><td><button class="drill-cell drill-geo" data-drill-action="geo" ${attr}>${safe(g.district)}</button></td><td>${cell(g.n,'geo')}</td><td class="firmados-num">${cell(firmados,'geo-signed')}</td><td class="devolucion-num">${cell(g.devoluciones,'geo-returns')}</td>${g.bands.map((n,i)=>`<td>${cell(n,'geo-band',i)}</td>`).join('')}<td>${g.n?num(g.avg,2):'–'}</td><td>${g.n?num(g.payAvg,1)+'%':'–'}</td></tr>`;
 }).join('')||'<tr><td colspan="16" class="empty">No hay datos en esta selección.</td></tr>';
 $('coverageNote').textContent=`${fmt(gr.length)} combinaciones territoriales · ${fmt(signRows.length)} firmadas independientes de pendientes.${gr.length>450?' Mostrando 450; Excel incluye todas.':''} Pulsa el conteo verde de Firmados para ver las guías.`;
}
/* V1.5 — selección persistente entre páginas; copiar guías únicas sin Excel ni SQL. */
const detailBase=()=>state.drill.signed?signedFiltered():applyDrill(getFiltered());
const detailKeys=['pdv','department','province','district','band','pay','status','devolver'];
function detailValue(r,k){switch(k){case 'band':return r.esFirmado?'FIRMADO':r.esDevolucion?'No aplica':String(C.LABELS[r.band]||'');case 'pay':return r.esFirmado||r.esDevolucion?'No aplica':String(r.pago)+'%';case 'status':return r.esFirmado||state.signed[r.guia]?'Firmado':r.esDevolucion?'Devolución':'Pendiente';default:return String(r[k]??'').trim()||'Sin dato'}}
function syncDetailFilters(rows){for(const k of detailKeys){const el=$('df-'+k),old=el.value,values=[...new Set(rows.map(r=>detailValue(r,k)))].sort((a,b)=>a.localeCompare(b,'es',{numeric:true}));if(old&&!values.includes(old))values.push(old);el.innerHTML='<option value="">Todos</option>'+values.map(v=>`<option value="${safe(v)}">${safe(v)}</option>`).join('');el.value=old}}
/* V1.9 — fecha de descarga del PDV: límites inclusivos, sin alterar los KPI. */
function matchesDownloadDate(r,from,to,missing){
 const date=String(r.descarga??'').trim();
 if(missing)return !date;
 if(!from&&!to)return true;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;
 return (!from||date>=from)&&(!to||date<=to);
}
function filteredDetailRows(){const rows=detailBase();const terms=$('df-guia').value.trim().toUpperCase().split(/[\s,;]+/).filter(Boolean);const filters=detailKeys.map(k=>[k,$('df-'+k).value]).filter(([,v])=>v);const min=$('df-min').value,max=$('df-max').value;const from=$('df-download-from').value,to=$('df-download-to').value,missing=$('df-download-missing').checked;return rows.filter(r=>(!terms.length||terms.some(t=>String(r.guia).toUpperCase().includes(t)))&&filters.every(([k,v])=>detailValue(r,k)===v)&&matchesDownloadDate(r,from,to,missing)&&opsMatches(r)&&((min===''&&max==='')||(!r.esFirmado&&Number.isFinite(Number(r.horas))&&(min===''||Number(r.horas)>=Number(min))&&(max===''||Number(r.horas)<=Number(max)))))}
function setupDetailFilters(){const refresh=()=>{state.page=0;renderDetail()};for(const k of detailKeys)$('df-'+k).addEventListener('change',refresh);for(const k of ['guia','min','max'])$('df-'+k).addEventListener('input',refresh);const from=$('df-download-from'),to=$('df-download-to'),missing=$('df-download-missing');const syncDates=()=>{from.disabled=to.disabled=missing.checked;from.max=to.value;to.min=from.value};for(const el of [from,to])el.addEventListener('change',()=>{syncDates();refresh()});missing.addEventListener('change',()=>{if(missing.checked){from.value='';to.value=''}syncDates();refresh()});$('df-reset').onclick=()=>{for(const k of [...detailKeys,'guia','min','max','download-from','download-to'])$('df-'+k).value='';missing.checked=false;syncDates();refresh()};const dialog=$('guideQrDialog');$('guideQrClose').onclick=()=>dialog.close();$('guideQrCopy').onclick=async()=>{const ok=await putOnClipboard($('guideQrNumber').textContent);$('guideQrError').textContent=ok?'Guía copiada.':'No se pudo copiar.'};$('detailRows').addEventListener('click',e=>{const b=e.target.closest('button[data-guide-qr]');if(!b||!access.canView)return;const guia=b.dataset.guideQr;const host=$('guideQrImage');host.replaceChildren();$('guideQrNumber').textContent=guia;$('guideQrError').textContent='';dialog.showModal();try{if(!window.QRCode)throw new Error('Biblioteca QR no disponible.');new window.QRCode(host,{text:guia,width:220,height:220,correctLevel:window.QRCode.CorrectLevel.M})}catch(err){$('guideQrError').textContent='No se pudo generar el QR. Revisa la conexión y recarga.'}})}
function updateGuideSelectionToolbar(rows,visible){
 const selection=state.selectedGuides;
 const selectedInFilter=rows.reduce((n,r)=>n+(selection.has(r.guia)?1:0),0);
 const currentSelected=visible.filter(r=>selection.has(r.guia)).length;
 const selectPage=$('selectPageGuides');
 selectPage.checked=!!visible.length&&currentSelected===visible.length;
 selectPage.indeterminate=currentSelected>0&&currentSelected<visible.length;
 selectPage.disabled=!visible.length||state.loading;
 $('guideSelectionInfo').textContent=`${fmt(selection.size)} seleccionadas en total · ${fmt(selectedInFilter)} dentro del filtro actual · ${fmt(rows.length)} filtradas`;
 $('btnCopyCheckedGuides').disabled=!selection.size||state.loading;
 $('btnCopyFilteredGuides').disabled=!rows.length||state.loading;
 $('btnPickAllGuides').disabled=!rows.length||state.loading;
 $('btnClearGuideSelection').disabled=!selection.size||state.loading;
}
function renderDetail(rows){
 syncDetailFilters(detailBase());
 const x=filteredDetailRows(),pp=100,totalPages=Math.max(1,Math.ceil(x.length/pp));
 state.page=Math.max(0,Math.min(state.page,totalPages-1));
 const visible=x.slice(state.page*pp,(state.page+1)*pp);
 $('detailRows').innerHTML=visible.map(r=>`<tr class="${r.esDevolucion?'fila-devolucion':''} ${state.selectedGuides.has(r.guia)?'guia-selected':''} ${opsCount(r)===3?'ops-three':''}"><td class="guide-selection-cell"><input type="checkbox" data-select-guia="${safe(r.guia)}" aria-label="Seleccionar guía ${safe(r.guia)}" ${state.selectedGuides.has(r.guia)?'checked':''}></td><td>${safe(r.guia)}</td><td><button type="button" class="btn outline guide-qr-btn" data-guide-qr="${safe(r.guia)}" aria-label="Ver QR de ${safe(r.guia)}">Ver QR</button></td><td>${safe(r.pdv)}</td><td>${safe(r.department)}</td><td>${safe(r.province)}</td><td>${safe(r.district)}</td><td>${safe(r.descarga)}</td><td>${safe(r.esFirmado?r.firma:(r.firma||''))}</td><td>${r.esFirmado?'–':num(r.horas,2)}</td><td>${r.esFirmado?'FIRMADO':r.esDevolucion?'No aplica':safe(C.LABELS[r.band])}</td><td>${r.esFirmado?'–':r.esDevolucion?'–':r.pago+'%'}</td><td class="devolucion-num">${r.esDevolucion?'1':'–'}</td><td>${safe(r.devolver||'')}</td><td>${safe(r.origenPct)}</td><td>${safe(r.fuente)}</td>${opsCells(r)}</tr>`).join('')||'<tr><td colspan="20" class="empty">No hay guías para esta selección.</td></tr>';
 $('pageInfo').textContent=`${state.page+1}/${totalPages}`;
 const d=C.stats(x.filter(r=>!r.esFirmado));$('detailInfo').textContent=state.drill.signed?`${fmt(x.length)} guías firmadas confirmadas (Exportación)`:`${fmt(x.length)} registros · ${fmt(d.n)} guías para el promedio · ${fmt(d.devoluciones)} devoluciones`;
 $('prevPage').disabled=state.page===0;$('nextPage').disabled=state.page>=totalPages-1;
 updateGuideSelectionToolbar(x,visible);opsRestoreDrafts();opsToolbar();
}
function onGuideSelectionChanged(e){
 const el=e.target.closest('input[data-select-guia]');if(!el)return;
 if(el.checked)state.selectedGuides.add(el.dataset.selectGuia);else state.selectedGuides.delete(el.dataset.selectGuia);
 renderDetail(filteredDetailRows());
}
function onSelectPageGuides(e){
 const all=filteredDetailRows();const visible=all.slice(state.page*100,(state.page+1)*100);
 for(const r of visible){if(e.target.checked)state.selectedGuides.add(r.guia);else state.selectedGuides.delete(r.guia)}
 renderDetail(all);
}
function selectAllFilteredGuides(){
 const rows=filteredDetailRows();for(const r of rows)state.selectedGuides.add(r.guia);
 renderDetail(rows);message(`Seleccionadas ${fmt(rows.length)} guías del filtro actual. La selección se mantiene al cambiar de página.`);
}
async function putOnClipboard(text){
 if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(text);return true}catch(e){/* Se intentará el modo alternativo. */}}
 const area=document.createElement('textarea');area.value=text;area.readOnly=true;area.style.position='fixed';area.style.top='-2000px';area.style.left='-2000px';document.body.appendChild(area);area.focus();area.select();
 let done=false;try{done=document.execCommand('copy')}catch(e){done=false}area.remove();return done;
}
async function copyGuides(mode){
 const rows=mode==='selected'?[...getActiveRows(),...signedAugmented()].filter(r=>state.selectedGuides.has(r.guia)):filteredDetailRows();
 const ids=[...new Set(rows.map(r=>String(r.guia||'').trim()).filter(Boolean))];
 if(!ids.length)return message('No hay guías para copiar. Marca una casilla o ajusta los filtros.',true);
 const ok=await putOnClipboard(ids.join('\n'));
 if(ok)message(`${fmt(ids.length)} guías copiadas al portapapeles (${mode==='selected'?'casillas seleccionadas':'todas las filtradas'}), una por línea.`);
 else message('El navegador bloqueó el portapapeles. Abre la página por HTTPS y concede permiso para copiar.',true);
}

function renderConflicts(){const list=state.conflicts.filter(c=>!state.excludeSigned||!state.signed[c.guia]);$('conflictBadge').textContent=`${fmt(list.length)} pendientes`;$('conflictList').innerHTML=list.slice(0,150).map(c=>`<div class="conflict-item"><div class="conflict-head"><strong>${safe(c.guia)}</strong><small class="muted">Selecciona la versión correcta</small></div><div class="conflict-options">${c.options.map((r,i)=>`<label class="conflict-option"><input type="radio" name="conflict-${safe(c.guia)}" data-resolve="${safe(c.guia)}" data-signature="${safe(r.signature)}"><span><b>Versión ${i+1}:</b> ${safe(r.pdv)} · ${num(r.horas,2)} h · ${safe(r.department)}/${safe(r.province)}/${safe(r.district)}<br><small>${safe(r.fuente)} · fila ${r.fila}</small></span></label>`).join('')}</div></div>`).join('')||'<div class="empty">Sin duplicados contradictorios pendientes.</div>';$('conflictList').querySelectorAll('input[data-resolve]').forEach(e=>e.onchange=async()=>{if(!canUse())return;state.decisions[e.dataset.resolve]=e.dataset.signature;rebuild();await persist();message(`Guía ${e.dataset.resolve} resuelta; ya forma parte de los indicadores.`)})}
function refreshAll(){renderSignedInfo();if(!state.raw.length&&!signedAugmented().length){renderDrillBar([]);renderGroupManager();return}updateOptions();const base=getFiltered(),rows=applyDrill(base);renderDrillBar(rows);syncKpi(rows);renderSummary(rows);renderCoverage(rows);renderDetail(rows);renderConflicts();renderCharts(base);renderSignedAudit();renderGroupManager()}
// Gráficos dibujados en Canvas puro, sin bibliotecas de gráficos externas.
function canvasSetup(canvas,w=1060,h=400){const ratio=Math.max(1,Math.min(2,window.devicePixelRatio||1));canvas.width=w*ratio;canvas.height=h*ratio;const ctx=canvas.getContext('2d');ctx.scale(ratio,ratio);ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);return ctx}
function drawBands(canvas,bands,{title='',w=1060,h=400,selected=null}={}){
 const ctx=canvasSetup(canvas,w,h),max=Math.max(1,...bands),left=55,right=20,top=60,bottom=85,width=w-left-right;
 canvas._logicalW=w;canvas._logicalH=h;canvas._hits=[];
 ctx.font='bold 18px Arial';ctx.fillStyle='#203958';ctx.fillText(title||'Guías por tramo de cumplimiento',left,30);
 ctx.strokeStyle='#dde6f0';ctx.beginPath();ctx.moveTo(left,top);ctx.lineTo(left,h-bottom);ctx.lineTo(w-right,h-bottom);ctx.stroke();
 const colors=['#1872c4','#398fe1','#62b1e8','#6bb899','#d8b86a','#f49b54','#d77d6c','#cb576b'];
 bands.forEach((n,i)=>{
  const bw=width/bands.length*.61,x=left+width*(i+.5)/bands.length-bw/2,barH=(h-top-bottom-30)*n/max,y=h-bottom-barH;
  ctx.fillStyle=colors[i];ctx.fillRect(x,y,bw,barH);
  if(selected===i){ctx.strokeStyle='#183858';ctx.lineWidth=4;ctx.strokeRect(x-2,y-2,bw+4,barH+4)}
  ctx.fillStyle='#1c3553';ctx.font='bold 18px Arial';ctx.textAlign='center';ctx.fillText(String(n),x+bw/2,Math.max(top+14,y-12));
  ctx.font='14px Arial';ctx.fillText(C.LABELS[i],x+bw/2,h-bottom+25);ctx.fillText(`${C.PAGOS[i]}%`,x+bw/2,h-bottom+47);
  if(n)canvas._hits.push({x1:x-5,x2:x+bw+5,y1:Math.max(0,y-18),y2:h-bottom+12,kind:'band',band:i,title:`${C.LABELS[i]} · ${C.PAGOS[i]}% · ${fmt(n)} guías`});
 });ctx.textAlign='left';return canvas.toDataURL('image/png');
}
function drawCoverage(canvas,geos,{title='',w=1060,h=400,selected=null}={}){
 const ctx=canvasSetup(canvas,w,h);canvas._logicalW=w;canvas._logicalH=h;canvas._hits=[];
 ctx.font='bold 18px Arial';ctx.fillStyle='#203958';ctx.fillText(title||'Distritos con más paquetes',35,29);
 const data=[...geos].sort((a,b)=>b.n-a.n).slice(0,10),max=Math.max(1,...data.map(a=>a.n)),top=55,spacing=31,left=300,right=100;
 ctx.font='13px Arial';data.forEach((g,i)=>{
  const label=`${g.district} · ${g.province}`,y=top+i*spacing,bw=(w-left-right)*g.n/max;
  ctx.fillStyle='#425c7b';ctx.textAlign='right';ctx.fillText(label.length>38?label.slice(0,36)+'…':label,left-15,y+13);
  ctx.fillStyle='#72a9e0';ctx.fillRect(left,y,bw,19);
  if(selected&&['department','province','district'].every(k=>selected[k]===g[k])){ctx.strokeStyle='#183858';ctx.lineWidth=3;ctx.strokeRect(left-2,y-2,bw+4,23)}
  ctx.textAlign='left';ctx.fillStyle='#233953';ctx.fillText(fmt(g.n),left+Math.min(w-left-right-40,bw)+7,y+13);
  if(g.n)canvas._hits.push({x1:15,x2:w-10,y1:y-5,y2:y+24,kind:'geo',geo:{department:g.department,province:g.province,district:g.district},title:`${label} · ${fmt(g.n)} guías`});
 });ctx.textAlign='left';if(!data.length)ctx.fillText('Sin datos',35,72);return canvas.toDataURL('image/png');
}
function renderCharts(base){
 // Los gráficos mantienen disponibles las otras barras para cambiar el filtro en un clic.
 const bandView=applyDrill(base,{ignoreBand:true,ignoreReturn:true});
 const geoView=applyDrill(base,{ignoreGeo:true});
 const geo=C.groupGeo(geoView).map(g=>({...g,n:state.drill.returns?g.devoluciones:g.n}));
 $('chartScope').textContent=currentDrillLabel()+(drillActive()?' · clic en otra barra para cambiar':'');
 drawBands($('chartBands'),C.stats(state.drill.signed?[]:bandView).bands,{title:'Paquetes por tramo (pendientes) · selecciona una barra',selected:state.drill.band});
 drawCoverage($('chartDistricts'),geo,{title:state.drill.returns?'Devoluciones por distrito · selecciona barra':'Cobertura territorial · selecciona barra',selected:state.drill.geo});
}
function excelText(s){const t=String(s??'');return /^[\s]*[=+\-@]/.test(t)?"'"+t:t}
function moneyPercent(n){return n/100}
function safeSheetName(n){return String(n).replace(/[\\/:?*\[\]]/g,'-').slice(0,31)}
const BLUE='174E89',DARK='183858',WHITE='FFFFFF';
function headerStyle(row){row.height=27;row.eachCell(cell=>{cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF'+BLUE}};cell.font={bold:true,color:{argb:'FF'+WHITE},size:10};cell.alignment={vertical:'middle',wrapText:true}})}
function formatCount(cell){cell.numFmt='#,##0'}
function workbookPDV(pdv,rows,signedRows=null){
 const wb=new ExcelJS.Workbook();wb.creator='Módulo Descarga PDV · Cobertura';wb.created=new Date();wb.modified=new Date();
 const summary=wb.addWorksheet('RESUMEN_PDV',{views:[{state:'frozen',ySplit:4}]});summary.properties.defaultRowHeight=18;
 [22,24,27,14,14,14,14,14,14,14,14,14,15,17,16,17].forEach((w,i)=>summary.getColumn(i+1).width=w);
 summary.mergeCells('A1:P2');const title=summary.getCell('A1');title.value=`COBERTURA Y CUMPLIMIENTO · ${pdv}`;title.font={bold:true,size:20,color:{argb:'FF'+WHITE}};title.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF'+DARK}};title.alignment={vertical:'middle',indent:1};summary.getRow(1).height=29;summary.getRow(2).height=25;
 const st=C.stats(rows),geo=C.groupGeo(rows);const srows=signedRows||signedFiltered().filter(r=>r.pdv===pdv);const scounts=signedByGeo(srows);for(const key of scounts.keys())if(!geo.some(g=>[g.department,g.province,g.district].join('¦')===key)){const [department,province,district]=key.split('¦');geo.push({department,province,district,...C.stats([])});}geo.sort((a,b)=>a.department.localeCompare(b.department,'es')||a.province.localeCompare(b.province,'es')||a.district.localeCompare(b.district,'es'));
 const cards=[['GUÍAS SIN DEVOLUCIÓN',st.n],['DEPARTAMENTOS',st.depts],['PROVINCIAS',st.provinces],['DISTRITOS',st.districts],['TIEMPO PROMEDIO (H)',st.avg],['PAGO PROMEDIO (%)',st.payAvg]];
 cards.forEach(([lab,v],i)=>{const col=i<3?1+i*2:1+(i-3)*2,row=i<3?4:6;const a=summary.getCell(row,col),b=summary.getCell(row+1,col);a.value=lab;a.font={size:9,bold:true,color:{argb:'FF5E7190'}};b.value=v;b.font={size:18,bold:true,color:{argb:'FF174E89'}};if(i>=4)b.numFmt='0.00'});
 summary.getCell('G4').value='DEVOLUCIÓN';summary.getCell('G4').font={size:10,bold:true,color:{argb:'FFB42318'}};summary.getCell('G5').value=st.devoluciones;summary.getCell('G5').font={size:20,bold:true,color:{argb:'FFB42318'}};summary.getCell('I5').value='No se incluyen en promedio ni tramos de pago';summary.getCell('I5').font={size:10,italic:true,color:{argb:'FFB42318'}};
 summary.getRow(10).values=['TRAMO','% PAGO','GUÍAS','% SOBRE GUÍAS SIN DEVOLUCIÓN'];headerStyle(summary.getRow(10));
 for(let i=0;i<C.PAGOS.length;i++){const r=summary.getRow(11+i);r.getCell(1).value=C.LABELS[i];r.getCell(2).value=C.PAGOS[i]/100;r.getCell(2).numFmt='0%';r.getCell(3).value=st.bands[i];r.getCell(4).value=st.n?st.bands[i]/st.n:0;r.getCell(4).numFmt='0.0%'}
 summary.getCell('A19').value='TOTAL GUÍAS PARA PAGO';summary.getCell('C19').value=st.n;summary.getCell('D19').value=st.n?1:0;summary.getCell('D19').numFmt='0%';summary.getRow(19).font={bold:true};
 summary.getCell('A20').value='DEVOLUCIÓN';summary.getCell('C20').value=st.devoluciones;summary.getCell('A20').font={bold:true,color:{argb:'FFB42318'}};summary.getCell('C20').font={bold:true,color:{argb:'FFB42318'}};summary.getCell('A21').value='FIRMADOS (EXPORTACIÓN)';summary.getCell('C21').value=srows.length;summary.getCell('A21').font={bold:true,color:{argb:'FF166534'}};summary.getCell('C21').font={bold:true,color:{argb:'FF166534'}};
 const i1=wb.addImage({base64:makeChartData('bands',st.bands),extension:'png'}),i2=wb.addImage({base64:makeChartData('coverage',geo),extension:'png'});summary.addImage(i1,{tl:{col:5.4,row:9},ext:{width:750,height:250}});summary.addImage(i2,{tl:{col:5.4,row:22},ext:{width:750,height:260}});
 summary.getCell('A36').value='COBERTURA TERRITORIAL POR TRAMOS';summary.getCell('A36').font={bold:true,size:14,color:{argb:'FF174E89'}};
 const cols=['DEPARTAMENTO','PROVINCIA','DISTRITO','GUÍAS','≤24 / 100%','>24–48 / 100%','48–72 / 90%','72–96 / 80%','96–120 / 70%','120–144 / 60%','144–168 / 50%','>168 / 0%','PROMEDIO HORAS','PAGO PROMEDIO','DEVOLUCIÓN','FIRMADOS'];summary.getRow(38).values=cols;headerStyle(summary.getRow(38));summary.getCell('O38').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFB42318'}};summary.getCell('P38').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF166534'}};
 geo.forEach((g,i)=>{const n=39+i;summary.getRow(n).values=[excelText(g.department),excelText(g.province),excelText(g.district),g.n,...g.bands,g.n?g.avg:null,g.n?g.payAvg/100:null,g.devoluciones,scounts.get([g.department,g.province,g.district].join('¦'))||0];summary.getCell(n,13).numFmt='0.00';summary.getCell(n,14).numFmt='0.0%';summary.getCell(n,15).font={bold:true,color:{argb:'FFB42318'}};summary.getCell(n,16).font={bold:true,color:{argb:'FF166534'}};if(i%2)summary.getRow(n).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF1F6FC'}}});
 const totalRow=39+geo.length;summary.getRow(totalRow).values=['TOTAL GENERAL','','',st.n,...st.bands,st.n?st.avg:null,st.n?st.payAvg/100:null,st.devoluciones,srows.length];summary.getRow(totalRow).font={bold:true,color:{argb:'FF174E89'}};summary.getCell(totalRow,14).numFmt='0.0%';summary.getCell(totalRow,13).numFmt='0.00';summary.getCell(totalRow,15).font={bold:true,color:{argb:'FFB42318'}};summary.getCell(totalRow,16).font={bold:true,color:{argb:'FF166534'}};summary.autoFilter={from:'A38',to:`P${Math.max(38,totalRow-1)}`};
 const det=wb.addWorksheet('DETALLE_GUIAS',{views:[{state:'frozen',ySplit:5}]});
 const dcols=[['GUÍA',22],['PDV',14],['DEPARTAMENTO',19],['PROVINCIA',24],['DISTRITO',28],['DESCARGA PDV',17],['FIRMA EFECTIVA',17],['HORAS LOGRADAS',17],['TRAMO',19],['% PAGO',13],['DEVOLUCIÓN',16],['ESTADO DEVOLUCIÓN',28],['% EN ORIGEN',15],['ESTADO',17],['STATUS',25],['ARCHIVO ORIGEN',42],['FILA ORIGEN',12],...opsExcelCols];
 dcols.forEach(([h,w],i)=>det.getColumn(i+1).width=w);det.mergeCells('A1:X2');det.getCell('A1').value=`DETALLE DE GUÍAS · ${pdv}`;det.getCell('A1').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF'+DARK}};det.getCell('A1').font={bold:true,color:{argb:'FF'+WHITE},size:18};det.getCell('A1').alignment={vertical:'middle',indent:1};det.getCell('A3').value=`${fmt(rows.length)} registros · ${fmt(st.n)} para promedio · ${fmt(st.devoluciones)} devoluciones`; const sorted=[...rows].sort((a,b)=>a.department.localeCompare(b.department,'es')||a.province.localeCompare(b.province,'es')||a.district.localeCompare(b.district,'es')||a.guia.localeCompare(b.guia,'es'));
 // Tabla estructurada auténtica: habilita Segmentación de datos > Insertar segmentación en Excel de escritorio.
 // Los segmentadores gráficos no se serializan de forma fiable mediante ExcelJS 4.4 en el navegador.
 det.addTable({name:'TablaDetalleGuias',ref:'A5',headerRow:true,totalsRow:false,
  style:{theme:'TableStyleMedium2',showRowStripes:true},
  columns:dcols.map(([name])=>({name,filterButton:true})),
  rows:sorted.map(r=>[excelText(r.guia),excelText(r.pdv),excelText(r.department),excelText(r.province),excelText(r.district),excelText(r.descarga),excelText(r.firma),r.horas,r.esFirmado?'FIRMADO':r.esDevolucion?'NO APLICA':C.LABELS[r.band],r.esDevolucion?null:r.pago/100,r.esDevolucion?1:0,excelText(r.devolver),excelText(r.origenPct),excelText(r.estado),excelText(r.status),excelText(r.fuente),r.fila,...opsExcel(r)])
 });
 headerStyle(det.getRow(5));det.getCell('K5').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFB42318'}};
 for(let i=0;i<sorted.length;i++){
  const r=sorted[i],row=det.getRow(6+i);row.getCell(8).numFmt='0.000';row.getCell(10).numFmt='0%';
  if(r.esDevolucion){row.getCell(11).font={bold:true,color:{argb:'FFB42318'}};row.getCell(12).font={color:{argb:'FFB42318'}};row.getCell(11).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFE5E5'}}}
 }
 summary.getCell('A24').value='SEGMENTACIONES DE DATOS EN EXCEL';summary.getCell('A24').font={bold:true,size:11,color:{argb:'FF174E89'}};
 summary.getCell('A26').value='1. Abre DETALLE_GUIAS y selecciona una celda.';
 summary.getCell('A27').value='2. Diseño de tabla → Insertar segmentación de datos.';
 summary.getCell('A28').value='3. Marca DEPARTAMENTO, PROVINCIA y DISTRITO.';
 summary.getCell('A29').value='4. Añade TRAMO y % PAGO; confirma.';
 summary.getCell('A31').value='La tabla ya incluye filtros desplegables.';
 summary.getCell('A32').value='Los paneles visuales se insertan desde Excel.';
 for(let row=26;row<=32;row++){const cell=summary.getCell(row,1);cell.font={size:9,color:{argb:row===32?'FFAD671A':'FF49627E'}}}
 const signedSheet=wb.addWorksheet('FIRMADOS_EXPORTACION');
 const signedColumns=[['GUÍA',23],['PDV',16],['DEPARTAMENTO',18],['PROVINCIA',24],['DISTRITO',28],['HORA DE FIRMA',22],['ESTATUS',15],['ARCHIVO EXPORTACIÓN',44],...opsExcelCols];
 signedColumns.forEach(([,width],i)=>signedSheet.getColumn(i+1).width=width);
 signedSheet.addRow(signedColumns.map(x=>x[0]));headerStyle(signedSheet.getRow(1));
 for(const r of srows)signedSheet.addRow([excelText(r.guia),excelText(r.pdv),excelText(r.department),excelText(r.province),excelText(r.district),excelText(r.firma),excelText(r.estatus||'FIRMADO'),excelText(r.fuente),...opsExcel(r)]);
 signedSheet.autoFilter={from:'A1',to:`O${Math.max(1,signedSheet.rowCount)}`};
 return wb;
 
}
function makeChartData(kind,data){const canvas=document.createElement('canvas');return kind==='bands'?drawBands(canvas,data,{w:1050,h:400}):drawCoverage(canvas,data,{w:1050,h:400})}
function controlWorkbook(pdvs,all,conflicts,invalid,signedRecords=null){
 const wb=new ExcelJS.Workbook();wb.creator='Descarga PDV';const sheet=wb.addWorksheet('CONTROL_GENERAL');
 [18,13,16,14,14,14,19,...Array(C.PAGOS.length).fill(17),18].forEach((w,i)=>sheet.getColumn(i+1).width=w);
 sheet.getRow(1).values=['PDV','GUÍAS','DEVOLUCIÓN','DEPTOS','PROVINCIAS','DISTRITOS','PROMEDIO H','≤24','>24–48','48–72','72–96','96–120','120–144','144–168','>168','PAGO PROM.','FIRMADOS'];headerStyle(sheet.getRow(1));sheet.getColumn(17).width=18;sheet.getCell('Q1').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF166534'}};sheet.getCell('C1').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFB42318'}};
 for(const g of pdvs)sheet.addRow([excelText(g.pdv),g.n,g.devoluciones,g.depts,g.provinces,g.districts,g.n?g.avg:null,...g.bands,g.n?g.payAvg/100:null,g.firmados??signedFiltered().filter(r=>r.pdv===g.pdv).length]);
 const st=C.stats(all),tr=sheet.addRow(['TOTAL',st.n,st.devoluciones,st.depts,st.provinces,st.districts,st.n?st.avg:null,...st.bands,st.n?st.payAvg/100:null,(signedRecords||signedFiltered()).length]);tr.font={bold:true};
 for(let r=2;r<=sheet.rowCount;r++){sheet.getCell(r,3).font={bold:true,color:{argb:'FFB42318'}};sheet.getCell(r,7).numFmt='0.00';sheet.getCell(r,16).numFmt='0.0%'}sheet.autoFilter={from:'A1',to:`Q${Math.max(1,sheet.rowCount-1)}`};
 const inc=wb.addWorksheet('INCIDENCIAS');[25,22,20,26,30,15,19,40,13,38].forEach((w,i)=>inc.getColumn(i+1).width=w);inc.addRow(['GUÍA','PROBLEMA','PDV','PROVINCIA','DISTRITO','HORAS','% PAGO','ARCHIVO','FILA','OBSERVACIÓN']);headerStyle(inc.getRow(1));
 for(const c of conflicts)for(const r of c.options)inc.addRow([c.guia,'Duplicado contradictorio',r.pdv,r.province,r.district,r.horas,r.esDevolucion?null:r.pago/100,r.fuente,r.fila,'Pendiente de seleccionar versión. Estado: '+r.devolver]);
 for(const r of invalid)inc.addRow([r.guia||'','Dato inválido','','','',null,null,r.fuente,r.fila,r.error]);inc.autoFilter={from:'A1',to:`J${Math.max(1,inc.rowCount)}`};
 const signed=wb.addWorksheet('FIRMADAS_RETIRADAS');[24,17,23,18,22,45,18].forEach((w,i)=>signed.getColumn(i+1).width=w);signed.addRow(['GUÍA','PDV CENTRO','FIRMA EXPORTACIÓN','PDV EXPORTACIÓN','ESTATUS','ARCHIVO EVIDENCIA','EXCLUIDA']);headerStyle(signed.getRow(1));for(const r of getSignedMatches()){const e=state.signed[r.guia];signed.addRow([excelText(r.guia),excelText(r.pdv),excelText(e?.firma),excelText(e?.pdv),excelText(e?.estatus),excelText(e?.fuente),state.excludeSigned?'SI':'NO'])}signed.autoFilter={from:'A1',to:`G${Math.max(1,signed.rowCount)}`};
 const signedAll=wb.addWorksheet('FIRMADOS_EXPORTACION');
 const scols=[['GUÍA',24],['PDV',17],['DEPARTAMENTO',22],['PROVINCIA',26],['DISTRITO',26],['HORA DE FIRMA',23],['ESTATUS',18],['ARCHIVO EXPORTACIÓN',44],...opsExcelCols];
 scols.forEach((col,i)=>signedAll.getColumn(i+1).width=col[1]);
 signedAll.addRow(scols.map(col=>col[0]));headerStyle(signedAll.getRow(1));
 for(const f of (signedRecords||signedFiltered()))signedAll.addRow([excelText(f.guia),excelText(f.pdv),excelText(f.department),excelText(f.province),excelText(f.district),excelText(f.firma),excelText(f.estatus||'FIRMADO'),excelText(f.fuente),...opsExcel(f)]);
 signedAll.autoFilter={from:'A1',to:`O${Math.max(1,signedAll.rowCount)}`};return wb;
}
async function exportZip(){
 if(state.loading||ops.busy)return; if(!await opsBeforeExport())return;
 if(!window.ExcelJS||!window.JSZip){message('No se pudo cargar el generador de Excel/ZIP. Revisa la conexión a Internet o los archivos externos.',true);return}
 const selected=new Set(state.selected),pending=applyDrill(getFiltered()).filter(r=>selected.has(r.pdv)),signed=signedFiltered().filter(r=>selected.has(r.pdv));
 // Permite descargar PDV que hoy solamente tengan guías firmadas y ningún pendiente.
 const pdvNames=[...new Set([...pending.map(r=>r.pdv),...signed.map(r=>r.pdv)])].sort((a,b)=>a.localeCompare(b,'es'));
 if(!pdvNames.length)return message('Marca los PDV con guías pendientes o firmadas que deseas descargar. Revisa los filtros aplicados.',true);
 if(pdvNames.length>80)return message('Para evitar archivos excesivos, selecciona 80 PDV o menos.',true);
 setBusy(true);
 try{
  const zip=new JSZip(),folder=zip.folder('EXCEL_POR_PDV'),groups=[];
  for(let i=0;i<pdvNames.length;i++){
   const pdv=pdvNames[i],rows=pending.filter(r=>r.pdv===pdv),signedRows=signed.filter(r=>r.pdv===pdv);
   message(`Generando Excel ${i+1}/${pdvNames.length}: ${pdv} (${fmt(rows.length)} registros, ${fmt(signedRows.length)} firmados)…`);
   await new Promise(r=>setTimeout(r,12));
   const wb=workbookPDV(pdv,rows,signedRows);
   folder.file(`${cleanFilename(pdv)}.xlsx`,await wb.xlsx.writeBuffer());
   groups.push({pdv,rows,firmados:signedRows.length,...C.stats(rows)});
  }
  message('Generando archivo de control y comprimiendo ZIP…');
  const ctr=controlWorkbook(groups,pending,state.conflicts,state.invalid,signed);
  zip.file('CONTROL_GENERAL.xlsx',await ctr.xlsx.writeBuffer());
  const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:4}},metadata=>{$('message').textContent=`Comprimiendo ZIP… ${Math.round(metadata.percent)}%`});
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=`COBERTURA_PDV_${new Date().toISOString().slice(0,10)}_${pdvNames.length}PDV.zip`;
  document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  message(`ZIP listo: ${pdvNames.length} Excel por PDV + CONTROL_GENERAL.xlsx · ${fmt(pending.length)} registros de Centro y ${fmt(signed.length)} firmadas.`);
 }catch(e){message('No se pudo generar el ZIP: '+(e?.message||e),true);console.error(e)}finally{setBusy(false)}
}

/* V1.1. Cruce auditable y reversible: nunca se editan ni borran filas de Centro. */
function getSignedMatches(){const u=new Map();for(const r of state.raw){if(!r.error&&r.guia&&state.signed[r.guia]&&!u.has(r.guia))u.set(r.guia,r)}return [...u.values()].sort((a,b)=>a.guia.localeCompare(b.guia))}
function renderSignedInfo(){const total=Object.keys(state.signed).length,match=getSignedMatches().length;$('signedStats').textContent=`${fmt(match)} de Centro · ${fmt(total)} firmadas`;$('signedFilesStatus').textContent=`${state.signedFiles.length} Exportación(es) cargadas · ${fmt(state.excludeSigned?match:0)} guías retiradas del pendiente.`;if(isPersonalOperator())$('signedFilesStatus').textContent=`Publicación: ${fmt(Object.keys(publishedSigned).length)} firmadas · Carga personal: ${fmt(Object.keys(personalSigned).length)} firmadas en ${personalSignedFiles.length} archivo(s) · ${fmt(state.excludeSigned?match:0)} guías retiradas del pendiente.`;if($('signedAuditCount'))$('signedAuditCount').textContent=`${fmt(match)} coincidentes`}
function renderSignedAudit(){const rows=getSignedMatches(),body=$('signedAuditRows');body.innerHTML=rows.slice(0,250).map(r=>{const e=state.signed[r.guia];return `<tr><td>${safe(r.guia)}</td><td>${safe(r.pdv)}</td><td>${safe(e.firma)}</td><td>${safe(e.pdv)}</td><td>${safe(e.fuente)}</td><td>${state.excludeSigned?'Retirada del pendiente':'Visible en pendiente'}</td></tr>`}).join('')||'<tr><td colspan="6" class="empty">No hay guías firmadas coincidentes.</td></tr>';$('signedAuditNote').textContent=`${fmt(rows.length)} coincidencias únicas entre Centro y Exportación · mostrando hasta 250 · El Excel CONTROL_GENERAL incluye todas.`}
async function loadSignedFiles(){
 if(!canCrossSigned())return;if(!window.XLSX)return message('No se pudo cargar el lector Excel.',true);
 const files=[...$('exportInput').files];if(!files.length)return;
 const personal=isPersonalOperator();setBusy(true);refreshSignedControls();
 try{
  let merged=personal?{...personalSigned}:{...state.signed};const meta=[];let ignored=0,outside=0,accepted=0;
  for(const f of files){
   const workbook=XLSX.read(await f.arrayBuffer(),{type:'array',cellDates:false,raw:true}),name=workbook.SheetNames.find(n=>C.normKey(n).includes('EXPORTACIONDEGUIADEEMBARQUE'))||workbook.SheetNames[0],grid=XLSX.utils.sheet_to_json(workbook.Sheets[name],{header:1,defval:'',raw:true,blankrows:false});
   const parsed=C.signedExportRows(grid,f.name);let count=0;
   for(const record of parsed.records){const r=personal?scopePersonalRecord(record):record;if(!r){outside++;continue}if(!Object.hasOwn(merged,r.guia)||String(r.firma)>=String(merged[r.guia].firma))merged[r.guia]=r;count++;accepted++;}
   ignored+=parsed.notSigned;if(!personal||count)meta.push({name:f.name,rows:personal?count:parsed.total,signed:count,ignored:personal?0:parsed.notSigned,loadedAt:new Date().toISOString()});
  }
  $('exportInput').value='';
  if(personal&&!accepted){$('exportFilesInfo').textContent='No se incorporaron nuevas firmadas.';return message(`No se encontraron guías firmadas de tus PDV autorizados en estos archivos. ${fmt(outside)} fuera del alcance o sin PDV verificable; ${fmt(ignored)} sin firma válida.`,true)}
  if(personal){personalSigned=merged;personalSignedFiles.push(...meta);applyPersonalSigned();$('exportFilesInfo').textContent='Cruce personal activo · puedes añadir más archivos.';rebuild();message(`Cruce temporal aplicado: ${fmt(Object.keys(personalSigned).length)} guías firmadas personales únicas; ${fmt(getSignedMatches().length)} coincidencias totales con Centro (incluida la publicación). ${fmt(outside)} fuera del alcance o sin PDV verificable; ${fmt(ignored)} sin firma válida. No se guardó ni publicó información.`);}
  else{state.signed=merged;signedCache=null;state.signedFiles.push(...meta);$('exportFilesInfo').textContent='Exportaciones cargadas. Puedes añadir más archivos después.';rebuild();await persist();message(`Cruce aplicado: ${fmt(Object.keys(state.signed).length)} guías firmadas únicas en Exportación; ${fmt(getSignedMatches().length)} coinciden con Centro; ${fmt(ignored)} registros sin evidencia de firma ignorados. Las filas de Centro permanecen intactas.`)}
 }catch(e){message('No se pudo cruzar la Exportación: '+e.message,true)}finally{setBusy(false);refreshSignedControls()}
}
async function clearSigned(){
 if(!canCrossSigned())return;
 if(isPersonalOperator()){if(!personalSignedFiles.length)return;if(!confirm('¿Quitar solo tus Exportaciones temporales y volver a los firmados publicados por el administrador?'))return;resetPersonalSigned();resetDrill();rebuild();refreshSignedControls();message('Carga personal retirada. Se conservaron los firmados de la publicación del administrador.');return;}
 if(!Object.keys(state.signed).length)return;if(!confirm('¿Restaurar todas las guías retiradas del resumen y borrar el cruce de Exportación guardado en este navegador? No se borrarán guías de Centro.'))return;state.signed={};signedCache=null;state.signedFiles=[];rebuild();await persist();message('Cruce de firmas desactivado y restaurado. Todas las guías de Centro vuelven a estar disponibles.');
}
/* Grupos editables y descargables, persistidos exclusivamente en IndexedDB. */
function allPDVs(){return [...new Set([...state.compiled.map(r=>r.pdv),...signedAugmented().map(r=>r.pdv),...state.groups.flatMap(g=>g.pdvs||[])])].filter(Boolean).sort((a,b)=>a.localeCompare(b,'es'))}
function draftOptions(){const query=C.normKey($('groupPDVSearch').value),pdvs=allPDVs().filter(p=>!query||C.normKey(p).includes(query));$('groupPDVOptions').innerHTML=pdvs.map(p=>`<label class="group-pdv-option"><input type="checkbox" data-group-pdv="${safe(p)}" ${state.groupDraft.has(p)?'checked':''}> ${safe(p)}</label>`).join('')||'<span class="tiny muted">Sin PDV coincidentes. Carga primero Centro.xlsx.</span>';$('groupDraftCount').textContent=`${state.groupDraft.size} PDV marcados · ${pdvs.length} encontrados`}
function groupRows(){const filtered=applyDrill(getFilteredNoGroup());return state.groups.map(g=>{const rows=filtered.filter(r=>g.pdvs.includes(r.pdv));const firmados=signedFiltered({ignoreGroup:true}).filter(r=>g.pdvs.includes(r.pdv)).length;return {...g,rows,firmados,...C.stats(rows)}})}
function renderGroupManager(){
 if(!$('groupRows'))return;const choose=$('pdvGroupFilter'),old=choose.value;
 choose.innerHTML='<option value="">Todos los grupos / PDV</option>'+state.groups.map(g=>`<option value="${safe(g.id)}">${safe(g.name)}</option>`).join('');if(state.groups.some(g=>g.id===old))choose.value=old;else choose.value='';
 $('groupStats').textContent=`${state.groups.length} grupos`;$('groupSelectedCount').textContent=`${state.selectedGroups.size} grupos seleccionados`;
 $('groupRows').innerHTML=groupRows().map(g=>`<tr data-row-group="${safe(g.id)}"><td><input type="checkbox" data-pick-group="${safe(g.id)}" ${state.selectedGroups.has(g.id)?'checked':''}></td><td><button class="drill-cell drill-geo" data-group-drill="${safe(g.id)}" data-group-metric="all"><strong>${safe(g.name)}</strong></button></td><td title="${safe(g.pdvs.join(', '))}">${safe(g.pdvs.join(', '))}</td><td class="firmados-num">${g.firmados?`<button class="drill-cell" data-group-drill="${safe(g.id)}" data-group-metric="signed">${fmt(g.firmados)}</button>`:'–'}</td><td><button class="drill-cell" data-group-drill="${safe(g.id)}" data-group-metric="all">${fmt(g.n)}</button></td><td class="devolucion-num">${g.devoluciones?`<button class="drill-cell" data-group-drill="${safe(g.id)}" data-group-metric="returns">${fmt(g.devoluciones)}</button>`:'–'}</td><td>${g.n?num(g.avg,2):'–'}</td><td>${g.n?num(g.payAvg,1)+'%':'–'}</td><td><button class="btn outline" data-show-group="${safe(g.id)}">Ver</button><button class="btn outline" data-edit-group="${safe(g.id)}" ${access.isAdmin?'':'hidden'}>Editar</button><button class="btn danger-soft" data-delete-group="${safe(g.id)}" ${access.isAdmin?'':'hidden'}>Eliminar</button></td></tr>`).join('')||'<tr><td colspan="9" class="empty">Aún no hay agrupaciones. Marca varios PDV y pulsa Guardar grupo.</td></tr>';draftOptions();
}
function cancelGroupEdit(){$('groupName').value='';state.groupDraft.clear();state.editingGroup='';$('btnSaveGroup').textContent='Guardar grupo';$('btnCancelEdit').classList.add('hidden');draftOptions()}
async function saveGroup(){if(!canUse())return;const name=$('groupName').value.trim().replace(/\s+/g,' ');if(!name||name.length>70)return message('Escribe un nombre válido de máximo 70 caracteres.',true);if(!state.groupDraft.size)return message('Marca al menos un PDV para crear la agrupación.',true);if(state.groups.some(g=>g.name.toUpperCase()===name.toUpperCase()&&g.id!==state.editingGroup))return message('Ya existe una agrupación con ese nombre.',true);const rec={id:state.editingGroup||`grp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`,name,pdvs:[...state.groupDraft].sort(),savedAt:new Date().toISOString()};const idx=state.groups.findIndex(g=>g.id===rec.id);if(idx>=0)state.groups[idx]=rec;else state.groups.push(rec);state.groups.sort((a,b)=>a.name.localeCompare(b.name,'es'));cancelGroupEdit();refreshAll();await persist();message(`Agrupación ${name} guardada con ${rec.pdvs.length} PDV.`)}
function setupExtra(){const exp=$('exportInput');exp.addEventListener('change',()=>{const files=[...exp.files];$('exportFilesInfo').textContent=files.length?files.map(f=>f.name).join(' · '):'Sin archivos seleccionados.';refreshSignedControls()});$('btnExportProcess').onclick=loadSignedFiles;$('btnRestoreSigned').onclick=clearSigned;$('excludeSigned').onchange=async e=>{if(!canCrossSigned()){e.target.checked=state.excludeSigned;return}state.excludeSigned=e.target.checked;resetDrill();refreshAll();if(access.isAdmin)await persist()};$('groupPDVSearch').oninput=draftOptions;$('groupPDVOptions').onchange=e=>{if(!canUse())return;const p=e.target.dataset.groupPdv;if(!p)return;e.target.checked?state.groupDraft.add(p):state.groupDraft.delete(p);draftOptions()};$('btnGroupAll').onclick=()=>{const q=C.normKey($('groupPDVSearch').value);for(const p of allPDVs().filter(p=>!q||C.normKey(p).includes(q)))state.groupDraft.add(p);draftOptions()};$('btnGroupNone').onclick=()=>{state.groupDraft.clear();draftOptions()};$('btnSaveGroup').onclick=saveGroup;$('btnCancelEdit').onclick=cancelGroupEdit;$('pdvGroupFilter').onchange=()=>{resetDrill();refreshAll()};$('btnZipGroups').onclick=exportGroupZip;$('groupRows').addEventListener('change',e=>{if(state.loading)return;const id=e.target.dataset.pickGroup;if(!id)return;e.target.checked?state.selectedGroups.add(id):state.selectedGroups.delete(id);$('groupSelectedCount').textContent=`${state.selectedGroups.size} grupos seleccionados`});$('groupRows').addEventListener('click',async e=>{const generic=e.target.closest('tr[data-row-group]');if(generic&&!e.target.closest('button,input,a')){if(state.groups.some(g=>g.id===generic.dataset.rowGroup)){$('pdvGroupFilter').value=generic.dataset.rowGroup;resetDrill();refreshAll()}return}const drill=e.target.closest('[data-group-drill]');if(drill){const id=drill.dataset.groupDrill;if(!state.groups.some(g=>g.id===id))return;$('pdvGroupFilter').value=id;resetDrill();if(drill.dataset.groupMetric==='returns')state.drill.returns=true;else if(drill.dataset.groupMetric==='signed')state.drill.signed=true;refreshAll();return}const btn=e.target.closest('button');if(!btn)return;const id=btn.dataset.showGroup||btn.dataset.editGroup||btn.dataset.deleteGroup;if(!id)return;const group=state.groups.find(g=>g.id===id);if(!group)return;if(btn.dataset.showGroup){$('pdvGroupFilter').value=id;resetDrill();refreshAll();$('pdvGroupFilter').scrollIntoView({behavior:'smooth',block:'center'});return}if(btn.dataset.editGroup){if(!canUse())return;state.editingGroup=id;state.groupDraft=new Set(group.pdvs);$('groupName').value=group.name;$('btnSaveGroup').textContent='Actualizar grupo';$('btnCancelEdit').classList.remove('hidden');draftOptions();$('groupName').focus();return}if(btn.dataset.deleteGroup){if(!canUse())return;if(!confirm(`¿Eliminar la agrupación «${group.name}»? Ninguna guía de Centro se borrará.`))return;state.groups=state.groups.filter(g=>g.id!==id);state.selectedGroups.delete(id);if($('pdvGroupFilter').value===id)$('pdvGroupFilter').value='';cancelGroupEdit();refreshAll();await persist();message('Agrupación eliminada.')}})}
function cleanFilename(name){return String(name||'grupo').replace(/[\\/:*?"<>|]/g,'_').trim().slice(0,65)||'grupo'}
async function exportGroupZip(){if(state.loading||ops.busy)return;if(!await opsBeforeExport())return;if(!window.ExcelJS||!window.JSZip)return message('No se encuentran ExcelJS o JSZip. Revisa la conexión.',true);const groups=groupRows().filter(g=>state.selectedGroups.has(g.id)&&(g.total||g.firmados));if(!groups.length)return message('Selecciona grupos con guías para descargar.',true);if(groups.length>40)return message('Descarga hasta 40 grupos por vez.',true);setBusy(true);try{const zip=new JSZip(),folder=zip.folder('EXCEL_POR_GRUPO'),items=[];for(let i=0;i<groups.length;i++){const g=groups[i];message(`Preparando grupo ${i+1}/${groups.length}: ${g.name}…`);await new Promise(r=>setTimeout(r,8));folder.file(`${String(i+1).padStart(2,'0')}_${cleanFilename(g.name)}.xlsx`,await workbookPDV('GRUPO '+g.name,g.rows,signedFiltered({ignoreGroup:true}).filter(r=>g.pdvs.includes(r.pdv))).xlsx.writeBuffer());items.push({pdv:g.name,rows:g.rows,firmados:g.firmados,...C.stats(g.rows)})}const combined=[...new Map(groups.flatMap(g=>g.rows).map(r=>[r.guia,r])).values()];const signedUnion=[...new Map(groups.flatMap(g=>signedFiltered({ignoreGroup:true}).filter(r=>g.pdvs.includes(r.pdv))).map(r=>[r.guia,r])).values()];const ctrl=controlWorkbook(items,combined,state.conflicts,state.invalid,signedUnion);const grupoSheet=ctrl.addWorksheet('GRUPOS_Y_PDV');grupoSheet.addRow(['GRUPO','PDV INTEGRANTE']);headerStyle(grupoSheet.getRow(1));for(const g of groups)for(const p of g.pdvs)grupoSheet.addRow([excelText(g.name),excelText(p)]);grupoSheet.getColumn(1).width=35;grupoSheet.getColumn(2).width=18;zip.file('CONTROL_GENERAL.xlsx',await ctrl.xlsx.writeBuffer());const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:4}});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`COBERTURA_GRUPOS_${new Date().toISOString().slice(0,10)}.zip`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);message(`ZIP de grupos listo: ${groups.length} grupos, ${fmt(combined.length)} guías únicas en control general.`)}catch(e){console.error(e);message('Error al descargar grupos: '+e.message,true)}finally{setBusy(false)}}

init().catch(e=>{console.error(e);$('authGate').classList.remove('hidden');$('authMessage').textContent='Error al iniciar módulo: '+e.message});
})();
