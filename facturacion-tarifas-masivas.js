/* Facturación PDV V2.9 — importación/exportación de tarifario R4.
 * No realiza operaciones remotas: validar/normalizar antes de guardar es obligatorio.
 */
(function(root){'use strict';
const M=root.FacturacionMotor;
const norm=v=>M.norm(v),pdvNorm=v=>M.normalizePDV(v),geo=(a,b,c)=>M.districtKey(a,b,c);
const header=v=>norm(v).replace(/[^A-Z0-9\u3400-\u9FFF]/g,'');
const safeExcel=v=>typeof v==='string'&&/^[=+@\-\t\r]/.test(v)?"'"+v:v;
function price(v){
 if(v===null||v===undefined||v==='')return null;
 if(typeof v==='string'){
  v=v.trim().replace(/^S\/?\s*/i,'').replace(/\s/g,'');
  if(/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(v))v=v.replace(/\./g,'').replace(',','.');
  else if(/^\d+,\d{1,2}$/.test(v))v=v.replace(',','.');
  else if(!/^\d+(?:\.\d+)?$/.test(v))return null;
 }
 const n=Number(v);
 return Number.isFinite(n)&&n>=0&&n<=100000&&Math.abs(n*100-Math.round(n*100))<0.000001?Math.round(n*100)/100:null;
}
function matrixFromSheet(book,name){return root.XLSX.utils.sheet_to_json(book.Sheets[name],{header:1,defval:'',raw:true});}
function headerCols(row){
 const h=row.map(header),at=aliases=>h.findIndex(x=>aliases.includes(x));
 return {ubigeo:at(['UBIGEO','CODIGOUBIGEO']),dept:at(['DEPARTAMENTO','DEPARTMENT','DEP']),prov:at(['PROVINCIA','PROVINCE']),dist:at(['DISTRITO','DISTRICT']),pdv:at(['PDV','PUNTODEDISTRIBUCION','围栏网点PDV','围栏网点']),rate:at(['现有派费','TARIFA','TARIFAS','PRECIO','TARIFAZONAL','TARIFAESPECIALS','现有派费S']),mode:at(['MODALIDAD','MODO','MODE'])};
}
function detectR4(book){
 for(const n of [...book.SheetNames.filter(n=>norm(n)==='R4'),...book.SheetNames.filter(n=>norm(n)!=='R4')]){
  const matrix=matrixFromSheet(book,n);
  for(let i=0;i<Math.min(15,matrix.length);i++){
   const cols=headerCols(matrix[i]);if(['dept','prov','dist','pdv','rate'].every(k=>cols[k]>=0))return{sheet:n,headerRow:i+1,cols,matrix};
  }
 }
 throw Error('No se encontró una hoja con Departamento, Provincia, Distrito, PDV y tarifa. Usa el formato de la hoja R4.');
}
function parseWorkbook(book){
 const detected=detectR4(book),groups=new Map(),invalid=[],duplicates=[],conflictMap=new Map(),byKey=new Map();
 let sourceRows=0;const headerIndex=detected.headerRow;
 for(let i=headerIndex;i<detected.matrix.length;i++){
  const a=detected.matrix[i];if(!a||a.every(v=>v===null||v===undefined||String(v).trim()===''))continue;
  sourceRows++;
  const c=detected.cols,dept=norm(a[c.dept]),prov=norm(a[c.prov]),dist=norm(a[c.dist]),pdv=pdvNorm(a[c.pdv]),rate=price(a[c.rate]),row=i+1;
  if(!dept||!prov||!dist||!/^[A-Z0-9][A-Z0-9_.-]{1,50}$/.test(pdv)||rate===null){invalid.push({row,dept,prov,dist,pdv,value:a[c.rate]});continue;}
  const key=geo(dept,prov,dist),full=pdv+'|'+key,ubigeo=c.ubigeo>=0?String(a[c.ubigeo]??'').trim():'';
  const rec={row,pdv,key,dept,prov,dist,rate,ubigeo};
  const old=byKey.get(full);
  if(old){
   if(old.rate===rate)duplicates.push({row,original:old.row,pdv,key,rate});
   else{
    const found=conflictMap.get(full)||{pdv,key,dept,prov,dist,options:[{row:old.row,rate:old.rate}]};
    if(!found.options.some(v=>v.row===row))found.options.push({row,rate});conflictMap.set(full,found);
   }
  }else byKey.set(full,rec);
 }
 for(const full of conflictMap.keys())byKey.delete(full);
 for(const r of byKey.values()){
  if(!groups.has(r.pdv))groups.set(r.pdv,{pdv:r.pdv,zones:{},ubigeos:{}});
  groups.get(r.pdv).zones[r.key]=r.rate;
  if(r.ubigeo)groups.get(r.pdv).ubigeos[r.key]=r.ubigeo;
 }
 const standardSheet=book.SheetNames.find(n=>norm(n)==='ESTANDAR_PDV');
 const standardConflicts=[];let standardRows=0;
 if(standardSheet){
  const matrix=matrixFromSheet(book,standardSheet);
  const h=(matrix[0]||[]).map(header),pc=h.findIndex(x=>x==='PDV'),sc=h.findIndex(x=>['TARIFAESTANDARS','TARIFAESTANDAR','ESTANDAR','STANDARD','TARIFABASE'].includes(x)),mc=h.findIndex(x=>['MODALIDAD','MODE'].includes(x));
  if(pc<0||sc<0)throw Error('La hoja ESTANDAR_PDV requiere las columnas PDV y TARIFA ESTANDAR S/.');
  const seen=new Map();
  for(let i=1;i<matrix.length;i++){
   const row=matrix[i];if(!row||row.every(v=>v==null||String(v).trim()===''))continue;
   const pdv=pdvNorm(row[pc]),raw=row[sc],standard=price(raw),mode=mc>=0?norm(row[mc]):'';
   if(!pdv||!/^[A-Z0-9][A-Z0-9_.-]{1,50}$/.test(pdv)||(!(raw===''||raw==null)&&standard===null)|| (mode&& !['ZONAL','ESTANDAR'].includes(mode))){
    invalid.push({row:i+1,sheet:standardSheet,pdv,value:raw});continue;
   }
   standardRows++;
   const entry={standard,mode,row:i+1};
   if(seen.has(pdv)&&JSON.stringify(seen.get(pdv))!==JSON.stringify(entry)){
    // Ignore row number when assessing duplicates.
    const prev=seen.get(pdv);
    if(prev.standard!==entry.standard||prev.mode!==entry.mode)standardConflicts.push({pdv,first:prev.row,second:i+1});
   }else if(!seen.has(pdv))seen.set(pdv,entry);
  }
  for(const c of standardConflicts)seen.delete(c.pdv);
  for(const [pdv,entry] of seen){
   if(!groups.has(pdv))groups.set(pdv,{pdv,zones:{},ubigeos:{}});
   // A blank standard in export means: preserve current value rather than clear it.
   if(entry.standard!==null)groups.get(pdv).standard=entry.standard;
   if(entry.mode)groups.get(pdv).mode=entry.mode;
  }
 }
 const entries=[...groups.values()].filter(x=>Object.keys(x.zones).length||Object.hasOwn(x,'standard')).sort((a,b)=>a.pdv.localeCompare(b.pdv));
 return {sheet:detected.sheet,sourceRows,valid:[...byKey.values()],invalid,duplicates,conflicts:[...conflictMap.values()],standardConflicts,standardRows,entries};
}
function workbookExport(XLSX,period,tariffs,guideRows=[]){
 const book=XLSX.utils.book_new(),tariffEntries=Object.entries(tariffs||{}).sort(([a],[b])=>a.localeCompare(b));
 const r4=[['UBIGEO','Departamento','Provincia','Distrito','围栏网点/ PDV','现有派费']];
 const standard=[['PDV','MODALIDAD','TARIFA ESTANDAR S/']];
 const known=new Map();
 for(const r of guideRows||[])known.set(pdvNorm(r.pdv)+'|'+geo(r.dept,r.prov,r.dist),r.ubigeo||'');
 for(const [pdv,t] of tariffEntries){
  standard.push([safeExcel(pdv),safeExcel(t.mode||'ESTANDAR'),t.standard??'']);
  for(const [key,value] of Object.entries(t.mode==='ZONAL'?(t.zones||{}):{}).sort(([a],[b])=>a.localeCompare(b))){
   const rate=price(value);if(rate===null)continue;
   const parts=key.split('|');if(parts.length!==3)continue;
   r4.push([(t.ubigeos?.[key]||known.get(pdv+'|'+key)||''),...parts.map(safeExcel),safeExcel(pdv),rate]);
  }
 }
 const notes=[['FORMATO','R4 / Tarifa zonal por PDV y distrito'],['PERIODO',period],['USO','Edita únicamente la hoja R4 y, si necesitas cambiar las tarifas estándar, ESTANDAR_PDV.'],['CARGA','La importación añade/actualiza las zonas presentes sin borrar las demás.'],['DUPLICADOS','Misma combinación PDV + departamento + provincia + distrito con tarifas diferentes: se omite y se reporta.'],['UBIGEO','Opcional, se conserva en la exportación cuando la fuente contiene ese dato.'],['ESTANDAR_PDV','Tarifa base opcional; una celda vacía no borra la tarifa existente.'],['PERIODO','Las tarifas se guardan en el periodo seleccionado de Facturación, no se modifican cierres históricos.']];
 for(const [name,data] of [['R4',r4],['ESTANDAR_PDV',standard],['INSTRUCCIONES',notes]]){
  const sheet=XLSX.utils.aoa_to_sheet(data);
  sheet['!cols']=name==='R4'?[{wch:12},{wch:20},{wch:27},{wch:32},{wch:19},{wch:16}]:[{wch:28},{wch:54},{wch:28}];
  XLSX.utils.book_append_sheet(book,sheet,name);
 }
 return {book,rows:r4.length-1,pdvs:tariffEntries.length};
}
root.FacturacionTarifasMasivas={parseWorkbook,workbookExport,price,detectR4};
})(window);
