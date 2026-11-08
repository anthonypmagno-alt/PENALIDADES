# Gestión de Guías V2 — Corrección V8: «Bloque fuera de rango»

## Causa
La versión V7 cambió el tamaño de los bloques enviados al RPC `public.v16_call` de 300 a 120 filas. La función SQL de tu Supabase aparentemente calcula los límites de índice considerando bloques de **300 filas**, por eso en una carga cercana a 11.400 registros el bloque **39 de 95** resulta fuera de rango. Esta conclusión se fundamenta en la coincidencia de los índices; **no disponemos del código de `public.v16_call` ni se ha probado contra tu Supabase en línea**.

## Corrección
- `bridge.js`: restaura bloques de **300 filas**, estrictamente **secuenciales (1 RPC a la vez)**; elimina el desfase de índices sin volver a ejecutar 3 escrituras concurrentes como V6.
- Mantiene las mejoras de V7: progreso por etapa, error con bloque exacto, conservación de archivos hasta confirmación, sin reintentos automáticos de escrituras inciertas.
- `gestion-v2.html`: actualiza referencia a `bridge.js?v=20261108-bloques300-v8` para romper caché y sello de versión visible.
- `index.html`: actualiza la redirección a la nueva versión.
- No se cambia procesamiento de guía, brecha, cola larga, comentarios, filtros ni Seguimiento General; tampoco la estructura de la base.

## Comprobación de tus Excel
Se inspeccionó la estructura física de los 3 Excel: **4 + 2.235 + 16.187 filas incluyendo encabezados** respectivamente. La consolidación elimina duplicados por guía; la cantidad de registros a publicar puede ser menor. Según la captura, V7 intentó 95 bloques de 120 filas. Con lotes de 300, un conjunto de 11.281–11.400 filas se guardaría en **38 bloques**, compatibles con el límite de índice que coincide con el error.

## Instalación
1. Haz una copia de tu versión actual de GitHub.
2. Reemplaza `bridge.js`, `gestion-v2.html` e `index.html` en la raíz por los archivos de este ZIP. No renombres ninguno.
3. Confirma el despliegue de GitHub Pages y presiona **Ctrl + Shift + R**.
4. Comprueba el sello **`20261108-EXPORTACION-MULTIPLE-V8-BLOQUES300`**.
5. Vuelve a seleccionar **los 3 Excel juntos** y realiza una sola carga con **Guardar información cargada**. Una carga nueva reemplaza el conjunto anterior cuando se confirma la publicación.

## Limitaciones y diagnóstico posterior
No se ha ejecutado contra tu instancia real de Supabase. Si vuelve a aparecer `statement timeout`, la siguiente etapa es revisar los logs de `public.v16_call`, ya que el error de rango y el timeout SQL son problemas diferentes. No amplíes el timeout ni ejecutes SQL de actualización sin revisar el procedimiento real. Evita hacer clic varias veces en Guardar mientras hay una carga en curso. Si falla la publicación final, verifica antes si hubo un cambio de revisión: los datos pueden estar publicados aunque la interfaz no haya recibido respuesta.
