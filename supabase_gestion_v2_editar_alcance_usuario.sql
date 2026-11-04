-- Edicion del alcance de usuarios existentes en Gestion de Guias V2.
-- Ejecutar una sola vez en el SQL Editor del mismo proyecto Supabase.
-- Crea solo una funcion RPC; no modifica tablas ni politicas de Storage.
begin;

create or replace function public.v16_admin_update_user_scope(
  p_usuario text,
  p_pdvs text[] default array[]::text[],
  p_areas text[] default array[]::text[],
  p_regiones text[] default array[]::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin v16_private.profiles;
  v_target v16_private.profiles;
  v_pdvs text[];
  v_areas text[];
  v_regiones text[];
begin
  select p.* into v_admin
  from v16_private.profiles p
  where p.user_id = auth.uid() and p.activo is true;

  if not found or v_admin.rol <> 'ADMINISTRADOR' then
    raise exception 'Solo un administrador activo puede modificar alcances.' using errcode = '42501';
  end if;

  if p_usuario is null or btrim(p_usuario) = '' then
    raise exception 'Indica el usuario que deseas actualizar.' using errcode = '22023';
  end if;

  select f.* into v_target
  from v16_private.profiles f
  where upper(f.usuario) = upper(btrim(p_usuario))
  for update;

  if not found then
    raise exception 'No se encontró el usuario indicado.' using errcode = '22023';
  end if;

  if v_target.rol = 'ADMINISTRADOR' then
    raise exception 'Los administradores conservan acceso a todos los PDV y no requieren asignación de alcance.' using errcode = '22023';
  end if;

  select coalesce(array_agg(x.valor order by x.valor), array[]::text[]) into v_pdvs
  from (
    select distinct btrim(s.valor) as valor
    from unnest(coalesce(p_pdvs, array[]::text[])) as s(valor)
    where btrim(s.valor) <> ''
  ) x;

  select coalesce(array_agg(x.valor order by x.valor), array[]::text[]) into v_areas
  from (
    select distinct btrim(s.valor) as valor
    from unnest(coalesce(p_areas, array[]::text[])) as s(valor)
    where btrim(s.valor) <> ''
  ) x;

  select coalesce(array_agg(x.valor order by x.valor), array[]::text[]) into v_regiones
  from (
    select distinct btrim(s.valor) as valor
    from unnest(coalesce(p_regiones, array[]::text[])) as s(valor)
    where btrim(s.valor) <> ''
  ) x;

  if v_target.rol = 'PDV' and (cardinality(v_pdvs) <> 1 or cardinality(v_areas) > 0 or cardinality(v_regiones) > 0) then
    raise exception 'Una cuenta PDV debe tener exactamente un PDV y no puede tener áreas ni regiones.' using errcode = '22023';
  end if;

  if v_target.rol = 'ENCARGADO' and cardinality(v_pdvs) + cardinality(v_areas) + cardinality(v_regiones) = 0 then
    raise exception 'Asigna al menos un PDV, área o región al encargado.' using errcode = '22023';
  end if;

  if v_target.rol not in ('PDV', 'ENCARGADO') then
    raise exception 'El rol de este usuario no admite alcance editable.' using errcode = '22023';
  end if;

  if exists (
    select 1 from unnest(v_pdvs) as x(valor)
    where not exists (select 1 from v16_private.catalog c where c.pdv = x.valor)
  ) then
    raise exception 'Uno de los PDV no está en PDV_LISTA. Actualiza el catálogo y vuelve a intentarlo.' using errcode = '22023';
  end if;

  if exists (
    select 1 from unnest(v_areas) as x(valor)
    where not exists (select 1 from v16_private.catalog c where c.area = x.valor)
  ) then
    raise exception 'Una de las áreas no está en PDV_LISTA. Actualiza el catálogo y vuelve a intentarlo.' using errcode = '22023';
  end if;

  if exists (
    select 1 from unnest(v_regiones) as x(valor)
    where not exists (select 1 from v16_private.catalog c where c.region = x.valor)
  ) then
    raise exception 'Una de las regiones no está en PDV_LISTA. Actualiza el catálogo y vuelve a intentarlo.' using errcode = '22023';
  end if;

  update v16_private.profiles f
  set pdvs = v_pdvs, areas = v_areas, regiones = v_regiones
  where f.user_id = v_target.user_id;

  insert into v16_private.audit(actor, action, data)
  values (
    v_admin.user_id,
    'ACTUALIZAR_ALCANCE_USUARIO',
    jsonb_build_object(
      'user_id', v_target.user_id,
      'usuario', v_target.usuario,
      'rol', v_target.rol,
      'pdvs', to_jsonb(v_pdvs),
      'areas', to_jsonb(v_areas),
      'regiones', to_jsonb(v_regiones)
    )
  );

  return jsonb_build_object(
    'usuario', v_target.usuario,
    'rol', v_target.rol,
    'pdvs', to_jsonb(v_pdvs),
    'areas', to_jsonb(v_areas),
    'regiones', to_jsonb(v_regiones)
  );
end;
$$;

revoke all on function public.v16_admin_update_user_scope(text, text[], text[], text[]) from public, anon, authenticated;
grant execute on function public.v16_admin_update_user_scope(text, text[], text[], text[]) to authenticated;

notify pgrst, 'reload schema';
commit;
