-- SOLO SI EL ERROR DE LA V7 IDENTIFICA EL RPC COMO UN TIMEOUT Y YA
-- REVISASTE LAS CONSULTAS EN SUPABASE LOGS / QUERY PERFORMANCE.
-- El frontend llama a public.v16_call(method text,payload jsonb).
-- Esto afecta a TODAS las acciones de esta función, no solo a Exportación.
-- No deshabilita los límites y no reemplaza la optimización de SQL.

-- 1) Comprobar firma y configuración actual (solo lectura)
SELECT p.oid::regprocedure AS funcion, p.proconfig AS configuracion
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'v16_call';

-- 2) Ejecutar SOLO si aparece exactamente public.v16_call(text,jsonb)
-- y necesitas ampliar la duración de la operación durante una carga controlada.
-- ALTER FUNCTION public.v16_call(text,jsonb) SET statement_timeout = '45s';
-- NOTIFY pgrst, 'reload config';

-- 3) Revertir si causa problemas o una vez optimizada la consulta.
-- ALTER FUNCTION public.v16_call(text,jsonb) RESET statement_timeout;
-- NOTIFY pgrst, 'reload config';
