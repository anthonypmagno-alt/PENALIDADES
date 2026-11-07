-- EJECUTAR EN SUPABASE SQL EDITOR ANTES DE USAR EL BOTÓN.
-- Solo afecta comentarios propios del encargado; conserva respaldo en una tabla privada.
begin;
create table if not exists v16_private.gestion_comentarios_encargado_archivo (
  like v16_private.gestion_comentarios_encargado including defaults,
  archivado_en timestamptz not null default now(),
  archivado_por uuid,
  motivo text not null default 'Ausente de carga operativa'
);
-- El archivo admite varias versiones históricas de una misma guía.
alter table v16_private.gestion_comentarios_encargado_archivo drop constraint if exists gestion_comentarios_encargado_archivo_pkey;
revoke all on v16_private.gestion_comentarios_encargado_archivo from public,anon,authenticated;
alter table v16_private.gestion_comentarios_encargado_archivo enable row level security;
create or replace function public.v16_gestion_v2_depurar_comentarios_encargado(p_registros jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 v_rol text;
 v_eliminados int := 0;
 v_solicitados int;
begin
 if auth.uid() is null then raise exception 'Sesión requerida' using errcode='42501'; end if;
 v_rol := upper(coalesce(to_jsonb(v16_private.profile())->>'rol',''));
 if v_rol <> 'ADMINISTRADOR' then raise exception 'Solo administrador' using errcode='42501'; end if;
 if jsonb_typeof(p_registros) <> 'array' or jsonb_array_length(p_registros) > 100 then
   raise exception 'Se requiere un lote de hasta 100 comentarios' using errcode='22023';
 end if;
 v_solicitados := jsonb_array_length(p_registros);
 with candidatos as (
   select distinct upper(btrim(x.guia)) as guia_clave,
          upper(btrim(x.pdv)) as pdv_clave,
          x.actualizado_en::timestamptz as actualizado_en
   from jsonb_to_recordset(p_registros) as x(guia text,pdv text,actualizado_en text)
   where length(btrim(x.guia)) between 1 and 200
     and length(btrim(x.pdv)) between 1 and 200
     and x.actualizado_en is not null
 ), borrados as (
   delete from v16_private.gestion_comentarios_encargado c
   using candidatos x
   where c.guia_clave=x.guia_clave and c.pdv_clave=x.pdv_clave
     and c.actualizado_en=x.actualizado_en
   returning c.*
 ), archivados as (
   insert into v16_private.gestion_comentarios_encargado_archivo
    (guia_clave,pdv_clave,guia,pdv,area,region,comentario,actualizado_en,actualizado_por,archivado_en,archivado_por,motivo)
   select guia_clave,pdv_clave,guia,pdv,area,region,comentario,actualizado_en,actualizado_por,now(),auth.uid(),'Ausente de carga operativa'
   from borrados returning 1
 ) select count(*) into v_eliminados from archivados;
 return jsonb_build_object('eliminados',v_eliminados,'omitidos',v_solicitados-v_eliminados);
end; $$;
revoke all on function public.v16_gestion_v2_depurar_comentarios_encargado(jsonb) from public,anon;
grant execute on function public.v16_gestion_v2_depurar_comentarios_encargado(jsonb) to authenticated;
commit;
