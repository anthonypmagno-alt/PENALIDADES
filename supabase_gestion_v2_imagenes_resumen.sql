-- Imágenes adjuntas al resumen por PDV en Gestión de Guías V2.
-- Ejecutar una sola vez en el mismo proyecto Supabase de Gestión de Guías.
-- Crea un bucket privado y una tabla nueva; no modifica ni elimina datos existentes.
begin;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('v16-gestion-v2-resumen','v16-gestion-v2-resumen',false,8388608,array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set
  name=excluded.name,
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create table if not exists public.v16_gestion_resumen_imagenes (
  id uuid primary key default gen_random_uuid(),
  pdv text not null check (length(trim(pdv)) between 1 and 200),
  area text not null default '',
  region text not null default '',
  object_path text not null unique check (object_path ~ '^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}\.(jpg|png|webp)$'),
  nombre_original text not null check (length(nombre_original) between 1 and 255),
  content_type text not null check (content_type in ('image/png','image/jpeg','image/webp')),
  bytes integer not null check (bytes between 1 and 8388608),
  subido_por uuid not null default auth.uid() references auth.users(id),
  subido_en timestamptz not null default now()
);

create index if not exists v16_gestion_resumen_imagenes_pdv_fecha_idx
  on public.v16_gestion_resumen_imagenes (pdv, subido_en desc);

create or replace function public.v16_gestion_v2_rol_imagenes_autorizado()
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare v_perfil jsonb; v_rol text;
begin
  if auth.uid() is null then return false; end if;
  v_perfil := to_jsonb(v16_private.profile());
  v_rol := upper(coalesce(v_perfil->>'rol',''));
  return v_rol in ('ADMINISTRADOR','ENCARGADO');
exception when others then return false;
end;
$$;

create or replace function public.v16_gestion_v2_alcance_imagenes(p_pdv text,p_area text,p_region text)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_perfil jsonb;
  v_rol text;
  v_lista jsonb;
  v_item text;
  v_area text := upper(trim(coalesce(p_area,'')));
  v_region text := upper(trim(coalesce(p_region,'')));
begin
  if auth.uid() is null then return false; end if;
  v_perfil := to_jsonb(v16_private.profile());
  v_rol := upper(coalesce(v_perfil->>'rol',''));
  if v_rol='ADMINISTRADOR' then return true; end if;
  if v_rol<>'ENCARGADO' then return false; end if;

  v_lista := v_perfil->'pdvs';
  if jsonb_typeof(v_lista)='array' then
    for v_item in select jsonb_array_elements_text(v_lista) loop
      if upper(trim(v_item))=upper(trim(coalesce(p_pdv,''))) then return true; end if;
    end loop;
  end if;

  v_lista := v_perfil->'areas';
  if jsonb_typeof(v_lista)='array' and v_area<>'' then
    for v_item in select jsonb_array_elements_text(v_lista) loop
      v_item := upper(trim(v_item));
      if v_item<>'' and (v_item=v_area or strpos(v_item,v_area)>0 or strpos(v_area,v_item)>0) then return true; end if;
    end loop;
  end if;

  v_lista := v_perfil->'regiones';
  if jsonb_typeof(v_lista)='array' and v_region<>'' then
    for v_item in select jsonb_array_elements_text(v_lista) loop
      v_item := upper(trim(v_item));
      if v_item<>'' and (v_item=v_region or strpos(v_item,v_region)>0 or strpos(v_region,v_item)>0) then return true; end if;
    end loop;
  end if;
  return false;
exception when others then return false;
end;
$$;

alter table public.v16_gestion_resumen_imagenes enable row level security;
revoke all on table public.v16_gestion_resumen_imagenes from public,anon,authenticated;
grant select,insert,delete on table public.v16_gestion_resumen_imagenes to authenticated;

drop policy if exists v16_gestion_resumen_imagenes_select on public.v16_gestion_resumen_imagenes;
create policy v16_gestion_resumen_imagenes_select
  on public.v16_gestion_resumen_imagenes for select to authenticated
  using (public.v16_gestion_v2_alcance_imagenes(pdv,area,region));

drop policy if exists v16_gestion_resumen_imagenes_insert on public.v16_gestion_resumen_imagenes;
create policy v16_gestion_resumen_imagenes_insert
  on public.v16_gestion_resumen_imagenes for insert to authenticated
  with check (
    subido_por=auth.uid()
    and object_path like auth.uid()::text||'/%'
    and public.v16_gestion_v2_rol_imagenes_autorizado()
    and public.v16_gestion_v2_alcance_imagenes(pdv,area,region)
  );

drop policy if exists v16_gestion_resumen_imagenes_delete on public.v16_gestion_resumen_imagenes;
create policy v16_gestion_resumen_imagenes_delete
  on public.v16_gestion_resumen_imagenes for delete to authenticated
  using (
    subido_por=auth.uid()
    and public.v16_gestion_v2_rol_imagenes_autorizado()
    and public.v16_gestion_v2_alcance_imagenes(pdv,area,region)
  );

-- Las políticas de almacenamiento se configuran desde el Dashboard;
-- consulta las expresiones incluidas en POLITICAS_STORAGE_IMAGENES.txt.

revoke all on function public.v16_gestion_v2_rol_imagenes_autorizado() from public,anon,authenticated;
revoke all on function public.v16_gestion_v2_alcance_imagenes(text,text,text) from public,anon,authenticated;
grant execute on function public.v16_gestion_v2_rol_imagenes_autorizado() to authenticated;
grant execute on function public.v16_gestion_v2_alcance_imagenes(text,text,text) to authenticated;

notify pgrst, 'reload schema';
commit;
