/* Centro Cobertura V1 - motor independiente, sin conexión de escritura a Supabase. */
(function(root){
'use strict';
const LIMITES=[48,72,96,120,144,168];
const PAGOS=[100,90,80,70,60,50,0];
const LABELS=['≤48 h','48–72 h','72–96 h','96–120 h','120–144 h','144–168 h','>168 h'];
const COLS={guia:['guia1','guia','numero de guia','numero guia','waybill_no'],pdv:['pdv_actual','pdv','punto de distribucion'],horas:['horas_48','horas','tiempo','horas logradas'],department:['receiver_province_name','departamento','dpto'],province:['receiver_city_name','provincia'],district:['distrito','receiver_area_name'],descarga:['descarga_pdv','descarga pdv'],firma:['firma_efectiva','firma efectiva'],pct:['porcentaje','% pago'],rango:['rango'],estado:['estado'],status:['status']};
function clean(v){return String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase().replace(/\s+/g,' ')}
function normKey(k){return clean(k).replace(/[^A-Z0-9]/g,'')}
function pdv(v){return clean(String(v??'').split('|')[0]).replace(/\.PDV$/,'').replace(/\s/g,'')}
function normGeo(v){return clean(v)}
function n(v){if(typeof v==='number')return v;let t=String(v??'').trim();if(!t)return NaN;t=t.replace(/\s/g,'');if(t.includes(',')&&!t.includes('.'))t=t.replace(',','.');else t=t.replace(/,/g,'');const r=Number(t);return Number.isFinite(r)?r:NaN}
function tramo(h){if(!Number.isFinite(h)||h<0)return -1;for(let i=0;i<LIMITES.length;i++)if(h<=LIMITES[i]+1e-9)return i;return 6}
function pago(h){const idx=tramo(h);return idx<0?null:PAGOS[idx]}
function mapCols(headers){const keys=headers.map(normKey);let idx={};for(const [field,opts] of Object.entries(COLS)){idx[field]=-1;for(const option of opts){const q=normKey(option);const j=keys.findIndex(x=>x===q||x.startsWith(q)&&q.length>8);if(j>=0){idx[field]=j;break}}}return idx}
function required(idx){return ['guia','pdv','horas','department','province','district'].filter(k=>idx[k]===-1)}
function displayDate(v){if(v===null||v===undefined||v==='')return '';if(typeof v==='number'){let d=new Date(Math.round((v-25569)*86400000));if(!isNaN(d))return d.toISOString().slice(0,10)}if(v instanceof Date&&!isNaN(v))return v.toISOString().slice(0,10);let s=String(v).trim();const m=s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);if(m)return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;const d=s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);if(d)return `${d[3]}-${d[2].padStart(2,'0')}-${d[1].padStart(2,'0')}`;return s}
function parseRecord(row,idx,src,rowNumber){const get=k=>idx[k]<0?'':row[idx[k]];
 const id=String(get('guia')??'').trim().toUpperCase(),h=n(get('horas'));
 if(!id)return {error:'Sin número de guía',fuente:src,fila:rowNumber};
 const p=pdv(get('pdv')),d=normGeo(get('department')),pr=normGeo(get('province')),di=normGeo(get('district'));
 if(!p||!d||!pr||!di||!Number.isFinite(h)||h<0)return {error:'PDV, destino u horas inválidos',guia:id,fuente:src,fila:rowNumber};
 const o={guia:id,pdv:p,department:d,province:pr,district:di,horas:h,descarga:displayDate(get('descarga')),firma:displayDate(get('firma')),origenPct:String(get('pct')||''),origenRango:String(get('rango')||''),estado:String(get('estado')||''),status:String(get('status')||''),fuente:src,fila:rowNumber};
 o.band=tramo(h);o.pago=PAGOS[o.band];o.signature=[p,d,pr,di,Number(h.toFixed(5)),o.descarga,o.firma].join('¦');
 return o}
function compile(rows,decisions){const map=new Map();const invalid=[];for(const r of rows){if(r.error){invalid.push(r);continue}if(!map.has(r.guia))map.set(r.guia,new Map());const g=map.get(r.guia);if(!g.has(r.signature))g.set(r.signature,r)}
 const valid=[],conflicts=[];let duplicated=0;
 for(const [guide,opts] of map){const entries=[...opts.values()];if(entries.length===1){valid.push(entries[0]);continue}
 const choose=entries.find(x=>x.signature===decisions[guide]);if(choose){valid.push(choose);continue}conflicts.push({guia:guide,options:entries})}
 // filas duplicadas exactas = registros válidos - variantes únicas
 const uniqueSignatures=[...map.values()].reduce((a,x)=>a+x.size,0);
 duplicated=rows.filter(x=>!x.error).length-uniqueSignatures;
 return {rows:valid,conflicts,invalid,duplicatesExact:duplicated,uniqueGuides:map.size}}
function passes(r,filters,guide=''){for(const fld of ['pdv','department','province','district']){const s=filters[fld];if(s&&s.size&&!s.has(r[fld]))return false}if(guide&&!r.guia.includes(guide.toUpperCase()))return false;return true}
function stats(list){let bands=Array(7).fill(0),sumH=0,sumP=0,dept=new Set(),prov=new Set(),dist=new Set();for(const r of list){bands[r.band]++;sumH+=r.horas;sumP+=r.pago;dept.add(r.department);prov.add(r.department+'¦'+r.province);dist.add(r.department+'¦'+r.province+'¦'+r.district)}const n=list.length;return{n,bands,avg:n?sumH/n:0,payAvg:n?sumP/n:0,depts:dept.size,provinces:prov.size,districts:dist.size}}
function groupPDV(list){const grouped=new Map();for(const r of list){if(!grouped.has(r.pdv))grouped.set(r.pdv,[]);grouped.get(r.pdv).push(r)}return [...grouped].sort((a,b)=>a[0].localeCompare(b[0],'es')).map(([pdv,rows])=>({pdv,rows,...stats(rows)}))}
function groupGeo(list){const grouped=new Map();for(const r of list){const key=[r.department,r.province,r.district].join('¦');if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(r)}return [...grouped].map(([key,rows])=>{const [department,province,district]=key.split('¦');return {department,province,district,rows,...stats(rows)}}).sort((a,b)=>a.department.localeCompare(b.department,'es')||a.province.localeCompare(b.province,'es')||a.district.localeCompare(b.district,'es'))}
const api={LIMITES,PAGOS,LABELS,COLS,normKey,pdv,normGeo,n,tramo,pago,mapCols,required,parseRecord,compile,passes,stats,groupPDV,groupGeo};
root.CentroCore=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window==='undefined'?globalThis:window);
