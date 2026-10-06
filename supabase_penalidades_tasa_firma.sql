-- Actualización incremental para una instalación V2 ya existente.
-- Asegura Estado y Tasa de firma por liquidación y actualiza su lectura y guardado.
-- No borra datos ni recrea las tablas de Penalidades.
begin;

alter table public.penalidades_liquidaciones
  add column if not exists estado text not null default 'pendiente';
alter table public.penalidades_liquidaciones
  add column if not exists tasa_firma numeric(5,2);
update public.penalidades_liquidaciones set estado='pendiente' where estado is null;
alter table public.penalidades_liquidaciones alter column estado set default 'pendiente';
alter table public.penalidades_liquidaciones alter column estado set not null;
alter table public.penalidades_liquidaciones alter column tasa_firma drop default;
alter table public.penalidades_liquidaciones alter column tasa_firma drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='penalidades_liquidaciones_estado_check'
      and conrelid='public.penalidades_liquidaciones'::regclass
  ) then
    alter table public.penalidades_liquidaciones
      add constraint penalidades_liquidaciones_estado_check
      check (estado in ('pendiente','en_proceso','finalizado','notificado','en_revalidacion'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname='penalidades_liquidaciones_tasa_firma_check'
      and conrelid='public.penalidades_liquidaciones'::regclass
  ) then
    alter table public.penalidades_liquidaciones
      add constraint penalidades_liquidaciones_tasa_firma_check
      check (tasa_firma >= 0 and tasa_firma <= 100);
  end if;
end $$;

create or replace function public.penalidades_obtener_resumen()
returns jsonb language plpgsql security definer stable
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
    'id',q.record_key,'period',q.periodo,'pdv',q.pdv,'status',q.estado,'signatureRate',q.tasa_firma,'createdAt',q.creado_en,'updatedAt',q.actualizado_en,
    'groupId',q.grupo_id,
    'summary',jsonb_build_object('count',q.total_guias,'yes',q.con_exoneracion,'no',q.sin_exoneracion,'total',q.penalidad_total,'exempt',q.monto_exonerado,'balance',q.saldo,'noExemptTotal',q.no_exonerated_total)
  ) order by q.periodo desc,q.pdv),'[]'::jsonb) into v_records
  from (
    select l.record_key,l.periodo,l.pdv,l.estado,l.tasa_firma,l.creado_en,l.actualizado_en,
      (select m.grupo_id from public.penalidades_liquidacion_grupos m where m.liquidacion_id=l.id) as grupo_id,
      count(g.id)::integer as total_guias,
      count(g.id) filter(where coalesce(d.porcentaje,0)>0)::integer as con_exoneracion,
      count(g.id) filter(where coalesce(d.porcentaje,0)<=0)::integer as sin_exoneracion,
      coalesce(sum(g.costo),0)::numeric(14,2) as penalidad_total,
      coalesce(sum(g.costo) filter(where coalesce(d.porcentaje,0)<=0),0)::numeric(14,2) as no_exonerated_total,
      coalesce(sum(g.costo*coalesce(d.porcentaje,0)/100),0)::numeric(14,2) as monto_exonerado,
      coalesce(sum(g.costo)-sum(g.costo*coalesce(d.porcentaje,0)/100),0)::numeric(14,2) as saldo
    from public.penalidades_liquidaciones l
    left join public.penalidades_guias g on g.liquidacion_id=l.id
    left join public.penalidades_decisiones d on d.guia_id=g.id
    group by l.id
  ) q;
  return jsonb_build_object('version',1,'serverRevision',0,
    'sources',jsonb_build_object('penalties',null,'breaches',null,'guides',null,'zones',null),
    'records',v_records,
    'groups',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',nombre,'createdAt',creado_en,'updatedAt',creado_en) order by nombre) from public.penalidades_grupos),'[]'::jsonb),
    'deletedRecords','{}'::jsonb);
end $$;

create or replace function public.penalidades_actualizar_estados(p_estados jsonb)
returns integer language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_count integer;
begin
  if not public.penalidades_usuario_autorizado() then
    raise exception 'Cuenta no autorizada.' using errcode='42501';
  end if;
  if jsonb_typeof(p_estados) is distinct from 'array' or jsonb_array_length(p_estados)>500 then
    raise exception 'La lista debe contener hasta 500 estados.' using errcode='22023';
  end if;
  if exists(
    select 1 from jsonb_array_elements(p_estados) as entries(value)
    where coalesce(entries.value->>'recordKey','')=''
       or coalesce(entries.value->>'estado','') not in ('pendiente','en_proceso','finalizado','notificado','en_revalidacion')
       or (
         entries.value ? 'tasaFirma'
         and nullif(entries.value->>'tasaFirma','') is not null
         and case
           when entries.value->>'tasaFirma' ~ '^[0-9]{1,3}(\.[0-9]{1,2})?$'
             then (entries.value->>'tasaFirma')::numeric not between 0 and 100
           else true
         end
       )
  ) then
    raise exception 'La clave, el estado o la tasa de firma no es válida.' using errcode='22023';
  end if;
  update public.penalidades_liquidaciones as liquidacion
  set estado=entry.estado,
      tasa_firma=case when entry.has_tasa_firma then entry.tasa_firma else liquidacion.tasa_firma end,
      actualizado_en=now()
  from (
    select entries.value->>'recordKey' as record_key,entries.value->>'estado' as estado,
      entries.value ? 'tasaFirma' as has_tasa_firma,
      nullif(entries.value->>'tasaFirma','')::numeric as tasa_firma
    from jsonb_array_elements(p_estados) as entries(value)
  ) as entry
  where liquidacion.record_key=entry.record_key
    and (liquidacion.estado is distinct from entry.estado
      or (entry.has_tasa_firma and liquidacion.tasa_firma is distinct from entry.tasa_firma));
  get diagnostics v_count=row_count;
  return v_count;
end $$;

revoke all on function public.penalidades_actualizar_estados(jsonb) from public,anon,authenticated;
revoke all on function public.penalidades_obtener_resumen() from public,anon,authenticated;
grant execute on function public.penalidades_actualizar_estados(jsonb) to authenticated;
grant execute on function public.penalidades_obtener_resumen() to authenticated;

commit;
