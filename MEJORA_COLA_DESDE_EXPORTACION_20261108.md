# Gestión de Guías V2 + Seguimiento General — Cola Larga desde Exportación
Versión: 2026-11-08, COLA-DESDE-EXPORTACION-V3

## Qué cambia
- La ficha COLA LARGA de Gestión V2 ya no pide un Excel independiente.
- La cola larga se genera desde la fuente EXPORTACION GUIAS almacenada por el administrador en Gestión V2.
- Columna `Tiempo de entrada` = inicio de antigüedad.
- Columna `Identificación de transferencia y devolución`:
    - `No devuelto` => categorías históricas «No devuelto».
    - `Devuelto` => categorías históricas «Por devolver». El nombre se mantiene por compatibilidad con los resúmenes actuales.
- Guías con estatus de firma «Firmado» se excluyen de los casos de cola larga activos.
- Agrupación por PDV del **Punto de escaneo más reciente** resuelto contra PDV LISTA. Las guías en HUB/Callao, sin PDV reconocido, no se atribuyen a un PDV de destino.
- El cálculo sigue las bandas vigentes: 120–<576h, 576–<600h (preventiva) y >=600h (crítica), a partir de ahora - Tiempo de entrada.
- Los filtros, resúmenes, comentarios y selecciones se mantienen, y Seguimiento General sigue reutilizando la misma Exportación de Gestión V2.

## Qué NO cambia
- El archivo antiguo COLA LARGA, si existe en Supabase, queda almacenado, pero se IGNORA para el cálculo nuevo. No se borra automáticamente.
- No se cambian las tablas ni se requiere SQL.
- No se elimina la carga de Track Break, PDV LISTA ni la Exportación de guías.
- La columna 'Devuelto' NO es igual al concepto 'Por devolver'; se mapea a esa columna heredada por compatibilidad. Si se decide cambiar el significado operativo, se deben revisar las etiquetas.

## Actualizar GitHub Pages
1. Hacer un respaldo del repositorio actual.
2. Descomprimir el ZIP y subir **su contenido** a la raíz del repositorio (no una subcarpeta).
3. Confirmar que se reemplazaron `bridge.js`, `process-worker.js` y `gestion-v2.html`.
4. Recargar la web con Ctrl+Shift+R. El título de Gestión V2 debe indicar:
   `Edición 20261108-COLA-DESDE-EXPORTACION-V3`.
5. Volver a cargar la Exportación de guías en Gestión V2 y pulsar «Guardar información cargada», para regenerar y publicar los registros. Se usará el PDV LISTA existente.
6. Verificar las categorías 120, 576 y 600h y la agrupación por PDV. No hace falta subir Cola Larga.

## Pruebas locales
- `node --check` del worker y puente: OK.
- Scripts inline de Gestión V2 y PDV V2: sintaxis OK.
- Pruebas funcionales del worker: sin fuente Cola Larga, con fuente Cola Larga antigua ignorada, No devuelto, Devuelto, fecha vacía, estado vacío, firma, centro de clasificación y reclasificación en tiempo real: OK.
- Exportación real de 08/11/2026 (2.360 filas): 2.010 registros atribuibles a PDV de escaneo, 348 en Callao.SC y 2 en CEDIS no asignados a PDV de destino. No es una verificación contra Supabase.
- Integración real en GitHub Pages/Supabase: PENDIENTE de probar tras la publicación.
