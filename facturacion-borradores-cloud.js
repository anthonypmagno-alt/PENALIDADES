/* Facturacion V2.4 - borrador remoto privado, Storage + metadatos en Postgres.
   Mantiene IndexedDB como cache; nunca publica un borrador como liquidacion final. */
(function(root){'use strict';
 const Cloud=root.FacturacionCloud;
 const BUCKET='facturacion-borradores';
 function admin(){if(!Cloud.admin())throw Error('Solo administradores de Facturación pueden acceder a los borradores.');}
 function ok(response,context){if(response.error)throw Error(context+': '+response.error.message);return response.data;}
 function checkPeriod(period){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(period)))throw Error('Periodo inválido.');}
 async function meta(period){admin();checkPeriod(period);return ok(await Cloud.create().from('facturacion_borradores')
   .select('periodo,version,objeto,filas,bytes,comprimido,fuente,actualizado_en')
   .eq('periodo',period).maybeSingle(),'Leer borrador remoto');}
 function validate(source,period){
   if(!source||!Array.isArray(source.rows)||!source.rows.length||source.rows.length>500000)throw Error('Borrador vacío o con demasiadas guías.');
   checkPeriod(period);
   return {formato:'FACTURACION_PDV_BORRADOR_NUBE_V1',periodo:period,
     fuente:{rows:source.rows,stats:source.stats||{},headers:source.headers||[],
       file:source.file||'',uploadedAt:source.uploadedAt||''}};
 }
 async function makeBlob(data){
   const blob=new Blob([JSON.stringify(data)],{type:'application/json'});
   if(typeof CompressionStream==='function'){
     const stream=blob.stream().pipeThrough(new CompressionStream('gzip'));
     return {blob:await new Response(stream).blob(),compressed:true};
   }
   return {blob,compressed:false};
 }
 async function save(period,source,expectedVersion){
   admin();checkPeriod(period);
   const v=Number(expectedVersion);
   if(!Number.isInteger(v)||v<0)throw Error('Se necesita la versión remota conocida antes de guardar.');
   const payload=validate(source,period),file=await makeBlob(payload);
   if(file.blob.size>45*1024*1024)throw Error('Borrador superior a 45 MB. Reduce el Excel antes de sincronizar.');
   const uid=Cloud.user()?.id;
   const stamp=root.crypto?.randomUUID?.()||`${Date.now()}_${Math.floor(Math.random()*1e9)}`;
   const path=`periodos/${period}/${String(uid).replace(/-/g,'')}_${String(stamp).replace(/-/g,'')}.json${file.compressed?'.gz':''}`;
   const storage=Cloud.create().storage.from(BUCKET);
   const uploaded=await storage.upload(path,file.blob,{upsert:false,contentType:file.compressed?'application/gzip':'application/json',cacheControl:'0'});
   ok(uploaded,'Subir borrador a Supabase Storage');
   try{
     const saved=ok(await Cloud.create().rpc('facturacion_guardar_borrador',{
       p_periodo:period,p_version_esperada:v,p_objeto:path,p_filas:source.rows.length,
       p_bytes:file.blob.size,p_comprimido:file.compressed,p_fuente:source.file||''
     }),'Confirmar versión del borrador');
     const item=Array.isArray(saved)?saved[0]:saved;
     if(!item?.version)throw Error('Supabase no confirmó la versión del borrador.');
     return item;
   }catch(e){
     // El archivo nuevo no está referenciado porque la transacción falló.
     // No borrar archivos antiguos ni datos de otro administrador.
     try{await storage.remove([path]);}catch(_){/* basura recuperable manualmente */}
     throw e;
   }
 }
 async function download(record){
   admin();if(!record?.objeto||!record?.periodo)throw Error('No hay borrador remoto disponible.');
   const res=ok(await Cloud.create().storage.from(BUCKET).download(record.objeto),'Descargar borrador de Supabase');
   let json;
   if(record.comprimido){
     if(typeof DecompressionStream!=='function')throw Error('Este navegador no permite abrir borradores gzip. Usa Chrome/Edge actualizado.');
     json=await new Response(res.stream().pipeThrough(new DecompressionStream('gzip'))).text();
   }else json=await res.text();
   const data=JSON.parse(json);
   if(data?.formato!=='FACTURACION_PDV_BORRADOR_NUBE_V1'||data.periodo!==record.periodo||
      !Array.isArray(data.fuente?.rows)||data.fuente.rows.length!==record.filas)throw Error('El contenido remoto no coincide con el periodo o la cantidad de guías.');
   return data.fuente;
 }
 root.FacturacionBorradores={meta,save,download};
})(window);
