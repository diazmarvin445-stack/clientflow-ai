# YourColor Functionality Recovery Report

## Scope

This pass focused only on `custom_apparel` (YourColor) after category separation.

- No automatic migration
- No legacy data deletion
- No work on `roofing_construction` behavior beyond isolation guarantees

## Objective

Restore and validate YourColor flows using only:

- `users/{uid}/business/custom_apparel/...`

## Applied fixes

### 1) Configuración

Validated and enforced profile path for YourColor:

- `users/{uid}/business/custom_apparel/profile`

Update made:

- `configuracion.js`
  - `businessRef()` now resolves exclusively to `businessProfileRef()`
  - removed fallback possibility to global path

### 2) Clientes

Confirmed CRUD already scoped to:

- `users/{uid}/business/custom_apparel/clients`

Implementation uses:

- `businessCollectionRef(...)`
- `businessDocRef(...)`

### 3) Pedidos

Confirmed order CRUD scoped to:

- `users/{uid}/business/custom_apparel/orders`

Delivered flow confirmed in code:

- `markOrderDelivered(orderId)` updates scoped order doc
- `upsertDeliveredOrderFinance(orderId)` writes into scoped `finances`
- dedup logic prevents duplicates by checking existing docs with:
  - `where("orderId","==",orderId)` + `where("type","==","income")`
  - `where("orderId","==",orderId)` + `where("type","==","expense")`

Relation preservation:

- finance docs keep `orderId` and `linkedOrderId`

### 4) Finanzas

Validated and hardened to scoped path:

- `users/{uid}/business/custom_apparel/finances`

Update made:

- `finanzas.js`
  - removed global fallback behavior
  - if `scopeUid` is missing, logs error and aborts scoped read/write

## Delivered-order finance behavior (YourColor)

When a YourColor order is marked `entregado`:

1. Income entry is created in scoped `finances` if missing
2. Expense entry is created if `expenses > 0` and missing
3. No duplicate movements are created for same `orderId` + `type`
4. Movement keeps order linkage (`orderId`, `linkedOrderId`)

## Isolation check vs Roofing

Because reads/writes are category-scoped references (`uid + categoryId`), operations performed under:

- `custom_apparel`

cannot write into:

- `roofing_construction`

unless code explicitly changes category context.

## Architecture verification (target modules)

Checked files:

- `configuracion.js`
- `clientes.js`
- `pedidos.js`
- `finanzas.js`

Result:

- No `businesses/...` paths found
- No `categories/...` paths found
- All target modules use `users/{uid}/business/{categoryId}/...`

## Manual flow validation checklist

Run these in browser with authenticated user owning both categories:

1. Open `configuracion.html?category=custom_apparel`
   - save profile fields
   - verify read/write in `users/{uid}/business/custom_apparel/profile`

2. Open `clientes.html?category=custom_apparel`
   - create/edit/delete one client
   - verify in `.../custom_apparel/clients`

3. Open `pedidos.html?category=custom_apparel`
   - create one order
   - mark it `entregado`
   - verify order in `.../custom_apparel/orders`

4. Open `finanzas.html?category=custom_apparel`
   - confirm new income movement
   - confirm expense movement if order had `expenses > 0`
   - confirm no duplicated movement for same `orderId`

5. Open any page with `?category=roofing_construction`
   - confirm no new records from the previous YourColor flow appear there

## Final status

YourColor (`custom_apparel`) core functionality is restored and aligned to the new architecture for:

- Configuración
- Clientes
- Pedidos
- Finanzas

with scoped, non-global paths and delivered-order finance linkage/dedup preserved.
