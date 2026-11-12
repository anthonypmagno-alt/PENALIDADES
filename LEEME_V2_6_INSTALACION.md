# Facturación PDV V2.6 — resumen por PDV y filtros buscables

Esta versión actualiza exclusivamente **Facturación**, partiendo de la V2.5. No cambia los módulos Penalidades ni Revisión de Guías.

## Instalación

Reemplaza estos **siete archivos** en la misma carpeta de GitHub Pages donde está tu Facturación V2.5:

- `facturacion.html`
- `facturacion.css`
- `facturacion.js`
- `facturacion-cloud.js`
- `facturacion-borradores-cloud.js`
- `facturacion-i18n.js`
- `motor-facturacion.js`

Mantén tu `config.js` y las configuraciones actuales de Supabase. **No hay migraciones SQL nuevas en V2.6.** Se presupone que V2.5 estaba instalada y ya ejecutaste sus migraciones anteriores (incluido SQL 08 para configuración masiva). Al terminar, actualiza con **Ctrl + Shift + R** y comprueba **V2.6** en el encabezado.

## Nuevo resumen por PDV

En **Resumen por distrito** se agregó, antes de la tabla detallada, un bloque expandible **Resumen por PDV** con:

- PDV, cantidad de coberturas de distrito, número de guías, promedio logrado (ponderado por guías).
- Cantidad de filas con revisión **OK** y número de guías sin cálculo.
- Bruto, descuentos, neto de simulación, diferencia contra el neto real y neto real.
- Totales de las columnas numéricas. Para «Distritos», el total suma coberturas **PDV–distrito**; un distrito compartido por varios PDV se cuenta una vez por PDV.
- Botón **Ver distritos**: aplica el filtro de ese PDV y conserva los restantes filtros de área/estado.

**Regla de conciliación:** el resumen usa las mismas guías que los indicadores, el resumen por distrito y el detalle filtrado. El promedio de tiempo es ponderado por guía (no promedio simple entre distritos). Las guías sin tarifa o sin umbral figuran en «Sin cálculo» y no se facturan automáticamente. Las simulaciones no modifican la liquidación real.

## Buscadores dentro de los filtros

- **Departamento, provincia, distrito:** pulsa la lupa junto al selector, escribe el término y elige un resultado. Admite tildes/no tildes. El filtro se aplica al seleccionar la opción, no al escribir.
- **PDV (selección múltiple):** abre el desplegable y utiliza **Buscar PDV** para encontrar rápidamente el código. La selección anterior se mantiene al escribir y al borrar el texto del buscador.
- **Filtros del resumen:** lupa en Muestra, Mejor PDV, Revisión OK, Umbral establecido, Tiempo establecido, Tarifa y Observaciones.
- **Detalle y liquidaciones compartidas:** lupa en los desplegables Estado, Liquidación y PDV autorizado.

Se mantienen los filtros combinados, las 40 filas por página, las casillas de selección masiva y los OK independientes.

## Exportación

El botón **Excel · selección** conserva las hojas existentes (`RESUMEN`, `DETALLE`, `TARIFAS`, `REGLAS`) y agrega **`RESUMEN_PDV`**, con los importes del filtro y sus totales. Usa el valor actual del simulador de horas.

## Validación efectuada

- `node --check` sobre los siete archivos JS.
- Prueba con navegador Chromium y Supabase/IndexedDB simulados: dos PDV, 26 guías y dos distritos. Los 26 registros se agruparon en dos filas, filtrado por distrito redujo a 23, búsqueda por PDV redujo a 11, y la hoja `RESUMEN_PDV` coincidió con sus importes.
- Cambio del título del resumen a inglés al seleccionar el idioma inglés. Se agregaron traducciones estáticas y dinámicas en inglés/chino simplificado.
- No se efectuaron operaciones en tu Supabase real ni publicaciones automáticas de GitHub. Valida primero con un usuario de pruebas.

## Si no aparece la actualización

1. Confirma que realmente se reemplazó `facturacion.js`, además de `facturacion.html`.
2. Abre `facturacion.html?build=v26` para evitar caché anterior.
3. Actualiza con Ctrl + Shift + R.
