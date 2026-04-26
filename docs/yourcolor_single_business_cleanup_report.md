# YourColor Single-Business Cleanup Report

## Decision Applied

This codebase was cleaned to run as a **YourColor-only CRM**.

- Multi-category behavior was disabled in practice.
- Roofing/Construction menu branching was removed from category navigation.
- Runtime data scope was simplified to a single stable Firestore base:

`users/{uid}/yourcolor/...`

## Official Firestore Route (single)

All primary modules now target the same base for the same authenticated user:

- `users/{uid}/yourcolor/profile`
- `users/{uid}/yourcolor/clients`
- `users/{uid}/yourcolor/orders`
- `users/{uid}/yourcolor/finances`
- `users/{uid}/yourcolor/teamMembers` (team data)
- `users/{uid}/yourcolor/settings/*`
- `users/{uid}/yourcolor/internalChat*`

## What was cleaned/disabled

### 1) Category/workspace path dynamics

- `dataPaths.js` base path changed from workspaces/categories to:
  - `users/{uid}/yourcolor`
- `profileDocRef` now points to:
  - `users/{uid}/yourcolor/profile`

### 2) Category context abstraction hardened to YourColor

- `category-context.js` now resolves:
  - `categoryId = custom_apparel`
  - `workspaceId = yourcolor`
- `withCategoryInHref` no longer appends dynamic category params.
- Category list/context resolution returns only `custom_apparel`.
- `businessCollectionRef` / `businessDocRef` route all writes/reads through the single YourColor base.

### 3) Category templates/menus cleanup

- `category-config.js` now serves only the `custom_apparel` menu.
- Roofing/construction category menu blocks were removed.

### 4) Critical module consistency kept on one path

- `chat.js` (Maya writes and logs)
- `pedidos.js`
- `clientes.js`
- `finanzas.js`
- `configuracion.js`
- `dashboard-data.js` scoped collection reads

All now converge to `users/{uid}/yourcolor/...` via shared path helpers.

### 5) Security rules support

- `firestore.rules` includes:
  - `match /users/{uid}/yourcolor/{document=**}`
  - owner-authenticated read/write

## Delivered order + finance behavior

The existing delivered-order idempotent flow in `pedidos.js` remains active and scoped to the single YourColor path:

- income creation on delivered
- expense creation (if applicable)
- duplicate prevention by `orderId`

## Empty-state readiness

Configuration and operational modules continue to support empty state startup:

- load without existing docs
- create from scratch on first save

## Not removed (intentionally)

To avoid breaking unrelated surfaces abruptly, legacy files may still exist physically in repo (e.g. old construction modules), but active pathing/menu routing now operates as YourColor-only in this version.

## Final validation checklist

1. Create client.
2. Create order.
3. Mark order delivered.
4. Verify finance income.
5. Verify finance expense (if applicable).
6. Verify balance updates.
7. Open same account on phone and desktop.
8. Confirm both show same data.
9. Ask Maya to create an order.
10. Confirm order appears in Pedidos and Firestore under `users/{uid}/yourcolor/orders`.
