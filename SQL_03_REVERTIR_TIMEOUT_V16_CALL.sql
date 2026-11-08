-- Revertir al valor heredado de la función (si antes no tenía un ajuste propio).
-- Si SQL_01 mostraba una configuración propia de statement_timeout,
-- restaurar ese valor en lugar de hacer RESET.
ALTER FUNCTION public.v16_call(text,jsonb) RESET statement_timeout;
NOTIFY pgrst, 'reload config';
