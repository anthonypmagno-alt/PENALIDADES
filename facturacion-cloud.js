/* Facturación PDV V2.1: Auth compartida (v16-replica-auth), consultas RLS y sincronización. */
(function (root) {
  'use strict';
  let client = null;
  let profile = null;
  let currentUser = null;
  const TABLES = {
    members: 'facturacion_usuarios', config: 'facturacion_configuracion',
    tariffs: 'facturacion_tarifas', times: 'facturacion_tiempos',
    settlements: 'facturacion_liquidaciones', private: 'facturacion_cierres_privados',
    summary: 'facturacion_resumen', detail: 'facturacion_detalle', reviews: 'facturacion_revisiones'
  };
  function ensure(result, context = 'Supabase') {
    if (result.error) throw new Error(context + ': ' + result.error.message);
    return result.data;
  }
  function create() {
    if (client) return client;
    const cfg = root.V16_CONFIG;
    if (!cfg || !/^https:\/\//i.test(cfg.url || '') || !cfg.key) {
      throw new Error('No se encontró V16_CONFIG.url/key. Conserva el config.js público de tu plataforma junto a facturacion.html; nunca uses service_role.');
    }
    if (!root.supabase || !root.supabase.createClient) {
      throw new Error('No se pudo cargar supabase-js. Revisa el acceso al CDN.');
    }
    client = root.supabase.createClient(cfg.url, cfg.key, {
      auth: { storageKey: 'v16-replica-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    client.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') {
        profile = null; currentUser = null;
        root.dispatchEvent(new CustomEvent('facturacion-sesion-cerrada'));
      }
    });
    return client;
  }
  async function refreshProfile() {
    const c = create();
    const userResult = await c.auth.getUser();
    if (userResult.error || !userResult.data?.user) { profile = null; currentUser = null; return null; }
    currentUser = userResult.data.user;
    const data = ensure(await c.from(TABLES.members)
      .select('user_id,rol,pdvs,activo')
      .eq('user_id', currentUser.id).maybeSingle(), 'Consultar acceso a Facturación');
    if (!data?.activo) { profile = null; return null; }
    profile = data;
    return profile;
  }
  async function restore() {
    const c = create();
    const { data, error } = await c.auth.getSession();
    if (error) throw error;
    if (!data?.session) return null;
    return refreshProfile();
  }
  async function login(loginName, password) {
    const c = create();
    const value = String(loginName || '').trim().toLowerCase();
    const domain = root.V16_CONFIG?.loginDomain;
    if (!value) throw Error('Ingresa el usuario o correo.');
    if (!value.includes('@') && !domain) throw Error('No está definido loginDomain en config.js; usa tu correo completo.');
    const email = value.includes('@') ? value : value + '@' + domain;
    ensure(await c.auth.signInWithPassword({email, password}), 'Inicio de sesión');
    const p = await refreshProfile();
    if (!p) {
      await c.auth.signOut();
      throw Error('Usuario válido en Supabase Auth, pero sin permiso activo de Facturación. Solicita al administrador que asigne tu UID.');
    }
    return p;
  }
  async function logout() {
    await create().auth.signOut();
    profile = null; currentUser = null;
  }
  function requireProfile() {
    if (!profile) throw Error('No hay sesión autorizada en Facturación.');
    return profile;
  }
  function admin() { return !!profile && profile.rol === 'ADMINISTRADOR'; }
  function assertAdmin() {
    requireProfile();
    if (!admin()) throw Error('Solo el administrador de Facturación puede realizar esta operación.');
  }
  async function allPages(table, columns, addFilters, limit = 500) {
    requireProfile();
    const out = [];
    for (let offset = 0; ; offset += limit) {
      let query = create().from(table).select(columns).range(offset, offset + limit - 1);
      if (addFilters) query = addFilters(query);
      const data = ensure(await query, 'Consulta ' + table);
      out.push(...(data || []));
      if ((data || []).length < limit) return out;
    }
  }
  async function loadConfig(period) {
    requireProfile();
    const c = create();
    const [cfg, rates, times] = await Promise.all([
      c.from(TABLES.config).select('regla,minimo_guias,periodo_referencia').eq('periodo', period).maybeSingle(),
      allPages(TABLES.tariffs, 'pdv,datos', q => q.eq('periodo', period).order('pdv',{ascending:true})),
      allPages(TABLES.times, 'clave,datos', q => q.eq('periodo', period).order('clave',{ascending:true}))
    ]);
    const settings = ensure(cfg, 'Configuración');
    return {
      rule: {rate:10, step:24, maxExcess:120, ...(settings?.regla || {})},
      minGuides: settings?.minimo_guias ?? 10,
      refPeriod: settings?.periodo_referencia || period,
      tariffs: Object.fromEntries(rates.map(r => [r.pdv, r.datos])),
      times: Object.fromEntries(times.map(r => [r.clave, r.datos]))
    };
  }
  async function saveRules(period, rule, minGuides, refPeriod) {
    assertAdmin();
    ensure(await create().from(TABLES.config).upsert({
      periodo: period, regla: rule, minimo_guias: minGuides, periodo_referencia: refPeriod || period
    }, {onConflict:'periodo'}), 'Guardar reglas');
  }
  async function saveTariff(period, pdv, data) {
    assertAdmin();
    return ensure(await create().from(TABLES.tariffs).upsert({periodo:period,pdv,datos:data},
      {onConflict:'periodo,pdv'}).select('periodo,pdv,datos').single(), 'Guardar tarifa');
  }
  async function saveTime(period, summaryRow, data) {
    assertAdmin();
    return ensure(await create().from(TABLES.times).upsert({
      periodo:period, clave:summaryRow.key, pdv:summaryRow.pdv,
      departamento:summaryRow.dept, provincia:summaryRow.prov, distrito:summaryRow.dist,
      datos:data
    }, {onConflict:'periodo,clave'}).select('periodo,clave,datos').single(), 'Guardar tiempo');
  }
  async function loadReviews(period) {
    assertAdmin();
    return allPages(TABLES.reviews,'periodo,clave,pdv,aprobado_ok,aprobado_por,aprobado_en,huella',
      q=>q.eq('periodo',period).order('clave',{ascending:true}));
  }
  async function saveReview(period, row, approved, fingerprint='') {
    assertAdmin();
    const payload={periodo:period,clave:row.key,pdv:row.pdv,departamento:row.dept,
      provincia:row.prov,distrito:row.dist,aprobado_ok:!!approved,huella:approved?fingerprint:''};
    return ensure(await create().from(TABLES.reviews).upsert(payload,{onConflict:'periodo,clave'})
      .select('periodo,clave,pdv,aprobado_ok,aprobado_por,aprobado_en,huella').single(), 'Guardar OK');
  }
  async function refreshReviews(period) {return loadReviews(period);}
  async function listMembers() {
    assertAdmin();
    return allPages(TABLES.members,'user_id,rol,pdvs,activo,actualizado_en',
      q => q.order('actualizado_en',{ascending:false}));
  }
  async function upsertMember(entry) {
    assertAdmin();
    const id = String(entry.user_id || '').trim().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw Error('UID inválido. Obtén el User UID en Supabase > Authentication > Users.');
    }
    if (!['ADMINISTRADOR','ENCARGADO','PDV'].includes(entry.rol)) throw Error('Rol inválido');
    const pdvs = [...new Set((entry.pdvs || []).map(x => root.FacturacionMotor?.normalizePDV(x) || String(x).trim().toUpperCase()).filter(Boolean))];
    if (entry.rol !== 'ADMINISTRADOR' && !pdvs.length) throw Error('Encargado y PDV necesitan al menos un PDV permitido.');
    if (id === currentUser?.id && (entry.rol !== 'ADMINISTRADOR' || entry.activo === false)) {
      throw Error('No puedes quitarte tu propio acceso administrador desde esta pantalla.');
    }
    ensure(await create().from(TABLES.members).upsert({
      user_id:id,rol:entry.rol,pdvs:entry.rol==='ADMINISTRADOR'?[]:pdvs,activo:entry.activo!==false,
      actualizado_en:new Date().toISOString()
    },{onConflict:'user_id'}), 'Asignar permisos');
  }
  function detailPayload(id, r) {
    return {
      liquidacion_id:id, guia:r.guia, pdv:r.pdv, departamento:r.dept, provincia:r.prov,
      distrito:r.dist, tarifa:r.tarifa, descuento:r.descuento, neto:r.neto, datos:r
    };
  }
  function summaryPayload(id, s) {
    return {
      liquidacion_id:id,clave:s.key,pdv:s.pdv,departamento:s.dept,provincia:s.prov,
      distrito:s.dist,cantidad:s.count,bruto:s.gross,descuento:s.discount,neto:s.net,datos:s
    };
  }
  async function batchInsert(table, rows, onProgress, batchSize = 250) {
    for (let i=0;i<rows.length;i+=batchSize) {
      ensure(await create().from(table).insert(rows.slice(i, i+batchSize)), 'Publicar '+table);
      if (onProgress) onProgress(Math.min(i+batchSize,rows.length),rows.length,table);
    }
  }
  async function publish(snapshot, onProgress) {
    assertAdmin();
    if (!snapshot.details.length || snapshot.totals.pendientes > 0 ||
        (snapshot.stats?.pdvConflicts || 0)>0) {
      throw Error('La liquidación no está lista: faltan cálculos o existen conflictos de PDV.');
    }
    const c=create();
    const metadata=ensure(await c.from(TABLES.settlements).insert({
      periodo:snapshot.period,esperado_guias:snapshot.details.length,
      regla_publica:snapshot.config.rule, minimo_guias:snapshot.config.minGuides,
      periodo_referencia:snapshot.config.refPeriod||snapshot.period
    }).select('id,version').single(), 'Iniciar cierre');
    const id=metadata.id;
    try {
      ensure(await c.from(TABLES.private).insert({liquidacion_id:id,
        configuracion:snapshot.config,estadisticas:snapshot.stats||{},totales:snapshot.totals,
        fuente:snapshot.source || ''}), 'Congelar configuración');
      await batchInsert(TABLES.summary, snapshot.summary.map(r=>summaryPayload(id,r)), onProgress, 200);
      // Mapear por bloques (no duplicar 100k objetos en memoria).
      for (let offset=0;offset<snapshot.details.length;offset+=250) {
        const batch=snapshot.details.slice(offset,offset+250).map(r=>detailPayload(id,r));
        ensure(await c.from(TABLES.detail).insert(batch), 'Subir detalle');
        if (onProgress) onProgress(Math.min(offset+250,snapshot.details.length),snapshot.details.length,'detalle');
      }
      ensure(await c.from(TABLES.settlements).update({estado:'FINALIZADO'})
        .eq('id',id).eq('estado','CARGANDO').select('id,estado').single(), 'Validar y finalizar');
      return {id,version:metadata.version,period:snapshot.period};
    } catch(e) {
      // Nunca borrar un cierre que pudo haberse confirmado en el servidor.
      try {
        const r=ensure(await c.from(TABLES.settlements).select('estado').eq('id',id).maybeSingle(), 'Comprobar cierre');
        if (r?.estado==='FINALIZADO') return {id,version:metadata.version,period:snapshot.period,warning:'La confirmación llegó con retraso; el cierre sí está finalizado.'};
        if (r?.estado==='CARGANDO') await c.from(TABLES.settlements).delete().eq('id',id).eq('estado','CARGANDO');
      } catch (_) { /* es posible que la sesión o red hayan expirado: conserva la referencia */ }
      throw new Error(e.message+' | Cierre de carga '+id+'. Si queda CARGANDO, un administrador puede limpiarlo.');
    }
  }
  async function listSettlements() {
    requireProfile();
    return allPages(TABLES.settlements,'id,periodo,version,estado,creado_en,finalizado_en,regla_publica,minimo_guias,periodo_referencia',
      q=>q.eq('estado','FINALIZADO').order('periodo',{ascending:false}).order('version',{ascending:false}),200);
  }
  async function readSummary(id) {
    const rows=await allPages(TABLES.summary,'datos,pdv,bruto,descuento,neto,cantidad',
      q=>q.eq('liquidacion_id',id).order('clave',{ascending:true}),500);
    return rows.map(x=>x.datos);
  }
  async function readDetails(id, options={}) {
    requireProfile();
    let q=create().from(TABLES.detail).select('datos,pdv,guia', options.withCount===false?{}:{count:'exact'})
      .eq('liquidacion_id',id).order('guia',{ascending:true});
    if (options.pdv) q=q.eq('pdv',options.pdv);
    if (options.guia) q=q.ilike('guia','%'+options.guia.replace(/[%,_]/g,'')+'%');
    const offset=options.offset||0,limit=Math.min(options.limit||100,500);
    const result=await q.range(offset,offset+limit-1);
    const data=ensure(result,'Consultar guías publicadas');
    return {rows:(data||[]).map(x=>x.datos),count:result.count??null};
  }
  async function readAllDetails(id,options={},onProgress) {
    requireProfile();
    const out=[];let total=null;
    for(let offset=0;;offset+=500){
      const chunk=await readDetails(id,{...options,offset,limit:500,withCount:offset===0});
      if(offset===0)total=chunk.count;
      out.push(...chunk.rows);
      if(onProgress)onProgress(out.length,total||out.length);
      if(chunk.rows.length<500) return out;
    }
  }
  async function readPrivate(id) {
    assertAdmin();
    return ensure(await create().from(TABLES.private)
      .select('configuracion,estadisticas,totales').eq('liquidacion_id',id).single(),'Cierre privado');
  }
  root.FacturacionCloud={create,restore,refreshProfile,login,logout,profile:()=>profile,
    user:()=>currentUser,admin,loadConfig,saveRules,saveTariff,saveTime,loadReviews,saveReview,refreshReviews,
    listMembers,upsertMember,publish,listSettlements,readSummary,readDetails,readAllDetails,readPrivate};
})(window);
