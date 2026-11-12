# Facturación PDV V2.9 — Tarifario masivo Excel

## Qué se agregó

En **Tarifario PDV** hay una barra con:

- **Cargar tarifario Excel**: importa varias tarifas zonales y varios PDV a la vez desde la hoja **R4**.
- **Descargar tarifario Excel**: exporta todas las tarifas del periodo o solo los PDV seleccionados en los filtros superiores.
- **Vista previa**: muestra cantidad de tarifas válidas, PDV, duplicados, errores y conflictos antes de confirmar.
- **Descargar incidencias**: genera un Excel para revisar tarifas repetidas o inválidas.
- Se respeta la modalidad **ZONAL**, la tarifa estándar (si ya existe) y las demás excepciones no mencionadas en la importación.
- El importador también acepta la hoja opcional `ESTANDAR_PDV`, que permite asignar la modalidad y la tarifa estándar por PDV.

## Instalación (en este orden)

1. En **Supabase > SQL Editor**, ejecuta **`09_IMPORTACION_MASIVA_TARIFAS.sql`** con rol propietario (`postgres`). Esta migración añade una función RPC nueva, sin modificar las tablas existentes.
2. En GitHub Pages reemplaza estos siete archivos por los incluidos en el ZIP:
   - `facturacion.html`
   - `facturacion.css`
   - `facturacion.js`
   - `facturacion-cloud.js`
   - `facturacion-borradores-cloud.js`
   - `facturacion-i18n.js`
   - `motor-facturacion.js`
3. **Agrega** el archivo nuevo `facturacion-tarifas-masivas.js` al mismo directorio.
4. Conserva `config.js` y todos los demás archivos de tu plataforma.
5. Actualiza la página con `Ctrl + Shift + R` y confirma que diga **V2.9**.
6. En Facturación, selecciona el **periodo correcto**. Abre **Tarifario PDV > Cargar tarifario Excel**.
7. Revisa las incidencias y pulsa **Confirmar importación a Supabase**. La función de Supabase guarda todos los PDV en una transacción: si una validación SQL falla, se revierten todos los cambios de esa operación.
8. Pulsa **Descargar tarifario Excel** para obtener la exportación del periodo, con hojas `R4`, `ESTANDAR_PDV` e `INSTRUCCIONES`.

## Formato aceptado

El sistema detecta por encabezados la hoja **R4** (aunque esté en otra posición):

| UBIGEO | Departamento | Provincia | Distrito | 围栏网点/ PDV | 现有派费 |
|---|---|---|---|---|---|
| 020204 | ANCASH | AIJA | LA MERCED | ANC-03 | 6.49 |

- `UBIGEO` es opcional y se conserva en la exportación cuando viene informado.
- La combinación única de tarifa zonal es **PDV + Departamento + Provincia + Distrito**.
- El valor de tarifa admite números desde cero hasta 100 000, con dos decimales como máximo.
- Los distritos pueden incluirse aunque todavía no tengan guías en el periodo activo; sus tarifas quedan disponibles para cargas futuras del mismo periodo.
- La importación **no elimina** tarifas no listadas.
- No establece tarifas estándar a partir de la hoja R4. Si una tarifa estándar está vacía, las localidades que no tengan excepción zonal seguirán sin tarifa.

### Opcional: `ESTANDAR_PDV`

| PDV | MODALIDAD | TARIFA ESTANDAR S/ |
|---|---|---|
| ANC-03 | ZONAL | 3.30 |
| JUN-02 | ESTANDAR | 4.50 |

Las celdas en blanco de tarifa estándar **no la borran**. Cuando un PDV tiene excepciones zonales en R4, se usa modalidad **ZONAL**, incluso si la hoja ESTANDAR_PDV dice ESTANDAR, para evitar desactivar esas excepciones.

## Observación sobre tu archivo 中部派费.xlsx

- Hoja: `R4`.
- 1 216 filas de datos, 26 PDV.
- 19 duplicados exactamente iguales; se omiten.
- **Conflicto en ANC-06 / ANCASH / PALLASCA / CABANA**: fila 189 = S/ 8.00; fila 899 = S/ 9.00. Esa localidad **se excluye**, sin alterar ninguna tarifa anterior, hasta que decidas cuál importe aplicar.
- **1 195 tarifas zonales** válidas y sin conflicto para importación.

## Seguridad y compatibilidad

- Solo `ADMINISTRADOR` habilitado en `facturacion_usuarios` puede importar/exportar el tarifario en el cliente. La función SQL valida nuevamente el rol activo y usa las políticas RLS existentes.
- Se utiliza `Supabase Auth` y `config.js` público existente. No pegues ninguna `service_role` en GitHub ni en el navegador.
- No altera reglas globales, tiempos, OK, archivos originales ni cierres de facturación ya finalizados. Los OK de filas cuyos importes cambien necesitarán nueva revisión al actualizarse la firma de los datos.
- Las tarifas se guardan **por periodo**. Cambiar de mes no modifica otro mes.

## Pruebas

- Se validó el archivo aportado con el importador real: 26 PDV, 1 195 tarifas válidas, conflicto aislado.
- Se comprobó en navegador la vista previa, confirmación usando una respuesta simulada de Supabase, conservación de valores y formato de exportación.
- Se verificó la sintaxis JavaScript.
- No se ha ejecutado la migración SQL ni comprobado con tu Supabase real, por lo que la prueba de producción queda pendiente.
