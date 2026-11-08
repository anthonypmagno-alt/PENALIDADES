from pathlib import Path
p=Path('/mnt/data/work_filter7/gestion-v2.html')
s=p.read_text(encoding='utf-8')
def rep(old,new,label):
 global s
 n=s.count(old)
 if n!=1: raise Exception(f'{label}: expected 1 got {n}')
 s=s.replace(old,new)
rep('Edición 20261108-COLA-DESDE-EXPORTACION-V3','Edición 20261108-FILTRO-COLA-DIAS-ENCARGADOS-V4','version')
rep('    .summary-toolbar{display:flex;', '''    .summary-cola-dias{display:flex;align-items:center;gap:7px;padding:5px 10px;border:1px solid #93c5fd;border-radius:8px;background:#eff6ff;color:#1e3a8a;font-size:12px;font-weight:800;white-space:nowrap}
    .summary-cola-dias input{width:82px;height:32px;padding:5px 8px;background:#fff;color:#0f172a;border:1px solid #94a3b8;border-radius:6px;font-size:12px}
    .summary-cola-dias:focus-within{box-shadow:0 0 0 2px #bfdbfe}
    .summary-cola-dias small{font-size:10px;font-weight:600;color:#475569}
    @media(max-width:560px){.summary-cola-dias{width:100%;justify-content:space-between}.summary-cola-dias input{flex:0 0 90px}}
    .summary-toolbar{display:flex;''','css')
rep('          <button type="button" id="btnSoloNoFinalizadas"', '''          <label class="summary-cola-dias" for="sDiasColaMin" title="Mostrar solo las guías de cola larga cuya antigüedad desde Tiempo de entrada supere los días indicados.">
            <span>Cola larga &gt; días</span>
            <input type="number" id="sDiasColaMin" min="0" step="any" inputmode="decimal" placeholder="Ej. 7" aria-label="Más de cuántos días de cola larga" oninput="programarFiltroDiasCola()" onchange="aplicarFiltroDiasCola()">
            <small>Mayor que</small>
          </label>
          <button type="button" id="btnSoloNoFinalizadas"''','filter UI')
rep('  function prepararFiltrosGuiaResumen(){', '''  // Filtra estrictamente >N días, medidos desde Tiempo de entrada.
  // Exige un caso real de cola larga: no interpreta una brecha como cola larga.
  function leerDiasMinimosColaResumen(){
    const el=document.getElementById("sDiasColaMin"),valor=String(el?.value||"").trim().replace(",",".");
    if(!valor)return null;
    const n=Number(valor);return Number.isFinite(n)&&n>=0?n:null;
  }
  function tieneCasoColaLarga(x){
    return Array.isArray(x?.casosResumen)&&x.casosResumen.some(c=>/^h(?:120o168|360|576a600|588a600|720)/.test(String(c?.categoria||"")));
  }
  function cumpleMinDiasColaResumen(x,minDias,ahoraMs){
    if(minDias===null)return true;
    if(!tieneCasoColaLarga(x))return false;
    const fecha=fechaEscaneoValida(x?.tiempoEntradaExportacion);
    return !!fecha && (ahoraMs-fecha.getTime())/86400000>minDias;
  }
  let timerFiltroDiasCola=null;
  function programarFiltroDiasCola(){
    clearTimeout(timerFiltroDiasCola);
    timerFiltroDiasCola=setTimeout(()=>aplicarFiltroDiasCola(),300);
  }
  function aplicarFiltroDiasCola(){
    clearTimeout(timerFiltroDiasCola);timerFiltroDiasCola=null;
    aplicarFiltrosResumen();
  }
  function prepararFiltrosGuiaResumen(){''','helpers')
rep('      noFinalizadas:soloNoFinalizadas\n', '      noFinalizadas:soloNoFinalizadas,\n      minDiasCola:leerDiasMinimosColaResumen(),\n      ahoraColaMs:Date.now()\n','capture')
rep('  function cumpleFiltrosGuiaResumen(x,f){\n    if(f.estadosExportacion.size', '  function cumpleFiltrosGuiaResumen(x,f){\n    if(!cumpleMinDiasColaResumen(x,f.minDiasCola,f.ahoraColaMs))return false;\n    if(f.estadosExportacion.size','predicate')
# Filter detail, hierarchy, selections consistently even when no summary-cell selected
rep('    const {cumpleEntrada,cumpleFecha}=crearPredicadosFechasGestion();', '''    const {cumpleEntrada,cumpleFecha}=crearPredicadosFechasGestion();
    const minDiasCola=leerDiasMinimosColaResumen(),ahoraColaMs=Date.now();''','detail capture')
