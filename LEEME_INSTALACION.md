# Facturación PDV V2.0 – Supabase multiusuario

**Estado:** paquete preparado para instalar y comprobar en el proyecto real. No se han ejecutado los SQL ni se ha publicado código en tu cuenta de Supabase/GitHub. No es posible certificar RLS real hasta realizar pruebas de lectura/denegación con usuarios existentes.

## 1. Qué conserva y qué cambia

- Conserva el motor V1: MODULADOR.xlsx, tarifas estándar/zonales, umbrales desde 48 h, mínimo 10 guías y descuento inmediato al superar el umbral. Exceso máximo por defecto 120 h: si `tiempo logrado - umbral > 120`, pago 0%; exactamente 120 h se aplica la escala.
- **Borradores:** las filas Excel importadas se mantienen en **IndexedDB** del navegador del administrador, como en la V1. No se comparten en red hasta que se finalize una liquidación.
- **Compartidos en Supabase:** configuración por mes, tarifas por PDV y distrito, tiempos por PDV/distrito, accesos asignados y todos los registros de resúmenes/detalles de las liquidaciones FINALIZADAS.
- **Usuarios:** las mismas cuentas de **Supabase Auth** ya existentes, compartiendo `storageKey='v16-replica-auth'` y configuración `V16_CONFIG` de `config.js`. **No se crea otra cuenta Auth**. El acceso al módulo se concede por UID en `facturacion_usuarios`, separadamente de los permisos de Gestión de Guías. El rol debe coincidir con el rol que deseas aplicar en Facturación.
- **Seguridad:** RLS protege los registros de cada PDV. Administrador prepara y publica; Encargado y PDV consultan solo los PDV expresamente autorizados. No basta esconder botones.
- **Versiones:** al publicar, la base valida número de guías e importes de resumen contra detalle. Un FINALIZADO no admite UPDATE/DELETE y una revalidación se publica como nueva versión.

## 2. Instalación – primero base de datos

1. **Realiza un respaldo** de tu base/proyecto antes de ejecutar cualquier cambio SQL.
2. En el **mismo proyecto Supabase** donde ya tienes los usuarios de Gestión de Guías, abre SQL Editor con una cuenta administradora del proyecto.
3. Ejecuta `01_FACTURACION_SUPABASE.sql` completo. Crea únicamente objetos con prefijo `facturacion_` y el esquema privado `facturacion_private`; no elimina ni reemplaza tablas de Penalidades ni Gestión.
4. Abre Authentication > Users y localiza el **correo exacto** de tu administrador EXISTENTE.
5. Reemplaza el correo de ejemplo en `02_ASIGNAR_ADMINISTRADOR.sql` y ejecútalo. Solo inserta el acceso a Facturación para el Auth UID que ya existe.
6. Ejecuta `03_DIAGNOSTICO_INSTALACION.sql`: deben aparecer ocho tablas con `rls_habilitada=true` y la consulta de permisos anon debe devolver **cero filas**.
7. Verifica en Project Settings > API que `facturacion_private` **NO** sea un esquema expuesto. No uses `service_role` en el navegador.

**El script 02 es una autorización privilegiada que debes realizar solo desde el SQL Editor del propietario**. El navegador nunca ejecuta esta inicialización.

## 3. Instalación – archivos de GitHub Pages

Sube a la raíz del repositorio en que ya existe `config.js`:

- `facturacion.html`
- `facturacion.css`
- `motor-facturacion.js`
- `facturacion.js`
- `facturacion-cloud.js`

Mantén intactos `config.js`, `gestion-v2.html`, `bridge.js` y los demás módulos. El nuevo HTML importa `config.js` y el SDK público Supabase desde un CDN. `config.js` debe publicar `window.V16_CONFIG={url,key,loginDomain}` igual que Gestión de Guías. Usa solo la **clave anon/publishable pública**, jamás la clave secreta `service_role`.

Luego abre `https://anthonypmagno-alt.github.io/PENALIDADES/facturacion.html`, cuando la página esté publicada (adaptar si cambiaste repositorio).

Si tienes abierta otra pestaña con Gestión de Guías y ya iniciaste sesión, Facturación intentará reutilizarla. Si la sesión no está disponible, muestra su propio formulario con las mismas credenciales.

## 4. Permisos por usuario

1. Ingresa como administrador y abre **Accesos y PDV**.
2. Copia el **User UID** del usuario existente en Supabase Authentication > Users.
3. Elige rol `ADMINISTRADOR`, `ENCARGADO` o `PDV`.
4. Para ENCARGADO/PDV escribe los PDV autorizados separados por coma, por ejemplo `UCA-02, UCA-04, UCA-05`. Para ADMINISTRADOR la lista se ignora: tiene acceso completo.
5. Guarda. Para revocar acceso, cambia el campo **Acceso** a Deshabilitado.

