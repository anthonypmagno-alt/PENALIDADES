-- Penalidades V2: almacenamiento relacional y por filas.
-- Ejecutar en el proyecto existente akultekodxqmmfchxviq.
-- Esta migración es aditiva: no modifica Auth, otros módulos ni los datos V1.

-- Lista de acceso específica del módulo. Si ya existe por una instalación V1,
-- se conserva; las cuentas Auth existentes se agregan solo si aún no figuran.
create table if not exists public.exo_authorized_users (
  email text primary key check (email = lower(btrim(email))),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.exo_authorized_users enable row level security;
revoke all on public.exo_authorized_users from anon, authenticated;
insert into public.exo_authorized_users(email,active)
select lower(btrim(email)),true
from auth.users
where nullif(btrim(email),'') is not null
on conflict(email) do nothing;

-- Metadatos de carga; no se guardan los Excel originales.
create table if not exists public.penalidades_cargas (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('liquidacion','brecha','exportacion','zonificacion')),
  periodo text,
  nombre_archivo text not null,
  filas integer not null default 0,
  creado_por uuid not null default auth.uid(),
  creado_en timestamptz not null default now()
);

create table if not exists public.penalidades_liquidaciones (
  id uuid primary key default gen_random_uuid(),
  record_key text not null unique,
  periodo text not null check (periodo ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  pdv text not null,
  nombre text,
  creado_por uuid not null default auth.uid(),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (periodo,pdv)
);

-- Una fila representa una penalidad de la hoja LISTA DETALLADA DE PENALIDAD.
-- Los campos de los otros tres Excel se reducen a sus columnas requeridas y
-- se asocian por las claves normalizadas calculadas por el importador.
create table if not exists public.penalidades_guias (
  id text primary key,
  liquidacion_id uuid not null references public.penalidades_liquidaciones(id) on delete cascade,
  tracking text not null,
  tracking_key text not null,
  pdv text not null,
  pdv_key text not null,
  penalizacion text not null default '',
  brecha text not null default '',
  sla text not null default '',
  brecha_liquidacion text not null default '',
  sla_liquidacion text not null default '',
  costo numeric(14,2) not null default 0,
  fecha text not null default '',
  motivo_origen text not null default '',
  observaciones text not null default '',
  distrito text not null default '',
  provincia text not null default '',
  departamento text not null default '',
  tipo_operacion_reciente text not null default '',
  operacion_brecha text not null default '',
  brecha_horas text not null default '',
  brecha_ultima_actualizacion text not null default '',
  tipo_escaneo_reciente text not null default '',
  estatus_firma text not null default '',
  tipo_zona text not null default '',
  zona text not null default '',
  sla_asignado_dias text not null default '',
  coincidencia_zona boolean not null default false,
  origen_archivo text not null default '',
  zona_manual jsonb,
  actualizado_en timestamptz not null default now()
);

create table if not exists public.penalidades_decisiones (
  guia_id text primary key references public.penalidades_guias(id) on delete cascade,
  porcentaje numeric(5,2) not null default 0 check (porcentaje >= 0 and porcentaje <= 100),
  motivo text not null default '',
  actualizado_por uuid not null default auth.uid(),
  actualizado_en timestamptz not null default now()
);

create table if not exists public.penalidades_grupos (
  id text primary key default gen_random_uuid()::text,
  nombre text not null unique,
  creado_por uuid not null default auth.uid(),
  creado_en timestamptz not null default now()
);

create table if not exists public.penalidades_liquidacion_grupos (
  liquidacion_id uuid primary key references public.penalidades_liquidaciones(id) on delete cascade,
  grupo_id text references public.penalidades_grupos(id) on delete set null
);

create table if not exists public.penalidades_control (singleton boolean primary key default true check(singleton), v2_activo boolean not null default false, activado_en timestamptz);
insert into public.penalidades_control(singleton) values(true) on conflict(singleton) do nothing;

create index if not exists idx_penalidades_liquidacion_periodo_pdv
  on public.penalidades_liquidaciones(periodo,pdv);
create index if not exists idx_penalidades_guias_liquidacion
  on public.penalidades_guias(liquidacion_id);
create index if not exists idx_penalidades_guias_pdv_tracking
  on public.penalidades_guias(pdv_key,tracking_key);
create index if not exists idx_penalidades_guias_penalizacion
  on public.penalidades_guias(penalizacion);
create index if not exists idx_penalidades_guias_zona_sla
  on public.penalidades_guias(tipo_zona,sla_asignado_dias);

alter table public.penalidades_cargas enable row level security;
alter table public.penalidades_liquidaciones enable row level security;
alter table public.penalidades_guias enable row level security;
alter table public.penalidades_decisiones enable row level security;
alter table public.penalidades_grupos enable row level security;
alter table public.penalidades_liquidacion_grupos enable row level security;
alter table public.penalidades_control enable row level security;

-- Sin acceso directo a tablas: se accede mediante funciones que validan sesión.
revoke all on public.penalidades_cargas, public.penalidades_liquidaciones,
  public.penalidades_guias, public.penalidades_decisiones,
  public.penalidades_grupos, public.penalidades_liquidacion_grupos
  from anon, authenticated;
revoke all on public.penalidades_control from anon,authenticated;

create or replace function public.penalidades_usuario_autorizado()
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.exo_authorized_users u
    where u.active and lower(u.email)=lower(coalesce(auth.jwt()->>'email',''))
  );
