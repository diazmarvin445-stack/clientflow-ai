# Client Lifecycle Upgrade Report

## 1) Active / Inactive lifecycle behavior

Client lifecycle is now calculated from **recent activity** using `lastContactAt` and `lastOrderAt`.

- `activo`:
  - has recent contact or order activity
- `inactivo`:
  - no contact/order activity for 90+ days
- Clients are **never auto-deleted**; only status fields are updated.

Implementation details:

- `computeClientLifecycleStatus(lastContactAt, lastOrderAt, now)` in `functions/index.js`
- `syncClientRecord(...)` now recalculates:
  - `status`
  - `inactiveDays`
  - `inactiveSince30`
  - `inactiveSince60`
  - `inactiveSince90`

## 2) Scheduled 90-day check

A new daily scheduler was added:

- Function: `clientsLifecycleDaily`
- File: `functions/index.js`
- Type: Firebase v2 scheduler (`onSchedule`)
- Cron: `0 3 * * *`
- Timezone: `America/Guayaquil`

Daily behavior:

- scans all `businesses/*/clients`
- recomputes inactivity from `lastContactAt` and `lastOrderAt`
- sets:
  - `status` (`activo` / `inactivo`)
  - `inactiveDays`
  - campaign readiness flags (`inactiveSince30/60/90`)

## 3) Reactivation logic

Reactivation now happens automatically when there is new activity:

- **WhatsApp inbound message**:
  - `recordWhatsAppCustomerInbound(...)` calls `syncClientRecord(...)`
  - updates `lastContactAt`
  - forces lifecycle recomputation to active if recent
- **New order created** (manual, Maya internal, WhatsApp order flow):
  - `processNewOrder(...)` calls `syncClientRecord(...)`
  - updates `lastOrderAt`, `lastContactAt`, `lastOrderId`, `lastOrderSource`
  - sets/maintains active lifecycle status
- **Maya order interactions**:
  - `mayaSetOrderExpenses(...)` updates contact touch via `syncClientRecord(...)`
  - `mayaMarkOrderDelivered(...)` updates contact touch via `syncClientRecord(...)`

## 4) totalSpent rule correction

`totalSpent` was adjusted to follow the delivery rule:

- On order creation: **does not increase**
- On delivery settlement: **increases** by delivered total

Implementation:

- `syncClientRecord(...)` no longer increments `totalSpent` on `create_order`
- `finalizeOrderDeliveryAndProfit(...)` now syncs delivered amount into client `totalSpent`

Finance logic itself was not modified; only client aggregation fields were updated.

## 5) Maya conversation memory upgrades

Maya now receives richer lightweight client memory (without prompt bloat):

- Added in reduced Firebase context (`shrinkFirebaseContextInitial`):
  - `status`
  - `totalOrders`
  - `lastOrderAt`
  - `lastContactAt`
  - `lastOrderId`
  - `interactionSummary`

- Added in snapshot (`functions/maya-context-snapshot.js`):
  - `clientsRecent` includes `interactionSummary`
  - `returningClients` (top recurring clients with `totalOrders > 1`)

Prompt guidance was also strengthened in `getMayaInternalChatPrompt()`:

- explicitly instructs Maya to treat known recurring clients as returning clients
- use context fields to personalize follow-up naturally
- never invent missing history

## 6) Future campaign readiness (30/60/90)

The client model is now campaign-ready with direct filters:

- `inactiveSince30 === true`
- `inactiveSince60 === true`
- `inactiveSince90 === true`

No automation campaign sender was implemented yet, but data model and daily maintenance are ready.

## 7) Existing logic protection

The upgrade preserved existing business flows:

- order creation/update flows kept intact
- Maya action pipeline preserved
- finance posting rules preserved
- no automatic client deletion introduced
