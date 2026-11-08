# Gestión de Guías V2 – V13 · Problema en una columna

Se unifican las columnas **Última razón del problema** y **Hora de registro del problema** en **ÚLTIMA RAZÓN DEL PROBLEMA Y HORA DE REGISTRO**, tanto en Gestión V2 como en Consulta desde Excel. El detalle muestra la fecha y hora arriba (dd-mm-aaaa HH:mm:ss) y la razón abajo, con separación visual, tal como el bloque de última actualización y escaneo.

La información sigue almacenada en sus **dos campos originales** y permanecen los filtros individuales (razón de problema y rango de hora). No hay que ejecutar SQL, cambiar `bridge.js` ni volver a cargar archivos para hacer este cambio de presentación. Cuando los datos no estén publicados, la celda muestra `—`.

Se actualizaron los colgroups, los anchos horizontales y los colspans de filas vacías en ambas tablas. No se modifican cálculos, comentarios, carga ni permisos.

## Instalación
Reemplazar solamente `gestion-v2.html` en la raíz de GitHub Pages y recargar con Ctrl + Shift + R. Marca visible: `20261108-PROBLEMA-UNIFICADO-V13`.

## Validación
Verificación de sintaxis JavaScript, consistencia entre número de encabezados, columnas y celdas del detalle, y formato de visualización de campos independiente con valores disponibles y nulos. Falta probar con datos de la plataforma conectada a Supabase.
