# Codebase Cleanup and Architecture Stabilization

## Alcance de esta limpieza

Se ejecuto una estabilizacion estructural del proyecto actual sin agregar features nuevas, enfocada en:

- reducir fragilidad por contexto global suelto
- centralizar construccion de rutas Firestore
- bloquear escrituras/lecturas sin contexto completo
- mantener Auth, Firestore, IA, login, deploy y navegacion base

## Arquitectura base aplicada

Ruta oficial introducida:

`users/{uid}/workspaces/{workspaceId}/categories/{categoryId}/...`

Separacion explicita:

- **user account**: `uid` (auth)
- **workspace/business**: `workspaceId`
- **category template**: `categoryId`
- **private data**: subcolecciones bajo `categories/{categoryId}`

## Nuevos archivos centrales

### `appContext.js`

Responsable de resolver y validar:

- `uid`
- `workspaceId` (URL `?workspace=`, fallback controlado)
- `categoryId` (URL `?category=`)

Comportamiento clave:

- persiste contexto por sesion de usuario
- asegura presencia de contexto en URL
- bloquea con error claro cuando falta `uid/workspaceId/categoryId`

### `dataPaths.js`

Builder oficial de rutas Firestore para:

- `profile`
- `clients`
- `orders`
- `jobs`
- `finances`
- `team`
- `settings`
- rutas genericas (`collectionRef`, `docRef`)

Regla aplicada: ningun acceso nuevo debe construir paths manuales fuera de este archivo.

## Modulos normalizados en esta fase

- `category-context.js`
  - ahora construye paths por `dataPaths.js`
  - `businessCollectionRef/businessDocRef` quedaron alineados a `workspaces/categories`
  - categorias por usuario ahora se consultan en `users/{uid}/workspaces/{workspaceId}/categories`

- `configuracion.js`
  - `profile` apunta a `dataPaths.profileDocRef(...)`

- `onboarding.js`
  - guardado inicial de perfil redirigido a `dataPaths.profileDocRef(...)`

- `diagnostico.js`
  - health check de perfil usa `dataPaths.profileDocRef(...)`

- `chat.js`
  - mensajes de conversaciones en Maya ahora usan `scopedDoc("conversations", ...)+collection("messages")`
  - se evita construcción directa legacy `users/{uid}/business/{categoryId}/...`

- `dashboard-data.js`
  - `scopedCategoryCollection` actualizado a estructura `workspaces/categories`
  - bloqueo explicito cuando falta `ownerUid` (sin fallback global)
  - `fetchClientsForBusiness` actualizado y bloqueado sin `uid`

- `firestore.rules`
  - agregado soporte para `users/{uid}/workspaces/{workspaceId}/categories/{categoryId}/...`

## Archivos legacy eliminados/aislados

- Scripts de migracion automatica: **no presentes** en el flujo actual.
- Archivos eliminados previamente y confirmados como ausentes:
  - `functions/scripts/migrate-yourcolor-legacy-to-category.mjs`
  - `docs/yourcolor_legacy_data_migration_report.md`

## Rutas viejas prohibidas

Quedan prohibidas para lecturas/escrituras nuevas:

- `businesses/{businessId}/...` (acceso global legacy)
- `users/{uid}/business/{categoryId}/...` (modelo intermedio legacy)
- cualquier path armado manualmente fuera de `dataPaths.js` para data privada de categoria

## Estado actual de limpieza (pendiente de normalizar)

Aun existen referencias legacy en algunos archivos no normalizados en esta fase:

- `diagnostics-logger.js`
- `receipt-settings.js`
- `solicitudes.js`
- `solicitar.js`
- `campanas.js`
- `receipt-public-sync.js`

Nota: estos archivos deben migrarse a `appContext.js` + `dataPaths.js` en la siguiente fase para cerrar la limpieza total.

## Validacion funcional esperada

Con contexto URL correcto:

- `custom_apparel` opera desde estado vacio
- `roofing_construction` opera desde estado vacio
- sin mezcla entre categorias
- sin mezcla entre usuarios

Si falta `uid/workspaceId/categoryId`:

- se bloquea acceso de datos
- se emite error claro
- no hay fallback a rutas globales

## Siguiente revision recomendada

1. Migrar archivos pendientes listados arriba a `dataPaths.js`.
2. Revisar `firestore.rules` para endurecer acceso a rutas legacy (solo lectura temporal si aplica).
3. Completar auditoria de writes para garantizar 100% cumplimiento de "no writes fuera de dataPaths".