$$;

create or replace function public.penalidades_upsert_lote(p_liquidacion jsonb, p_guias jsonb)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_liquidacion_id uuid;
  v_periodo text := p_liquidacion->>'periodo';
  v_pdv text := p_liquidacion->>'pdv';
  v_count integer := 0;
begin
  if not public.penalidades_usuario_autorizado() then
    raise exception 'Cuenta no autorizada.' using errcode='42501';
  end if;
  if v_periodo !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or coalesce(v_pdv,'')='' then
    raise exception 'Periodo o PDV inválido.' using errcode='22023';
  end if;
  if jsonb_typeof(p_guias) is distinct from 'array' or jsonb_array_length(p_guias)>1000 then
    raise exception 'El lote debe ser un arreglo de hasta 1000 guías.' using errcode='22023';
  end if;
  insert into public.penalidades_liquidaciones(record_key,periodo,pdv,nombre,actualizado_en)
  values(coalesce(p_liquidacion->>'id',v_periodo||'|'||upper(regexp_replace(v_pdv,'[^A-Za-z0-9]+','','g'))),v_periodo,v_pdv,p_liquidacion->>'nombre',now())
  on conflict(periodo,pdv) do update set record_key=excluded.record_key,nombre=excluded.nombre,actualizado_en=now()
  returning id into v_liquidacion_id;

  insert into public.penalidades_guias(
    id,liquidacion_id,tracking,tracking_key,pdv,pdv_key,penalizacion,brecha,sla,brecha_liquidacion,sla_liquidacion,costo,fecha,
    motivo_origen,observaciones,distrito,provincia,departamento,tipo_operacion_reciente,operacion_brecha,brecha_horas,brecha_ultima_actualizacion,
    tipo_escaneo_reciente,estatus_firma,tipo_zona,zona,sla_asignado_dias,coincidencia_zona,origen_archivo,
    zona_manual
  )
  select x.id,v_liquidacion_id,x.tracking,x.tracking_key,v_pdv,x.pdv_key,x.penalizacion,x.brecha,x.sla,x.brecha_liquidacion,x.sla_liquidacion,
    x.costo,x.fecha,x.motivo_origen,x.observaciones,x.distrito,x.provincia,x.departamento,
    x.tipo_operacion_reciente,x.operacion_brecha,x.brecha_horas,x.brecha_ultima_actualizacion,x.tipo_escaneo_reciente,x.estatus_firma,x.tipo_zona,x.zona,
    x.sla_asignado_dias,x.coincidencia_zona,x.origen_archivo,x.zona_manual
  from jsonb_to_recordset(p_guias) as x(
    id text,tracking text,tracking_key text,pdv_key text,penalizacion text,brecha text,sla text,brecha_liquidacion text,sla_liquidacion text,
    costo numeric,fecha text,motivo_origen text,observaciones text,distrito text,provincia text,
    departamento text,tipo_operacion_reciente text,operacion_brecha text,brecha_horas text,brecha_ultima_actualizacion text,tipo_escaneo_reciente text,estatus_firma text,
    tipo_zona text,zona text,sla_asignado_dias text,coincidencia_zona boolean,origen_archivo text,
    porcentaje_exoneracion numeric,motivo_decision text,modificado_en text,zona_manual jsonb
  )
  on conflict(id) do update set
    liquidacion_id=excluded.liquidacion_id,tracking=excluded.tracking,tracking_key=excluded.tracking_key,
    pdv=excluded.pdv,pdv_key=excluded.pdv_key,penalizacion=excluded.penalizacion,
    brecha=excluded.brecha,sla=excluded.sla,brecha_liquidacion=excluded.brecha_liquidacion,sla_liquidacion=excluded.sla_liquidacion,costo=excluded.costo,fecha=excluded.fecha,
    motivo_origen=excluded.motivo_origen,observaciones=excluded.observaciones,distrito=excluded.distrito,
    provincia=excluded.provincia,departamento=excluded.departamento,
    tipo_operacion_reciente=excluded.tipo_operacion_reciente,operacion_brecha=excluded.operacion_brecha,
    brecha_horas=excluded.brecha_horas,brecha_ultima_actualizacion=excluded.brecha_ultima_actualizacion,
    tipo_escaneo_reciente=excluded.tipo_escaneo_reciente,estatus_firma=excluded.estatus_firma,
    tipo_zona=excluded.tipo_zona,zona=excluded.zona,sla_asignado_dias=excluded.sla_asignado_dias,
    coincidencia_zona=excluded.coincidencia_zona,origen_archivo=excluded.origen_archivo,
    zona_manual=excluded.zona_manual,actualizado_en=now();
  insert into public.penalidades_decisiones(guia_id,porcentaje,motivo,actualizado_en)
    select x.id,coalesce(x.porcentaje_exoneracion,0),coalesce(x.motivo_decision,''),coalesce(nullif(x.modificado_en,'')::timestamptz,now())
    from jsonb_to_recordset(p_guias) as x(id text,porcentaje_exoneracion numeric,motivo_decision text,modificado_en text)
    on conflict(guia_id) do update set porcentaje=excluded.porcentaje,motivo=excluded.motivo,actualizado_en=excluded.actualizado_en,actualizado_por=auth.uid();
  get diagnostics v_count = row_count;
  return jsonb_build_object('ok',true,'liquidacion_id',v_liquidacion_id,'guias_afectadas',v_count);
