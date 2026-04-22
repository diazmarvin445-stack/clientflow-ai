# Maya Action Refactor Report

## What Was Added

New pipeline modules in `functions/`:

- `maya-action-schemas.js`
  - Defines strict supported actions:
    - `create_order`
    - `set_order_expenses`
    - `mark_order_delivered`
    - `add_income`
    - `add_expense`
  - Defines alias support:
    - `total | amount | monto | price`
    - `clientName | customerName | name`
    - `clientPhone | phone | telefono | whatsapp`

- `maya-action-validator.js`
  - Validates required fields by action.
  - Normalizes aliased field names into canonical payload.
  - Rejects invalid actions before mutation.
  - Returns clean error strings.

- `maya-entity-resolver.js`
  - Resolves order entities for order-mutating actions.
  - Supports resolution by:
    - `orderId`
    - `clientName`
    - `clientPhone`
    - most recent open order when unambiguous
  - Returns structured ambiguity errors for multiple matches.

- `maya-action-executor.js`
  - Centralized executor for validated actions.
  - Calls canonical logic:
    - `processNewOrder()`
    - `finalizeOrderDeliveryAndProfit()` (only settlement path for delivery)
    - `mayaFinanceAddMovement()`
  - Keeps delivery settlement single-sourced.

## What Was Changed

- Updated `functions/index.js`:
  - Imported new pipeline modules.
  - Refactored `applyMayaActionsFromPanelReply()` to execute action flow:
    1. schema lookup
    2. validation + normalization
    3. entity resolution
    4. centralized execution
  - Added structured logs per action stage:
    - `received`
    - `validation_error`
    - `resolve_error`
    - `executed`
    - `execute_error`
  - Maintained existing non-pipeline action behavior for legacy actions not in strict scope.

## Remaining Risks / Notes

- Legacy action branches still coexist in `applyMayaActionsFromPanelReply()` for actions outside strict set; this is intentional for backward compatibility.
- Ambiguity handling currently returns an error string to user; future UX can include actionable candidate listing in chat response.
- No full transaction wrapper across multi-action batches in one message; each action runs sequentially and may partially succeed if later actions fail.
- WhatsApp path still uses separate parsing/execution logic for order confirmation (`MAYA_ORDER_JSON`) and can be migrated later to share this pipeline.
