# Gestión de guías V2 · V5 · 8 de noviembre de 2026

## Cambios incluidos

1. **Encargados:** el botón «Guardar comentario» del modal del resumen queda oculto y su textarea es de solo lectura; no hay botón de guardado individual del comentario de gestión. Se mantiene la gestión masiva del encargado y la opción «Guardar revisión», que no equivale a guardar el comentario del resumen. El servidor también valida el rol Administrador para guardar el comentario del resumen.
2. **Cola larga > N días:** campo numérico del resumen que filtra estrictamente guías con (ahora − Tiempo de entrada) / 24 horas mayor que N; filtra el resumen y el detalle. Las fechas sin dato no cumplen. El valor se recalcula durante la sesión.
3. **Nueva columna En cola larga:** columna informativa por PDV de último escaneo, muestra guías sin firma cuya edad desde Tiempo de entrada está por debajo del umbral escogido (120 h predeterminado, 168 h opcional). Se pueden consultar haciendo clic. No se suma al total de cola larga, total crítico ni guías únicas de casos vencidos. Entre 120 y 168 h una guía puede figurar también en la banda 120–<576 h si se selecciona 168 h (la nueva columna es informativa).
4. **Filtro Área asignada · entrega:** toma Punto de entrega de Exportación de guías, lo normaliza y cruza contra PDV LISTA, sin alterar la agrupación operativa por último punto de escaneo. Si no existe una coincidencia única muestra SIN DATO. Selección múltiple compatible con otros filtros.

## Archivos modificados
- `gestion-v2.html`: controles, clasificación informativa y resúmenes.
- `process-worker.js`: punto y área de entrega enriquecidos desde Exportación y PDV LISTA para cada guía.
- `bridge.js`: recalculador de la nueva categoría informativa en la hora actual.
- `pdv-v2.html` y `pdv.html`: renovación de URL de bridge para evitar caché de código previo.
- `index.html`: versión de la redirección renovada.

## Instalación
1. Respaldar los archivos actuales de GitHub.
2. Copiar el contenido descomprimido del ZIP en la raíz del repositorio, reemplazando los existentes, sin crear una subcarpeta.
3. Comprobar que GitHub Pages sirve Gestión V2 con `Edición 20261108-UMBRAL-COLA-AREA-ENTREGA-V5`.
4. Abrir la plataforma de nuevo (Ctrl+Shift+R) y, si la fuente Exportación se había procesado con una versión antigua, volver a guardar la exportación desde el administrador para incorporar `areaAsignadaEntrega` y `puntoEntregaExportacion` a los registros.
5. No se ejecuta SQL ni se añade otra carga de COLA LARGA.

## Verificación
- Validación de sintaxis: bridge.js, process-worker.js y scripts inline de gestion-v2.html.
- Prueba local de procesamiento: escaneo UCA-05/área SELVA y punto de entrega JUN-05/área CENTRO; 2 áreas correctamente independientes.
- Edades 119, 120, 167 y 168 h: columnas 120/168 excluyen el límite exacto.
- Conmutador <120 h / <168 h: 3 / 5 guías informativas en datos simulados, sin incrementar el total de cola larga (3).
- Regresión de la carga única Exportación y la cola larga con categoría 120–<576, 576–<600 y ≥600: correcta.

*Pendiente*: comprobar GitHub Pages y Supabase con los permisos y PDV LISTA reales de la instalación.
