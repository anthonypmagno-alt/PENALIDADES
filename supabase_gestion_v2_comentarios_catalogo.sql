-- Catálogo compartido de Subcampo 1 / Subcampo 2 y clasificación del comentario
-- de encargado por guía y PDV. Ejecutar una sola vez en el proyecto Supabase V16.
-- No modifica ni elimina comentarios, perfiles, guías, fuentes o decisiones existentes.
-- No cambia storage.objects ni sus políticas.
begin;

create table if not exists v16_private.gestion_comentario_subcampo1 (
  clave text primary key check (length(btrim(clave)) between 1 and 100),
  etiqueta text not null check (length(btrim(etiqueta)) between 1 and 100),
  orden integer not null default 0,
  activo boolean not null default true,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references auth.users(id)
);

create table if not exists v16_private.gestion_comentario_subcampo2 (
  subcampo1_clave text not null references v16_private.gestion_comentario_subcampo1(clave),
  clave text not null check (length(btrim(clave)) between 1 and 100),
  etiqueta text not null check (length(btrim(etiqueta)) between 1 and 100),
  orden integer not null default 0,
  activo boolean not null default true,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references auth.users(id),
  primary key (subcampo1_clave, clave)
);

create table if not exists v16_private.gestion_comentario_clasificaciones (
  guia_clave text not null check (length(btrim(guia_clave)) between 1 and 200),
  pdv_clave text not null check (length(btrim(pdv_clave)) between 1 and 200),
  guia text not null check (length(btrim(guia)) between 1 and 200),
  pdv text not null check (length(btrim(pdv)) between 1 and 200),
  area text not null default '',
  region text not null default '',
  subcampo1 text not null default '',
  subcampo2 text not null default '',
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references auth.users(id),
  primary key (guia_clave, pdv_clave),
  check (guia_clave = upper(btrim(guia))),
  check (pdv_clave = upper(btrim(pdv)))
);

create index if not exists gestion_comentario_clasificaciones_scope_idx
  on v16_private.gestion_comentario_clasificaciones (pdv_clave, guia_clave);

alter table v16_private.gestion_comentario_subcampo1 enable row level security;
alter table v16_private.gestion_comentario_subcampo2 enable row level security;
alter table v16_private.gestion_comentario_clasificaciones enable row level security;
revoke all on table v16_private.gestion_comentario_subcampo1 from public, anon, authenticated;
revoke all on table v16_private.gestion_comentario_subcampo2 from public, anon, authenticated;
revoke all on table v16_private.gestion_comentario_clasificaciones from public, anon, authenticated;

-- Catálogo inicial solicitado. Las tablas y los valores existentes se conservan.
insert into v16_private.gestion_comentario_subcampo1 (clave, etiqueta, orden)
values ('ENTREGA','ENTREGA',1),('DEVOLUCIÓN','DEVOLUCIÓN',2),('TRASLADO','TRASLADO',3),('OTROS','OTROS',4)
on conflict (clave) do nothing;

insert into v16_private.gestion_comentario_subcampo2 (subcampo1_clave, clave, etiqueta, orden)
values
 ('ENTREGA','PENDIENTE ACTUALIZAR','PENDIENTE ACTUALIZAR',1),
 ('ENTREGA','PENDIENTE GESTIONAR ANOMALIAS','PENDIENTE GESTIONAR ANOMALIAS',2),
 ('ENTREGA','ERROR DE CLASIFICACIÓN','ERROR DE CLASIFICACIÓN',3),
 ('ENTREGA','POSIBLE PERDIDA','POSIBLE PERDIDA',4),
 ('DEVOLUCIÓN','PENDIENTE REGISTRAR DEVOLUCIÓN','PENDIENTE REGISTRAR DEVOLUCIÓN',1),
 ('DEVOLUCIÓN','PENDIENTE CARGAR A OT','PENDIENTE CARGAR A OT',2),
 ('DEVOLUCIÓN','PENDIENTE LLEGADA AL CALLAO','PENDIENTE LLEGADA AL CALLAO',3),
 ('DEVOLUCIÓN','PENDIENTE PROCESAR AL CALLAO','PENDIENTE PROCESAR AL CALLAO',4)