end $$;

create or replace function public.penalidades_guardar_decisiones(p_decisiones jsonb)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_count integer;
begin
  if not public.penalidades_usuario_autorizado() then
    raise exception 'Cuenta no autorizada.' using errcode='42501';
  end if;
  if jsonb_typeof(p_decisiones) is distinct from 'array' or jsonb_array_length(p_decisiones)>1000 then
    raise exception 'El lote debe ser un arreglo de hasta 1000 decisiones.' using errcode='22023';
  end if;
  insert into public.penalidades_decisiones(guia_id,porcentaje,motivo)
  select x.guia_id,x.porcentaje,x.motivo
  from jsonb_to_recordset(p_decisiones) as x(guia_id text,porcentaje numeric,motivo text)
  on conflict(guia_id) do update set porcentaje=excluded.porcentaje,motivo=excluded.motivo,
    actualizado_por=auth.uid(),actualizado_en=now();
  get diagnostics v_count = row_count;
  return jsonb_build_object('ok',true,'decisiones_guardadas',v_count);
end $$;

create or replace function public.penalidades_listar_liquidaciones()
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.penalidades_usuario_autorizado() then
    raise exception 'Cuenta no autorizada.' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(q) order by q.periodo desc,q.pdv)
    from (select l.id,l.periodo,l.pdv,l.nombre,l.actualizado_en,
      count(g.id)::integer as total_guias,
      count(*) filter(where coalesce(d.porcentaje,0)>0)::integer as con_exoneracion,
      coalesce(sum(g.costo),0)::numeric(14,2) as penalidad_total,
      coalesce(sum(g.costo*coalesce(d.porcentaje,0)/100),0)::numeric(14,2) as monto_exonerado
      from public.penalidades_liquidaciones l
      left join public.penalidades_guias g on g.liquidacion_id=l.id
      left join public.penalidades_decisiones d on d.guia_id=g.id
      group by l.id) q), '[]'::jsonb);
end $$;

