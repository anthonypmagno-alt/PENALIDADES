-- REINICIO TOTAL DEL MODULO PENALIDADES
-- Ejecutar una sola vez, después de supabase_penalidades_v2.sql.
-- Elimina cargas, liquidaciones, penalidades, decisiones y grupos del módulo.
-- Conserva Supabase Auth, exo_authorized_users y los demás módulos del portal.

begin;

-- Vacía el antiguo estado JSON para que datos anteriores no vuelvan a migrarse.
do $$
begin
  if to_regclass('public.exoneraciones_app_state') is not null then
    execute $reset$
      update public.exoneraciones_app_state
      set state=jsonb_build_object(
        'version',1,
        'serverRevision',revision+1,
        'sources',jsonb_build_object('penalties',null,'breaches',null,'guides',null,'zones',null),
        'records','[]'::jsonb,'groups','[]'::jsonb,'deletedRecords','{}'::jsonb
      ),
      revision=revision+1,
      updated_at=now()
      where singleton=true
    $reset$;
  end if;
end $$;

truncate table
  public.penalidades_decisiones,
  public.penalidades_guias,
  public.penalidades_liquidacion_grupos,
  public.penalidades_liquidaciones,
  public.penalidades_grupos,
  public.penalidades_cargas;

update public.penalidades_control
set v2_activo=true, activado_en=now()
where singleton=true;

-- Impide que una pestaña vieja vuelva a escribir el estado JSON anterior.
do $$
begin
  if to_regprocedure('public.save_exoneraciones_app_state(jsonb)') is not null then
    execute 'revoke execute on function public.save_exoneraciones_app_state(jsonb) from authenticated';
  end if;
end $$;

commit;