rep("return coincideListaGuias(x,'gestion')&&cumpleEntrada(x)&&cumpleFecha(x)", "return coincideListaGuias(x,'gestion')&&cumpleMinDiasColaResumen(x,minDiasCola,ahoraColaMs)&&cumpleEntrada(x)&&cumpleFecha(x)",'detail predicate')
rep('    document.getElementById(\'buscar\').value=\'\';soloNoFinalizadas=false;', '    document.getElementById(\'buscar\').value=\'\';document.getElementById("sDiasColaMin").value="";soloNoFinalizadas=false;','regions reset')
rep('soloNoFinalizadas=false;soloCriticos=false;actualizarEtiquetaMulti("sArea");', 'soloNoFinalizadas=false;soloCriticos=false;document.getElementById("sDiasColaMin").value="";actualizarEtiquetaMulti("sArea");','clear filter')
rep('if(soloNoFinalizadas)partes.push("no finalizadas");', 'const diasCola=leerDiasMinimosColaResumen();if(diasCola!==null)partes.push("cola larga >"+diasCola+" días");if(soloNoFinalizadas)partes.push("no finalizadas");','status')
# Critical-comment modal filters should use the captured predicate (fixes previously undefined f)
rep('    guias.filter(cumpleFiltrosGuiaResumen).forEach(x=>{', '    const filtrosResumenModal=prepararFiltrosGuiaResumen();\n    guias.filter(x=>cumpleFiltrosGuiaResumen(x,filtrosResumenModal)).forEach(x=>{','modal predicate')
# Comment editor in summary, only administrator allowed to save; encargado view-only
rep('  function abrirComentario(pdv){const x=(resumen.filas||[]).find(r=>r.pdv===pdv);if(!x)return;document.getElementById("commentModal").dataset.pdv=pdv;document.getElementById("commentText").value=x.comentario||"";aplicarIdiomaModalComentario();', '  function abrirComentario(pdv){const x=(resumen.filas||[]).find(r=>r.pdv===pdv);if(!x)return;document.getElementById("commentModal").dataset.pdv=pdv;document.getElementById("commentText").value=x.comentario||"";const soloLectura=sesion?.rol!=="ADMINISTRADOR";document.getElementById("commentText").readOnly=soloLectura;document.getElementById("btnSaveComment").hidden=soloLectura;aplicarIdiomaModalComentario();','summary comment read-only')
rep('  function guardarComentario(){\n    const pdv=', '  function guardarComentario(){\n    if(sesion?.rol!=="ADMINISTRADOR"){toast("Solo el administrador puede guardar el comentario del resumen.",false);return;}\n    const pdv=','summary comment guard')
rep('document.getElementById("btnSaveComment").textContent=t.save;', 'document.getElementById("btnSaveComment").textContent=t.save;document.getElementById("btnSaveComment").hidden=sesion?.rol!=="ADMINISTRADOR";','translation guard')
# In detail, remove solo (single-guide) "Guardar comentario" for encargado; mass tool still works.
rep('''<textarea id="comentario-gestion-${fila}" data-fila="${fila}" data-draft-field="comentarioGestionEncargado" maxlength="2000" placeholder="Comentario de gestión del encargado" ${comentarioGestionEncargadoDisponible?"":"disabled"}>${esc(notaActual)}</textarea><button type="button" id="guardar-comentario-gestion-${fila}" class="small" onclick="guardarComentarioGestionEncargado(${fila})" ${comentarioGestionEncargadoDisponible?"":"disabled"}>Guardar comentario</button><div class="manager-note-help">Solo el encargado puede editar este campo.</div>''', '''<div class="manager-note-display">${esc(x.comentarioGestionEncargado||"Sin comentario de gestión")}</div><div class="manager-note-help">Para actualizar, selecciona la guía y usa «Comentario de encargado» en gestión masiva.</div>''','detail manager button')
# update text so manager does not look like owner of single editor
rep('Comentario encargado · Administrador: solo lectura para el encargado. Comentario de gestión · Encargado: campo independiente por guía y PDV.', 'Comentario administrador: solo lectura para el encargado. Comentario de gestión: editable mediante la acción masiva del encargado.', 'manager help')
# Recurring filter refresh only when active, and only for the current content
rep("setInterval(()=>{\n for(const prefijo of ['fEntrada','excelEntrada'])", "setInterval(()=>{\n if(leerDiasMinimosColaResumen()!==null&&!document.hidden)aplicarFiltrosResumen(true);\n for(const prefijo of ['fEntrada','excelEntrada'])",'clock refresh')
p.write_text(s,encoding='utf-8')
print('Patched',p,'bytes',p.stat().st_size)
