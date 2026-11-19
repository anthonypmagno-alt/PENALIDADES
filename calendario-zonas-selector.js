/* Calendario de incidencias V1.1 — Selector geográfico múltiple.
   Datos en calendario-zonas.js. El guardado conserva el contrato existente: [{dept,prov,dist}]. */
(function (root) {
  'use strict';
  const safe = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uniq = iterable => Array.from(new Set(iterable));
  const normDefault = value => String(value ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ');

  function create({source = [], normalize = normDefault, t = k => k} = {}) {
    const $ = id => document.getElementById(id);
    const norm = value => normalize(value);
    const toZone = z => {
      if (Array.isArray(z)) return {dept:norm(z[0]),prov:norm(z[1]),dist:norm(z[2])};
      if (typeof z === 'string') {
        const [dept,prov,dist] = z.split('|'); return {dept:norm(dept),prov:norm(prov),dist:norm(dist)};
      }
      return {dept:norm(z?.dept || z?.departamento),prov:norm(z?.prov || z?.provincia),dist:norm(z?.dist || z?.distrito)};
    };
    const key = z => `${z.dept}|${z.prov}|${z.dist}`;
    const registry = new Map();
    for(const original of source){const z=toZone(original);if(z.dept&&z.prov&&z.dist)registry.set(key(z),z);}
    const selected = new Set();
    const filters = {dept:new Set(),prov:new Set(),dist:new Set()};
    const queryIds={dept:'geoDeptSearch',prov:'geoProvSearch',dist:'geoDistSearch'};
    const boxIds={dept:'geoDeptOptions',prov:'geoProvOptions',dist:'geoDistOptions'};
    const getQuery=level=>norm($(queryIds[level])?.value||'');
    const sorted=()=>Array.from(registry.values()).sort((a,b)=>a.dept.localeCompare(b.dept,'es')||a.prov.localeCompare(b.prov,'es')||a.dist.localeCompare(b.dist,'es'));
    function getFilterKey(z,level){return level==='dept'?z.dept:level==='prov'?`${z.dept}|${z.prov}`:key(z);}
    function matches(z,skipLevel){
      for(const level of ['dept','prov','dist']){
        if(level===skipLevel) continue;
        const q=getQuery(level);
        if(q&&!z[level].includes(q))return false;
        if(filters[level].size&&!filters[level].has(getFilterKey(z,level)))return false;
      }
      return true;
    }
    function filteredZones(){
      const only=$('zoneOnlySelected')?.checked;
      return sorted().filter(z=>matches(z,null)&&(!only||selected.has(key(z))));
    }
    function drawOptions(level,rows){
      const map=new Map();
      for(const z of rows){
        const k=getFilterKey(z,level);
        if(!map.has(k)) map.set(k,level==='dept'?z.dept:level==='prov'?`${z.prov} · ${z.dept}`:`${z.dist} · ${z.prov}`);
      }
      const options=Array.from(map).filter(([k,label])=>{
        const q=getQuery(level);
        return !q||norm(level==='dept'?k:level==='prov'?k.split('|')[1]:k.split('|')[2]).includes(q);
      }).sort((a,b)=>a[1].localeCompare(b[1],'es'));
      const limit=level==='dept'?60:140;
      $(boxIds[level]).innerHTML=options.slice(0,limit).map(([k,label])=>`<label><input type="checkbox" data-geo-filter="${level}" data-geo-key="${safe(k)}" ${filters[level].has(k)?'checked':''}><span>${safe(label)}</span></label>`).join('')||`<div class="geo-empty">${safe(t('noResults'))}</div>`;
      if(options.length>limit)$(boxIds[level]).insertAdjacentHTML('beforeend',`<div class="geo-empty">${safe(t('showingOptions'))}: ${limit}/${options.length}</div>`);
    }
    function render(){
      const all=sorted();
      for(const level of ['dept','prov','dist'])drawOptions(level,all.filter(z=>matches(z,level)));
      const matching=filteredZones(),lim=160;
      $('zoneFilteredCount').textContent=`${matching.length.toLocaleString('es-PE')} ${t('matches')}`;
      $('geoZoneList').innerHTML=matching.slice(0,lim).map(z=>{
        const id=key(z),checked=selected.has(id);
        return `<label class="${checked?'checked':''}"><input type="checkbox" data-zone-key="${safe(id)}" ${checked?'checked':''}><span>${safe(z.dept)} / ${safe(z.prov)} / <strong>${safe(z.dist)}</strong></span></label>`;
      }).join('')||`<div class="geo-empty">${safe(t('noResults'))}</div>`;
      if(matching.length>lim)$('geoZoneList').insertAdjacentHTML('beforeend',`<div class="geo-empty">${safe(t('showingOptions'))}: ${lim}/${matching.length}. ${safe(t('selectAllHint'))}</div>`);
      $('zoneSelectedCount').textContent=`${selected.size.toLocaleString('es-PE')} ${t('selectedZones')}${!selected.size?' · '+t('allDistrictsHint'):''}`;
      const chips=Array.from(selected).sort().slice(0,32);
      $('zonePreview').innerHTML=chips.map(k=>`<span class="zone-chip"><span>${safe(k.replace(/\|/g,' / '))}</span><button type="button" data-remove-zone="${safe(k)}" title="${safe(t('removeOne'))}" aria-label="${safe(t('removeOne'))}">×</button></span>`).join('')+(selected.size>chips.length?`<span class="geo-empty">+${selected.size-chips.length}</span>`:'');
    }
    function setZones(zones=[]){
      selected.clear();for(const level of ['dept','prov','dist'])filters[level].clear();
      for(const id of Object.values(queryIds))$(id).value='';
      $('zoneOnlySelected').checked=false;
      for(const raw of zones){const z=toZone(raw);if(z.dept&&z.prov&&z.dist){registry.set(key(z),z);selected.add(key(z));}}
      render();
    }
    function getZones(){return Array.from(selected).sort().map(k=>registry.get(k)).filter(Boolean).map(z=>({...z}));}
    function register(){
      for(const level of ['dept','prov','dist']){
        $(queryIds[level]).addEventListener('input',render);
        $(boxIds[level]).addEventListener('change',e=>{
          const c=e.target.closest('input[data-geo-filter]');if(!c)return;
          if(c.checked)filters[level].add(c.dataset.geoKey);else filters[level].delete(c.dataset.geoKey);
          render();
        });
      }
      $('geoZoneList').addEventListener('change',e=>{
        const c=e.target.closest('input[data-zone-key]');if(!c)return;
        c.checked?selected.add(c.dataset.zoneKey):selected.delete(c.dataset.zoneKey);
        render();
      });
      $('zoneSelectFiltered').addEventListener('click',()=>{
        const list=filteredZones();
        if(list.length>300&&!window.confirm(`${t('confirmMany')} ${list.length}?`))return;
        for(const z of list)selected.add(key(z));render();
      });
      $('zoneRemoveFiltered').addEventListener('click',()=>{for(const z of filteredZones())selected.delete(key(z));render();});
      $('zoneClear').addEventListener('click',()=>{if(selected.size>100&&!window.confirm(t('confirmClear')))return;selected.clear();render();});
      $('zoneOnlySelected').addEventListener('change',render);
      $('zonePreview').addEventListener('click',e=>{const btn=e.target.closest('[data-remove-zone]');if(!btn)return;selected.delete(btn.dataset.removeZone);render();});
      $('manualAddZone').addEventListener('click',()=>{
        const z={dept:norm($('manualDept').value),prov:norm($('manualProv').value),dist:norm($('manualDist').value)};
        if(!z.dept||!z.prov||!z.dist){window.alert(t('manualIncomplete'));return;}
        registry.set(key(z),z);selected.add(key(z));
        ['manualDept','manualProv','manualDist'].forEach(id=>$(id).value='');
        render();
      });
      render();
    }
    register();
    return {render,setZones,getZones,filteredZones,selectedCount:()=>selected.size,availableCount:()=>registry.size};
  }
  root.IncidenciasZonePicker={create};
})(window);
