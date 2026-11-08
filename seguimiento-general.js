(function () {
  'use strict';
  const C = window.SeguimientoCore;
  if (!C) { document.body.textContent = 'No se pudo iniciar Seguimiento General. Comprueba seguimiento-core.js.'; return; }
  const $ = id => document.getElementById(id);
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtNum = n => new Intl.NumberFormat('es-PE').format(n || 0);
  const state = {
    exports: [], monitors: [], manualCatalog: [], portalCatalog: [], consolidated: null,
    filtered: [], detail: [], groups: [], selectedGroup: null, visible: 150, groupVisible: 250,
    selected: {}, reading: false, lastNow: Date.now()
  };
  const categories = [
    ['area','Área'], ['punto','Punto de escaneo'], ['pdv','PDV de entrega'], ['tipo','Tipo escaneo'],
    ['estadoSla','Estado SLA'], ['provincia','Provincia de destino'], ['ciudad','Ciudad de destino'], ['colonia','Colonia de destino']
  ];
  const dates = C.dateFields;
  const isVisible = el => !el.classList.contains('hidden');
  function status(message, level = '') { $('importStatus').textContent = message; $('importStatus').className = 'status ' + level; }
  function updateFiles() {
    for (const [id, dest] of [['filesExport','countExport'],['filesMonitor','countMonitor'],['filesPdv','countPdv']]) {
      const files = [...$(id).files];
      $(dest).textContent = files.length ? `${files.length} archivos: ${files.map(f=>f.name).join(', ')}` :
        id === 'filesPdv' ? 'Usando catálogo del portal si está disponible' : 'Sin archivos nuevos seleccionados';
    }
  }
  function setBusy(busy) {
    state.reading = busy; $('loadBtn').disabled = busy; $('clearData').disabled = busy;
    $('loadBtn').textContent = busy ? 'Procesando…' : 'Procesar archivos seleccionados';
  }
  async function loadPortalCatalog() {
    try {
      if (window.parent !== window && typeof window.parent.V16SeguimientoApi?.catalogo === 'function') {
        const records = await window.parent.V16SeguimientoApi.catalogo();
        state.portalCatalog = Array.isArray(records) ? records : [];
        $('catalogStatus').textContent = `${fmtNum(state.portalCatalog.length)} PDV disponibles desde el portal`;
        return;
      }
      $('catalogStatus').textContent = 'Carga PDV LISTA para asignar áreas (catálogo del portal no disponible).';
    } catch (err) {
      $('catalogStatus').textContent = 'No se pudo leer PDV LISTA del portal. Puedes cargarlo manualmente.';
      console.warn('Seguimiento: catálogo no disponible:', err);
    }
  }
  function hasColumn(matrix, aliases) {
    return matrix.some((row, i) => i < 15 && aliases.some(a => row.map(C.key).includes(C.key(a))));
  }
  async function readWorkbook(file, kind) {
    if (!/\.xlsx?$/i.test(file.name)) throw new Error(`${file.name}: solo se admite Excel XLSX/XLS.`);
    if (file.size > 40 * 1024 * 1024) throw new Error(`${file.name}: supera 40 MB.`);
    if (!window.XLSX) throw new Error('No se cargó el lector XLSX. Comprueba tu conexión de internet.');
    const book = XLSX.read(await file.arrayBuffer(), {type:'array', cellDates:false, dense:true});
    const needed = kind === 'pdv' ? ['NOMBRE SIMPLE', 'PDV'] : ['Número de Guía'];
    let matrix = null;
    for (const sheet of book.SheetNames) {
      const data = XLSX.utils.sheet_to_json(book.Sheets[sheet], {header:1, defval:'', raw:true, blankrows:false});
      const headerIndex = data.findIndex((r,i) => i < 15 && Array.isArray(r) && needed.some(k => r.map(C.key).includes(C.key(k))));
      if (headerIndex >= 0) { matrix = data.slice(headerIndex); break; }
    }
    if (!matrix) throw new Error(`${file.name}: no se encontró la columna ${kind === 'pdv' ? 'NOMBRE SIMPLE / PDV' : 'Número de Guía'}.`);
    if (kind === 'export' && !hasColumn(matrix, ['Tiempo de entrada'])) throw new Error(`${file.name}: falta "Tiempo de entrada".`);
    if (kind === 'monitor' && !hasColumn(matrix, ['Hora de salida del HUB','Hora de llegada al PDV','Tiempo de despacho'])) {
      throw new Error(`${file.name}: no se detectaron columnas del monitoreo.`);
    }
    const rows = C.normalizeRows(matrix);
    return kind === 'export' ? C.normalizeExport(rows, file.name) : kind === 'monitor' ? C.normalizeMonitor(rows, file.name) : C.normalizePdv(rows);
  }
  async function load() {
    if (state.reading) return;
    const types = [ ['filesExport','export'], ['filesMonitor','monitor'], ['filesPdv','pdv'] ];
    const files = types.flatMap(([id, kind]) => [...$(id).files].map(file => ({file, kind})));
    if (!files.length) { status('Selecciona al menos un archivo Excel.', 'error'); return; }
    setBusy(true);
    try {
      const staged = {exports:[], monitors:[], manualCatalog:[]};
      for (let idx = 0; idx < files.length; idx++) {
        const {file,kind} = files[idx];
        status(`Procesando archivo ${idx+1} de ${files.length}: ${file.name}`);
        await new Promise(resolve => setTimeout(resolve, 0));
        const rows = await readWorkbook(file, kind);
        const target = kind === 'export' ? staged.exports : kind === 'monitor' ? staged.monitors : staged.manualCatalog;
        target.push(...rows);
      }
      const replace = $('replaceCheck').checked;
      const nextExports = replace ? staged.exports : [...state.exports, ...staged.exports];
      if (!nextExports.length) throw new Error('Primero carga al menos un Excel de Exportación de guías.');
      // Aplicar solo cuando toda la carga haya terminado correctamente (sin datos parciales).
      state.exports = nextExports;
      state.monitors = replace ? staged.monitors : [...state.monitors, ...staged.monitors];
      state.manualCatalog = replace ? staged.manualCatalog : [...state.manualCatalog, ...staged.manualCatalog];
      await loadPortalCatalog();
      rebuild();
      const summary = state.consolidated;
      status(`Carga finalizada: ${files.length} archivo(s), ${fmtNum(summary.uniqueExport)} guías únicas, ${fmtNum(summary.matchedMonitor)} con monitoreo y ${fmtNum(summary.missingArea)} sin área por último punto.`, 'good');
      for (const [id] of types) $(id).value = '';
      updateFiles();
    } catch (e) { console.error(e); status(`No se completó la carga: ${e.message}`, 'error'); }
    finally { setBusy(false); }
  }
  function rebuild() {
    const catalog = [...state.portalCatalog, ...state.manualCatalog];
    // Si el PDV se carga manualmente, prevalece sobre el del portal para su mismo código.
    const merged = new Map(catalog.map(p => [C.pdvKey(p.pdv), p]));
    state.consolidated = C.combine(state.exports, state.monitors, [...merged.values()]);
    renderCategoricalFilters();
    updateAll();
    $('exportBtn').disabled = !state.consolidated.rows.length;
  }
  function renderCategoricalFilters() {
    const container = $('filtersCategorical');
    const rows = state.consolidated?.rows || [];
    container.innerHTML = categories.map(([id,title]) => {
      const selected = state.selected[id]?.size || 0;
      return `<div class="multi-filter"><details id="filter-${id}"><summary><span>${escape(title)}${selected ? ` (${selected})` : ''}</span>▾</summary>
      <div class="multi-list"><div class="multi-actions"><small>Selecciona varios valores</small><button type="button" data-clear="${id}">Limpiar</button></div>
      <input type="search" data-query="${id}" placeholder="Buscar opción"><div class="multi-options" id="options-${id}"></div></div></details></div>`;
    }).join('');
    for (const [id] of categories) {
      if (!state.selected[id]) state.selected[id] = new Set();
      const opts = [...new Set(rows.map(r => C.clean(r[id]) || C.NO_DATA))].sort((a,b) => a.localeCompare(b,'es',{numeric:true}));
      // Retener opciones seleccionadas aunque desaparezcan del universo cargado.
      state.selected[id] = new Set([...state.selected[id]].filter(x => opts.includes(x)));
      const input = container.querySelector(`[data-query="${id}"]`);
      const optionsEl = $(`options-${id}`);
      function draw(query = '') {
        const matched = opts.filter(x => C.norm(x).includes(C.norm(query)));
        optionsEl.innerHTML = (matched.length ? matched.slice(0,180).map(v => `<label><input type="checkbox" ${state.selected[id].has(v) ? 'checked' : ''} data-value="${escape(v)}">${escape(v)}</label>`).join('') : '<small>Sin opciones coincidentes</small>') + (matched.length>180?'<small>Refina la búsqueda para ver más.</small>':'');
        optionsEl.querySelectorAll('input[type=checkbox]').forEach(box => box.addEventListener('change', () => {
          if (box.checked) state.selected[id].add(box.dataset.value); else state.selected[id].delete(box.dataset.value);
          const summary = $(`filter-${id}`).querySelector('summary span');
          summary.textContent = categories.find(x=>x[0]===id)[1] + (state.selected[id].size ? ` (${state.selected[id].size})` : '');
          state.selectedGroup = null;
          updateAll();
        }));
      }
      input.addEventListener('input', () => draw(input.value));
      draw();
      container.querySelector(`[data-clear="${id}"]`).addEventListener('click', () => {
        state.selected[id].clear(); draw(input.value);
        $(`filter-${id}`).querySelector('summary span').textContent = categories.find(x=>x[0]===id)[1];
        state.selectedGroup = null; updateAll();
      });
    }
    // Cerrar menús si se abre otro o se pulsa fuera.
    container.querySelectorAll('details').forEach(d => d.addEventListener('toggle', () => {
      if (d.open) container.querySelectorAll('details').forEach(other => { if (other!==d) other.open = false; });
    }));
  }
  function renderDateFilters() {
    $('dateFilterGrid').innerHTML = dates.map(({id,name,daysName}) => `<div class="date-card" data-date="${id}"><h3>${escape(name)}<span>${escape(daysName)}</span></h3>
     <div class="date-inputs"><label>Fecha desde <input type="text" data-part="from" placeholder="dd-mm-aaaa" maxlength="19"></label><label>Fecha hasta <input type="text" data-part="to" placeholder="dd-mm-aaaa" maxlength="19"></label></div>
     <div class="date-days-head">${escape(daysName)} (decimales)</div><div class="date-inputs"><label>Días mín. <input type="number" data-part="daysMin" min="0" step="any" placeholder="Ej. 7"></label><label>Días máx. <input type="number" data-part="daysMax" min="0" step="any" placeholder="Ej. 10"></label></div>
     <label class="inline-check"><input type="checkbox" data-part="onlyEmpty"> Solo registros sin esta fecha</label></div>`).join('');
    $('dateFilterGrid').querySelectorAll('input').forEach(el => el.addEventListener(el.type === 'text' ? 'change' : 'input', scheduleUpdate));
  }
  let updateTimer = null;
  function scheduleUpdate() { clearTimeout(updateTimer); updateTimer = setTimeout(() => {state.selectedGroup=null; updateAll();}, 120); }
  function numberOrNull(input) {
    const t = input?.value?.trim();
    if (!t) return null;
    const n = Number(t.replace(',','.'));
    return Number.isFinite(n) ? n : null;
  }
  function readFilters() {
    const errors = [];
    const filters = {search: $('search').value, dates:{}};
    for (const [id] of categories) filters[id] = [...(state.selected[id]||[])];
    for (const {id,name} of dates) {
      const card = document.querySelector(`[data-date="${id}"]`);
      const field = part => card.querySelector(`[data-part="${part}"]`);
      const from = C.parseBoundary(field('from').value);
      const to = C.parseBoundary(field('to').value, true);
      if (from.error) errors.push(`${name} · Desde: ${from.error}`);
      if (to.error) errors.push(`${name} · Hasta: ${to.error}`);
      if (from.value != null && to.value != null && from.value > to.value) errors.push(`${name}: el inicio supera el fin.`);
      const daysMin = numberOrNull(field('daysMin'));
      const daysMax = numberOrNull(field('daysMax'));
      if (daysMin != null && daysMax != null && daysMin > daysMax) errors.push(`${name}: días mínimos superan los máximos.`);
      filters.dates[id] = { from: from.value, to: to.value, daysMin, daysMax, onlyEmpty: field('onlyEmpty').checked };
    }
    filters.slaMin = numberOrNull($('slaMin')); filters.slaMax = numberOrNull($('slaMax'));
    if (filters.slaMin != null && filters.slaMax != null && filters.slaMin > filters.slaMax) errors.push('SLA: mínimo supera al máximo.');
    $('dateErrors').textContent = errors.join(' · ');
    return errors.length ? null : filters;
  }
  function updateAll(preservePage = false) {
    if (!state.consolidated) return;
    const filters = readFilters(); if (!filters) return;
    const now = Date.now(); state.lastNow = now;
    state.filtered = C.filterRows(state.consolidated.rows, filters, now);
    state.groups = C.summarize(state.filtered, now);
    state.detail = state.selectedGroup ? state.filtered.filter(r => r.area === state.selectedGroup.area && (r.punto || C.NO_DATA) === state.selectedGroup.punto) : state.filtered;
    if (!preservePage) {state.visible = 150; state.groupVisible = 250;}
    sortDetails();
    renderKpis(); renderSummary(); renderDetail();
  }
  function renderKpis() {
    const rows = state.filtered;
    $('kpiGuias').textContent = fmtNum(rows.length);
    $('kpiMonitor').textContent = fmtNum(rows.filter(r=>r.tieneMonitoreo).length);
    $('kpiSla').textContent = fmtNum(rows.filter(r=>r.inicioSla != null).length);
    $('kpiSinMonitor').textContent = fmtNum(rows.filter(r=>!r.tieneMonitoreo).length);
    $('kpiSinArea').textContent = fmtNum(rows.filter(r=>r.area === 'SIN ÁREA').length);
    $('resultSummary').textContent = `${fmtNum(state.groups.length)} grupos · ${fmtNum(rows.length)} guías filtradas`;
    $('groupSelection').textContent = state.selectedGroup ? `Grupo: ${state.selectedGroup.area} · ${state.selectedGroup.punto}` : 'Haz clic en un grupo para ver su detalle.';
    $('clearGroup').classList.toggle('hidden', !state.selectedGroup);
  }
  function numberText(n) { return n == null ? '—' : n.toFixed(8); }
  function renderSummary() {
    const list = state.groups.slice(0,state.groupVisible);
    $('summaryBody').innerHTML = list.length ? list.map((g,i) => {
      const selected = state.selectedGroup && g.area === state.selectedGroup.area && g.punto === state.selectedGroup.punto;
      return `<tr class="clickable ${selected?'selected':''}" tabindex="0" data-index="${i}" title="Ver guías del grupo"><td>${escape(g.area)}</td><td>${escape(g.punto)}</td><td class="numeric">${fmtNum(g.total)}</td><td class="numeric">${fmtNum(g.countSla)}</td><td class="numeric">${fmtNum(g.sinSla)}</td><td class="numeric">${numberText(g.promedioCola)}</td><td class="numeric">${numberText(g.promedioSla)}</td></tr>`;
    }).join('') : '<tr><td class="empty" colspan="7">Sin guías para los filtros seleccionados.</td></tr>';
    $('summaryBody').querySelectorAll('tr[data-index]').forEach(tr => {
      const select = () => {
        const group = state.groups[Number(tr.dataset.index)];
        state.selectedGroup = state.selectedGroup?.area === group.area && state.selectedGroup?.punto === group.punto ? null : {area:group.area,punto:group.punto};
        state.detail = state.selectedGroup ? state.filtered.filter(r=>r.area === group.area && (r.punto || C.NO_DATA) === group.punto) : state.filtered;
        state.visible = 150; sortDetails(); renderSummary(); renderDetail();renderKpis();
      };
      tr.addEventListener('click', select);
      tr.addEventListener('keydown', ev => {if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();select();}});
    });
    $('showSummaryMore').classList.toggle('hidden', state.groupVisible >= state.groups.length);
  }
  function sortDetails() {
    const now = state.lastNow, sort = $('sortBy').value;
    state.detail.sort((a,b) => {
      if (sort === 'sla') return (C.elapsedDays(b.inicioSla,now) ?? -Infinity) - (C.elapsedDays(a.inicioSla,now) ?? -Infinity);
      if (sort === 'cola') return (C.elapsedDays(b.tiempoEntrada,now) ?? -Infinity) - (C.elapsedDays(a.tiempoEntrada,now) ?? -Infinity);
      if (sort === 'guia') return a.guia.localeCompare(b.guia,'es');
      return a.area.localeCompare(b.area,'es') || a.punto.localeCompare(b.punto,'es') || a.guia.localeCompare(b.guia,'es');
    });
  }
  function tagStatus(s) {
    const cls = s === 'DESDE LLEGADA PDV' || s === 'DESDE SALIDA HUB' ? 'ok' : s === 'EN TRÁNSITO' || s === 'SIN SALIDA HUB' ? 'warn' : 'muted';
    return `<span class="tag ${cls}">${escape(s)}</span>`;
  }
  function renderDetail() {
    const now = state.lastNow;
    const list = state.detail.slice(0,state.visible);
    $('detailBody').innerHTML = list.length ? list.map(r=>`<tr><td><b>${escape(r.guia)}</b></td><td>${escape(r.area)}</td><td>${escape(r.punto||'—')}</td><td>${escape(r.pdv||'—')}</td><td>${escape(r.tipo||'—')}</td>
      <td>${C.formatPeru(r.tiempoEntrada)}</td><td class="numeric">${C.elapsedText(r.tiempoEntrada,now)}</td>
      <td>${C.formatPeru(r.salidaHub)}</td><td class="numeric">${C.elapsedText(r.salidaHub,now)}</td>
      <td>${C.formatPeru(r.llegadaPdv)}</td><td class="numeric">${C.elapsedText(r.llegadaPdv,now)}</td>
      <td>${C.formatPeru(r.tiempoDespacho)}</td><td class="numeric">${C.elapsedText(r.tiempoDespacho,now)}</td>
      <td>${tagStatus(r.estadoSla)}</td><td class="numeric">${C.elapsedText(r.inicioSla,now)}</td>
      <td>${escape(r.provincia||'—')}</td><td>${escape(r.ciudad||'—')}</td><td>${escape(r.colonia||'—')}</td></tr>`).join('') : '<tr><td class="empty" colspan="18">Sin guías coincidentes.</td></tr>';
    $('detailCount').textContent = `${fmtNum(state.detail.length)} guías en detalle`;
    $('showingCount').textContent = `Mostrando ${fmtNum(list.length)} de ${fmtNum(state.detail.length)}`;
    $('showMore').classList.toggle('hidden', state.visible >= state.detail.length);
  }
  function resetFilters() {
    $('search').value = ''; $('slaMin').value = ''; $('slaMax').value = '';
    $('dateFilterGrid').querySelectorAll('input').forEach(el => {if(el.type === 'checkbox') el.checked=false; else el.value='';});
    for (const [id] of categories) state.selected[id] = new Set();
    state.selectedGroup = null;
    if (state.consolidated) {renderCategoricalFilters();updateAll();}
    $('dateErrors').textContent = '';
  }
  function clearData() {
    if (state.exports.length && !window.confirm('¿Vaciar los Excel cargados en esta sesión? No afecta otras secciones ni Supabase.')) return;
    state.exports=[];state.monitors=[];state.manualCatalog=[];state.consolidated=null;state.filtered=[];state.detail=[];state.groups=[];state.selectedGroup=null;state.selected={};
    $('filesExport').value='';$('filesMonitor').value='';$('filesPdv').value='';updateFiles();resetFilters();
    $('filtersCategorical').replaceChildren(); $('summaryBody').innerHTML='<tr><td colspan="7" class="empty">Carga una exportación para ver el resumen.</td></tr>';
    $('detailBody').innerHTML='<tr><td colspan="18" class="empty">Sin registros.</td></tr>';
    for(const id of ['kpiGuias','kpiMonitor','kpiSla','kpiSinMonitor','kpiSinArea'])$(id).textContent='0';
    $('exportBtn').disabled=true;$('resultSummary').textContent='';$('detailCount').textContent='';$('showingCount').textContent='';
    $('showMore').classList.add('hidden');$('showSummaryMore').classList.add('hidden');$('clearGroup').classList.add('hidden');
    status('Datos locales vaciados. Puedes realizar una nueva carga.');
  }
  function exportXlsx() {
    if (!state.consolidated?.rows.length) return;
    if (!window.XLSX) { status('No se pudo cargar XLSX para descargar Excel. Comprueba tu conexión.', 'error'); return; }
    const now = Date.now();
    const groups = C.summarize(state.filtered,now);
    const summary = [['Área','Punto de escaneo más reciente','Guías','Con SLA','Sin SLA','Promedio cola larga (días)','Promedio SLA (días)'],
      ...groups.map(g=>[g.area,g.punto,g.total,g.countSla,g.sinSla,g.promedioCola==null?'':+g.promedioCola.toFixed(8),g.promedioSla==null?'':+g.promedioSla.toFixed(8)])];
    const header = ['Número de Guía','Área','Región','Encargado','Punto de escaneo más reciente','PDV de entrega','Área PDV destino','Tipo de escaneo','Tiempo de entrada','Días cola larga','Hora salida HUB','Días desde HUB','Hora llegada PDV','Días desde PDV','Tiempo despacho','Días desde despacho','Estado SLA','SLA días','Provincia destino','Ciudad destino','Colonia destino','Estatus firma','Repartidor','Archivo exportación','Archivo monitoreo'];
    const detail = [header,...state.detail.map(r=>[
      r.guia,r.area,r.region,r.encargado,r.punto,r.pdv,r.areaDestino,r.tipo,
      C.formatPeru(r.tiempoEntrada)==='—'?'':C.formatPeru(r.tiempoEntrada,true), n(r.tiempoEntrada),
      C.formatPeru(r.salidaHub)==='—'?'':C.formatPeru(r.salidaHub,true), n(r.salidaHub),
      C.formatPeru(r.llegadaPdv)==='—'?'':C.formatPeru(r.llegadaPdv,true), n(r.llegadaPdv),
      C.formatPeru(r.tiempoDespacho)==='—'?'':C.formatPeru(r.tiempoDespacho,true), n(r.tiempoDespacho),
      r.estadoSla,n(r.inicioSla),r.provincia,r.ciudad,r.colonia,r.firma,r.repartidor,r.archivoExportacion,r.archivoMonitoreo
    ])];
    function n(t) {const v=C.elapsedDays(t,now);return v==null?'':+v.toFixed(8);}
    const wb = XLSX.utils.book_new();
    const sh1 = XLSX.utils.aoa_to_sheet(summary),sh2 = XLSX.utils.aoa_to_sheet(detail);
    sh1['!cols']=[{wch:21},{wch:32},{wch:12},{wch:12},{wch:12},{wch:25},{wch:24}];
    sh2['!cols']=header.map((h,i)=>({wch:i===0?21:i>=8&&i<=17?23:21}));
    for (const [sh,columns] of [[sh1,[5,6]],[sh2,[9,11,13,15,17]]]) {
      const range=XLSX.utils.decode_range(sh['!ref']);
      for(let row=1;row<=range.e.r;row++)for(const col of columns){const cell=sh[XLSX.utils.encode_cell({r:row,c:col})];if(cell?.t==='n')cell.z='0.00000000';}
      sh['!autofilter']={ref:XLSX.utils.encode_range({s:{r:0,c:0},e:{r:range.e.r,c:range.e.c}})};
    }
    XLSX.utils.book_append_sheet(wb,sh1,'Resumen');XLSX.utils.book_append_sheet(wb,sh2,'Detalle');
    const stamp=C.formatPeru(now).slice(0,10).replace(/-/g,'');
    XLSX.writeFile(wb,`Seguimiento_General_Guias_${stamp}.xlsx`);
  }
  async function init() {
    renderDateFilters();
    for(const id of ['filesExport','filesMonitor','filesPdv'])$(id).addEventListener('change',updateFiles);
    $('loadBtn').addEventListener('click',load);
    $('clearData').addEventListener('click',clearData);
    $('clearFilters').addEventListener('click',resetFilters);
    $('clearGroup').addEventListener('click',()=>{state.selectedGroup=null;state.detail=state.filtered.slice();state.visible=150;sortDetails();renderSummary();renderDetail();renderKpis();});
    $('search').addEventListener('input',scheduleUpdate);
    $('slaMin').addEventListener('input',scheduleUpdate);$('slaMax').addEventListener('input',scheduleUpdate);
    $('sortBy').addEventListener('change',()=>{sortDetails();renderDetail();});
    $('exportBtn').addEventListener('click',exportXlsx);
    $('showMore').addEventListener('click',()=>{state.visible+=150;renderDetail();});
    $('showSummaryMore').addEventListener('click',()=>{state.groupVisible+=250;renderSummary();});
    document.addEventListener('click',e=>{if(!e.target.closest('.multi-filter'))document.querySelectorAll('.multi-filter details[open]').forEach(d=>d.open=false);});
    if(window.parent===window){$('authAlert').classList.remove('hidden');$('authAlert').textContent='Para utilizar el catálogo PDV LISTA de la plataforma, ingresa desde Gestión de guías V2 y abre la pestaña Seguimiento general. También puedes cargar PDV LISTA manualmente.';}
    await loadPortalCatalog();
    if(window.parent !== window && 'ResizeObserver' in window){
      const notifyHeight=()=>{try{window.parent.postMessage({type:'V16_SEGUIMIENTO_ALTURA',height:Math.ceil(document.documentElement.scrollHeight)},location.origin);}catch(_){}};
      new ResizeObserver(notifyHeight).observe(document.body);
      notifyHeight();
    }
    window.setInterval(()=>{if(state.consolidated && !state.reading)updateAll(true);},60_000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
