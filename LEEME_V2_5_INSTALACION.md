# Facturación PDV V2.5 — configuración múltiple y tabla de ancho completo

Esta versión continúa la V2.4: **no reemplaza Revisión de Guías ni Penalidades**.

## Instalación en dos etapas

1. **Supabase → SQL Editor:** ejecuta **`08_CONFIGURACION_MULTIPLE_TIEMPOS.sql`** con el rol `postgres`. Es una migración incremental que crea únicamente una función RPC de actualización parcial. No borra tarifas, tiempos, usuarios, guías, borradores ni liquidaciones. Ejecutar una segunda vez reemplaza la definición de la misma función.
2. **GitHub Pages:** reemplaza en la raíz de tu proyecto exactamente estos siete archivos:
   - `facturacion.html`
   - `facturacion.css`
   - `facturacion.js`
   - `facturacion-cloud.js`
   - `facturacion-borradores-cloud.js`
   - `facturacion-i18n.js`
   - `motor-facturacion.js`

Conserva `config.js`, `bridge.js`, `gestion-v2.html`, las funciones Edge y los archivos del módulo Penalidades sin cambios. Actualiza la página con **Ctrl + Shift + R** y confirma que aparece **V2.5**.

> Si aún no funciona **Guardar borrador en Supabase**, primero confirma que está instalada la migración corregida `06_BORRADORES_SUPABASE_CORREGIDO.sql` de la V2.4. La migración 08 es independiente y no crea la tabla de borradores.

## Cómo seleccionar varias filas

1. Abre **Resumen por distrito** y aplica filtros de departamento, PDV, muestra o estado según necesites.
2. Marca las casillas de **SEL** a la izquierda de la tabla (son distintas de las casillas **OK**).
3. Puedes usar **Seleccionar página** para la página actual (40 filas), o **Seleccionar todas las filtradas** para todas las páginas del filtro. **Quitar selección** limpia la selección. Al cambiar los filtros se excluyen automáticamente filas que ya no están visibles en el conjunto filtrado; al cambiar de periodo la selección se borra.
4. Pulsa **Configurar selección (N)**.
5. En el formulario masivo, marca **Aplicar** solo para los campos que deseas modificar. Si no marcas un campo, se conserva su valor individual en cada fila. Si marcas **Aplicar** y dejas un campo vacío, se elimina ese dato de las filas seleccionadas. El valor **0** es válido.
6. Confirma el guardado. La interfaz muestra progreso por bloques de hasta 75 filas. Si algún bloque falla, recupera de Supabase lo que sí quedó guardado para evitar confusiones.
7. Los cambios actualizan el tiempo establecido, el umbral y los descuentos. Los OK previamente aprobados de las filas modificadas deben revisarse nuevamente. Las liquidaciones ya finalizadas **no cambian**.

Solo el rol **ADMINISTRADOR** de Facturación puede efectuar cambios masivos. La función SQL comprueba ese permiso y las políticas RLS también se aplican.

## Ancho de la tabla

- Se utiliza todo el ancho disponible de la ventana en lugar de un contenedor centrado de ancho fijo.
- **Ampliar tabla** abre una vista grande que ocupa casi toda la pantalla.
- **Vista compacta** reduce el espaciado para mostrar más columnas.
- **Las columnas siguen permitiendo desplazamiento horizontal** cuando la pantalla no alcance para mostrar 25 columnas con texto legible. No se ocultan ni se cortan campos.
- Se conservan los filtros, paginación y exportación existentes.

## Seguridad y simultaneidad

La nueva función RPC recibe solo los campos elegidos y aplica una unión JSONB (`datos = datos || cambios`) **dentro de Supabase**. De este modo, si dos administradores trabajan, una modificación de consolidación no pisa accidentalmente observaciones, retraslado o despacho guardados por otro. Para un mismo campo modificado simultáneamente, el último guardado confirmado prevalece. Cada lote se confirma por separado: no hay una transacción única para los 919 distritos.

## Validación

- Sintaxis JavaScript: comprobada.
- Navegador Chromium con Supabase simulado: 45 filas seleccionadas en dos páginas, configuración masiva, preservación de campos no marcados, recalculo de umbral, OK independiente, modos ampliado/compacto e idiomas español/inglés/chino.
- Servicio de guardado simulado: 151 filas en tres lotes (75/75/1), exclusivamente los campos marcados.
- **Pendiente:** ejecutar el SQL y probar el guardado real con una cuenta administradora en tu proyecto de Supabase. No se publicó nada en tu GitHub.

## Si aparece un error

- `Could not find function public.facturacion_actualizar_tiempos_masivo`: ejecuta el SQL 08 y actualiza la caché con `NOTIFY pgrst, 'reload schema'` (ya incluido).
- `permission denied` o `Solo el administrador`: revisa que la sesión pertenezca a un administrador activo de **Facturación**, no solamente de Penalidades.
- Guardado parcial: **recarga configuración de Supabase** antes de volver a seleccionar. No repitas a ciegas la misma operación.
