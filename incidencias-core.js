/* Calendario de incidencias - motor de solapamiento exacto en hora de Peru. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.IncidenciasCore=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const norm=v=>String(v??'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ');
 const pdv=v=>norm(v).split('|')[0].replace(/\.PDV$/,'');
 const loc=(a,b,c)=>[a,b,c].map(norm).join('|');
 // Excel JS Date serial is based on 1899-12-30; preserve calendar clock in Peru, no browser timezone inference.
 function limaMoment(value){
  if(value==null||value==='')return null;
  if(value instanceof Date){if(!Number.isFinite(value.getTime()))return null;const p=n=>String(n).padStart(2,'0');return limaMoment(`${value.getUTCFullYear()}-${p(value.getUTCMonth()+1)}-${p(value.getUTCDate())} ${p(value.getUTCHours())}:${p(value.getUTCMinutes())}:${p(value.getUTCSeconds())}`);}
  if(typeof value==='number'&&value>20000&&value<100000)return limaMoment(new Date(Date.UTC(1899,11,30)+Math.round(value*86400000)));
  const s=String(value).trim();
  if(/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(s)){const ms=Date.parse(s);return Number.isFinite(ms)?new Date(ms).toISOString():null;}
  let m=s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if(!m){m=s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);if(m)m=[m[0],m[3],m[2],m[1],m[4],m[5],m[6]];}
  if(!m)return null;
  const [y,mo,d,h,mi,se]=m.slice(1).map(Number),check=new Date(Date.UTC(y,mo-1,d,h,mi,se||0));
  if(y<2020||y>2100||check.getUTCFullYear()!==y||check.getUTCMonth()!==mo-1||check.getUTCDate()!==d||h>23||mi>59||se>59)return null;
  return new Date(Date.UTC(y,mo-1,d,h+5,mi,se||0)).toISOString();
 }
 function overlaps(row,events){
  const reception=Date.parse(row.recepcionAt||''),delivery=Date.parse(row.entregaAt||'');
  if(!Number.isFinite(reception)||!Number.isFinite(delivery)||delivery<=reception)return {hours:0,events:[],state:'SIN_FECHAS',segments:[]};
  const intervals=[],used=[];const point=pdv(row.pdv),zone=loc(row.dept,row.prov,row.dist);
  for(const e of events||[]){if(e.estado!=='APROBADO'||!(e.pdvs||[]).some(p=>pdv(p)===point))continue;
   const zones=Array.isArray(e.zonas)?e.zonas:[];
   if(zones.length&&!zones.some(z=>typeof z==='string'?norm(z)===zone:loc(z.dept||z.departamento,z.prov||z.provincia,z.dist||z.distrito)===zone))continue;
   const start=Math.max(reception,Date.parse(e.inicio||e.fecha_inicio||'')),end=Math.min(delivery,Date.parse(e.fin||e.fecha_fin||''));
   if(Number.isFinite(start)&&Number.isFinite(end)&&end>start){intervals.push([start,end]);used.push({id:e.id,titulo:e.titulo||'Incidencia'});}
  }
  intervals.sort((a,b)=>a[0]-b[0]);const merged=[];
  for(const [s,e] of intervals){const last=merged[merged.length-1];if(last&&s<=last[1])last[1]=Math.max(last[1],e);else merged.push([s,e]);}
  const ms=merged.reduce((acc,[s,e])=>acc+e-s,0);
  return {hours:ms/3600000,events:used,state:ms>0?'AFECTADA':'SIN_EVENTO',segments:merged};
 }
 function expandFor(row,events,base){const o=overlaps(row,events);return {...o,umbralAjustado:base==null?null:base+o.hours};}
 return {norm,pdv,loc,limaMoment,overlaps,expandFor};
});