-- Estado compatible para validación/migración desde el HTML anterior.
create or replace function public.penalidades_obtener_estado()
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_records jsonb;
begin
  if not public.penalidades_usuario_autorizado() then
    raise exception 'Cuenta no autorizada.' using errcode='42501';
  end if;
  if not exists(select 1 from public.penalidades_control where singleton=true and v2_activo) then
    return jsonb_build_object('version',1,'serverRevision',0,'sources',jsonb_build_object('penalties',null,'breaches',null,'guides',null,'zones',null),'records','[]'::jsonb,'groups','[]'::jsonb,'deletedRecords','{}'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',l.record_key,
    'period',l.periodo,'pdv',l.pdv,'createdAt',l.creado_en,'updatedAt',l.actualizado_en,
    'groupId',(select m.grupo_id from public.penalidades_liquidacion_grupos m where m.liquidacion_id=l.id),
    'items',coalesce(q.rows,'[]'::jsonb)
  ) order by l.periodo desc,l.pdv),'[]'::jsonb) into v_records
  from public.penalidades_liquidaciones l
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'id',g.id,'tracking',g.tracking,'pdv',g.pdv,'penalty',g.penalizacion,'breach',g.brecha,
      'sla',g.sla,'liquidationBreach',g.brecha_liquidacion,'liquidationSla',g.sla_liquidacion,'cost',g.costo,'dateRaw',g.fecha,'motive',g.motivo_origen,
      'observations',g.observaciones,'district',g.distrito,'province',g.provincia,
      'department',g.departamento,'latestOperation',g.tipo_operacion_reciente,
      'breachOperation',g.operacion_brecha,'breachWaitHours',g.brecha_horas,'breachLastUpdate',g.brecha_ultima_actualizacion,'scanType',g.tipo_escaneo_reciente,
      'signature',g.estatus_firma,'zoneType',g.tipo_zona,'zoneName',g.zona,
      'slaDays',g.sla_asignado_dias,'zoneMatched',g.coincidencia_zona,
      'sourceFile',g.origen_archivo,'exemptionPercent',coalesce(d.porcentaje,0),
      'exonerated',coalesce(d.porcentaje,0)>0,'reason',coalesce(d.motivo,''),
      'modifiedAt',d.actualizado_en,'breachMatched',g.operacion_brecha<>'',
      'guideMatched',g.distrito<>'' or g.provincia<>'' or g.departamento<>'',
      'sourceRow',0,'period',l.periodo,
      'costRaw',g.costo::text,'sourceZone',g.zona,'manualZone',g.zona_manual
    ) order by g.tracking,g.penalizacion,g.id) as rows
    from public.penalidades_guias g left join public.penalidades_decisiones d on d.guia_id=g.id where g.liquidacion_id=l.id
  ) q on true;
  return jsonb_build_object('version',1,'serverRevision',0,
    'sources',jsonb_build_object('penalties',null,'breaches',null,'guides',null,'zones',null),
    'records',v_records,'groups',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',nombre,'createdAt',creado_en,'updatedAt',creado_en) order by nombre) from public.penalidades_grupos),'[]'::jsonb),'deletedRecords','{}'::jsonb);
end $$;

create or replace function public.penalidades_activar_v2()
returns boolean language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.penalidades_usuario_autorizado() then raise exception 'Cuenta no autorizada.' using errcode='42501'; end if;
  update public.penalidades_control set v2_activo=true,activado_en=now() where singleton=true;
  return true;
end $$;

create or replace function public.penalidades_borrar_guias(p_ids text[])
returns integer language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_count integer;
begin
  if not public.penalidades_usuario_autorizado() then
    raise exception 'Cuenta no autorizada.' using errcode='42501';
  end if;
  delete from public.penalidades_guias where id=any(p_ids);
  get diagnostics v_count=row_count;
  return v_count;
end $$;


create or replace function public.penalidades_borrar_liquidaciones(p_record_keys text[])
returns integer language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_count integer;
begin
  if not public.penalidades_usuario_autorizado() then
    raise exception 'Cuenta no autorizada.' using errcode='42501';
  end if;
  if p_record_keys is null or cardinality(p_record_keys)>1000 then
    raise exception 'La lista debe contener hasta 1000 registros.' using errcode='22023';
  end if;
  -- Una sola operación transaccional; las guías, decisiones y asignaciones
  -- se eliminan por las claves foráneas ON DELETE CASCADE.
  delete from public.penalidades_liquidaciones
  where record_key=any(p_record_keys);
  get diagnostics v_count=row_count;
  return v_count;
end $$;

create or replace function public.penalidades_guardar_grupos(p_grupos jsonb, p_asignaciones jsonb default '[]'::jsonb)
returns boolean language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.penalidades_usuario_autorizado() then raise exception 'Cuenta no autorizada.' using errcode='42501'; end if;
  if jsonb_typeof(p_grupos) is distinct from 'array' or jsonb_array_length(p_grupos)>500 then raise exception 'Lista de grupos inválida.' using errcode='22023'; end if;
  if jsonb_typeof(coalesce(p_asignaciones,'[]'::jsonb)) is distinct from 'array' or jsonb_array_length(coalesce(p_asignaciones,'[]'::jsonb))>10000 then raise exception 'Lista de asignaciones inválida.' using errcode='22023'; end if;

  -- Sincroniza por diferencia: no borra y recrea todas las filas en cada guardado.
  delete from public.penalidades_liquidacion_grupos m
  using public.penalidades_liquidaciones l
  where l.id=m.liquidacion_id
    and not exists (
      select 1 from jsonb_array_elements(coalesce(p_asignaciones,'[]'::jsonb)) a
      where a->>'recordKey'=l.record_key
    );

  delete from public.penalidades_grupos g
  where not exists (
    select 1 from jsonb_array_elements(p_grupos) item
    where item->>'id'=g.id
  );

  insert into public.penalidades_grupos(id,nombre,creado_en)
    select item->>'id',item->>'name',coalesce(nullif(item->>'createdAt','')::timestamptz,now())
    from jsonb_array_elements(p_grupos) item
    where coalesce(item->>'id','')<>'' and coalesce(item->>'name','')<>''
    on conflict(id) do update set nombre=excluded.nombre;

  insert into public.penalidades_liquidacion_grupos(liquidacion_id,grupo_id)
    select l.id,a->>'groupId'
    from jsonb_array_elements(coalesce(p_asignaciones,'[]'::jsonb)) a
    join public.penalidades_liquidaciones l on l.record_key=a->>'recordKey'
    join public.penalidades_grupos g on g.id=a->>'groupId'
    on conflict(liquidacion_id) do update set grupo_id=excluded.grupo_id;
  return true;
end $$;

create or replace function public.penalidades_borrar_liquidaciones_vacias()
returns integer language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_count integer;
begin
  if not public.penalidades_usuario_autorizado() then raise exception 'Cuenta no autorizada.' using errcode='42501'; end if;
  delete from public.penalidades_liquidaciones l where not exists(select 1 from public.penalidades_guias g where g.liquidacion_id=l.id);
  get diagnostics v_count=row_count;
  return v_count;
end $$;

create or replace function public.penalidades_obtener_detalle(p_liquidacion_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.penalidades_usuario_autorizado() then
    raise exception 'Cuenta no autorizada.' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(q) order by q.tracking,q.penalizacion,q.id)
    from (select g.*,coalesce(d.porcentaje,0) as porcentaje_exoneracion,coalesce(d.motivo,'') as motivo_decision,d.actualizado_en as fecha_modificacion from public.penalidades_guias g left join public.penalidades_decisiones d on d.guia_id=g.id where g.liquidacion_id=p_liquidacion_id) q), '[]'::jsonb);
