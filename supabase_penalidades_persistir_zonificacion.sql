-- Persistencia de tipo de zona, zona, SLA asignado y asignación manual por guía.
-- Ejecutar una sola vez en el mismo proyecto Supabase de Penalidades.
-- No modifica ni elimina liquidaciones, guías o decisiones.
begin;

-- Conserva el guardado de exportación y escribe también los campos de zona/SLA.
create or replace function public.penalidades_actualizar_datos_exportacion(p_guias jsonb)
returns integer language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_count integer;
begin
  if not public.penalidades_usuario_autorizado() then
    raise exception 'Cuenta no autorizada.' using errcode='42501';
  end if;
  if jsonb_typeof(p_guias) is distinct from 'array' then
    raise exception 'El lote de actualización debe ser un arreglo de guías.' using errcode='22023';
  end if;
  if jsonb_array_length(p_guias)>1000 then
    raise exception 'El lote debe contener hasta 1000 guías.' using errcode='22023';
  end if;
  update public.penalidades_guias g
  set distrito=coalesce(x.distrito,''),
      provincia=coalesce(x.provincia,''),
      departamento=coalesce(x.departamento,''),
      tipo_escaneo_reciente=coalesce(x.tipo_escaneo_reciente,''),
      estatus_firma=coalesce(x.estatus_firma,''),
      fecha_hora_ultimo_escaneo=coalesce(x.fecha_hora_ultimo_escaneo,''),
      tipo_zona=coalesce(x.tipo_zona,''),
      zona=coalesce(x.zona,''),
      sla_asignado_dias=coalesce(x.sla_asignado_dias,''),
      coincidencia_zona=coalesce(x.coincidencia_zona,false),
      actualizado_en=now()
  from jsonb_to_recordset(p_guias) as x(
    id text,distrito text,provincia text,departamento text,
    tipo_escaneo_reciente text,estatus_firma text,fecha_hora_ultimo_escaneo text,
    tipo_zona text,zona text,sla_asignado_dias text,coincidencia_zona boolean
  )
  where g.id=x.id;
  get diagnostics v_count=row_count;
  return v_count;
end $$;

create or replace function public.penalidades_actualizar_zonificacion(p_guias jsonb)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_rows jsonb;
begin
  if not public.penalidades_usuario_autorizado() then
    raise exception 'Cuenta no autorizada.' using errcode='42501';
  end if;
  if jsonb_typeof(p_guias) is distinct from 'array' then
    raise exception 'El lote de zonificación debe ser un arreglo de guías.' using errcode='22023';
  end if;
  if jsonb_array_length(p_guias)>1000 then
    raise exception 'El lote de zonificación admite hasta 1000 guías.' using errcode='22023';
  end if;
  if exists(
    select 1 from jsonb_array_elements(p_guias) as item(value)
    where coalesce(item.value->>'id','')=''
  ) then
    raise exception 'Cada fila de zonificación debe incluir el id de la guía.' using errcode='22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_guias)) <>
     (select count(distinct item.value->>'id') from jsonb_array_elements(p_guias) as item(value)) then
    raise exception 'El lote contiene ids de guía repetidos.' using errcode='22023';
  end if;

  with updated as (
    update public.penalidades_guias g
    set tipo_zona=coalesce(x.tipo_zona,''),
        zona=coalesce(x.zona,''),
        sla_asignado_dias=coalesce(x.sla_asignado_dias,''),
        coincidencia_zona=coalesce(x.coincidencia_zona,false),
        zona_manual=x.zona_manual,
        actualizado_en=now()
    from jsonb_to_recordset(p_guias) as x(
      id text,tipo_zona text,zona text,sla_asignado_dias text,
      coincidencia_zona boolean,zona_manual jsonb
    )
    where g.id=x.id
    returning g.id,g.tipo_zona,g.zona,g.sla_asignado_dias,g.coincidencia_zona,g.zona_manual
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',updated.id,
    'tipo_zona',updated.tipo_zona,
    'zona',updated.zona,
    'sla_asignado_dias',updated.sla_asignado_dias,
    'coincidencia_zona',updated.coincidencia_zona,
    'zona_manual',updated.zona_manual
  ) order by updated.id),'[]'::jsonb)
  into v_rows
  from updated;
  return v_rows;
end $$;

-- Devuelve las columnas guardadas cuando se vuelve a abrir el detalle.
create or replace function public.penalidades_obtener_items(
  p_record_key text,
  p_offset integer default 0,
  p_limit integer default 500
)
returns jsonb language plpgsql security definer stable
set search_path = pg_catalog, public
as $$
begin
  if not public.penalidades_usuario_autorizado() then
    raise exception 'Cuenta no autorizada.' using errcode='42501';
  end if;
  if p_offset<0 or p_limit<1 or p_limit>1000 then
    raise exception 'Parámetros de paginación inválidos.' using errcode='22023';
  end if;
  return coalesce((
    select jsonb_agg(q.item order by q.tracking,q.penalizacion,q.id)
    from (
      select g.tracking,g.penalizacion,g.id,
        jsonb_build_object(
          'id',g.id,'tracking',g.tracking,'pdv',g.pdv,'penalty',g.penalizacion,'breach',g.brecha,
          'sla',g.sla,'liquidationBreach',g.brecha_liquidacion,'liquidationSla',g.sla_liquidacion,
          'cost',g.costo,'dateRaw',g.fecha,'motive',g.motivo_origen,'observations',g.observaciones,
          'district',g.distrito,'province',g.provincia,'department',g.departamento,
          'latestOperation',g.tipo_operacion_reciente,'breachOperation',g.operacion_brecha,
          'breachWaitHours',g.brecha_horas,'breachLastUpdate',g.brecha_ultima_actualizacion,
          'scanType',g.tipo_escaneo_reciente,'signature',g.estatus_firma,'scanTime',g.fecha_hora_ultimo_escaneo,
          'zoneType',g.tipo_zona,'zoneName',g.zona,'slaDays',g.sla_asignado_dias,
          'zoneMatched',g.coincidencia_zona,'sourceFile',g.origen_archivo,
          'exemptionPercent',coalesce(d.porcentaje,0),'exonerated',coalesce(d.porcentaje,0)>0,
          'reason',coalesce(d.motivo,''),'modifiedAt',d.actualizado_en,
          'breachMatched',coalesce(g.operacion_brecha,'')<>'',
          'guideMatched',g.distrito<>'' or g.provincia<>'' or g.departamento<>'',
          'sourceRow',0,'period',l.periodo,'costRaw',g.costo::text,
          'sourceZone',g.zona,'manualZone',g.zona_manual
        ) as item
      from public.penalidades_liquidaciones l
      join public.penalidades_guias g on g.liquidacion_id=l.id
      left join public.penalidades_decisiones d on d.guia_id=g.id
      where l.record_key=p_record_key
      order by g.tracking,g.penalizacion,g.id
      limit p_limit offset p_offset
    ) q
  ),'[]'::jsonb);
end $$;

revoke all on function public.penalidades_actualizar_datos_exportacion(jsonb) from public,anon,authenticated;
revoke all on function public.penalidades_actualizar_zonificacion(jsonb) from public,anon,authenticated;
revoke all on function public.penalidades_obtener_items(text,integer,integer) from public,anon,authenticated;
grant execute on function public.penalidades_actualizar_datos_exportacion(jsonb) to authenticated;
grant execute on function public.penalidades_actualizar_zonificacion(jsonb) to authenticated;
grant execute on function public.penalidades_obtener_items(text,integer,integer) to authenticated;

notify pgrst, 'reload schema';
commit;
