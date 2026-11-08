# Módulo Seguimiento General de Guías — V1 (08/11/2026)

## Instalación en GitHub Pages

1. Subir y reemplazar **todos los archivos del ZIP** en la raíz del repositorio actual, especialmente:
   - `gestion-v2.html` — añade la pestaña protegida de Seguimiento General.
   - `bridge.js` — expone al módulo el catálogo PDV LISTA ya autorizado en Gestión V2.
   - `index.html` — versión nueva para invalidar caché de GitHub Pages.
   - `seguimiento-general.html` — vista del módulo.
   - `seguimiento-general.css` — estilos.
   - `seguimiento-general.js` — carga, controles, filtros, Excel y representación.
   - `seguimiento-core.js` — procesamiento y cálculos.
2. Ingresar por `index.html` o `gestion-v2.html`, iniciar sesión y seleccionar **Seguimiento general de guías**.
3. Subir varios Excel de **Exportación de guía de embarque** y, opcionalmente, varios Excel de **Monitoreo de entrada al puerto del nodo**. Si el catálogo PDV LISTA no aparece en el portal, cargar el Excel **PDV LISTA** también.
4. Pulsar **Procesar archivos seleccionados**. Una nueva carga se añade a la información de la sesión y se consolida por guía. Marcar **Reemplazar cargas anteriores** solo si se desea reiniciar el universo.

## Fuentes y cruce

- **Exportación de guía de embarque**: clave `Número de Guía`; `Tiempo de entrada`, `Punto de escaneo más reciente`, `Punto de entrega`, `Tipo de escaneo más reciente`, `Última actualización`, Provincia/Ciudad/Colonia de destino, reparto y firma.
- **Monitoreo de entrada al puerto del nodo**: misma clave; se extraen únicamente `Hora de salida del HUB`, `Hora de llegada al PDV` y `Tiempo de despacho` (aparte de `Número de Guía` y una fecha auxiliar para seleccionar registros duplicados).
- **PDV LISTA**: `NOMBRE SIMPLE`, `NOMBRE.SIMPLE2`, `Área 区域1`, `Región`, `ENCARGADO`. Se usa el catálogo del portal automáticamente; el usuario puede reemplazar/añadir entradas con un maestro Excel.
- **Área del grupo**: área correspondiente al **punto de escaneo más reciente**. Si el punto es un HUB o no existe en PDV LISTA, la guía aparece como `SIN ÁREA`; no se atribuye arbitrariamente al área del PDV de entrega. El área del PDV destino queda en una columna independiente del Excel descargado.
- **Duplicados**: se conserva un solo registro por `Número de Guía`, seleccionando la actualización/escaneo más reciente para Exportación y la información temporal más reciente para Monitoreo. A igualdad de fecha prevalece el último Excel cargado.
- **Sin monitoreo**: las guías de Exportación que no aparecen en Monitoreo se muestran como `SIN MONITOREO`; no se marcan `EN TRÁNSITO` automáticamente.

## Cálculos (hora Perú)

`Días transcurridos = (ahora – fecha del evento) / 86.400.000` (milisegundos), con **8 decimales**.

- `Días cola larga = ahora – Tiempo de entrada`.
- `Días desde HUB = ahora – Hora de salida del HUB`.
- `Días desde PDV = ahora – Hora de llegada al PDV`.
- `Días desde despacho = ahora – Tiempo de despacho`.
- **SLA**: si existe `Hora de llegada al PDV`, `ahora – llegada PDV`; en caso contrario, si existe `Tiempo de despacho` y `Hora de salida del HUB`, `ahora – salida HUB`.
- Si el registro tiene monitoreo pero no cumple las anteriores condiciones: `EN TRÁNSITO` (sin despacho) o `SIN SALIDA HUB` (hay despacho pero falta salida), **sin SLA calculable**.
- Si falta una fecha, el valor de tiempo transcurrido se muestra como `—`, nunca cero.
- Ejemplo de referencia: `08-11-2026 03:44 – 01-11-2026 01:26 = 7.09583333 días`.

## Filtros y resumen

- Para cada una de las cuatro fechas: **Desde**, **Hasta** en `dd-mm-aaaa`, con hora opcional `HH:mm`, **días mínimos**, **días máximos**, y **sin fecha**.
- Los rangos de solo fecha incluyen todo el día final (23:59:59.999). Las fechas Excel se interpretan como hora local de Perú, UTC-05:00.
- Selector múltiple con búsqueda para área, último punto, PDV, tipo de escaneo, estado de SLA y destinos (Provincia, Ciudad, Colonia).
- Filtro adicional de SLA por mínimo y máximo de días.
- Tabla resumen agrupada por **Área + Punto de escaneo más reciente**, con conteos, guías sin SLA y promedios de cola larga/SLA. Seleccionar una fila reduce el detalle sin modificar el universo filtrado.
- El detalle se dibuja en bloques de 150 filas, sin dejar de considerar el total en los cálculos ni en la descarga.
- Excel descargable con dos hojas: **Resumen** y **Detalle**; los días se exportan como valores numéricos con formato `0.00000000`.
- Los tiempos se recalculan cada minuto mientras el módulo está abierto. El Excel descargado captura los días a la hora de exportación.

## Limitaciones de esta primera versión

- **Carga local de sesión:** no se envían los Excel ni los registros del módulo a Supabase y **no** quedan compartidos con otros usuarios. Al cerrar la pestaña o salir de la plataforma, hay que volver a cargar los archivos. Esto evita crear tablas, SQL o tráfico de escritura sin autorización.
- No cambia los cálculos ni las fuentes de Gestión V2, Consulta desde Excel ni Penalidades.
- La biblioteca de lectura/escritura Excel se carga desde el mismo CDN de SheetJS XLSX que usa Penalidades. Se necesita acceso a esa dependencia para importar/exportar archivos.
- Antes de desplegar, conservar una copia del repositorio actual. Si el navegador no muestra la pestaña nueva, actualizar con Ctrl + Shift + R y confirmar que el build sea `20261108-SEGUIMIENTO-V1`.
- El módulo se muestra dentro de Gestión V2 a usuarios con permiso de visualizar `gestion_v2`. El catálogo PDV se lee mediante la sesión activa del portal.
