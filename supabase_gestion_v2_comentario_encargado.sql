-- Comentario propio del encargado por guía y PDV en Gestión de Guías V2.
-- Ejecutar una sola vez en el proyecto Supabase de Gestión de Guías.
-- Mantiene intactos los comentarios de revisión y las observaciones PDV existentes.
begin;

create table if not exists v16_private.gestion_comentarios_encargado (
  guia_clave text not null check (length(btrim(guia_clave)) between 1 and 200),
  pdv_clave text not null check (length(btrim(pdv_clave)) between 1 and 200),
  guia text not null check (length(btrim(guia)) between 1 and 200),
  pdv text not null check (length(btrim(pdv)) between 1 and 200),
  area text not null default '',
  region text not null default '',
  comentario text not null check (length(comentario) between 1 and 2000),
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid not null references auth.users(id),
  primary key (guia_clave,pdv_clave),
  check (guia_clave=upper(btrim(guia))),
  check (pdv_clave=upper(btrim(pdv)))
);

create index if not exists gestion_comentarios_encargado_pdv_guia_idx
  on v16_private.gestion_comentarios_encargado (pdv_clave,guia_clave);

alter table v16_private.gestion_comentarios_encargado enable row level security;
revoke all on table v16_private.gestion_comentarios_encargado from public,anon,authenticated;

create or replace function public.v16_gestion_v2_listar_comentarios_encargado(
  p_despues_guia text default '',
  p_despues_pdv text default '',
  p_limite integer default 1000
) returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_perfil jsonb;
  v_rol text;
  v_resultado jsonb;
  v_limite integer := greatest(1,least(coalesce(p_limite,1000),5000));
begin
  if auth.uid() is null then
    raise exception 'Inicia sesión para consultar los comentarios de gestión.' using errcode='42501';
  end if;
  v_perfil := to_jsonb(v16_private.profile());
  v_rol := upper(coalesce(v_perfil->>'rol',''));
  if v_rol not in ('ADMINISTRADOR','ENCARGADO') then
    raise exception 'Solo administradores y encargados pueden consultar estos comentarios.' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.guia_clave,q.pdv_clave),'[]'::jsonb)
    into v_resultado
  from (
    select c.guia_clave,c.pdv_clave,c.guia,c.pdv,c.area,c.region,c.comentario,
           c.actualizado_en
    from v16_private.gestion_comentarios_encargado c
    where public.v16_gestion_v2_comentario_alcance(c.pdv,c.area,c.region,v_perfil)
      and (c.guia_clave,c.pdv_clave) >
          (upper(btrim(coalesce(p_despues_guia,''))),upper(btrim(coalesce(p_despues_pdv,''))))
    order by c.guia_clave,c.pdv_clave
    limit v_limite
  ) q;
  return v_resultado;
end;
$$;

create or replace function public.v16_gestion_v2_guardar_comentario_encargado(
  p_guia text,
  p_pdv text,
  p_area text,
  p_region text,
  p_comentario text,
  p_esperado_actualizado_en timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_perfil jsonb;
  v_rol text;
  v_guia text := btrim(coalesce(p_guia,''));
  v_pdv text := btrim(coalesce(p_pdv,''));
  v_area text := btrim(coalesce(p_area,''));
  v_region text := btrim(coalesce(p_region,''));
  v_comentario text := btrim(coalesce(p_comentario,''));
  v_guardado v16_private.gestion_comentarios_encargado%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Inicia sesión para guardar el comentario.' using errcode='42501';
  end if;
  v_perfil := to_jsonb(v16_private.profile());
  v_rol := upper(coalesce(v_perfil->>'rol',''));
  if v_rol <> 'ENCARGADO' then
    raise exception 'Solo el encargado puede editar el comentario de gestión.' using errcode='42501';
  end if;
  if length(v_guia) not between 1 and 200 or length(v_pdv) not between 1 and 200 then
    raise exception 'Guía o PDV inválido.' using errcode='22023';
  end if;
  if length(v_comentario)>2000 then
    raise exception 'El comentario admite hasta 2000 caracteres.' using errcode='22023';
  end if;
  if not public.v16_gestion_v2_comentario_alcance(v_pdv,v_area,v_region,v_perfil) then
    raise exception 'No tienes acceso a este PDV.' using errcode='42501';
  end if;

  if v_comentario='' then
    if p_esperado_actualizado_en is null then
      if exists (
        select 1 from v16_private.gestion_comentarios_encargado
        where guia_clave=upper(v_guia) and pdv_clave=upper(v_pdv)
      ) then
        raise exception 'Otro usuario guardó un comentario. Actualiza la tabla y vuelve a intentarlo.' using errcode='40001';
      end if;
      return jsonb_build_object('guia',v_guia,'pdv',v_pdv,'comentario','','actualizado_en',null);
    end if;
    delete from v16_private.gestion_comentarios_encargado
    where guia_clave=upper(v_guia) and pdv_clave=upper(v_pdv)
      and actualizado_en=p_esperado_actualizado_en;
    if not found then
      raise exception 'Otro usuario cambió este comentario. Actualiza la tabla y vuelve a intentarlo.' using errcode='40001';
    end if;
    return jsonb_build_object('guia',v_guia,'pdv',v_pdv,'comentario','','actualizado_en',null);
  end if;

  if p_esperado_actualizado_en is null then
    insert into v16_private.gestion_comentarios_encargado
      (guia_clave,pdv_clave,guia,pdv,area,region,comentario,actualizado_en,actualizado_por)
    values (upper(v_guia),upper(v_pdv),v_guia,v_pdv,v_area,v_region,v_comentario,now(),auth.uid())
    on conflict (guia_clave,pdv_clave) do nothing
    returning * into v_guardado;
  else
    update v16_private.gestion_comentarios_encargado
    set guia=v_guia,pdv=v_pdv,area=v_area,region=v_region,comentario=v_comentario,
        actualizado_en=now(),actualizado_por=auth.uid()
    where guia_clave=upper(v_guia) and pdv_clave=upper(v_pdv)
      and actualizado_en=p_esperado_actualizado_en
    returning * into v_guardado;
  end if;

  if not found then
    raise exception 'Otro usuario guardó un comentario. Actualiza la tabla y vuelve a intentarlo.' using errcode='40001';
  end if;
  return jsonb_build_object('guia',v_guardado.guia,'pdv',v_guardado.pdv,
    'comentario',v_guardado.comentario,'actualizado_en',v_guardado.actualizado_en);
end;
$$;

revoke all on function public.v16_gestion_v2_listar_comentarios_encargado(text,text,integer) from public,anon,authenticated;
revoke all on function public.v16_gestion_v2_guardar_comentario_encargado(text,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.v16_gestion_v2_listar_comentarios_encargado(text,text,integer) to authenticated;
grant execute on function public.v16_gestion_v2_guardar_comentario_encargado(text,text,text,text,text,timestamptz) to authenticated;

notify pgrst, 'reload schema';
commit;
