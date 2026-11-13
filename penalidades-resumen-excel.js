/*
 * Penalidades · Exportacion RESUMEN por PENALIDAD x MOTIVO
 * Parche aditivo: no altera los datos, la autenticacion ni las funciones de Supabase.
 * Requiere que Penalidades exponga #breakdownBody dentro de su resumen actual.
 * XLSX: reutiliza SheetJS disponible en la pagina. Intenta aplicar estilos mediante
 * xlsx-js-style solo para este reporte y, si falla, exporta con el XLSX existente.
 */
(function (root) {
  'use strict';
  const BTN_ID = 'penalidadesExcelResumenMotivosBtn';
  const STORAGE_KEY = '__penalidadesExcelResumenStyleWriter';
  const STYLE_URL = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js';

  function cleanText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }
  function normalized(value) {
    return cleanText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  }
  function safeFilename(value) {
    return normalized(value).replace(/[^A-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);
  }
  function moneyCents(text) {
    let value = String(text == null ? '' : text).replace(/S\s*\/?\s*/gi, '').replace(/[^\d.,()\-]/g, '');
    if (!value) return 0;
    const negative = value.includes('-') || (value.startsWith('(') && value.endsWith(')'));
    value = value.replace(/[()\-]/g, '');
    // Aplicacion usa S/ 3,750.00. Se soporta tambien formato S/ 3.750,00.
    const lastDot = value.lastIndexOf('.'), lastComma = value.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) {
      value = lastDot > lastComma ? value.replace(/,/g, '') : value.replace(/\./g, '').replace(',', '.');
    } else if (lastComma >= 0) {
      const tail = value.length - lastComma - 1;
      value = tail <= 2 ? value.replace(',', '.') : value.replace(/,/g, '');
    } else if (lastDot >= 0) {
      const tail = value.length - lastDot - 1;
      if (tail > 2) value = value.replace(/\./g, '');
    }
    const amount = Number(value);
    if (!Number.isFinite(amount)) throw new Error('No se pudo leer un importe: ' + cleanText(text));
    return Math.round(amount * 100) * (negative ? -1 : 1);
  }
  function stripButtons(cell) {
    if (!cell) return '';
    const clone = cell.cloneNode(true);
    clone.querySelectorAll('button,input,svg').forEach(element => element.remove());
    return cleanText(clone.textContent);
  }
  function findColumn(headers, patterns, fallback) {
    const found = headers.findIndex(h => patterns.some(pattern => pattern.test(h)));
    return found < 0 ? fallback : found;
  }
  function extractSummary(doc) {
    const body = doc.querySelector('#breakdownBody');
    if (!body) throw new Error('No se encontró el resumen «Penalización y motivo de decisión» de esta versión de Penalidades.');
    const table = body.closest('table');
    const headers = [...(table?.querySelectorAll('thead th') || [])].map(th => normalized(th.textContent));
    const initial = findColumn(headers, [/PENALIDAD TOTAL/, /PENALIDAD INICIAL/, /MONTO INICIAL/], headers.length >= 9 ? 6 : 2);
    const final = findColumn(headers, [/^SALDO/, /PENALIDAD FINAL/, /MONTO FINAL/], headers.length >= 9 ? 8 : 3);
    if (initial === final || headers.length <= Math.max(initial, final)) {
      throw new Error('No se identificaron las columnas de Penalidad inicial y Penalidad final.');
    }
    const groups = new Map();
    let lastPenalty = '';
    for (const tr of [...body.querySelectorAll('tr')]) {
      const kind = tr.getAttribute('data-row-kind');
      if (kind && kind !== 'reason-group') continue;
      if (tr.matches('.breakdown-subrow, .summary-grand-total, .breakdown-grand-total, [data-grand-total="true"]')) continue;
      const cells = [...tr.querySelectorAll(':scope > td')];
      if (cells.length <= Math.max(initial, final)) continue;
      const penalty = cleanText(tr.getAttribute('data-penalty') || stripButtons(cells[0]) || lastPenalty);
      const reason = cleanText(stripButtons(cells[1])) || 'Sin motivo de decisión';
      if (!penalty || /^TOTAL GENERAL$/i.test(penalty) || /NO HAY PENALIDADES/i.test(penalty)) continue;
      lastPenalty = penalty;
      const initialCents = moneyCents(cells[initial].textContent);
      const finalCents = moneyCents(cells[final].textContent);
      const key = normalized(penalty) + '\u0000' + normalized(reason);
      if (!groups.has(key)) groups.set(key, { penalty, reason, initialCents: 0, finalCents: 0 });
      const row = groups.get(key);
      row.initialCents += initialCents;
      row.finalCents += finalCents;
    }
    if (!groups.size) throw new Error('No hay penalidades agrupadas para exportar. Abre una liquidación y espera a que se cargue el resumen.');
    const rows = [...groups.values()];
    return {
      rows,
      initialCents: rows.reduce((s, r) => s + r.initialCents, 0),
      finalCents: rows.reduce((s, r) => s + r.finalCents, 0)
    };
  }
  const CURRENCY = '"S/" #,##0.00;[Red]("S/" #,##0.00)';
  const GRID_COLOR = 'B9C4D0';
  function styleCell(cell, overrides) {
    if (!cell) return;
    cell.s = {
      fill: { patternType:'solid', fgColor: { rgb: overrides?.background || 'F0F3F6' } },
      font: { name:'Aptos', sz:10, color:{rgb: overrides?.color || '1A2D40'}, bold:!!overrides?.bold },
      alignment: { vertical:'center', horizontal: overrides?.align || 'left', wrapText:true },
      border: { bottom:{style:'thin', color:{rgb:GRID_COLOR}}, right:{style:'thin',color:{rgb:GRID_COLOR}} }
    };
  }
  function makeWorkbook(XLSX, summary) {
    // Formato tabular: una fila por PENALIDAD + MOTIVO, con todas las
    // etiquetas repetidas. Sin celdas combinadas ni jerarquías tipo pivote.
    // Los importes son números reales: se pueden sumar, filtrar o pivotar.
    const head = ['PENALIDAD', 'MOTIVO DE DECISIÓN', 'PENALIDAD INICIAL APLICADA (S/)', 'PENALIDAD FINAL (S/)'];
    const sortedRows = [...summary.rows].sort((a,b) =>
      a.penalty.localeCompare(b.penalty,'es') || a.reason.localeCompare(b.reason,'es'));
    const values = [head];
    sortedRows.forEach(r => values.push([r.penalty, r.reason, r.initialCents / 100, r.finalCents / 100]));
    // El total va debajo de los datos, fuera del Autofiltro, para no
    // contaminar una tabla dinámica o el recuento de filas filtradas.
    const totalIdx = values.length;
    values.push(['TOTAL GENERAL', '', summary.initialCents / 100, summary.finalCents / 100]);
    const ws = XLSX.utils.aoa_to_sheet(values);
    ws['!cols'] = [{wch:47}, {wch:64}, {wch:35}, {wch:26}];
    ws['!rows'] = values.map((_,idx) => ({hpt:idx===0?35:idx===totalIdx?27:24}));
    ws['!autofilter'] = {ref:'A1:D' + Math.max(2,totalIdx)};
    // Sin !merges: en un resumen tabular cada fila tiene su penalidad.
    // Encabezado azul, filas con bandas suaves y total destacado.
    for (let r=0; r<values.length; r++) for (let c=0; c<4; c++) {
      const addr = XLSX.utils.encode_cell({r,c});
      const cell = ws[addr];
      if (!cell) continue;
      const isHeader=r===0, isTotal=r===totalIdx;
      const background=isHeader?'255F8C':isTotal?'D9E6F3':r%2?'FFFFFF':'F0F5FA';
      styleCell(cell,{background,color:isHeader?'FFFFFF':'203448',bold:isHeader||isTotal,align:c>=2?'right':'left'});
      if (c>=2 && !isHeader){cell.z=CURRENCY;cell.t='n';}
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,'RESUMEN_TABULAR');
    wb.Props={Title:'Resumen tabular de penalidades por motivo',Subject:'Penalidad inicial y final por penalidad y motivo',Author:'Módulo Penalidades'};
    return wb;
  }
  async function getXLSXWriter() {
    if (root[STORAGE_KEY]) return root[STORAGE_KEY];
    const original = root.XLSX;
    if (!original?.utils?.aoa_to_sheet) throw new Error('No se cargó la biblioteca XLSX en Penalidades.');
    // La biblioteca XLSX del portal guarda datos correctamente, pero no siempre conserva colores.
    // Se intenta cargar xlsx-js-style para escribir el encabezado y el total con formato.
    try {
      const styled = await new Promise((resolve,reject)=>{
        const script=document.createElement('script');
        script.src=STYLE_URL;script.async=true;script.crossOrigin='anonymous';
        script.onload=()=>resolve(root.XLSX);
        script.onerror=()=>reject(new Error('No disponible'));
        document.head.appendChild(script);
      });
      root.XLSX=original;
      root[STORAGE_KEY]=styled?.utils?.aoa_to_sheet?styled:original;
    } catch(e) {root.XLSX=original;root[STORAGE_KEY]=original;}
    return root[STORAGE_KEY];
  }
  function contextFilename(doc){
    const subtitle=cleanText(doc.querySelector('#detailSubtitle')?.textContent);
    const tokens=subtitle.match(/20\d{2}[-/]\d{2}|(?:ANC|UCA|LIM|JUN|HUA|PAS|CAL)-[A-Z0-9]+/gi)||[];
    const suffix=tokens.map(safeFilename).filter(Boolean).join('_');
    return 'RESUMEN_TABULAR_PENALIDADES'+(suffix?'_'+suffix:'')+'.xlsx';
  }
  async function exportCurrent(doc, button) {
    if(doc.querySelector('#detailPanel')?.hidden)throw new Error('Selecciona primero una liquidación del módulo Penalidades.');
    const summary=extractSummary(doc);
    const writer=await getXLSXWriter();
    const wb=makeWorkbook(writer,summary);
    writer.writeFile(wb,contextFilename(doc),{bookType:'xlsx',compression:true});
    return {rows:summary.rows.length,total:summary.initialCents/100,final:summary.finalCents/100};
  }
  function notify(doc,message,error){
    let alert=doc.getElementById('penalidadesResumenExcelStatus');
    if(!alert){alert=doc.createElement('div');alert.id='penalidadesResumenExcelStatus';alert.setAttribute('role','status');alert.style.cssText='font-size:12px;max-width:480px;margin:4px 0;color:#1769aa;';const buttons=doc.querySelector('#detailPanel .detail-actions');buttons?.appendChild(alert);}
    alert.style.color=error?'#b42318':'#1769aa';alert.textContent=message;
  }
  function mount(doc) {
    if(doc.getElementById(BTN_ID))return true;
    const toolbar=doc.querySelector('#detailPanel .detail-actions');
    if(!toolbar||!doc.querySelector('#breakdownBody'))return false;
    const button=doc.createElement('button');button.type='button';button.id=BTN_ID;
    button.className='btn soft';button.textContent='Excel tabular: Penalidad × Motivo';
    button.title='Exporta una fila por penalidad y motivo, sin combinar celdas, con los filtros actuales.';
    button.addEventListener('click',async()=>{
      if(button.disabled)return;
      button.disabled=true;const oldText=button.textContent;button.textContent='Preparando Excel…';
      try{
        const report=await exportCurrent(doc,button);
        notify(doc,`Excel generado: ${report.rows} combinaciones; penalidad inicial S/ ${report.total.toFixed(2)} y final S/ ${report.final.toFixed(2)}.`,false);
      }catch(error){notify(doc,error?.message||String(error),true);}
      finally{button.disabled=false;button.textContent=oldText;}
    });
    const regular=doc.getElementById('exportXlsxBtn');
    if(regular) regular.insertAdjacentElement('afterend',button);
    else toolbar.appendChild(button);
    return true;
  }
  function install(doc) {
    if(mount(doc))return;
    const observer = new MutationObserver(()=>{if(mount(doc))observer.disconnect();});
    observer.observe(doc.documentElement,{childList:true,subtree:true});
  }
  root.PenalidadesResumenExcel = {extractSummary,makeWorkbook,moneyCents,install};
  if(typeof module==='object'&&module?.exports)module.exports={extractSummary,makeWorkbook,moneyCents};
  if(typeof document!=='undefined'){
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>install(document),{once:true});
    else install(document);
  }
})(typeof window!=='undefined'?window:globalThis);
