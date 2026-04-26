# Clean State Category Functionality Fix

## Objetivo

Dejar la plataforma funcional desde estado limpio (sin datos previos) para:

- `custom_apparel` (YourColor)
- `roofing_construction` (Diaz and Yanez LLC)

Sin migrar datos antiguos y sin mezcla entre categorias.

## Cambios aplicados

### 1) Contexto por URL en estado limpio

- Se reforzo `resolveCategoryContextForUser` en `category-context.js` para que, si no existen documentos en `users/{uid}/categories`, use `?category=` como contexto valido.
- Se garantiza `setActiveCategoryId` + `ensureCategoryInUrl` tambien en ese escenario.
- Ajuste de normalizacion: `construction_roofing` ahora se normaliza a `roofing_construction`.

Impacto: una categoria puede operar desde cero aun sin documentos preexistentes.

### 2) Resolucion de negocio para categoria limpia

- En `dashboard-data.js`, `resolveBusinessForUser` ahora construye un negocio de alcance por URL (`scope: { uid, categoryId }`) cuando no existe negocio legacy ni categoria persistida.

Impacto: las pantallas no dependen de data historica para arrancar.

### 3) Configuracion robusta sin documento previo

- En `configuracion.js` se agrego `saveProfilePatch(...)` usando `setDoc(..., { merge: true })`.
- Las secciones `business`, `brand`, `marketing`, `platform` e integraciones ahora guardan con `setDoc` merge sobre `users/{uid}/business/{categoryId}/profile`.
- Esto evita fallos por `updateDoc` sobre documentos inexistentes.

Impacto: si `profile` no existe, el formulario carga vacio, permite guardar y crea el documento correctamente.

### 4) Equipo sin fallback global

- En `equipo.js` se elimino fallback a `businesses/{businessId}/...`.
- Todas las operaciones quedan forzadas a `businessCollectionRef/businessDocRef` con `scopeUid + businessId`.
- `fetchTeamMembersForBusiness` en `dashboard-data.js` se actualizo para leer por ruta canonica y recibir `ownerUid`.

Impacto: `Equipo` no mezcla datos ni usa rutas globales.

### 5) Calendario flotante en ruta canonica

- En `dash-shell.js` el widget de calendario ahora usa:
  - `users/{uid}/business/{categoryId}/calendar` (read/write/update/delete)
- Se elimino uso de `businesses/{businessId}/calendar`.

Impacto: escrituras del shell tambien respetan aislamiento por categoria.

### 6) Empty states solicitados

- `clientes.js`: mensaje principal actualizado a **"No hay clientes todavia."**
- `finanzas.js`: mensaje principal actualizado a **"No hay movimientos todavia."**
- `pedidos.js`: vacio actualizado a **"No hay pedidos todavia."**
- `trabajos.js`: se agrego fila vacia con **"No hay trabajos todavia."**

## Migracion deshabilitada

Se eliminaron artefactos de migracion para evitar cualquier uso accidental:

- `functions/scripts/migrate-yourcolor-legacy-to-category.mjs`
- `docs/yourcolor_legacy_data_migration_report.md`

No se agrego ninguna ejecucion automatica de migracion en el flujo UI.

## Validacion tecnica (arquitectura)

- Sin errores de lint en archivos modificados.
- Modulos criticos revisados para estado limpio:
  - `configuracion`
  - `clientes`
  - `pedidos`
  - `trabajos`
  - `finanzas`
  - `equipo`
  - `chat` (sin cambios en este ajuste; ya opera con scope y category)
  - `dash-shell` (calendario)

## Checklist de aceptacion manual

### `custom_apparel`

1. Abrir `...html?category=custom_apparel`.
2. Confirmar que Configuracion carga sin error, con formulario vacio.
3. Guardar perfil de YourColor.
4. Crear cliente en Clientes.
5. Crear pedido en Pedidos.
6. Marcar pedido como entregado.
7. Verificar movimiento en Finanzas dentro de `custom_apparel`.

### `roofing_construction`

1. Abrir `...html?category=roofing_construction`.
2. Confirmar que Configuracion carga sin error, con formulario vacio.
3. Guardar perfil de Diaz and Yanez LLC.
4. Crear cliente en Clientes.
5. Crear trabajo en Trabajos.
6. Marcar trabajo completado/pagado.
7. Verificar movimiento en Finanzas dentro de `roofing_construction`.

### Aislamiento

- Mantener una pestaña por categoria y navegar en ambas.
- Confirmar que la URL conserva `?category=` en cada pagina.
- Confirmar que no hay escritura cruzada entre categorias.
