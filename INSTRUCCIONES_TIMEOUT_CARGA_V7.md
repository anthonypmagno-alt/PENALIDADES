# Gestión de guías V2 – Corrección de carga múltiple (V7)

## Error abordado
`canceling statement due to statement timeout`: Postgres aborta una sentencia SQL que tarda más de lo permitido. **No significa que el Excel esté mal**. La aplicación no puede confirmar por sí sola qué consulta concreta causó el timeout sin los registros de Supabase.

## Cambios del código
1. `bridge.js`: subidas al RPC `v16_call` en bloques de 120 filas, **secuencialmente**, en vez de 300 filas x 3 RPC simultáneos. No reintenta a ciegas una petición de escritura fallida (podría haberse aplicado).
2. `bridge.js`: los errores especifican etapa, fuente y número de bloque; se distingue `Publicación final` de `Guardando fuente`, `registros` o `catálogo`.
3. `gestion-v2.html`: se muestra el avance de bloques; en la carga múltiple general no se borra la selección de archivos hasta que Supabase confirma la publicación.
4. `bridge.js`: si la base confirma la publicación pero falla la recarga de la interfaz, no presenta la operación como un guardado fallido; indica recargar.
5. `index.html` y `gestion-v2.html`: versión visible `20261108-EXPORTACION-MULTIPLE-V7-TIMEOUT` y actualización forzada de `bridge.js`.
6. No se modificaron los cálculos de Cola Larga, Brecha, el cruce de PDV, los filtros, permisos ni Seguimiento General.

## Instalación
1. Haz copia de seguridad del repositorio actual.
2. Reemplaza al menos **`gestion-v2.html`, `bridge.js` e `index.html`** de la raíz de GitHub por los incluidos en este ZIP. Puedes subir el ZIP completo descomprimido si lo prefieres.
3. Espera a que GitHub Pages publique y realiza Ctrl+Shift+R.
4. Comprueba el sello `Edición 20261108-EXPORTACION-MULTIPLE-V7-TIMEOUT`.
5. Sube los Excel en **Carga de fuentes → Exportación de guías** y pulsa solo uno de los dos botones: `Cargar Exportación de guías` o `Guardar información cargada`.

## Cómo interpretar un error de esta versión
- `Guardando registros/fuente/catálogo, bloque X de Y`: uno de los bloques SQL superó el límite. **No reintentes inmediatamente** si hay otra carga en curso; consulta los registros de Supabase.
- `Publicación final (Supabase)`: los bloques se subieron, pero la transacción de publicación no terminó o su confirmación se perdió. Verifica el sello `Último guardado confirmado` o la revisión en una pestaña nueva antes de repetir.
- Si la aplicación dice `Publicación confirmada, pero falló la actualización de pantalla`: **no vuelvas a cargar**; recarga la web y comprueba el resultado.

## Si aún aparece timeout durante la publicación
Primero revisa en Supabase Dashboard → Logs → Postgres Logs o Query Performance qué consulta/función causa la demora. El código utiliza el RPC `public.v16_call` con acciones `iniciar`, `bloque` y `publicar`. El ZIP original **no contiene la definición SQL** de esa función; por ello no es posible certificar una mejora del SQL interno sin acceso a esa definición y a los planes de ejecución.

El archivo `SQL_OPCIONAL_TIMEOUT_FUNCION.sql` incluye una alternativa para ampliar *solo* el límite de `public.v16_call` a 45 segundos, con verificación previa y una instrucción para revertirlo. **No se ejecuta automáticamente**. Solo aplícalo si confirma el timeout en el RPC y cuentas con permiso de administrador de la base; puede aumentar el tiempo que una transacción mantiene recursos ocupados. Es preferible optimizar el SQL del RPC si la carga sigue siendo lenta.

## Pruebas locales
- Sintaxis de `bridge.js` y del JavaScript embebido en `gestion-v2.html` validada con Node.
- 361 registros → 4 bloques de 120, 120, 120 y 1; máximo una escritura a la vez.
- Falla simulada en bloque 2/3: informa la etapa y no repite escritura.
- Falla simulada en publicación: preserva el conjunto pendiente y no lo marca como publicado.
- Publicación simulada exitosa: confirma y limpia el estado.

**No se pudo probar contra tu instancia real de Supabase ni establecer qué sentencia específica agotó el tiempo.**