La pantalla **NO crea cuentas de Supabase Auth** ni cambia el rol de Gestión de Guías: solo gestiona la autorización a Facturación.

## 5. Flujo de uso

1. Selecciona mes y carga `MODULADOR.xlsx` como administrador. El archivo de trabajo se almacena localmente.
2. Configura reglas, tarifas y tiempos. Esos cambios se guardan **en Supabase para ese periodo**.
3. Revisa que no existan `SIN TARIFA`, `SIN TIEMPO BASE` ni conflictos de PDV. El cierre toma **TODAS** las guías del periodo, aunque haya filtros de pantalla.
4. Abre **Historial y cierre**, pulsa **Finalizar y congelar periodo** y confirma.
5. El sistema envía resumen y detalle en lotes, muestra el avance, comprueba sumas en el servidor y marca FINALIZADO.
6. Encargados/PDV pueden ver el periodo en **Liquidaciones compartidas**, consultar sus guías y exportar su Excel filtrado.
7. Si hay un cambio necesario después del cierre, prepara nueva liquidación y publica una **versión nueva**. La anterior se conserva.

## 6. Importación desde la V1 local

Si ya tenías datos guardados en el mismo navegador/origen:

- Las filas del Excel se vuelven a leer automáticamente de IndexedDB al seleccionar el periodo.
- En **Historial y cierre** el administrador puede pulsar **Importar configuración local de V1** para copiar, previa confirmación, las tarifas y los tiempos de su navegador a Supabase. Puede sobrescribir claves de configuración que ya existan en el mismo mes; no afecta cierres finalizados.
- Los cierres V1 locales aparecen con botón **Publicar en Supabase** y se subirán expresamente como nueva versión sin borrar el registro antiguo.

## 7. Validación obligatoria de permisos antes de producción

Prueba con **dos cuentas reales diferentes**:

| Caso | Resultado esperado |
|---|---|
| Administrador: importar y guardar tarifa | Aceptado |
| Administrador: cierre sin tarifas completas | Rechazado en interfaz |
| Administrador: publicar cierre válido | Se guarda versión FINALIZADO |
| PDV UCA-02: abrir liquidaciones finales de UCA-02 | Aceptado |
| PDV UCA-02: intentar ver detalle de UCA-05 en API (no asignado) | Devuelve cero filas |
| PDV/Encargado: intentar actualizar tarifa por API | Rechazado por RLS |
| PDV: consultar configuración/cierre privado de otro PDV | Rechazado por RLS |
| Administrador: intentar alterar FINALIZADO por API | Rechazado por trigger/ACL |
| Administrador: publicar revalidación | Nueva versión, anterior inmutable |
| Usuario Auth sin permiso facturacion_usuarios | Login rechazado por el módulo |

**Importante:** el diagnóstico SQL solo comprueba la instalación. Las pruebas con tokens y usuarios reales son las que certifican la separación por roles. Sigue la guía de RLS de Supabase para pruebas por rol.

## 8. Rendimiento y límites

El Excel MODULADOR puede superar 99 mil guías; un cierre completo de 100 mil guías escribe 100 mil filas de detalle JSONB, más resúmenes. Con historial por versiones, consume almacenamiento e I/O de Supabase. Por las alertas de Disk IO que ya has encontrado, **haz un piloto con pocas guías antes de publicar un mes entero**, revisa Database > Reports/Usage y decide si conviene el detalle completo en tablas o un archivo histórico privado por PDV en Supabase Storage. Esta versión usa tablas con paginación para permitir RLS por PDV.

El usuario administrador debe mantener abierta la pestaña durante la publicación. Si la red falla antes de finalizar, el sistema intentará retirar el cierre `CARGANDO`; si no puede, puede quedar una carga parcial no visible para los PDV. No vuelvas a publicar sin comprobar el estado. No publiques la misma liquidación varias veces por error.

## 9. Archivos de prueba

- `test-motor.js`: `node test-motor.js` – motor financiero V1.
- `test-cloud.js`: `node test-cloud.js` – simulación de cliente Auth y permisos UI (no verifica la base real).
- `03_DIAGNOSTICO_INSTALACION.sql`: seguridad estructural y grants.

## 10. Alcance

Facturación V2.0 **no emite comprobantes SUNAT**; es un sistema de liquidación operativa. La validación de entregas firmadas y evidencias/exoneraciones sigue pendiente y deberá conectarse con una fuente adicional antes del cierre contable definitivo. Los archivos HTML/CSS/JS y SQL están preparados; no se han probado contra tu proyecto real ni desplegado en tu GitHub.
