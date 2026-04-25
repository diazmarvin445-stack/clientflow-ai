# Centro de Diagnóstico (admin-only)

## Objetivo cumplido

Se implementó un **Centro de Diagnóstico** para dueños/admin del negocio con:

- Botón/enlace de acceso en sidebar y en Configuración.
- Página `diagnostico.html` con tarjetas de estado y errores.
- Logger interno seguro `logPlatformIssue(type, module, technicalMessage, friendlyMessage, metadata)`.
- Guardado en Firestore bajo `businesses/{businessId}/diagnostics/{issueId}`.

## UI creada

- Nueva página: `diagnostico.html` + `diagnostico.js`.
- Tarjetas visibles:
  - Estado general
  - Errores recientes
  - Problemas de Firebase
  - Problemas de Maya
  - Problemas de Clientes
  - Problemas de Pedidos
  - Recomendación en palabras simples
- Estilos nuevos en `styles.css` con prefijo `diag-*`.

## Control de acceso (solo admin)

- El enlace de sidebar se inyecta dinámicamente solo para owner/admin (`ensureDiagnosticsNavLink` en `dash-shell.js`).
- En `configuracion.html`, el acceso “Diagnóstico →” se muestra solo para owner/admin.
- `diagnostico.js` valida owner/admin; si no cumple, redirige a `dashboard.html`.

## Logger seguro

Archivo: `diagnostics-logger.js`

- API principal:
  - `logPlatformIssue(type, module, technicalMessage, friendlyMessage, metadata, severity)`
  - `setDiagnosticsLoggerContext({ businessId, ownerUid })`
  - `wireGlobalDiagnosticsListeners(moduleName)`
- Protecciones:
  - Recorta mensajes largos.
  - Sanitiza metadata (solo valores seguros y resumidos).
  - Evita guardar conversaciones privadas o payloads sensibles completos.

## Explicaciones en lenguaje simple

Incluye mapeos para casos típicos:

- `Missing or insufficient permissions` ->
  “Firestore bloqueó esta acción. Probablemente falta permiso en las reglas para leer o guardar estos datos.”
- Error al compartir recibo ->
  “No se pudo compartir el recibo. Puede ser permiso, navegador o link público no creado.”
- Error de acción Maya ->
  “Maya entendió el mensaje, pero no pudo ejecutar la acción en la base de datos.”

## Integraciones iniciales de diagnóstico

Se conectó logging en módulos clave:

- `chat.js`
  - Fallo al iniciar chat.
  - Fallo al ejecutar acción Maya.
  - Fallo al enviar/recibir respuesta IA.
  - Fallo al convertir cotización a orden.
- `pedidos.js`
  - Fallo al abrir recibo.
  - Fallo al compartir recibo.
  - Fallo al cargar módulo de pedidos.
- `configuracion.js`
  - Fallo al cargar configuración.
  - Fallo al guardar secciones.
  - Fallo al cambiar integraciones.
- Listeners globales `window.error` y `unhandledrejection` para capturar errores JavaScript no controlados.

## Firestore y reglas

Colección usada:

- `businesses/{businessId}/diagnostics/{issueId}`

Campos guardados:

- `type`
- `module`
- `technicalMessage`
- `friendlyMessage`
- `createdAt`
- `resolved`
- `severity`
- `ownerUid`
- `metadata` (sanitizada)

Reglas añadidas en `firestore.rules`:

- `match /diagnostics/{issueId} { allow read, write: if isBusinessOwner(businessId); }`

## Archivos modificados

- `diagnostics-logger.js` (nuevo)
- `diagnostico.html` (nuevo)
- `diagnostico.js` (nuevo)
- `dash-shell.js`
- `category-config.js`
- `configuracion.html`
- `configuracion.js`
- `chat.js`
- `pedidos.js`
- `styles.css`
- `firestore.rules`
