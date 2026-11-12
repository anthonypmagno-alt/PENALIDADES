# Facturación PDV V2.3 — Tiempos y persistencia corregidos

## Instalación

1. Conserva una copia de los archivos actuales del repositorio.
2. Reemplaza en GitHub **los cinco archivos** `facturacion.html`, `facturacion.js`, `facturacion-cloud.js`, `facturacion.css` y `motor-facturacion.js` por los del ZIP. No reemplaces `config.js` ni modifiques las tablas existentes.
3. Actualiza con `Ctrl + Shift + R`. Comprueba el nombre de versión V2.3 en la cabecera.
4. Abre el **periodo que habías trabajado**. El sistema ahora recuerda el último periodo de facturación por usuario, incluso después de cerrar y reabrir la pestaña. Si antes editaste octubre y se muestra noviembre, cambia el selector a octubre; los datos existentes de Supabase no se eliminan con este cambio de archivos.
5. Abre una fila de prueba, introduce Consolidación=24 y Necesario despacho=48, pulsa **Guardar tiempos** y espera a ver el estado «Guardado en Supabase». Comprueba Tiempo establecido=72 y Umbral establecido=72. Recarga y vuelve a comprobarlo.
6. Pulsa **Respaldar borrador de guías** para obtener el JSON de las guías locales; guárdalo en un lugar seguro. Podrás usar **Restaurar respaldo** si cambias de navegador o se elimina su almacenamiento local.

## Cambios funcionales

- Tiempo establecido = consolidación + retraslado + adicional + tiempo necesario de despacho. Los campos vacíos cuentan como 0 **solo cuando al menos uno de los cuatro tiene un valor**. Si los cuatro están vacíos, la referencia es el tiempo manual si se configuró; en otro caso el mejor tiempo del distrito si hay suficiente muestra.
- El umbral continúa siendo el tramo superior de 24 h con mínimo de 48 h. Se usa para calcular descuentos reales, totales, detalle y Excel. La simulación conserva su umbral alternativo configurado independientemente.
- El último periodo y la hora de simulación se recuerdan **en el mismo navegador y usuario**. La carga Excel permanece en IndexedDB de ese navegador. Las tarifas, tiempos, reglas y OK se consultan desde Supabase al entrar al periodo.
- Los botones **Guardar tiempos** y **Guardar tarifas** ya no cierran el diálogo antes de terminar la petición a Supabase. Si hay error, mantienen los valores visibles, muestran el error y permiten reintentar. Las escrituras exigen una respuesta del registro guardado para confirmar la sincronización.
- Las páginas de la consulta a Supabase ordenan por clave para evitar resultados inconsistentes con muchos tiempos guardados. Se muestran mensajes de recuperación y guardado.
- Los archivos JSON de respaldo **solo contienen guías importadas** y datos de origen, nunca contraseñas, sesiones, claves ni tokens. Los ajustes guardados en Supabase no forman parte del JSON.

## Observaciones y seguridad

- **No requiere SQL nuevo** y no migra ni elimina registros anteriores en Supabase.
- Si la carga de origen se hizo en otro navegador, equipo, dominio o sesión privada, el IndexedDB local no estará disponible en el navegador nuevo. Importa el Excel o restaura un respaldo JSON. Esto no afecta a las tarifas/tiempos compartidos en Supabase.
- La versión no modifica liquidaciones finalizadas. Las versiones históricas siguen congeladas, pero **recalcula los borradores** abiertos con el nuevo Tiempo establecido.
- Antes de facturar, prueba guardado y recarga con un PDV, y revisa que las guías con base nueva generen los descuentos esperados.
- No se pudo probar una cuenta real de tu Supabase ni se publicó la versión directamente en GitHub. Se incluyen pruebas automáticas locales del cálculo y una comprobación sintáctica JavaScript.
