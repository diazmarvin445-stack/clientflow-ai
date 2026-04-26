# Category URL Context Isolation Fix

## Problem addressed

Multiple pages were resolving category context from shared state and mixed Firestore paths, causing:

- cross-page context drift between categories
- empty data in `Clientes` / `Finanzas`
- broken persistence in `Configuración`
- delivered/completed work not updating the intended category finance records

## Implemented strategy

1. Category context is now URL-first (`?category=...`) and per-page.
2. Session fallback remains, but only when URL has no category.
3. Sidebar links preserve the active category in URL.
4. Critical modules now use category-scoped paths under:
   - `users/{uid}/business/{categoryId}/...`

## Key code changes

### 1) Category context resolution and URL helpers

Updated `category-context.js`:

- Added `getCategoryFromUrl()` (URL-first category read).
- Added `ensureCategoryInUrl(categoryId)` (keeps selected category in current URL).
- Added `withCategoryInHref(href, categoryId)` (preserve category in navigation links).
- Added `businessCollectionRef(...)` and `businessDocRef(...)` for canonical category-scoped access.
- Updated `resolveCategoryContextForUser(...)` to choose category in this order:
  1. URL `category`
  2. session active category
  3. first available category

### 2) Sidebar and navigation context isolation

Updated `dash-shell.js`:

- Sidebar/category menu links are now generated with `?category=<currentCategory>`.
- Existing sidebar links are rewritten to include current category when shell hydrates.
- User dropdown links are also rewritten with active category.
- Route matching now ignores query string, preventing wrong active-state behavior.
- Anchor selectors were updated to support query-param links (e.g. `href^="finanzas.html"`).

### 3) Configuración profile single-source path (already aligned)

`configuracion.js` + `category-context.js` now load/save profile from:

- `users/{uid}/business/{categoryId}/profile`

with safe empty-form fallback when profile does not exist.

### 4) Clientes category-scoped data

Updated `clientes.js`:

- CRUD now uses:
  - `users/{uid}/business/{categoryId}/clients`
- linked jobs counting uses:
  - `users/{uid}/business/{categoryId}/jobs`

Updated `dashboard-data.js`:

- `fetchClientsForBusiness(...)` now reads category clients from:
  - `users/{uid}/business/{categoryId}/clients`

### 5) Finanzas category-scoped data

Updated `finanzas.js`:

- Scoped collection/doc helpers now map finance operations to:
  - `users/{uid}/business/{categoryId}/finances`
- Existing module flow remains unchanged, but writes/reads are now category-scoped.

### 6) Pedidos (custom_apparel) finance updates in same category

Updated `pedidos.js`:

- Orders now read/write from:
  - `users/{uid}/business/{categoryId}/orders`
- `markOrderDelivered(...)` now updates order status directly in scoped category path.
- Added `upsertDeliveredOrderFinance(orderId)` to create missing finance movements in:
  - `users/{uid}/business/{categoryId}/finances`
- Manual order create/update/delete now run directly against category-scoped paths.
- Repair routine now targets category-scoped `orders` + `finances`.

### 7) Trabajos (roofing_construction) finance updates in same category

Updated `trabajos.js`:

- Jobs now read/write from:
  - `users/{uid}/business/{categoryId}/jobs`
- Client picker reads:
  - `users/{uid}/business/{categoryId}/clients`
- Auto finance entries for materials/completion now write to:
  - `users/{uid}/business/{categoryId}/finances`

## Files updated

- `category-context.js`
- `dash-shell.js`
- `clientes.js`
- `finanzas.js`
- `pedidos.js`
- `trabajos.js`
- `dashboard-data.js`
- `configuracion.js` (already aligned in previous fix)
- `onboarding.js` (already aligned in previous fix)

## Data safety

- No data deletion or migration logic was added.
- Legacy structures were not migrated in this patch.
- Old data remains intact.

## Acceptance checklist mapping

1. Open tab A with `?category=custom_apparel` and tab B with `?category=roofing_construction`:
   - context is URL-driven per tab/page.
2. Navigate within each tab:
   - sidebar links preserve `?category=...`.
3. Configuración:
   - loads/saves category profile from `users/{uid}/business/{categoryId}/profile`.
4. Clientes:
   - loads/saves per-category clients from `.../clients`.
5. Finanzas:
   - reads/writes per-category finances from `.../finances`.
6. Delivered custom_apparel order:
   - writes finance movement in `.../business/custom_apparel/finances`.
7. Completed/paid roofing job:
   - writes finance movement in `.../business/roofing_construction/finances`.

## Notes

- This patch enforces category isolation without migration.
- If legacy pages still depend on `businesses/{id}` or `categories/{id}` collections, they should be aligned in a follow-up pass to avoid mixed historical views.
