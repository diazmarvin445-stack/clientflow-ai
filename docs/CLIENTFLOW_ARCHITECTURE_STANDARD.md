# CLIENTFLOW AI Architecture Standard (Mandatory)

## Purpose

This standard is mandatory for all ClientFlow modules before adding new features.

Goal: guarantee strict multi-user and multi-category isolation.

## Core rule

There must never be global private business data.

Private data must always be scoped by:

- `uid`
- `categoryId`

Official path base:

- `users/{uid}/business/{categoryId}/...`

Examples:

- `users/{uid}/business/custom_apparel/clients`
- `users/{uid}/business/custom_apparel/orders`
- `users/{uid}/business/custom_apparel/finances`
- `users/{uid}/business/roofing_construction/clients`
- `users/{uid}/business/roofing_construction/jobs`
- `users/{uid}/business/roofing_construction/finances`

## How uid is resolved

1. Wait auth state (`onAuthStateChanged` or equivalent).
2. Use authenticated user uid: `auth.currentUser.uid`.
3. Never use hardcoded owner ids.

## How categoryId is resolved

Resolution order is mandatory:

1. URL query param `?category=<categoryId>` (page-local context, tab-safe)
2. Session fallback (same user only)
3. First available category for user (controlled fallback)

Implementation source:

- `category-context.js`
  - `getCategoryFromUrl()`
  - `resolveCategoryContextForUser(...)`
  - `ensureCategoryInUrl(...)`

## URL category persistence

Every internal page link must keep current category:

- `dashboard.html?category=custom_apparel`
- `finanzas.html?category=custom_apparel`
- `configuracion.html?category=custom_apparel`

Mandatory helper:

- `withCategoryInHref(href, categoryId)` in `category-context.js`

## Official Firestore structure

Canonical collections under category scope:

- `profile`
- `clients`
- `orders`
- `jobs`
- `finances`
- `teamMembers`
- `calendar`
- `campaigns`
- `conversations`
- `diagnostics`
- `settings`

Pattern:

- `users/{uid}/business/{categoryId}/{collection}`
- `users/{uid}/business/{categoryId}/{collection}/{docId}`

## Forbidden patterns

Do not use these for private tenant data:

- `businesses/{businessId}/...` (global tenant path)
- `users/{uid}/categories/{categoryId}/...` (legacy path)
- Any path missing `uid + categoryId`

No module should depend only on a global active category state without URL context.

## Anti-mix rules

- A tab opened with one category must never switch because another tab changed category.
- All writes must use the page category context.
- All reads must use the page category context.
- Cross-category reads are forbidden unless explicitly labeled admin analytics.

## Module audit snapshot

Audited modules:

- `dashboard`
- `chat`
- `clientes`
- `pedidos`
- `trabajos`
- `finanzas`
- `equipo`
- `configuracion`
- `diagnostico`

Current status after this stabilization pass:

- **Aligned to official path**: `clientes`, `pedidos`, `trabajos`, `finanzas`, `equipo`, `configuracion`, `dashboard`, `diagnostico` (primary data flows).
- **Still contains legacy/global references to eliminate**: `chat` (multiple direct `businesses/...` and legacy `categories/...` reads/writes still present).

Because of this, architecture is now significantly more stable, but `chat` still requires a full final alignment pass before declaring the entire platform fully compliant.

## Runtime architecture diagnostics

`diagnostico` now reports:

- current `uid`
- current `categoryId`
- active Firestore path
- active module
- architecture error if global/legacy route patterns are detected in audited module files

## Manual test protocol (mandatory)

1. Open tab A with `?category=custom_apparel`.
2. Open tab B with `?category=roofing_construction`.
3. Navigate in tab A only.
   - Context must remain `custom_apparel`.
4. Navigate in tab B only.
   - Context must remain `roofing_construction`.
5. Verify `Configuración` loads/saves separately per category.
6. Verify `Clientes` loads/saves separately per category.
7. Verify `Finanzas` loads/saves separately per category.
8. Deliver a `custom_apparel` order.
   - Movement must appear only in `users/{uid}/business/custom_apparel/finances`.
9. Complete/pay a `roofing_construction` job.
   - Movement must appear only in `users/{uid}/business/roofing_construction/finances`.

## Migration policy

- Do not delete old data.
- Do not run automatic migration yet.
- Stabilize reads/writes first.
- Migrate only after full module compliance is confirmed.