on conflict (subcampo1_clave, clave) do nothing;

create or replace function public.v16_gestion_v2_comentario_alcance(
  p_pdv text, p_area text, p_region text, p_perfil jsonb
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
  if v_rol<>'ENCARGADO' then return false; end if;

  v_lista := p_perfil->'pdvs';
  if jsonb_typeof(v_lista)='array' then
    for v_item in select jsonb_array_elements_text(v_lista) loop
      if upper(trim(v_item))=upper(trim(coalesce(p_pdv,''))) then return true; end if;
    end loop;
  end if;

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

create or replace function public.v16_gestion_v2_comentarios(
  accion text,
  payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_perfil jsonb;
  v_rol text;
  v_item jsonb;
  v_parent text;
  v_label text;
  v_subcampo1 text;
  v_subcampo2 text;
  v_guia text;
  v_pdv text;
  v_area text;
  v_region text;
  v_total integer := 0;
  v_s1 jsonb;
  v_s2 jsonb;
  v_clasificaciones jsonb;
  v_registros jsonb;
begin
  if auth.uid() is null then
    raise exception 'Inicia sesión para usar la configuración de comentarios.' using errcode='42501';
  end if;
  v_perfil := to_jsonb(v16_private.profile());
  v_rol := upper(coalesce(v_perfil->>'rol',''));
  if v_rol not in ('ADMINISTRADOR','ENCARGADO') then
    raise exception 'Solo administradores y encargados pueden usar la clasificación del comentario.' using errcode='42501';
  end if;

  if accion in ('listar_catalogo','guardar_catalogo') then
    if accion='guardar_catalogo' and not public.v16_gestion_modulo_permitido('catalogo_comentarios','ejecutar',v_perfil) then
      raise exception 'Tu usuario no tiene permiso para guardar el catálogo de comentarios.' using errcode='42501';
    elsif accion='listar_catalogo'
       and not public.v16_gestion_modulo_permitido('catalogo_comentarios','ver',v_perfil)
       and not public.v16_gestion_modulo_permitido('gestion_v2','ver',v_perfil) then
      raise exception 'Tu usuario no tiene permiso para esta acción del catálogo de comentarios.' using errcode='42501';
    end if;
  elsif accion in ('listar_clasificaciones','guardar_clasificaciones') then
    if not public.v16_gestion_modulo_permitido('gestion_v2',case when accion='guardar_clasificaciones' then 'ejecutar' else 'ver' end,v_perfil) then
      raise exception 'Tu usuario no tiene permiso para esta acción de Gestión de Guías V2.' using errcode='42501';
    end if;
  end if;

  if accion in ('listar_catalogo','guardar_catalogo') then
    if accion='guardar_catalogo' and v_rol<>'ADMINISTRADOR' then
      raise exception 'Solo el administrador puede modificar el catálogo.' using errcode='42501';
    end if;

    if accion='guardar_catalogo' then
      if jsonb_typeof(payload->'subcampos1') is distinct from 'array'
         or jsonb_typeof(payload->'opciones') is distinct from 'array' then
        raise exception 'Envía las listas de Subcampo 1 y Subcampo 2.' using errcode='22023';
      end if;
      if jsonb_array_length(payload->'subcampos1') not between 1 and 100
         or jsonb_array_length(payload->'opciones')>1000 then
        raise exception 'El catálogo debe tener entre 1 y 100 valores de Subcampo 1 y hasta 1000 opciones de Subcampo 2.' using errcode='22023';
      end if;
      if exists (
        select 1 from jsonb_array_elements(payload->'subcampos1') as item(value)
        where length(btrim(coalesce(item.value->>'etiqueta',''))) not between 1 and 100
      ) then
        raise exception 'Cada valor de Subcampo 1 debe tener entre 1 y 100 caracteres.' using errcode='22023';
      end if;
      if exists (
        select 1 from jsonb_array_elements(payload->'subcampos1') as item(value)
        group by upper(btrim(item.value->>'etiqueta')) having count(*)>1
      ) then
        raise exception 'Los valores de Subcampo 1 no pueden repetirse.' using errcode='22023';
      end if;
      if exists (
        select 1 from jsonb_array_elements(payload->'opciones') as item(value)
        where length(btrim(coalesce(item.value->>'subcampo1',''))) not between 1 and 100
           or length(btrim(coalesce(item.value->>'subcampo2',''))) not between 1 and 100
      ) then
        raise exception 'Cada opción de Subcampo 2 debe tener un padre y un nombre de hasta 100 caracteres.' using errcode='22023';
      end if;
      if exists (
        select 1 from jsonb_array_elements(payload->'opciones') as item(value)
        where not exists (
          select 1 from jsonb_array_elements(payload->'subcampos1') as parent(value)
          where upper(btrim(parent.value->>'etiqueta'))=upper(btrim(item.value->>'subcampo1'))
        )
      ) then
        raise exception 'Hay opciones de Subcampo 2 asociadas a un Subcampo 1 que no está en el catálogo.' using errcode='22023';
      end if;
      if exists (
        select 1 from jsonb_array_elements(payload->'opciones') as item(value)
        group by upper(btrim(item.value->>'subcampo1')),upper(btrim(item.value->>'subcampo2')) having count(*)>1
      ) then
        raise exception 'Las opciones de Subcampo 2 no pueden repetirse dentro del mismo Subcampo 1.' using errcode='22023';
      end if;

      update v16_private.gestion_comentario_subcampo1
        set activo=false, actualizado_en=now(), actualizado_por=auth.uid()
        where activo is distinct from false;
      update v16_private.gestion_comentario_subcampo2
        set activo=false, actualizado_en=now(), actualizado_por=auth.uid()
        where activo is distinct from false;

      for v_item in select value from jsonb_array_elements(payload->'subcampos1') loop
        v_label := btrim(v_item->>'etiqueta');
        v_parent := upper(v_label);
        insert into v16_private.gestion_comentario_subcampo1
          (clave,etiqueta,orden,activo,actualizado_en,actualizado_por)
        values (v_parent,v_label,v_total,true,now(),auth.uid())
        on conflict (clave) do update set etiqueta=excluded.etiqueta,orden=excluded.orden,
          activo=true,actualizado_en=now(),actualizado_por=auth.uid();
        v_total := v_total+1;
      end loop;

      v_total := 0;
      for v_item in select value from jsonb_array_elements(payload->'opciones') loop
        v_parent := upper(btrim(v_item->>'subcampo1'));
        v_label := btrim(v_item->>'subcampo2');
        insert into v16_private.gestion_comentario_subcampo2
          (subcampo1_clave,clave,etiqueta,orden,activo,actualizado_en,actualizado_por)
        values (v_parent,upper(v_label),v_label,v_total,true,now(),auth.uid())
        on conflict (subcampo1_clave,clave) do update set etiqueta=excluded.etiqueta,orden=excluded.orden,
          activo=true,actualizado_en=now(),actualizado_por=auth.uid();
        v_total := v_total+1;
      end loop;
    end if;

    select coalesce(jsonb_agg(etiqueta order by orden,etiqueta),'[]'::jsonb)
      into v_s1 from v16_private.gestion_comentario_subcampo1 where activo;
    select coalesce(jsonb_agg(jsonb_build_object('subcampo1',p.etiqueta,'subcampo2',c.etiqueta)
      order by p.orden,c.orden,c.etiqueta),'[]'::jsonb)
      into v_s2
      from v16_private.gestion_comentario_subcampo2 c
      join v16_private.gestion_comentario_subcampo1 p on p.clave=c.subcampo1_clave and p.activo
      where c.activo;
    return jsonb_build_object('ok',true,'subcampos1',v_s1,'opciones',v_s2);
  end if;

  if accion='listar_clasificaciones' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'guia',c.guia,'pdv',c.pdv,'area',c.area,'region',c.region,
      'subcampo1',c.subcampo1,'subcampo2',c.subcampo2
    ) order by c.pdv,c.guia),'[]'::jsonb)
    into v_clasificaciones
    from v16_private.gestion_comentario_clasificaciones c
    where public.v16_gestion_v2_comentario_alcance(c.pdv,c.area,c.region,v_perfil);
    return jsonb_build_object('ok',true,'clasificaciones',v_clasificaciones);
  end if;

  if accion='guardar_clasificaciones' then
    if jsonb_typeof(payload->'registros') is distinct from 'array' then
      raise exception 'Envía una lista de clasificaciones por guía.' using errcode='22023';
    end if;
    if jsonb_array_length(payload->'registros')>500 then
      raise exception 'Guarda como máximo 500 clasificaciones por operación.' using errcode='22023';
    end if;
    for v_item in select value from jsonb_array_elements(payload->'registros') loop
      v_guia := btrim(coalesce(v_item->>'guia',''));
      v_pdv := btrim(coalesce(v_item->>'pdv',''));
      v_area := btrim(coalesce(v_item->>'area',''));
      v_region := btrim(coalesce(v_item->>'region',''));
      v_subcampo1 := btrim(coalesce(v_item->>'subcampo1',''));
      v_subcampo2 := btrim(coalesce(v_item->>'subcampo2',''));
      if length(v_guia) not between 1 and 200 or length(v_pdv) not between 1 and 200 then
        raise exception 'Una clasificación no contiene guía y PDV válidos.' using errcode='22023';
      end if;
      if not public.v16_gestion_v2_comentario_alcance(v_pdv,v_area,v_region,v_perfil) then
        raise exception 'No tienes acceso al PDV o área de una de las guías seleccionadas.' using errcode='42501';
      end if;
      if v_subcampo1='' and v_subcampo2<>'' then
        raise exception 'Selecciona Subcampo 1 antes de Subcampo 2.' using errcode='22023';
      end if;
      if v_subcampo1<>'' and not exists (
        select 1 from v16_private.gestion_comentario_subcampo1
        where clave=upper(v_subcampo1) and activo
      ) and not exists (
        select 1 from v16_private.gestion_comentario_clasificaciones
        where guia_clave=upper(v_guia) and pdv_clave=upper(v_pdv)
          and upper(subcampo1)=upper(v_subcampo1) and upper(subcampo2)=upper(v_subcampo2)
      ) then
        raise exception 'El valor seleccionado de Subcampo 1 ya no está activo.' using errcode='22023';
      end if;
      if v_subcampo2<>'' and not exists (
        select 1 from v16_private.gestion_comentario_subcampo2
        where subcampo1_clave=upper(v_subcampo1) and clave=upper(v_subcampo2) and activo
      ) and not exists (
        select 1 from v16_private.gestion_comentario_clasificaciones
        where guia_clave=upper(v_guia) and pdv_clave=upper(v_pdv)
          and upper(subcampo1)=upper(v_subcampo1) and upper(subcampo2)=upper(v_subcampo2)
      ) then
        raise exception 'La opción seleccionada de Subcampo 2 no corresponde al Subcampo 1 o ya no está activa.' using errcode='22023';
      end if;

      if v_subcampo1='' and v_subcampo2='' then
        delete from v16_private.gestion_comentario_clasificaciones
        where guia_clave=upper(v_guia) and pdv_clave=upper(v_pdv);
      else
        insert into v16_private.gestion_comentario_clasificaciones
          (guia_clave,pdv_clave,guia,pdv,area,region,subcampo1,subcampo2,actualizado_en,actualizado_por)
        values (upper(v_guia),upper(v_pdv),v_guia,v_pdv,v_area,v_region,v_subcampo1,v_subcampo2,now(),auth.uid())
        on conflict (guia_clave,pdv_clave) do update set
          guia=excluded.guia,pdv=excluded.pdv,area=excluded.area,region=excluded.region,
          subcampo1=excluded.subcampo1,subcampo2=excluded.subcampo2,
          actualizado_en=now(),actualizado_por=auth.uid();
      end if;
      v_total := v_total+1;
    end loop;
    return jsonb_build_object('ok',true,'actualizados',v_total);
  end if;

  raise exception 'Acción de catálogo de comentarios no reconocida.' using errcode='22023';
end;
$$;

revoke all on function public.v16_gestion_v2_comentario_alcance(text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.v16_gestion_v2_comentarios(text,jsonb) from public,anon,authenticated;
grant execute on function public.v16_gestion_v2_comentarios(text,jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
