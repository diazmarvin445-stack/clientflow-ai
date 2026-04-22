# Clients Cleanup Fix Report

## 1) Tightened safe client creation rules

Updated canonical client sync in `functions/index.js` (`syncClientRecord`) so it no longer creates junk clients from weak context.

Now client create/update only proceeds when at least one is true:

- valid phone exists (`>= 7` digits)
- meaningful full name exists (not generic placeholders like `Cliente`)
- confirmed order exists (`orderId` present)

If none are true, sync exits safely without creating a client record.

Also `create_client` Maya action now reuses `syncClientRecord` (instead of raw `clients.add`) and returns a clear error if identity data is too weak.

## 2) Order deletion impact on clients

Implemented backend-safe recomputation in `functions/index.js`:

- new helper: `recomputeClientAfterOrderDelete(db, businessId, clientId)`

When an order is deleted:

- if linked client has no remaining orders:
  - client is deleted automatically
- if linked client still has orders:
  - client is kept
  - recalculated:
    - `lastOrderAt`
    - `lastOrderId`
    - `totalOrders`
    - `totalSpent` (from delivered orders only)
    - lifecycle fields (`status`, inactivity flags)

Integrated in both deletion paths:

- `mayaDeleteOrderCascade(...)`
- `deleteOrderCascade` HTTP function

## 3) Clients page delete button

Updated `clientes.js` table UI:

- added `Acciones` column
- added per-row delete/trash button
- confirmation prompt exactly:
  - `¿Seguro que quieres borrar este cliente?`

Delete action calls new backend safe endpoint:

- `deleteClientSafe` (Cloud Function)

## 4) Safe manual client delete behavior

Added `deleteClientSafe` HTTP function in `functions/index.js` with safer default:

- if client has linked orders (`orders.linkedClientId`):
  - deletion is blocked
  - returns clear message:
    - `No se puede borrar este cliente porque tiene pedidos vinculados.`
- if no linked orders:
  - client can be deleted

Also applied same protection in internal chat delete flow (`handleDeleteClient`) so UI and Maya behavior remain consistent.

## 5) Controlled junk cleanup utility

Added admin-safe utility function:

- `cleanupJunkClients` (HTTP)

Behavior:

- default mode is preview (`applyDelete: false`)
- identifies likely junk clients:
  - missing meaningful name AND missing valid phone
  - no orders (`totalOrders` <= 0 and no `orders` linked by `linkedClientId`)
  - no meaningful activity (`lastOrderAt` and `lastContactAt` empty)
- only deletes when explicitly requested with `applyDelete: true`

No aggressive silent cleanup is auto-run.

## 6) Remaining limitations

- Recompute on order deletion currently uses `orders.linkedClientId` as the canonical link. Legacy orders without this link may require a one-time migration for perfect coverage.
- Manual cleanup utility is backend-only (safe/admin path) and not yet exposed in a dedicated UI button.
