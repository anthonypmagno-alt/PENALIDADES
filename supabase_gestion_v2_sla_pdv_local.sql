-- Acceso de solo lectura al SLA de paquetes para usuarios PDV.
-- Ejecutar una vez en el mismo proyecto Supabase de Gestión de Guías V2.
-- No crea, elimina ni modifica tablas o cargas existentes.
begin;

create or replace function public.v16_gestion_v2_sla_paquetes(
  p_accion text,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_perfil jsonb;
  v_rol text;
  v_accion text := lower(btrim(coalesce(p_accion,'')));
  v_carga_id uuid;
  v_carga v16_private.gestion_sla_cargas%rowtype;
  v_filas jsonb;
  v_filas_recibidas integer;
  v_filas_esperadas integer;
  v_rangos jsonb;
  v_rango jsonb;
  v_rangos_cantidad integer;
  v_rango_orden integer;
  v_desde numeric(10,2);
  v_hasta numeric(10,2);
  v_tarifa_rango numeric(5,2);
  v_limite_previo numeric(10,2) := 0;
  v_limite integer;
  v_despues bigint;
  v_siguiente bigint;
  v_carga_anterior uuid;
  v_umbral numeric(10,2);
  v_tarifa numeric(5,2);
  v_precio_item jsonb;
  v_departamento text;
  v_provincia text;
  v_distrito text;
  v_departamento_clave text;
  v_provincia_clave text;
  v_distrito_clave text;
  v_precio numeric(14,4);
  v_precio_text text;
  v_precios_cantidad integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Inicia sesión para consultar el SLA.' using errcode='42501';
  end if;
  v_perfil := to_jsonb(v16_private.profile());
  v_rol := upper(coalesce(v_perfil->>'rol',''));
  if v_rol not in ('ADMINISTRADOR','ENCARGADO','PDV') then
    raise exception 'El módulo SLA está disponible para administradores, encargados y PDV autorizados.' using errcode='42501';
  end if;
  if not public.v16_gestion_modulo_permitido('sla_paquetes','ver',v_perfil) then
    raise exception 'Tu usuario no tiene permiso para ver el módulo SLA.' using errcode='42501';
  end if;
  if v_rol='PDV' and v_accion not in ('config','config_pdv') then
    raise exception 'El usuario PDV solo puede consultar parámetros y precios del SLA.' using errcode='42501';
  end if;
  if v_accion in ('guardar_parametros','guardar_precios','iniciar_carga','guardar_bloque','publicar_carga','cancelar_carga')
     and not public.v16_gestion_modulo_permitido('sla_paquetes','ejecutar',v_perfil) then
    raise exception 'Tu usuario puede consultar el SLA, pero no ejecutar cambios.' using errcode='42501';
  end if;

  if v_accion='config_pdv' then
    if v_rol<>'PDV' then
      raise exception 'La consulta local de precios solo está disponible para el usuario PDV.' using errcode='42501';
    end if;
    if jsonb_typeof(p_payload->'distritos') is distinct from 'array' then
      raise exception 'Envía una lista de hasta 10,000 distritos de la consulta local.' using errcode='22023';
    end if;
    if jsonb_array_length(p_payload->'distritos')>10000 then
      raise exception 'Envía una lista de hasta 10,000 distritos de la consulta local.' using errcode='22023';
    end if;
    if exists (
      select 1
      from jsonb_to_recordset(p_payload->'distritos') as d(departamento text,provincia text,distrito text)
      where length(btrim(coalesce(d.departamento,''))) not between 1 and 200
         or length(btrim(coalesce(d.provincia,''))) not between 1 and 200
         or length(btrim(coalesce(d.distrito,''))) not between 1 and 200
         or public.v16_gestion_sla_geo_clave(d.distrito)=''
    ) then
      raise exception 'Cada distrito de la consulta local debe tener departamento, provincia y distrito de zonificación.' using errcode='22023';
    end if;
    return jsonb_build_object(
      'rangos',coalesce((select jsonb_agg(jsonb_build_object('orden',r.orden,'desde_horas',r.desde_horas,'hasta_horas',r.hasta_horas,'tarifa_porcentaje',r.tarifa_porcentaje) order by r.orden) from v16_private.gestion_sla_rangos r),'[]'::jsonb),
      'precios',coalesce((
        select jsonb_agg(jsonb_build_object('departamento',d.departamento,'provincia',d.provincia,'distrito',d.distrito,'precio',t.precio) order by d.departamento,d.provincia,d.distrito)
        from (
          select distinct btrim(x.departamento) as departamento,btrim(x.provincia) as provincia,btrim(x.distrito) as distrito,
            public.v16_gestion_sla_geo_clave(x.departamento) as departamento_clave,
            public.v16_gestion_sla_geo_clave(x.provincia) as provincia_clave,
            public.v16_gestion_sla_geo_clave(x.distrito) as distrito_clave
          from jsonb_to_recordset(p_payload->'distritos') as x(departamento text,provincia text,distrito text)
        ) d
        left join v16_private.gestion_sla_precios_distrito t
          on t.departamento_clave=d.departamento_clave
         and t.provincia_clave=d.provincia_clave
         and t.distrito_clave=d.distrito_clave
      ),'[]'::jsonb),
      'dataset',null
    );
  elsif v_accion='config' then
    return jsonb_build_object(
      'umbral_horas',(select c.umbral_horas from v16_private.gestion_sla_configuracion c where c.id=1),
      'tarifa_porcentaje',(select c.tarifa_porcentaje from v16_private.gestion_sla_configuracion c where c.id=1),
      'rangos',coalesce((select jsonb_agg(jsonb_build_object('orden',r.orden,'desde_horas',r.desde_horas,'hasta_horas',r.hasta_horas,'tarifa_porcentaje',r.tarifa_porcentaje) order by r.orden) from v16_private.gestion_sla_rangos r),'[]'::jsonb),
      'precios',case when v_rol='PDV' then '[]'::jsonb else coalesce((
        select jsonb_agg(jsonb_build_object(
          'departamento',d.departamento,'provincia',d.provincia,'distrito',d.distrito,'precio',t.precio
        ) order by d.departamento,d.provincia,d.distrito)
        from (
          select distinct p.departamento,p.provincia,p.distrito,
            public.v16_gestion_sla_geo_clave(p.departamento) as departamento_clave,
            public.v16_gestion_sla_geo_clave(p.provincia) as provincia_clave,
            public.v16_gestion_sla_geo_clave(p.distrito) as distrito_clave
          from v16_private.gestion_sla_paquetes p
          join v16_private.gestion_sla_cargas c on c.id=p.carga_id and c.activa
          where public.v16_gestion_v2_sla_alcance(p.pdv,p.area,p.region,v_perfil)
        ) d
        left join v16_private.gestion_sla_precios_distrito t
          on t.departamento_clave=d.departamento_clave
         and t.provincia_clave=d.provincia_clave
         and t.distrito_clave=d.distrito_clave
      ),'[]'::jsonb) end,
      'actualizado_en',(select c.actualizado_en from v16_private.gestion_sla_configuracion c where c.id=1),
      'dataset',case when v_rol='PDV' then null else (select jsonb_build_object('id',c.id,'archivo',c.archivo,'filas',c.filas_esperadas,'creado_en',c.creado_en)
                 from v16_private.gestion_sla_cargas c where c.activa) end
    );
  elsif v_accion='guardar_parametros' then
    if v_rol<>'ADMINISTRADOR' then
      raise exception 'Solo el administrador puede cambiar los parámetros SLA.' using errcode='42501';
    end if;
    v_rangos := p_payload->'rangos';
    if jsonb_typeof(v_rangos) is distinct from 'array' then
      raise exception 'Envía una lista de rangos SLA.' using errcode='22023';
    end if;
    v_rangos_cantidad := jsonb_array_length(v_rangos);
    if v_rangos_cantidad not between 1 and 20 then
      raise exception 'Configura entre 1 y 20 rangos SLA.' using errcode='22023';
    end if;
    delete from v16_private.gestion_sla_rangos where orden is not null;
    for v_rango,v_rango_orden in
      select item.value,item.ordinality::integer
      from jsonb_array_elements(v_rangos) with ordinality as item(value,ordinality)
    loop
      begin
        v_desde := nullif(v_rango->>'desde_horas','')::numeric;
        v_hasta := nullif(v_rango->>'hasta_horas','')::numeric;
        v_tarifa_rango := nullif(v_rango->>'tarifa_porcentaje','')::numeric;
      exception when others then
        raise exception 'El rango % contiene valores que no son numéricos.' ,v_rango_orden using errcode='22023';
      end;
      if v_desde is null or v_desde not between 0 and 100000
         or v_tarifa_rango is null or v_tarifa_rango not between 0 and 100 then
        raise exception 'El inicio debe estar entre 0 y 100000 horas y la tarifa entre 0 y 100%% (rango %).' ,v_rango_orden using errcode='22023';
      end if;
      if v_desde<>v_limite_previo then
        raise exception 'Los rangos deben iniciar donde termina el anterior; revise el rango %.' ,v_rango_orden using errcode='22023';
      end if;
      if v_rango_orden<v_rangos_cantidad and (v_hasta is null or v_hasta<=v_desde or v_hasta>100000) then
        raise exception 'Cada rango intermedio necesita un límite final mayor a su inicio (rango %).' ,v_rango_orden using errcode='22023';
      end if;
      if v_rango_orden=v_rangos_cantidad and v_hasta is not null then
        raise exception 'Deja sin límite superior el último rango.' using errcode='22023';
      end if;
      insert into v16_private.gestion_sla_rangos(orden,desde_horas,hasta_horas,tarifa_porcentaje,actualizado_por,actualizado_en)
      values (v_rango_orden,v_desde,v_hasta,v_tarifa_rango,auth.uid(),now());
      v_limite_previo := v_hasta;
    end loop;
    update v16_private.gestion_sla_configuracion
       set actualizado_por=auth.uid(),actualizado_en=now()
     where id=1;
    return jsonb_build_object(
      'rangos',coalesce((select jsonb_agg(jsonb_build_object('orden',r.orden,'desde_horas',r.desde_horas,'hasta_horas',r.hasta_horas,'tarifa_porcentaje',r.tarifa_porcentaje) order by r.orden) from v16_private.gestion_sla_rangos r),'[]'::jsonb),
      'actualizado_en',now()
    );
  elsif v_accion='guardar_precios' then
    if v_rol<>'ADMINISTRADOR' then
      raise exception 'Solo el administrador puede cambiar los precios por distrito.' using errcode='42501';
    end if;
    if jsonb_typeof(p_payload->'precios') is distinct from 'array' then
      raise exception 'Envía una lista de precios por distrito.' using errcode='22023';
    end if;
    if jsonb_array_length(p_payload->'precios')>10000 then
      raise exception 'Envía hasta 10,000 precios por distrito.' using errcode='22023';
    end if;
    for v_precio_item in select value from jsonb_array_elements(p_payload->'precios') loop
      v_departamento:=btrim(coalesce(v_precio_item->>'departamento',''));
      v_provincia:=btrim(coalesce(v_precio_item->>'provincia',''));
      v_distrito:=btrim(coalesce(v_precio_item->>'distrito',''));
      v_precio_text:=nullif(btrim(coalesce(v_precio_item->>'precio','')),'');
      begin v_precio:=v_precio_text::numeric;
      exception when others then raise exception 'El precio del distrito % no es numérico.',v_distrito using errcode='22023'; end;
      if length(v_departamento)>200 or length(v_provincia)>200 or length(v_distrito) not between 1 and 200
         or public.v16_gestion_sla_geo_clave(v_distrito)=''
         or (v_precio_text is not null and v_precio_text !~ '^[0-9]{1,10}([.][0-9]{1,4})?$')
         or (v_precio is not null and v_precio not between 0 and 9999999999.9999) then
        raise exception 'Revisa los nombres y el precio del distrito % (usa hasta 4 decimales).',v_distrito using errcode='22023';
      end if;
      v_departamento_clave:=public.v16_gestion_sla_geo_clave(v_departamento);
      v_provincia_clave:=public.v16_gestion_sla_geo_clave(v_provincia);
      v_distrito_clave:=public.v16_gestion_sla_geo_clave(v_distrito);
      insert into v16_private.gestion_sla_precios_distrito(
        departamento_clave,provincia_clave,distrito_clave,departamento,provincia,distrito,precio,actualizado_por,actualizado_en
      ) values (
        v_departamento_clave,v_provincia_clave,v_distrito_clave,v_departamento,v_provincia,v_distrito,v_precio,auth.uid(),now()
      ) on conflict (departamento_clave,provincia_clave,distrito_clave) do update set
        departamento=excluded.departamento,provincia=excluded.provincia,distrito=excluded.distrito,
        precio=excluded.precio,actualizado_por=auth.uid(),actualizado_en=now();
      v_precios_cantidad:=v_precios_cantidad+1;
    end loop;
    return jsonb_build_object('guardados',v_precios_cantidad);
  elsif v_accion='iniciar_carga' then
    if v_rol<>'ADMINISTRADOR' then
      raise exception 'Solo el administrador puede cargar el archivo SLA.' using errcode='42501';
    end if;
    begin v_filas_esperadas := (p_payload->>'filas')::integer;
    exception when others then v_filas_esperadas := 0; end;
    if length(btrim(coalesce(p_payload->>'archivo',''))) not between 1 and 255
       or v_filas_esperadas is null or v_filas_esperadas not between 1 and 100000 then
      raise exception 'Nombre o cantidad de filas del archivo inválidos.' using errcode='22023';
    end if;
    insert into v16_private.gestion_sla_cargas(archivo,filas_esperadas,subido_por)
    values (btrim(p_payload->>'archivo'),v_filas_esperadas,auth.uid())
    returning * into v_carga;
    return jsonb_build_object('id',v_carga.id,'filas',v_carga.filas_esperadas);
  elsif v_accion='guardar_bloque' then
    if v_rol<>'ADMINISTRADOR' then
      raise exception 'Solo el administrador puede cargar el archivo SLA.' using errcode='42501';
    end if;
    begin v_carga_id := (p_payload->>'carga_id')::uuid;
    exception when others then raise exception 'Identificador de carga inválido.' using errcode='22023'; end;
    select * into v_carga from v16_private.gestion_sla_cargas c
      where c.id=v_carga_id and c.subido_por=auth.uid() and not c.activa;
    if not found then raise exception 'No se encontró la carga pendiente de este administrador.' using errcode='22023'; end if;
    if jsonb_typeof(p_payload->'filas') is distinct from 'array' then
      raise exception 'Envía un bloque JSON de filas.' using errcode='22023';
    end if;
    if jsonb_array_length(p_payload->'filas') not between 1 and 300 then
      raise exception 'Envía un bloque de entre 1 y 300 filas.' using errcode='22023';
    end if;
    select count(*) into v_filas_recibidas from v16_private.gestion_sla_paquetes p where p.carga_id=v_carga_id;
    if v_filas_recibidas + jsonb_array_length(p_payload->'filas') > v_carga.filas_esperadas then
      raise exception 'El bloque excede la cantidad de filas declarada para la carga.' using errcode='22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_payload->'filas') as item(value)
      where length(btrim(coalesce(item.value->>'guia',''))) not between 1 and 200
         or length(btrim(coalesce(item.value->>'pdv',''))) not between 1 and 200
    ) then
      raise exception 'Cada fila debe incluir una guía y un PDV válidos.' using errcode='22023';
    end if;
    insert into v16_private.gestion_sla_paquetes(
      carga_id,guia,guia_clave,pdv,pdv_clave,departamento,provincia,distrito,area,region,
      fecha_generacion,salida_hub,llegada_cedis,salida_cedis,llegada_pdv,despacho,firma,problema,retorno_almacen,devolucion
    )
    select v_carga_id,btrim(x.guia),upper(btrim(x.guia)),btrim(x.pdv),upper(btrim(x.pdv)),
      coalesce(x.departamento,''),coalesce(x.provincia,''),coalesce(x.distrito,''),coalesce(x.area,''),coalesce(x.region,''),
      x.fecha_generacion,x.salida_hub,x.llegada_cedis,x.salida_cedis,x.llegada_pdv,x.despacho,x.firma,x.problema,x.retorno_almacen,x.devolucion
    from jsonb_to_recordset(p_payload->'filas') as x(
      guia text,pdv text,departamento text,provincia text,distrito text,area text,region text,
      fecha_generacion timestamptz,salida_hub timestamptz,llegada_cedis timestamptz,salida_cedis timestamptz,
      llegada_pdv timestamptz,despacho timestamptz,firma timestamptz,problema timestamptz,retorno_almacen timestamptz,devolucion timestamptz
    );
    get diagnostics v_filas_recibidas=row_count;
    return jsonb_build_object('insertadas',v_filas_recibidas);
  elsif v_accion='publicar_carga' then
    if v_rol<>'ADMINISTRADOR' then
      raise exception 'Solo el administrador puede publicar el archivo SLA.' using errcode='42501';
    end if;
    begin v_carga_id := (p_payload->>'carga_id')::uuid;
    exception when others then raise exception 'Identificador de carga inválido.' using errcode='22023'; end;
    select * into v_carga from v16_private.gestion_sla_cargas c
      where c.id=v_carga_id and c.subido_por=auth.uid() and not c.activa;
    if not found then raise exception 'No se encontró la carga pendiente de este administrador.' using errcode='22023'; end if;
    select count(*) into v_filas_recibidas from v16_private.gestion_sla_paquetes p where p.carga_id=v_carga_id;
    if v_filas_recibidas<>v_carga.filas_esperadas then
      raise exception 'Carga incompleta: recibidas % de % filas.' ,v_filas_recibidas,v_carga.filas_esperadas using errcode='22023';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('v16_gestion_v2_sla_paquetes'));
    update v16_private.gestion_sla_cargas set activa=false where activa returning id into v_carga_anterior;
    update v16_private.gestion_sla_cargas set activa=true where id=v_carga_id;
    if v_carga_anterior is not null then
      delete from v16_private.gestion_sla_cargas where id=v_carga_anterior;
    end if;
    return jsonb_build_object('id',v_carga.id,'archivo',v_carga.archivo,'filas',v_filas_recibidas,'creado_en',now());
  elsif v_accion='cancelar_carga' then
    if v_rol<>'ADMINISTRADOR' then
      raise exception 'Solo el administrador puede cancelar una carga SLA.' using errcode='42501';
    end if;
    begin v_carga_id := (p_payload->>'carga_id')::uuid;
    exception when others then raise exception 'Identificador de carga inválido.' using errcode='22023'; end;
    delete from v16_private.gestion_sla_cargas where id=v_carga_id and subido_por=auth.uid() and not activa;
    return jsonb_build_object('eliminada',found);
  elsif v_accion='listar' then
    if v_rol not in ('ADMINISTRADOR','ENCARGADO') then
      raise exception 'No tienes acceso al módulo SLA.' using errcode='42501';
    end if;
    begin v_despues := greatest(0,coalesce((p_payload->>'despues_id')::bigint,0));
    exception when others then v_despues := 0; end;
    begin v_limite := greatest(1,least(coalesce((p_payload->>'limite')::integer,1000),1000));
    exception when others then v_limite := 1000; end;
    select * into v_carga from v16_private.gestion_sla_cargas c where c.activa limit 1;
    if not found then
      return jsonb_build_object('filas','[]'::jsonb,'siguiente_id',v_despues,'dataset',null);
    end if;
    select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]'::jsonb) into v_filas
    from (
      select p.id,p.guia,p.pdv,p.departamento,p.provincia,p.distrito,p.area,p.region,
        p.fecha_generacion,p.salida_hub,p.llegada_cedis,p.salida_cedis,p.llegada_pdv,p.despacho,p.firma,p.problema,p.retorno_almacen,p.devolucion
      from v16_private.gestion_sla_paquetes p
      where p.carga_id=v_carga.id and p.id>v_despues
        and public.v16_gestion_v2_sla_alcance(p.pdv,p.area,p.region,v_perfil)
      order by p.id limit v_limite
    ) q;
    select coalesce(max((item.value->>'id')::bigint),v_despues) into v_siguiente
      from jsonb_array_elements(v_filas) as item(value);
    return jsonb_build_object(
      'filas',v_filas,'siguiente_id',v_siguiente,
      'dataset',jsonb_build_object('id',v_carga.id,'archivo',v_carga.archivo,'filas',v_carga.filas_esperadas,'creado_en',v_carga.creado_en)
    );
  else
    raise exception 'Acción SLA desconocida.' using errcode='22023';
  end if;
