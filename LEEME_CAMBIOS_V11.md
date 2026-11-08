# Gestión de Guías V2 · Separadores y datos de problemas (V11)

**Correcciones**
- Tabla resumen: líneas de separación después de **No devuelto** (columna 6) y antes de **TOTAL** (columna 17), incluidas filas PDV y subtotales.
- Gestión V2: dos columnas nuevas, **Última razón del problema** y **Hora de registro del problema**.
- Consulta desde Excel: las mismas dos columnas, además del tipo de problema de Track Break existente.
- Filtros nuevos e independientes en ambos módulos: razón del problema (selección múltiple, incluye SIN DATO) y fecha/hora de registro (Desde/Hasta).
- `process-worker.js` y `bridge.js` conservan ambos datos al procesar Exportación de guía de embarque; Consulta también los incluye en su persistencia.
- Si un dato está vacío, la celda muestra —. No altera los cálculos de cola larga, brecha ni comentarios.

**Instalación**
1. Copia los archivos de este ZIP a la raíz de tu repositorio GitHub, reemplazando los actuales (especialmente `gestion-v2.html`, `process-worker.js`, `bridge.js` e `index.html`).
2. Recarga el navegador con Ctrl+Shift+R.
3. Para Gestión V2, **vuelve a procesar y publicar la Exportación** cuando Supabase publique correctamente; los registros previamente procesados no contienen estos campos. **No fuerces la publicación mientras existan timeouts SQL.**
4. Para Consulta desde Excel, vuelve a cruzar la Exportación con Track Break o actualiza la consulta compartida.

**Límites de la validación**
Se comprueban las columnas reales del Excel adjunto y la sintaxis de los scripts localmente. No se ejecutó una carga real contra Supabase; las columnas estarán vacías hasta que el conjunto de registros se publique con el worker actualizado.
