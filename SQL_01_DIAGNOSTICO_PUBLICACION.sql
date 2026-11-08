-- SOLO LECTURA. Ejecutar en Supabase > SQL Editor.
-- Comprueba la firma y configuración de la función de publicación.
SELECT
  p.oid::regprocedure AS funcion,
  p.proconfig AS configuracion_actual,
  p.prosecdef AS seguridad_definidor,
  p.provolatile AS volatilidad,
  pg_get_function_identity_arguments(p.oid) AS argumentos,
  length(pg_get_functiondef(p.oid)) AS longitud_definicion
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='v16_call';

-- Para investigar optimizaciones de fondo, obtener el código de la función (no ejecuta acciones):
SELECT pg_get_functiondef(to_regprocedure('public.v16_call(text,jsonb)')) AS definicion;
