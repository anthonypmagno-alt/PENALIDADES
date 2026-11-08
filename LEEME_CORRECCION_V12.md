# Gestión V2 · Corrección de detalle V12

## Problema confirmado
- V11 llamaba a `razonesGestion` y `cumpleHoraProblema` sin declararlos en `filtrar()`. Cuando había guías, la excepción interrumpía el renderizado del detalle.
- `filtrarExcel()` tenía una llamada equivalente a `cumpleHoraProblema` sin definir.
- Los anchos porcentuales originales de `colgroup` superaban el espacio total de la tabla, por lo que los dos nuevos encabezados quedaban comprimidos y el texto se apilaba verticalmente.

## Correcciones
- Declarados los predicados reales a partir de los filtros de Razón y Hora del problema para Gestión V2 y Consulta Excel. Por defecto, sin rango o razones seleccionadas, no se excluyen guías.
- Asignados anchos fijos a las 14 columnas del detalle y a las 10 columnas de Consulta Excel; la vista mantiene scroll horizontal.
- No cambia el procesamiento de fuentes, el SQL ni las reglas de cola larga/brecha.

## Instalación
Reemplaza solo **gestion-v2.html** en GitHub por el archivo de esta carpeta y fuerza la recarga con **Ctrl + Shift + R**. No hace falta volver a cargar los Excel para corregir la visualización; los nuevos campos aparecerán cuando existan en los registros procesados.

Versión visible: `20261108-DETALLE-ENCABEZADOS-V12`.

## Validación
Sintaxis de scripts JS, estructura de 14 encabezados/14 celdas y prueba funcional del filtrado en navegador local. Integración con Supabase en producción no ejecutada.
