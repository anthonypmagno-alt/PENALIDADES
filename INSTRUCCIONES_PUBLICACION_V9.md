# Publicación V9: recuperación de bloques sin reenviar Excel

## Qué fallaba
V8 transportaba los bloques correctamente, pero la única llamada RPC `v16_call(method='publicar')` agotaba el límite de tiempo de ejecución en PostgreSQL. Reducir el tamaño de los bloques no modifica el costo del trabajo realizado dentro de la función SQL durante la publicación final.

## Qué cambia en V9
- Los bloques se siguen transportando secuencialmente en grupos de 300 compatibles con el SQL existente.
- Antes de publicar, el navegador almacena **solo los identificadores de los lotes** en `sessionStorage` (misma pestaña, 24h); no guarda los datos de las guías.
- Si el RPC final falla, se habilitan **Verificar publicación** y **Reintentar SOLO publicación**.
- Verificar consulta la revisión activa. Si cambió, **no publica** porque la nueva revisión podría pertenecer a otra carga.
- El reintento verifica nuevamente la revisión, conserva el usuario administrador y llama a `publicar` con los identificadores existentes. No vuelve a subir los archivos.
- Se bloquea una nueva carga mientras haya una publicación V9 pendiente para evitar duplicar registros.

## Instrucciones
1. Reemplaza `bridge.js`, `gestion-v2.html` e `index.html` en GitHub, o todo el contenido del ZIP.
2. Verifica que la cabecera muestre `20261108-PUBLICACION-RECUPERABLE-V9`.
3. Como el intento anterior fue hecho con V8, **no existen identificadores de la publicación V8 recuperables desde esta versión**. Es necesario realizar una nueva carga una sola vez para preparar los lotes V9.
4. Antes de iniciar otra publicación grande, ejecuta `SQL_01_DIAGNOSTICO_PUBLICACION.sql` en Supabase, guarda la configuración actual de `v16_call`, revisa la función y los indicadores de recursos en Supabase.
5. Antes de cargar nada, utiliza **Comprobar versión publicada** para ver la revisión actual, fecha, archivo y cantidad de filas de Exportación. Esto sirve también después del fallo de V8 (los identificadores V8 no son recuperables en V9).
6. Opcional: si tienes permisos para administrar la función y la firma es correcta, ejecuta `SQL_02_AMPLIAR_TIMEOUT_V16_CALL_OPCIONAL.sql` para un intento controlado. La acción afecta todas las llamadas a esa función; si genera problemas, usa `SQL_03_REVERTIR_TIMEOUT_V16_CALL.sql` (o recupera el valor anterior exacto).
7. Haz la carga con los tres Excel. Si aparece nuevamente el error final, **no pulses Guardar información cargada**. Pulsa **Verificar publicación** y luego **Reintentar SOLO publicación**, una única vez, si la revisión no cambió.

## Limitación: falta analizar la función SQL real
No se incluyó el cuerpo de la función `public.v16_call` en los archivos originales. Tampoco hay una conexión de administración Supabase disponible para revisar planes, índices y logs actuales. Por lo tanto V9 evita volver a transferir los datos, y SQL_02 puede aliviar límites de tiempo, pero **no garantiza** solucionar el cuello de botella interno de la función. Si vuelve a agotar 60 segundos, debe reescribirse `publicar` para usar operaciones por conjuntos, índices adecuados y/o un protocolo de publicación por etapas seguro, con la definición actual y métricas reales.

No borres la fuente publicada ni ejecutes TRUNCATE/DELETE sobre tablas de staging como primer intento.