end $$;

revoke all on function public.penalidades_usuario_autorizado() from public,anon,authenticated;
revoke all on function public.penalidades_upsert_lote(jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.penalidades_guardar_decisiones(jsonb) from public,anon,authenticated;
revoke all on function public.penalidades_listar_liquidaciones() from public,anon,authenticated;
revoke all on function public.penalidades_obtener_detalle(uuid) from public,anon,authenticated;
revoke all on function public.penalidades_obtener_estado() from public,anon,authenticated;
revoke all on function public.penalidades_activar_v2() from public,anon,authenticated;
revoke all on function public.penalidades_borrar_guias(text[]) from public,anon,authenticated;
revoke all on function public.penalidades_borrar_liquidaciones(text[]) from public,anon,authenticated;
revoke all on function public.penalidades_guardar_grupos(jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.penalidades_borrar_liquidaciones_vacias() from public,anon,authenticated;
grant execute on function public.penalidades_upsert_lote(jsonb,jsonb) to authenticated;
grant execute on function public.penalidades_guardar_decisiones(jsonb) to authenticated;
grant execute on function public.penalidades_listar_liquidaciones() to authenticated;
grant execute on function public.penalidades_obtener_detalle(uuid) to authenticated;
grant execute on function public.penalidades_obtener_estado() to authenticated;
grant execute on function public.penalidades_activar_v2() to authenticated;
grant execute on function public.penalidades_borrar_guias(text[]) to authenticated;
grant execute on function public.penalidades_borrar_liquidaciones(text[]) to authenticated;
grant execute on function public.penalidades_guardar_grupos(jsonb,jsonb) to authenticated;
grant execute on function public.penalidades_borrar_liquidaciones_vacias() to authenticated;

-- IMPORTANTE: No elimina ni convierte exoneraciones_app_state. El estado V1
-- permanece intacto hasta validar migración y comparar cantidades y decisiones.
