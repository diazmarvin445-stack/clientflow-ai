# Team Linked Order Picker Report

## How pending orders are loaded
- Team module now subscribes to `businesses/{businessId}/orders`.
- Orders are filtered in UI to only allow active/pending statuses:
  - `nuevo`
  - `produccion`
  - `listo`
- Delivered/cancelled orders are excluded from the picker.

## How selection works
- Replaced manual `Pedido vinculado` text input with a selectable dropdown picker.
- Each option includes:
  - client name
  - product
  - total
  - status
  - delivery date (or `sin fecha`)
- Added a clear action (`Limpiar pedido`) to unlink quickly.
- Selected order is shown in a compact summary line for easy mobile tap/scan.

## Session data stored
When starting a work session, stored fields now include:
- `linkedOrderId`
- `linkedOrderClientName`
- `linkedOrderProduct`
- `linkedOrderStatus`

This data is persisted in `teamSessions` together with time/payroll fields.

## Finance link behavior
When finalizing a session and creating the payroll expense, finance entry keeps the order link:
- `linkedOrderId`
- `orderId` (same value, compatibility)
- plus mirrored order context:
  - `linkedOrderClientName`
  - `linkedOrderProduct`
  - `linkedOrderStatus`

This keeps payroll expenses tied to the same linked order without changing existing sync flow.

## BI / Maya readiness
Data is now structured so future analytics/prompts can calculate:
- hours per order
- labor cost per order
- real profitability by combining order totals, materials, and labor

No extra prompt orchestration was added yet (by design).
