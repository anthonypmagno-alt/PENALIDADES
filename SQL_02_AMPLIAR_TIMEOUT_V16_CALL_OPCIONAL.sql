-- OPCIONAL Y REVERSIBLE, SOLO SI EN LA CONSULTA SQL_01 LA FIRMA ES
-- EXACTAMENTE: public.v16_call(text,jsonb).
-- Afecta TODAS las llamadas a v16_call, no solamente "publicar".
-- Antes de ejecutar, conserva el valor de proconfig mostrado por SQL_01.
-- Esto NO corrige consultas SQL ineficientes; únicamente permite hasta 60 segundos.
-- Supabase establece un máximo configurable de 60 segundos para llamadas por Data API.
DO $$
DECLARE objetivo regprocedure := to_regprocedure('public.v16_call(text,jsonb)');
BEGIN
  IF objetivo IS NULL THEN
    RAISE EXCEPTION 'No existe public.v16_call(text,jsonb). No se modificó nada.';
  END IF;
  EXECUTE format('ALTER FUNCTION %s SET statement_timeout = %L', objetivo, '60s');
END $$;
NOTIFY pgrst, 'reload config';

-- Comprobar que quedó aplicado a esta función:
SELECT p.oid::regprocedure AS funcion, p.proconfig
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='v16_call';
