# Gestión de Guías V2 — Exportación múltiple (V6)

## Instalación
1. Reemplazar en la raíz de GitHub los archivos del ZIP. Para este cambio funcional, bastan `gestion-v2.html` e `index.html`.
2. Abrir la aplicación y actualizar con Ctrl + Shift + R.
3. Verificar versión visible: `20261108-EXPORTACION-MULTIPLE-V6`.
4. Administrador → Carga de fuentes → **Exportación de guías** → seleccionar varios `.xlsx`/`.xls` con Ctrl + clic → pulsar **Cargar Exportación de guías** o el botón general **Guardar información cargada**. **Usar solo uno de los botones para la misma selección**.

## Qué hace
- Lee y valida **todos** los Excel seleccionados; si alguno falla, no inicia la sustitución de la exportación.
- Une columnas por encabezado normalizado y registros por **Número de Guía**.
- Para guías repetidas prioriza **Tiempo del escaneo más reciente**; a igualdad de fecha, **Última actualización**, luego Tiempo de despacho, completitud y nombre de archivo.
- Envía **una única fuente consolidada** a Supabase, no un guardado independiente por Excel.
- Conserva `Tiempo de entrada`, `Identificación de transferencia y devolución`, último punto, tipo de escaneo y destinos para la cola larga automática y Seguimiento General.
- También permite seleccionar varios Excel en **Consulta desde Excel → Exportación**; esa carga es local de consulta y se cruza con Track Break.

## Comportamiento importante
- El conjunto de Excel que selecciones **reemplaza toda la exportación anteriormente guardada**. No añade guías a un histórico de cargas anteriores.
- Para incluir guías de diferentes Excel en el mismo conjunto, selecciónalos **juntos en una sola operación**. Repetir la carga con otro grupo reemplazará el anterior.
- Máximo 30 MB por archivo, 100.000 guías únicas en el conjunto; puede haber límites adicionales en Supabase o el navegador.
- Si faltan campos obligatorios en cualquier archivo, se rechazará el conjunto antes de publicar.
- No se modifican funciones SQL, tablas ni políticas de Supabase.

## Validación realizada
- Prueba de consolidación de los 2 Excel de exportación proporcionados: 4.021 registros, 2.852 guías únicas, 1.169 repeticiones.
- Pruebas de prioridad de fechas con orden de archivos invertido, archivos inválidos y unión de columnas.
- Prueba de compatibilidad con `process-worker.js` sobre la exportación consolidada: procesa el campo Tiempo de entrada.
- Validación de sintaxis JavaScript de la página y scripts de procesamiento.
- Pendiente verificar la publicación y guardado contra la instancia real de Supabase del usuario.
