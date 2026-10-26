-- Permisos de módulos por usuario, precios SLA por distrito y cálculo SLA para Gestión de Guías V2.
-- Ejecutar una sola vez en el mismo proyecto Supabase de Gestión de Guías.
-- Usa tablas privadas nuevas. No modifica las fuentes ni storage.objects existentes.
-- Es incremental: conserva rangos y datos SLA ya cargados.
begin;

-- Permisos por usuario: la administración de permisos solo la puede hacer un administrador.
create table if not exists v16_private.gestion_modulos_usuario (
  usuario text primary key check (length(btrim(usuario)) between 1 and 64),
  permisos jsonb not null check (jsonb_typeof(permisos)='object'),
  actualizado_por uuid references auth.users(id),
  actualizado_en timestamptz not null default now()
);
alter table v16_private.gestion_modulos_usuario enable row level security;
revoke all on table v16_private.gestion_modulos_usuario from public,anon,authenticated;

create or replace function public.v16_gestion_sla_geo_clave(p_texto text)
returns text language sql immutable security definer
set search_path = ''
as $$
  select regexp_replace(
    translate(upper(coalesce(p_texto,'')),
      'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑÇ',
      'AAAAEEEEIIIIOOOOUUUUNC'),
    '[^A-Z0-9]+','','g')
$$;

create or replace function public.v16_gestion_modulo_permitido(
  p_modulo text,p_accion text,p_perfil jsonb
) returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_rol text := upper(coalesce(p_perfil->>'rol',''));
  v_usuario text := lower(btrim(coalesce(p_perfil->>'usuario','')));
  v_permisos jsonb;
  v_item jsonb;
begin
  if auth.uid() is null then return false; end if;
  if v_rol='ADMINISTRADOR' then return true; end if;
  if p_modulo not in ('gestion','consulta_excel','estadisticas','gestion_v2','sla_paquetes','catalogo_comentarios','penalidades')
     or p_accion not in ('ver','ejecutar') then return false; end if;
  select u.permisos into v_permisos
    from v16_private.gestion_modulos_usuario u where u.usuario=v_usuario;
  if not found then return true; end if;
  v_item := v_permisos->p_modulo;
  if jsonb_typeof(v_item) is distinct from 'object'
     or coalesce((v_item->>'ver')::boolean,false)=false then return false; end if;
  if p_accion='ver' then return true; end if;
  return coalesce((v_item->>'ejecutar')::boolean,false);
exception when others then return false;
end;
$$;