end;
$$;

revoke all on function public.v16_gestion_v2_sla_paquetes(text,jsonb) from public,anon,authenticated;
grant execute on function public.v16_gestion_v2_sla_paquetes(text,jsonb) to authenticated;

create or replace function public.v16_gestion_v2_sla_zonificacion(
  p_accion text,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_perfil jsonb;
  v_rol text;
  v_accion text := lower(btrim(coalesce(p_accion,'')));
  v_carga_id uuid;
  v_carga v16_private.gestion_sla_zonificacion_cargas%rowtype;
  v_filas jsonb;
  v_filas_recibidas integer;
  v_filas_esperadas integer;
  v_filas_bloque integer;
  v_item jsonb;
  v_departamento text;
  v_provincia text;
  v_distrito text;
  v_valor text;
  v_siguiente bigint;
  v_despues bigint;
  v_limite integer;
  v_carga_anterior uuid;
begin
  if auth.uid() is null then
    raise exception 'Inicia sesión para consultar la zonificación SLA.' using errcode='42501';
  end if;
  v_perfil := to_jsonb(v16_private.profile());
  v_rol := upper(coalesce(v_perfil->>'rol',''));
  if v_rol not in ('ADMINISTRADOR','ENCARGADO','PDV') then
    raise exception 'El módulo SLA está disponible para administradores, encargados y PDV autorizados.' using errcode='42501';
  end if;
  if not public.v16_gestion_modulo_permitido('sla_paquetes','ver',v_perfil) then
    raise exception 'Tu usuario no tiene permiso para ver el módulo SLA.' using errcode='42501';
  end if;
  if v_rol='PDV' and v_accion<>'listar' then
    raise exception 'El usuario PDV solo puede consultar la zonificación.' using errcode='42501';
  end if;
  if v_accion in ('iniciar_carga','guardar_bloque','publicar_carga','cancelar_carga')
     and (v_rol<>'ADMINISTRADOR' or not public.v16_gestion_modulo_permitido('sla_paquetes','ejecutar',v_perfil)) then
    raise exception 'Solo un administrador con permiso de ejecución puede actualizar la zonificación.' using errcode='42501';
  end if;

  if v_accion='iniciar_carga' then
    begin v_filas_esperadas := (p_payload->>'filas')::integer;
    exception when others then v_filas_esperadas := 0; end;
    if length(btrim(coalesce(p_payload->>'archivo',''))) not between 1 and 255
       or v_filas_esperadas is null or v_filas_esperadas not between 1 and 50000 then
      raise exception 'Nombre o cantidad de filas de zonificación inválidos.' using errcode='22023';
    end if;
    insert into v16_private.gestion_sla_zonificacion_cargas(archivo,filas_esperadas,subido_por)
    values (btrim(p_payload->>'archivo'),v_filas_esperadas,auth.uid())
    returning * into v_carga;
    return jsonb_build_object('id',v_carga.id,'filas',v_carga.filas_esperadas);

  elsif v_accion='guardar_bloque' then
    begin v_carga_id := (p_payload->>'carga_id')::uuid;
    exception when others then raise exception 'Identificador de carga inválido.' using errcode='22023'; end;
    select * into v_carga from v16_private.gestion_sla_zonificacion_cargas c
      where c.id=v_carga_id and c.subido_por=auth.uid() and not c.activa;
    if not found then raise exception 'No se encontró la carga de zonificación pendiente de este administrador.' using errcode='22023'; end if;
    if jsonb_typeof(p_payload->'filas') is distinct from 'array' then
      raise exception 'Envía un bloque JSON de filas de zonificación.' using errcode='22023';
    end if;
    v_filas_bloque := jsonb_array_length(p_payload->'filas');
    if v_filas_bloque not between 1 and 300 then
      raise exception 'Envía un bloque de entre 1 y 300 distritos.' using errcode='22023';
    end if;
    select count(*) into v_filas_recibidas from v16_private.gestion_sla_zonificacion z where z.carga_id=v_carga_id;
    if v_filas_recibidas + v_filas_bloque > v_carga.filas_esperadas then
      raise exception 'El bloque excede la cantidad de distritos declarada para la carga.' using errcode='22023';
    end if;
    for v_item in select value from jsonb_array_elements(p_payload->'filas') loop
      v_departamento := btrim(coalesce(v_item->>'departamento',''));
      v_provincia := btrim(coalesce(v_item->>'provincia',''));
      v_distrito := btrim(coalesce(v_item->>'distrito',''));
      if length(v_departamento) not between 1 and 200 or length(v_provincia) not between 1 and 200 or length(v_distrito) not between 1 and 200 then
        raise exception 'Cada fila requiere Departamento, Provincia y Distrito.' using errcode='22023';
      end if;
      if length(coalesce(v_item->>'tipo_zona',''))>200 then
        raise exception 'El tipo de zona supera 200 caracteres.' using errcode='22023';
      end if;
      foreach v_valor in array array[nullif(btrim(coalesce(v_item->>'sla_traslado_dias','')),''),nullif(btrim(coalesce(v_item->>'sla_reparto_dias','')),'')] loop
        if v_valor is not null then
          if v_valor !~ '^[0-9]{1,3}([.][0-9]{1,2})?$' then
            raise exception 'Los SLA de traslado y reparto deben ser valores entre 0 y 365 días, con hasta 2 decimales.' using errcode='22023';
          end if;
          if v_valor::numeric>365 then
            raise exception 'Los SLA de traslado y reparto deben ser valores entre 0 y 365 días.' using errcode='22023';
          end if;
        end if;
      end loop;
    end loop;
    insert into v16_private.gestion_sla_zonificacion(
      carga_id,departamento,provincia,distrito,departamento_clave,provincia_clave,distrito_clave,
      tipo_zona,sla_traslado_dias,sla_reparto_dias
    )
    select v_carga_id,btrim(x.departamento),btrim(x.provincia),btrim(x.distrito),
      public.v16_gestion_sla_geo_clave(x.departamento),public.v16_gestion_sla_geo_clave(x.provincia),public.v16_gestion_sla_geo_clave(x.distrito),
      btrim(coalesce(x.tipo_zona,'')),x.sla_traslado_dias,x.sla_reparto_dias
    from jsonb_to_recordset(p_payload->'filas') as x(
      departamento text,provincia text,distrito text,tipo_zona text,
      sla_traslado_dias numeric,sla_reparto_dias numeric
    );
    get diagnostics v_filas_recibidas=row_count;
    return jsonb_build_object('insertadas',v_filas_recibidas);

  elsif v_accion='publicar_carga' then
    begin v_carga_id := (p_payload->>'carga_id')::uuid;
    exception when others then raise exception 'Identificador de carga inválido.' using errcode='22023'; end;
    select * into v_carga from v16_private.gestion_sla_zonificacion_cargas c
      where c.id=v_carga_id and c.subido_por=auth.uid() and not c.activa;
    if not found then raise exception 'No se encontró la carga de zonificación pendiente de este administrador.' using errcode='22023'; end if;
    select count(*) into v_filas_recibidas from v16_private.gestion_sla_zonificacion z where z.carga_id=v_carga_id;
    if v_filas_recibidas<>v_carga.filas_esperadas then
      raise exception 'Carga de zonificación incompleta: recibidos % de % distritos.',v_filas_recibidas,v_carga.filas_esperadas using errcode='22023';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('v16_gestion_v2_sla_zonificacion'));
    update v16_private.gestion_sla_zonificacion_cargas set activa=false where activa returning id into v_carga_anterior;
    update v16_private.gestion_sla_zonificacion_cargas set activa=true where id=v_carga_id;
    if v_carga_anterior is not null then
      delete from v16_private.gestion_sla_zonificacion_cargas where id=v_carga_anterior;
    end if;
    return jsonb_build_object('id',v_carga.id,'archivo',v_carga.archivo,'filas',v_filas_recibidas,'creado_en',now());

  elsif v_accion='cancelar_carga' then
    begin v_carga_id := (p_payload->>'carga_id')::uuid;
    exception when others then raise exception 'Identificador de carga inválido.' using errcode='22023'; end;
    delete from v16_private.gestion_sla_zonificacion_cargas
      where id=v_carga_id and subido_por=auth.uid() and not activa;
    return jsonb_build_object('eliminada',found);

  elsif v_accion='listar' then
    begin v_despues := greatest(0,coalesce((p_payload->>'despues_id')::bigint,0));
    exception when others then v_despues := 0; end;
    begin v_limite := greatest(1,least(coalesce((p_payload->>'limite')::integer,1000),1000));
    exception when others then v_limite := 1000; end;
    select * into v_carga from v16_private.gestion_sla_zonificacion_cargas c where c.activa limit 1;
    if not found then
      return jsonb_build_object('filas','[]'::jsonb,'siguiente_id',v_despues,'dataset',null);
    end if;
    select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]'::jsonb) into v_filas
    from (
      select z.id,z.departamento,z.provincia,z.distrito,z.tipo_zona,z.sla_traslado_dias,z.sla_reparto_dias
      from v16_private.gestion_sla_zonificacion z
      where z.carga_id=v_carga.id and z.id>v_despues
      order by z.id limit v_limite
    ) q;
    select coalesce(max((item.value->>'id')::bigint),v_despues) into v_siguiente
      from jsonb_array_elements(v_filas) as item(value);
    return jsonb_build_object(
      'filas',v_filas,'siguiente_id',v_siguiente,
      'dataset',jsonb_build_object('id',v_carga.id,'archivo',v_carga.archivo,'filas',v_carga.filas_esperadas,'creado_en',v_carga.creado_en)
    );
  else
    raise exception 'Acción de zonificación SLA desconocida.' using errcode='22023';
  end if;
end;
$$;

revoke all on function public.v16_gestion_v2_sla_zonificacion(text,jsonb) from public,anon,authenticated;
grant execute on function public.v16_gestion_v2_sla_zonificacion(text,jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
