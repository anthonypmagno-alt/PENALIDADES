/* Facturación PDV - motor puro, sin dependencias de red ni almacenamiento. */
(function(root,factory){const m=factory();if(typeof module==='object'&&module.exports)module.exports=m;root.FacturacionMotor=m;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const norm=(v)=>String(v??'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').toUpperCase();
 const num=(v)=>{if(v===null||v===undefined||String(v).trim()==='')return null;if(typeof v==='number')return Number.isFinite(v)?v:null;let s=String(v).trim().replace(/\s/g,'');if(s.includes(',')&&!s.includes('.'))s=s.replace(',','.');else if(s.includes(',')&&s.includes('.'))s=s.lastIndexOf(',')>s.lastIndexOf('.')?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'');const x=Number(s);return Number.isFinite(x)?x:null;};
 const money=(v)=>Math.round((v+Number.EPSILON)*100)/100;
 const districtKey=(dept,prov,dist)=>[norm(dept),norm(prov),norm(dist)].join('|');
 const normalizePDV=v=>norm(v).split('|')[0].replace(/\.PDV$/,'').trim();
 const localKey=(period,dept,prov,dist,pdv)=>[period,districtKey(dept,prov,dist),norm(pdv)].join('|');
 const fmtDate=(v)=>{
  if(v==null||v==='')return '';
  if(v instanceof Date&&!isNaN(v))return v.toISOString().slice(0,10);
  if(typeof v==='number'&&v>20000&&v<100000){const d=new Date(Date.UTC(1899,11,30)+Math.floor(v)*86400000);return d.toISOString().slice(0,10);}
  const s=String(v).trim();let m=s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);if(m)return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  m=s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);if(m)return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return s;
 };
 const header=(name)=>norm(name).replace(/[^A-Z0-9]/g,'');
 const aliases={
  guia:['WAYBILLNO','NUMERODEGUIA','NUMEROGUIA','GUIA','NROGUIA','TRACKINGNUMBER'],
  dept:['RECEIVERPROVINCENAME','DEPARTAMENTO','DEPARTAMENTODEDESTINO','DPTO'],
  prov:['RECEIVERCITYNAME','PROVINCIA','PROVINCIADEDESTINO'],
  dist:['RECEIVERAREANAME','DISTRITO','DISTRITODEDESTINO','COLONIA','DESTINODISTRITO'],
  pdv:['PDV','PUNTODEDISTRIBUCION','PUNTODEENTREGA'],
  horas:['TIEMPO','HORAS','TIEMPOLOGRADO','TIEMPOHORAS'],
  fecha:['DIADEREPARTO','FECHADEREPARTO','FECHA','FECHAENTREGA']
 };
 function indexColumns(headers){const h=headers.map(header),found={};for(const [k,opts] of Object.entries(aliases)){found[k]=opts.map(a=>h.indexOf(a)).find(x=>x>=0)??-1;}return found;}
 function parseMatrix(matrix,period){if(!Array.isArray(matrix)||!matrix.length)throw Error('El Excel no contiene filas');let headAt=matrix.findIndex(r=>Array.isArray(r)&&r.some(c=>header(c)==='WAYBILLNO'||header(c)==='NUMERODEGUIA'||header(c)==='GUIA'));if(headAt<0)headAt=0;
  const cols=indexColumns(matrix[headAt]);const missing=['guia','dept','prov','dist','pdv','horas'].filter(k=>cols[k]<0);if(missing.length)throw Error('Faltan columnas obligatorias: '+missing.join(', ')+'. Encabezados recibidos: '+matrix[headAt].join(' | '));
  const res=[],seen=new Map();let invalid=0,duplicates=0,pdvConflicts=0,high=0,missingDate=0;const months={};
  for(let i=headAt+1;i<matrix.length;i++){const a=matrix[i];if(!Array.isArray(a)||a.every(x=>x==null||x===''))continue;const guia=norm(a[cols.guia]);const pdv=normalizePDV(a[cols.pdv]);const horas=num(a[cols.horas]);const dept=norm(a[cols.dept]);const prov=norm(a[cols.prov]);const dist=norm(a[cols.dist]);if(!guia||!pdv||!dept||!prov||!dist||horas===null||horas<0){invalid++;continue;}
   const fecha=cols.fecha>=0?fmtDate(a[cols.fecha]):'';if(!fecha)missingDate++;else if(/^\d{4}-\d{2}-\d{2}$/.test(fecha)){const mon=fecha.slice(0,7);months[mon]=(months[mon]||0)+1;}if(horas>720)high++;
   const row={guia,pdv,dept,prov,dist,horas,fecha,period};const key=guia; if(seen.has(key)){duplicates++;const idx=seen.get(key);const old=res[idx];if(old.pdv!==pdv)pdvConflicts++;if(fecha>=old.fecha)res[idx]=row;}else{seen.set(key,res.length);res.push(row);}
  }
  if(!res.length)throw Error('No se encontraron guías válidas. Revisa TIEMPO, PDV y destinos.');
  return {rows:res,stats:{valid:res.length,invalid,duplicates,pdvConflicts,high,missingDate,months,sourceRows:matrix.length-headAt-1},headers:matrix[headAt]};
 }
 function threshold(hours){if(hours==null||!Number.isFinite(hours)||hours<0)return null;return Math.max(48,Math.ceil((hours-1e-10)/24)*24);}
 function discount(hours,base,rule){const t=num(hours),b=num(base);if(t===null||b===null)return null;const step=num(rule?.step)??24,rate=num(rule?.rate)??10,max=num(rule?.maxExcess)??120;if(step<=0||rate<0||rate>100||max<0)throw Error('Regla de descuentos inválida.');const excess=Math.max(0,t-b);
  const forcedZero=excess>max+1e-9;const blocks=excess<=1e-9?0:1+Math.floor((excess+1e-9)/step);const percent=forcedZero?100:Math.min(100,blocks*rate);return{excess,blocks,discountPct:percent,payPct:100-percent,forcedZero};
 }
 // Escenario comparativo: no altera el neto real, la configuración ni el cierre.
 // Solo es comparable con liquidaciones reales cuando ambas tienen tarifa y tiempo base.
 function simulatedNet(detail,simBase,rule){
  const tarifa=num(detail?.tarifa),horas=num(detail?.horas),base=num(simBase);
  if(tarifa===null||tarifa<0||horas===null||base===null||base<=0||detail?.neto==null)return null;
  const d=discount(horas,base,rule);
  return d===null?null:money(tarifa*d.payPct/100);
 }
 function rank(rows,min=10){const bins=new Map();for(const row of rows){const k=districtKey(row.dept,row.prov,row.dist);let bin=bins.get(k);if(!bin){bin=new Map();bins.set(k,bin);}let b=bin.get(row.pdv);if(!b){b={pdv:row.pdv,sum:0,count:0};bin.set(row.pdv,b);}b.sum+=row.horas;b.count++;}
  const out={};for(const [k,binsPdv] of bins){const list=Array.from(binsPdv.values()).map(v=>({...v,avg:v.sum/v.count})).sort((a,b)=>a.avg-b.avg||a.pdv.localeCompare(b.pdv));out[k]={best:list.find(x=>x.count>=min)||null,options:list};}return out;
 }
 function establish(time,bestHours){const c=['consolidacion','retraslado','adicional'];const vals=c.map(k=>num(time?.[k]));const any=vals.some(v=>v!==null);if(any){if(vals.some(v=>v!==null&&v<0))throw Error('Los tiempos no pueden ser negativos.');return {hours:vals.reduce((s,v)=>s+(v??0),0),origin:'COMPONENTES'};}let manual=num(time?.manualBase);if(manual!==null&&manual>=0)return{hours:manual,origin:'MANUAL'};return{hours:bestHours??null,origin:bestHours==null?'SIN_REFERENCIA':'MEJOR_PDV'};}
 function getTariff(row,tariffs){let t=tariffs?.[row.pdv];if(!t)return{amount:null,origin:'SIN_TARIFA'};const dk=districtKey(row.dept,row.prov,row.dist);let val=t.mode==='ZONAL'?num(t.zones?.[dk]):null;if(val!==null&&val>=0)return{amount:val,origin:'ZONAL'};val=num(t.standard);return {amount:val!==null&&val>=0?val:null,origin:val==null?'SIN_TARIFA':'ESTANDAR'};}
 function run(rows,config,refRows){const min=Math.max(1,Math.floor(num(config?.minGuides)??10));const ranks=rank(refRows||rows,min);const groups=new Map();const details=[];const period=config?.period||'';
  for(const row of rows){const dk=districtKey(row.dept,row.prov,row.dist),lk=localKey(period,row.dept,row.prov,row.dist,row.pdv),benchmark=ranks[dk]?.best||null,time=config?.times?.[lk]||{},base=establish(time,benchmark?.avg??null),umb=threshold(base.hours),tariff=getTariff(row,config?.tariffs||{});const d=discount(row.horas,umb,config?.rule||{}),gross=tariff.amount,net=(gross!==null&&d!==null)?money(gross*d.payPct/100):null,off=(gross!==null&&net!==null)?money(gross-net):null;
   let g=groups.get(lk);if(!g){g={key:lk,dept:row.dept,prov:row.prov,dist:row.dist,pdv:row.pdv,count:0,timeSum:0,bestPDV:benchmark?.pdv||'',bestHours:benchmark?.avg??null,benchmarkCount:benchmark?.count??0,umbral:threshold(benchmark?.avg??null),consolidacion:num(time.consolidacion),retraslado:num(time.retraslado),adicional:num(time.adicional),necesario:num(time.necesario),manualBase:num(time.manualBase),establecido:base.hours,origen:base.origin,umbralEst:umb,observaciones:time.observaciones||'',tariffOrigin:tariff.origin,gross:0,discount:0,net:0,billable:0,excluded:0,breached:0,zero:0};groups.set(lk,g);}g.count++;g.timeSum+=row.horas;
   if(gross!==null&&d!==null){g.gross=money(g.gross+gross);g.discount=money(g.discount+off);g.net=money(g.net+net);g.billable++;if(d.excess>0)g.breached++;if(d.payPct===0)g.zero++;}else g.excluded++;
   details.push({ ...row,establecido:base.hours,origenTiempo:base.origin,umbralEst:umb,umbral:threshold(benchmark?.avg??null),mejorPDV:benchmark?.pdv||'',mejorTiempo:benchmark?.avg??null,tarifa:gross,tarifaTipo:tariff.origin,exceso:d?.excess??null,bloques:d?.blocks??null,reduccion:d?.discountPct??null,pagoPct:d?.payPct??null,descuento:off,neto:net,ceroMax:d?.forcedZero??false,estado:umb===null?'SIN TIEMPO BASE':gross===null?'SIN TARIFA':'CALCULADO'});
  }
  const summary=[...groups.values()].map(g=>({...g,promedio:g.timeSum/g.count})).sort((a,b)=>a.dept.localeCompare(b.dept)||a.prov.localeCompare(b.prov)||a.dist.localeCompare(b.dist)||a.pdv.localeCompare(b.pdv));
  const totals=summary.reduce((p,g)=>({guias:p.guias+g.count,bruto:money(p.bruto+g.gross),descuentos:money(p.descuentos+g.discount),neto:money(p.neto+g.net),calculadas:p.calculadas+g.billable,pendientes:p.pendientes+g.excluded,fuera:p.fuera+g.breached,cero:p.cero+g.zero}),{guias:0,bruto:0,descuentos:0,neto:0,calculadas:0,pendientes:0,fuera:0,cero:0});
  return{details,summary,totals,ranks};
 }
 return{norm,normalizePDV,num,money,districtKey,localKey,indexColumns,parseMatrix,threshold,discount,simulatedNet,rank,establish,getTariff,run};
});
