# Facturación PDV V2.2 — Simulador de umbral configurable

## Instalación (desde V2.1)

1. Haz copia de seguridad de los cinco archivos web actuales.
2. En GitHub, reemplaza **facturacion.html**, **facturacion.css**, **facturacion.js**, **facturacion-cloud.js** y **motor-facturacion.js**, en el mismo directorio donde ya funciona Facturación. No modifiques `config.js`.
3. Actualiza con **Ctrl + Shift + R** y entra a **Resumen por distrito**.
4. En **Umbral de simulación (h)** escribe cualquier número positivo, por ejemplo `48`, `72`, `96` o `50.5`. El valor inicial es `48`. La simulación usa ese valor exactamente: no lo redondea automáticamente al próximo umbral.
5. El **Neto simulación N h** aparece entre **Descuentos** y **Neto** junto con la **Diferencia vs N h = Neto real − Neto simulado**. Hay total filtrado al pie de la tabla. También aparecen en **Detalle de guías** y en el Excel.

**No debes ejecutar SQL nuevo**. Esta versión es compatible con las tablas, políticas RLS y estructura de la V2.1. Supabase Auth, accesos, tarifas, tiempos, revisiones OK e historiales continúan como estaban.

## Cálculo

- El **neto real** sigue usando el *umbral establecido* del distrito/PDV. No cambia.
- El **neto simulado** aplica la **misma tarifa**, **reducción por bloque**, **duración del bloque** y **exceso máximo permitido**; solamente reemplaza el umbral real por el número que escribes.
- Al superar el umbral de simulación, se aplica el primer descuento inmediatamente. Los bloques adicionales comienzan en cada frontera exacta.
- Si el exceso es **mayor** que el exceso máximo permitido, el pago simulado pasa a cero, igual que el real.
- El cálculo se realiza **por guía**, redondeando cada importe a dos decimales antes de sumar. La diferencia se calcula por guía y se suma.
- Para que ambos resultados sean comparables, se simula únicamente sobre las guías **con tarifa y neto real calculados**. Los registros sin tiempo real o sin tarifa quedan fuera de ambos netos, aunque siguen en el conteo de guías pendientes.
- **Diferencia positiva:** el umbral real paga más que el escenario simulado. **Diferencia negativa:** el escenario simulado paga más.
- El cambio del simulador no invalida revisiones OK, no modifica ninguna configuración ni persiste nada en Supabase, y **no altera cierres finalizados**.

### Ejemplo

Tarifa S/ 5.00, tiempo logrado 80 h, umbral real 72 h, descuento 10 % cada 24 h:

| Concepto | Neto |
|---|---:|
| Real con 72 h | S/ 4.50 |
| Simulación con 48 h | S/ 4.00 |
| Diferencia real − simulado | +S/ 0.50 |

Si escribes `72`, el neto simulado pasa a S/ 4.50 y la diferencia a S/ 0.00.

## Excel

**Excel · selección** exporta las guías y PDV que cumplen los filtros activos y agrega dos columnas en **RESUMEN** y **DETALLE**, más la fila **TOTAL FILTRADO** en RESUMEN. La hoja **REGLAS** incluye el umbral simulado y sus totales.

El Excel de liquidaciones históricas puede incluir la comparación calculada con el umbral que tengas indicado cuando lo exportes, pero **esa comparación no es parte de la liquidación original congelada**.

## Validaciones realizadas

- `node --check` sobre los JavaScript.
- Pruebas automatizadas locales: umbral real 72 vs simulación 48/72, descuento en límites exactos, exceso máximo, subtotales en pantalla y valores/anchos en las cuatro hojas exportadas mediante un generador simulado.
- No se ha publicado el HTML en GitHub ni probado la conexión a Supabase real desde esta entrega. Verifica el comportamiento en tu navegador con tus datos antes de usar los resultados para efectuar pagos.
