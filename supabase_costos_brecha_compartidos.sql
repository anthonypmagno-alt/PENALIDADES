-- Configuración central de costos de brecha, compartida entre los usuarios V16.
-- Ejecutar una sola vez como propietario desde Supabase SQL Editor.
-- No elimina ni modifica liquidaciones, guías, perfiles ni fuentes existentes.
begin;

create table if not exists v16_private.brecha_costos (
  clave text primary key check (clave ~ '^[A-Z0-9_]{1,120}$'),
  tipo text not null check (length(tipo) between 1 and 250),
  costo_unitario numeric(14,2) not null default 0 check (costo_unitario >= 0),
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references auth.users(id)
);

alter table v16_private.brecha_costos enable row level security;
revoke all on table v16_private.brecha_costos from public, anon, authenticated;

create or replace function public.v16_brecha_costos(
  accion text,
  payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  perfil v16_private.profiles;
  fila jsonb;
  clave_tipo text;
  etiqueta text;
  valor numeric;
  cantidad integer := 0;
  lista jsonb;
begin
  perfil := v16_private.profile();

  if accion = 'listar' then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'clave', c.clave,
          'tipo', c.tipo,
          'costoUnitario', c.costo_unitario,
          'actualizadoEn', c.actualizado_en
        ) order by c.clave
      ),
      '[]'::jsonb
    )
    into lista
    from v16_private.brecha_costos c;
    return jsonb_build_object('ok', true, 'costos', lista);
  end if;

  if accion <> 'guardar' then
    raise exception 'Operación de costos de brecha no reconocida';
  end if;
  if perfil.rol <> 'ADMINISTRADOR' then
    raise exception 'Solo el rol ADMINISTRADOR puede definir los costos de brecha';
  end if;
  if jsonb_typeof(payload->'costos') is distinct from 'array' then
    raise exception 'Lista de costos no válida';
  end if;
  if jsonb_array_length(payload->'costos') > 500 then
    raise exception 'La lista de costos excede el límite permitido';
  end if;

  for fila in select value from jsonb_array_elements(payload->'costos') loop
    clave_tipo := upper(trim(coalesce(fila->>'clave', '')));
    etiqueta := trim(coalesce(fila->>'tipo', ''));
    begin
      valor := (fila->>'costoUnitario')::numeric;
    exception when others then
      raise exception 'El costo unitario debe ser un número válido';
    end;

    if clave_tipo !~ '^[A-Z0-9_]{1,120}$'
       or length(etiqueta) not between 1 and 250
       or valor is null
       or valor < 0
       or valor > 999999999999.99 then
      raise exception 'Hay un tipo o costo unitario no válido';
    end if;

    insert into v16_private.brecha_costos
      (clave, tipo, costo_unitario, actualizado_en, actualizado_por)
    values
      (clave_tipo, etiqueta, round(valor, 2), now(), auth.uid())
    on conflict (clave) do update set
      tipo = excluded.tipo,
      costo_unitario = excluded.costo_unitario,
      actualizado_en = excluded.actualizado_en,
      actualizado_por = excluded.actualizado_por;
    cantidad := cantidad + 1;
  end loop;

  insert into v16_private.audit(actor, action, data)
  values (
    auth.uid(),
    'ACTUALIZAR_COSTOS_BRECHA',
    jsonb_build_object('cantidad', cantidad)
  );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'clave', c.clave,
        'tipo', c.tipo,
        'costoUnitario', c.costo_unitario,
        'actualizadoEn', c.actualizado_en
      ) order by c.clave
    ),
    '[]'::jsonb
  )
  into lista
  from v16_private.brecha_costos c;
  return jsonb_build_object('ok', true, 'costos', lista, 'actualizados', cantidad);
end;
$$;

revoke all on function public.v16_brecha_costos(text, jsonb) from public, anon;
grant execute on function public.v16_brecha_costos(text, jsonb) to authenticated;

commit;
