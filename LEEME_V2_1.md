# FACTURACIÓN PDV · V2.1 — Filtros de revisión y OK por fila

## Instalación en plataforma V2.0 que ya tiene Supabase Auth

**Orden obligatorio**: realiza una copia de seguridad antes de aplicar la migración.

1. En el proyecto existente de Supabase, abre **SQL Editor** con usuario con privilegios de propietario.
2. Ejecuta **solo `04_REVISIONES_OK.sql`**. No repitas los scripts 01 y 02 si ya terminaron correctamente. El script crea únicamente la tabla nueva `public.facturacion_revisiones`, su índice, dos funciones y disparadores para invalidar revisiones cuando cambian reglas, tiempos o tarifas; configura las políticas RLS y permisos. No borra cierres ni guías.
3. En GitHub Pages, **reemplaza** los cinco archivos de la versión anterior en la misma ruta: `facturacion.html`, `facturacion.css`, `facturacion.js`, `facturacion-cloud.js`, `motor-facturacion.js`. Mantén tu `config.js` actual **sin cambiar sus credenciales**. No subas SQL ni scripts de pruebas a GitHub.
4. Recarga con **Ctrl + Shift + R**. Inicia sesión con el administrador de Facturación. Importa el MODULADOR del periodo si aún no figura en ese navegador.
5. Abre **Resumen por distrito** y comprueba los filtros y el OK con una fila cuyo tiempo y tarifa estén calculados.

## Filtros añadidos en Resumen por distrito

- **Muestra mínima**: `Todas`, `Con muestra suficiente`, `Sin muestra suficiente` (la segunda y tercera usan el mínimo configurado, 10 guías por PDV-distrito dentro del periodo de referencia). Los que tienen un mejor PDV elegible aparecen como muestra suficiente; si ningún PDV de ese distrito cumple, figura «Muestra insuficiente».
- **Mejor PDV**: todos, sin mejor PDV o un PDV concreto.
- **Revisión OK**: Todos / Con OK / Sin OK.
- **Umbral establecido**: todos, sin umbral o un umbral concreto (48, 72, 96, ...).
- **Tiempo establecido**, **Tarifa** y **Observaciones**: Todos / Con dato / Sin dato.

Los filtros se combinan con los existentes de Departamento, Provincia, Distrito, PDV, búsqueda y Estado del detalle. **Afectan simultáneamente** resumen, indicadores, detalle y Excel de la selección. **No alteran el cierre completo**: el botón Finalizar sigue tomando todas las guías del periodo, incluso si la pantalla muestra solo una parte filtrada.

## Casilla de revisión OK

- Cada fila distrito/PDV tiene un checkbox en la nueva columna **OK**.
- No se habilita mientras falte el **Umbral establecido** o la **tarifa**. En distritos sin muestra suficiente puedes colocar manualmente un tiempo base, y después aprobar cuando también exista una tarifa.
- El OK se guarda en `facturacion_revisiones` con periodo, PDV, destino, UID del aprobador y fecha/hora generada **en el servidor**. Solo los ADMINISTRADORES pueden marcar o quitar el OK; RLS lo restringe en Supabase.
- El OK persiste al cambiar de página, filtros y recargar; las configuraciones y guías correspondientes deben ser equivalentes. Al modificar una regla, tarifa o tiempo, el servidor invalida los OK afectados. La aplicación también invalida cualquier OK que ya no coincida con los datos/valores calculados de las guías importadas.
- El Excel agrega columnas **OK**, **OK POR** y **OK FECHA** en RESUMEN. Los cierres nuevos conservan el estado de revisión en la copia congelada del resumen.
- **El OK es un estado de revisión y no un bloqueo obligatorio del cierre** en esta versión. No se cambió la regla actual de cierre sin indicación expresa.

## Pruebas realizadas

- `node --check` para los JavaScript principales.
- Pruebas locales del motor (18+ verificaciones) y conexión simulada (7).
- Prueba de los filtros de muestra, OK, sin tiempo, sin umbral, observaciones y reconocimiento de aprobaciones obsoletas mediante Node (sin conexión a Supabase).
- Verificación estructural del HTML y de sus controles.

**Pendiente de validar en tu entorno**: ejecución del SQL `04`, RLS real en Supabase con dos usuarios, guardado del checkbox y renderizado visual en el navegador. No se ha ejecutado la migración contra tu proyecto ni publicado en GitHub.

## Si ocurre un error

- `relation "public.facturacion_revisiones" does not exist`: ejecuta `04_REVISIONES_OK.sql` antes de abrir V2.1.
- `permission denied` o `42501`: verifica que 01 y 02 se ejecutaron y el usuario activo tiene rol `ADMINISTRADOR` en `facturacion_usuarios`.
- «Muestra insuficiente»: verifica que exista un PDV con **al menos 10 guías válidas** en el distrito dentro del **periodo de referencia**, no necesariamente en el periodo de facturación.
- Si marca OK y luego se desmarca por sí solo, revisa la tarifa, los tiempos o si se importó una versión distinta del archivo. La revisión debe repetirse tras cambios relevantes.

No incluye ni requiere claves privadas `service_role`.
