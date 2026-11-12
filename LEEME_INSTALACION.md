# Accesos a Facturación DESDE Penalidades

Complemento para la versión V2.3 de Facturación. **NO reemplaza Penalidades ni Gestión de Guías.**

## Qué hace

- Reutiliza la cuenta existente de Supabase Auth con que el usuario abre Penalidades.
- Muestra `👤 Accesos a Facturación` en la barra superior de Penalidades **solo si quien está conectado es administrador activo de Facturación** (`facturacion_usuarios`).
- Permite buscar una cuenta existente por el **correo de Supabase Auth** o el nombre de usuario si está configurado `V16_CONFIG.loginDomain`.
- Permite habilitar/deshabilitar acceso, elegir rol `ADMINISTRADOR`, `ENCARGADO` o `PDV` y limitar los PDV visibles de encargados/PDV.
- Muestra `💰 Ir a Facturación` para las personas autorizadas que están dentro de Penalidades.
- Registra permisos en `public.facturacion_usuarios`, con las políticas RLS ya instaladas en Facturación V2.
- No crea usuarios nuevos ni modifica los accesos que ya tienen a Penalidades.

## Instalación (en orden)

1. Haz una copia de seguridad de tu `penalidades.html` **ACTUAL** de GitHub.
2. En Supabase SQL Editor, ejecuta **`05_BUSCAR_USUARIO_AUTH_FACTURACION.sql`** usando un rol de administración como `postgres`. Solo instala una función RPC de búsqueda protegida.
3. En GitHub, sube el archivo **`facturacion-accesos-penalidades.js`** a la misma carpeta de `penalidades.html`.
4. Abre tu `penalidades.html` actual y añade **una única línea** antes del cierre `</body>`:

   ```html
   <script src="./facturacion-accesos-penalidades.js?v=1"></script>
   ```

5. Abre Penalidades con la misma cuenta que fue habilitada como **ADMINISTRADOR de Facturación** con el SQL `02_ASIGNAR_ADMINISTRADOR.sql`; actualiza con `Ctrl+Shift+R`.
6. En `👤 Accesos a Facturación`, escribe el correo de un usuario que ya exista en Supabase Auth, pulsa **Buscar cuenta**, elige rol, indica PDV permitidos y pulsa **Guardar acceso**.
7. Cierra sesión e ingresa con la cuenta de prueba. Verifica que aparece `💰 Ir a Facturación` y que Facturación muestra solo sus PDV. Intenta abrir por API un PDV no permitido para confirmar la protección RLS, no te bases únicamente en la UI.

## Seguridad y límites

- Solo un **administrador activo de Facturación** puede buscar usuarios, leer membresías y asignar acceso, incluso si otra persona logra mostrar los controles manualmente. El permiso se aplica en PostgreSQL mediante el RLS ya existente.
- Un usuario autorizado para Penalidades no adquiere automáticamente el permiso de Facturación: requiere una fila en `facturacion_usuarios`.
- Si el botón no aparece, confirma que la cuenta actual es ADMINISTRADOR en `facturacion_usuarios` (no basta con ser ADMINISTRADOR de Penalidades).
- El correo consultado debe coincidir exactamente con `Authentication > Users`; la extensión no muestra la lista privada de todos los correos de Auth.
- Para ENCARGADO y PDV se exige al menos un PDV. El rol ADMINISTRADOR permite todos los PDV y debe concederse solo a personal de confianza.
- No uses `service_role` ni credenciales privadas en `config.js` o en el navegador.
- Si tu `penalidades.html` actual utiliza una estructura de encabezado distinta de `.top-actions`, habrá que adaptar el selector del botón; este complemento se basó en el HTML disponible en la conversación, no en una lectura del despliegue actual.
- El SQL y el complemento se validaron estáticamente, pero **no se han ejecutado en tu Supabase ni publicado en GitHub**. No se pudieron ejecutar pruebas visuales de Chromium en este entorno.

## Revertir la integración

- Quita la línea `<script src="./facturacion-accesos-penalidades.js?v=1"></script>` de `penalidades.html`.
- Si deseas retirar el buscador SQL sin afectar accesos, ejecuta `DROP FUNCTION IF EXISTS public.facturacion_buscar_usuario_existente(text);` desde SQL Editor.
- Quitar la interfaz NO elimina los permisos previamente guardados; esos se administran desde Facturación > Accesos y PDV o en la tabla `facturacion_usuarios`.
