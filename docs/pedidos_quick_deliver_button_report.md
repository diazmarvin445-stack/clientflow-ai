# Pedidos Quick Deliver Button Report

## What Was Added

- Added a new quick action button in each orders table row (Acciones column) in `pedidos.js`:
  - Existing kept:
    - edit (`✏️`)
    - delete (`🗑️`)
  - New:
    - quick deliver/settle (`✅`)
    - tooltip: `Marcar como entregado y cobrado`

- The new button is rendered compactly inline with existing row action buttons.

## What Function Is Called

- The quick button reuses the existing canonical function:
  - `markOrderDelivered(orderId)`

- `markOrderDelivered` calls the same backend endpoint:
  - `UPDATE_ORDER_STATUS_URL`
  - payload `{ businessId, orderId, status: "entregado" }`

- This is the same delivery settlement flow already used by the detail panel action.

## How Duplicate Delivery Was Prevented

- UI-level prevention:
  - If row status is already `entregado`, quick deliver button is rendered disabled.

- Backend-level canonical protection remains in place:
  - Delivery settlement is handled in canonical backend flow (not duplicated in UI code).
  - The quick button does not create finance entries directly; it only calls canonical delivery endpoint.