create or replace function public.v16_gestion_modulos_usuario(
  p_accion text,p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_perfil jsonb;
  v_rol text;
  v_usuario text;
  v_permisos jsonb;
  v_modulo text;
  v_item jsonb;
  v_completo jsonb := jsonb_build_object(
    'gestion',jsonb_build_object('ver',true,'ejecutar',true),
    'consulta_excel',jsonb_build_object('ver',true,'ejecutar',true),
    'estadisticas',jsonb_build_object('ver',true,'ejecutar',true),
    'gestion_v2',jsonb_build_object('ver',true,'ejecutar',true),
    'sla_paquetes',jsonb_build_object('ver',true,'ejecutar',true),
    'catalogo_comentarios',jsonb_build_object('ver',true,'ejecutar',true),
    'penalidades',jsonb_build_object('ver',true,'ejecutar',true)
  );
begin
  if auth.uid() is null then raise exception 'Inicia sesión para administrar permisos.' using errcode='42501'; end if;
  v_perfil := to_jsonb(v16_private.profile());
  v_rol := upper(coalesce(v_perfil->>'rol',''));
  if lower(btrim(coalesce(p_accion,'')))='obtener' then
    v_usuario := lower(btrim(coalesce(v_perfil->>'usuario','')));
  elsif lower(btrim(coalesce(p_accion,''))) in ('obtener_usuario','guardar_usuario') then
    if v_rol<>'ADMINISTRADOR' then
      raise exception 'Solo un administrador puede revisar o cambiar permisos de otros usuarios.' using errcode='42501';
    end if;
    v_usuario := lower(btrim(coalesce(p_payload->>'usuario','')));
  else
    raise exception 'Acción de permisos desconocida.' using errcode='22023';
  end if;
  if length(v_usuario) not between 1 and 64 then raise exception 'Usuario inválido.' using errcode='22023'; end if;

  if lower(btrim(coalesce(p_accion,'')))='guardar_usuario' then
    v_permisos := p_payload->'permisos';
    if jsonb_typeof(v_permisos) is distinct from 'object' then
      raise exception 'Envía los permisos de cada módulo.' using errcode='22023';
    end if;
    foreach v_modulo in array array['gestion','consulta_excel','estadisticas','gestion_v2','sla_paquetes','catalogo_comentarios','penalidades'] loop
      v_item := v_permisos->v_modulo;
      if jsonb_typeof(v_item) is distinct from 'object'
         or jsonb_typeof(v_item->'ver') is distinct from 'boolean'
         or jsonb_typeof(v_item->'ejecutar') is distinct from 'boolean' then
        raise exception 'Completa los permisos de ver y ejecutar para el módulo %.',v_modulo using errcode='22023';
      end if;
      if coalesce((v_item->>'ejecutar')::boolean,false)
         and not coalesce((v_item->>'ver')::boolean,false) then
        raise exception 'Para ejecutar el módulo % también debe habilitarse Ver.',v_modulo using errcode='22023';
      end if;
    end loop;
    insert into v16_private.gestion_modulos_usuario(usuario,permisos,actualizado_por,actualizado_en)
    values (v_usuario,v_permisos,auth.uid(),now())
    on conflict (usuario) do update set permisos=excluded.permisos,actualizado_por=auth.uid(),actualizado_en=now();
  end if;

  select u.permisos into v_permisos
    from v16_private.gestion_modulos_usuario u where u.usuario=v_usuario;
  if not found then v_permisos:=v_completo; end if;
  if v_rol='ADMINISTRADOR' and v_usuario=lower(btrim(coalesce(v_perfil->>'usuario',''))) then v_permisos:=v_completo; end if;
  return jsonb_build_object('usuario',v_usuario,'permisos',v_permisos);
end;
$$;

create table if not exists v16_private.gestion_sla_cargas (
  id uuid primary key default gen_random_uuid(),
  archivo text not null check (length(btrim(archivo)) between 1 and 255),
  filas_esperadas integer not null check (filas_esperadas between 1 and 100000),
  activa boolean not null default false,
  subido_por uuid not null references auth.users(id),
  creado_en timestamptz not null default now()
);

create unique index if not exists gestion_sla_una_carga_activa_idx
  on v16_private.gestion_sla_cargas (activa) where activa;

create table if not exists v16_private.gestion_sla_paquetes (
  id bigint generated by default as identity primary key,
  carga_id uuid not null references v16_private.gestion_sla_cargas(id) on delete cascade,
  guia text not null check (length(btrim(guia)) between 1 and 200),
  guia_clave text not null check (length(btrim(guia_clave)) between 1 and 200),
  pdv text not null check (length(btrim(pdv)) between 1 and 200),
  pdv_clave text not null check (length(btrim(pdv_clave)) between 1 and 200),
  departamento text not null default '',
  provincia text not null default '',
  distrito text not null default '',
  area text not null default '',
  region text not null default '',
  fecha_generacion timestamptz,
  salida_hub timestamptz,
  llegada_cedis timestamptz,
  salida_cedis timestamptz,
  llegada_pdv timestamptz,
  despacho timestamptz,
  firma timestamptz,
  problema timestamptz,
  retorno_almacen timestamptz,
  devolucion timestamptz
);

create index if not exists gestion_sla_paquetes_carga_id_idx
  on v16_private.gestion_sla_paquetes (carga_id,id);
create index if not exists gestion_sla_paquetes_scope_idx
  on v16_private.gestion_sla_paquetes (carga_id,pdv_clave,provincia,distrito);

create table if not exists v16_private.gestion_sla_configuracion (
  id smallint primary key check (id=1),
  umbral_horas numeric(10,2) not null check (umbral_horas between 1 and 8760),
  tarifa_porcentaje numeric(5,2) not null check (tarifa_porcentaje between 0 and 100),
  actualizado_por uuid references auth.users(id),
  actualizado_en timestamptz not null default now()
);
insert into v16_private.gestion_sla_configuracion (id,umbral_horas,tarifa_porcentaje)
values (1,48,90) on conflict (id) do nothing;

create table if not exists v16_private.gestion_sla_rangos (
  orden smallint primary key check (orden between 1 and 20),
  desde_horas numeric(10,2) not null check (desde_horas between 0 and 100000),
  hasta_horas numeric(10,2) check (hasta_horas is null or hasta_horas between 0 and 100000),
  tarifa_porcentaje numeric(5,2) not null check (tarifa_porcentaje between 0 and 100),
  actualizado_por uuid references auth.users(id),
  actualizado_en timestamptz not null default now(),
  check (hasta_horas is null or hasta_horas > desde_horas)
);

create table if not exists v16_private.gestion_sla_precios_distrito (
  departamento_clave text not null,
  provincia_clave text not null,
  distrito_clave text not null check (length(distrito_clave)>0),
  departamento text not null,
  provincia text not null,
  distrito text not null,
  precio numeric(14,4) check (precio is null or precio between 0 and 9999999999.9999),
  actualizado_por uuid references auth.users(id),
  actualizado_en timestamptz not null default now(),
  primary key (departamento_clave,provincia_clave,distrito_clave)
);

-- Migra el parámetro previo de umbral único a dos rangos, sin reemplazar rangos ya configurados.
insert into v16_private.gestion_sla_rangos(orden,desde_horas,hasta_horas,tarifa_porcentaje)
select 1,0,c.umbral_horas,0 from v16_private.gestion_sla_configuracion c
where c.id=1 and not exists (select 1 from v16_private.gestion_sla_rangos)
union all
select 2,c.umbral_horas,null,c.tarifa_porcentaje from v16_private.gestion_sla_configuracion c
where c.id=1 and not exists (select 1 from v16_private.gestion_sla_rangos);

alter table v16_private.gestion_sla_cargas enable row level security;
alter table v16_private.gestion_sla_paquetes enable row level security;
alter table v16_private.gestion_sla_configuracion enable row level security;
alter table v16_private.gestion_sla_rangos enable row level security;
alter table v16_private.gestion_sla_precios_distrito enable row level security;
revoke all on table v16_private.gestion_sla_cargas from public,anon,authenticated;
revoke all on table v16_private.gestion_sla_paquetes from public,anon,authenticated;
revoke all on table v16_private.gestion_sla_configuracion from public,anon,authenticated;
revoke all on table v16_private.gestion_sla_rangos from public,anon,authenticated;
revoke all on table v16_private.gestion_sla_precios_distrito from public,anon,authenticated;

create or replace function public.v16_gestion_v2_sla_alcance(
  p_pdv text,p_area text,p_region text,p_perfil jsonb
) returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_rol text := upper(coalesce(p_perfil->>'rol',''));
  v_lista jsonb;
  v_item text;
  v_area text := upper(trim(coalesce(p_area,'')));
  v_region text := upper(trim(coalesce(p_region,'')));
begin
  if auth.uid() is null then return false; end if;
  if v_rol='ADMINISTRADOR' then return true; end if;
  if v_rol not in ('ENCARGADO','PDV') then return false; end if;

  v_lista := p_perfil->'pdvs';
  if jsonb_typeof(v_lista)='array' then
    for v_item in select jsonb_array_elements_text(v_lista) loop
      if upper(trim(v_item))=upper(trim(coalesce(p_pdv,''))) then return true; end if;
    end loop;
  end if;
  if v_rol='PDV' then return false; end if;

  v_lista := p_perfil->'areas';
  if jsonb_typeof(v_lista)='array' and v_area<>'' then
    for v_item in select jsonb_array_elements_text(v_lista) loop
      v_item := upper(trim(v_item));
      if v_item<>'' and (v_item=v_area or strpos(v_item,v_area)>0 or strpos(v_area,v_item)>0) then return true; end if;
    end loop;
  end if;

  v_lista := p_perfil->'regiones';
  if jsonb_typeof(v_lista)='array' and v_region<>'' then
    for v_item in select jsonb_array_elements_text(v_lista) loop
      v_item := upper(trim(v_item));
      if v_item<>'' and (v_item=v_region or strpos(v_item,v_region)>0 or strpos(v_region,v_item)>0) then return true; end if;
    end loop;
  end if;
  return false;
exception when others then
  return false;
end;
$$;

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
  if v_rol not in ('ADMINISTRADOR','ENCARGADO') then
    raise exception 'El módulo SLA está disponible para administradores y encargados.' using errcode='42501';
  end if;
  if not public.v16_gestion_modulo_permitido('sla_paquetes','ver',v_perfil) then
    raise exception 'Tu usuario no tiene permiso para ver el módulo SLA.' using errcode='42501';
  end if;
  if v_accion in ('guardar_parametros','guardar_precios','iniciar_carga','guardar_bloque','publicar_carga','cancelar_carga')
     and not public.v16_gestion_modulo_permitido('sla_paquetes','ejecutar',v_perfil) then
    raise exception 'Tu usuario puede consultar el SLA, pero no ejecutar cambios.' using errcode='42501';
  end if;

  if v_accion='config' then
    return jsonb_build_object(
      'umbral_horas',(select c.umbral_horas from v16_private.gestion_sla_configuracion c where c.id=1),
      'tarifa_porcentaje',(select c.tarifa_porcentaje from v16_private.gestion_sla_configuracion c where c.id=1),
      'rangos',coalesce((select jsonb_agg(jsonb_build_object('orden',r.orden,'desde_horas',r.desde_horas,'hasta_horas',r.hasta_horas,'tarifa_porcentaje',r.tarifa_porcentaje) order by r.orden) from v16_private.gestion_sla_rangos r),'[]'::jsonb),
      'precios',coalesce((
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
      ),'[]'::jsonb),
      'actualizado_en',(select c.actualizado_en from v16_private.gestion_sla_configuracion c where c.id=1),
      'dataset',(select jsonb_build_object('id',c.id,'archivo',c.archivo,'filas',c.filas_esperadas,'creado_en',c.creado_en)
                 from v16_private.gestion_sla_cargas c where c.activa)
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

revoke all on function public.v16_gestion_v2_sla_alcance(text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.v16_gestion_sla_geo_clave(text) from public,anon,authenticated;
revoke all on function public.v16_gestion_modulo_permitido(text,text,jsonb) from public,anon,authenticated;
revoke all on function public.v16_gestion_modulos_usuario(text,jsonb) from public,anon,authenticated;
revoke all on function public.v16_gestion_v2_sla_paquetes(text,jsonb) from public,anon,authenticated;
grant execute on function public.v16_gestion_modulos_usuario(text,jsonb) to authenticated;
grant execute on function public.v16_gestion_v2_sla_paquetes(text,jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
