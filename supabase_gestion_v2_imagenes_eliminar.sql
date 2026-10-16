-- Habilita eliminar desde Gestión de Guías V2 las imágenes que subió el usuario.
-- Ejecutar una sola vez en el mismo proyecto Supabase que almacena las imágenes.
-- Solo cambia permisos de la tabla pública de metadatos; no modifica storage.objects.
begin;

grant delete on table public.v16_gestion_resumen_imagenes to authenticated;

drop policy if exists v16_gestion_resumen_imagenes_delete
  on public.v16_gestion_resumen_imagenes;

create policy v16_gestion_resumen_imagenes_delete
  on public.v16_gestion_resumen_imagenes
  for delete to authenticated
  using (
    subido_por=auth.uid()
    and public.v16_gestion_v2_rol_imagenes_autorizado()
    and public.v16_gestion_v2_alcance_imagenes(pdv,area,region)
  );

commit;
