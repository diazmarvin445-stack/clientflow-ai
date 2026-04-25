# Maya Operational Logic Audit

## Scope
Audit of Maya internal chat (Chat IA / panel) and operational action execution for CRM/order behavior.

## Data flow map

### 1) Where Maya chat input is processed
- Frontend send path: `chat.js` (`sendToClaude`).
  - Reads input from `#yc-chat-input`.
  - Sends `messages` + `firebaseContext` to `CHAT_WITH_AI_URL`.
  - Appends user/assistant bubbles and executes action payloads when present.
- Backend inference/action path: `functions/index.js`.
  - Parses and removes `MAYA_ACTION_JSON` blocks from model reply in `applyMayaActionsFromPanelReply(...)`.
  - Validates, resolves entities, executes action handlers, and injects system feedback.

### 2) How Maya extracts client/order data
- Frontend extraction:
  - `stripMayaPanelMetadata(...)` in `chat.js` removes tagged JSON (`MAYA_ORDER_JSON`, `MAYA_ACTION_JSON`, etc.).
- Backend extraction:
  - `extractAndRemoveAllTaggedJson(...)` in `functions/index.js`.
  - `mergeMayaActionData(...)` merges top-level and nested action fields.

### 3) How clients are created/updated
- Frontend local action execution:
  - `executeMayaActionFromChat(...)` in `chat.js` now supports:
    - `save_client` (create or merge)
    - `update_client`
    - `search_client`
    - `delete_client` (with confirmation guard)
- Backend canonical sync:
  - `syncClientRecord(...)` in `functions/index.js`.
  - Merges by `normalizedPhone`, then `phone`, then `name`.
  - Preserves previous valid data when incoming fields are missing.

### 4) How orders are created
- Frontend: `executeMayaActionFromChat(...)` can create local order docs in panel flow.
- Backend: `processNewOrder(...)` in `functions/index.js`:
  - validates totals
  - links client/calendar docs
  - updates client order stats.

### 5) Where phone numbers are normalized
- Frontend:
  - `normalizePhoneForMatch(...)` in `chat.js` (digits-only matching).
- Backend:
  - `normalizePhoneDigits(...)` in `functions/index.js`.
  - `validateAndNormalizeMayaAction(...)` in `functions/maya-action-validator.js`.

### 6) Where Firestore writes happen
- Frontend writes: `chat.js` (`addDoc`, `updateDoc`, `deleteDoc`) for panel actions.
- Backend writes:
  - `syncClientRecord(...)`, `processNewOrder(...)`, delete/update handlers in `functions/index.js`.
  - strict action execution via:
    - `validateAndNormalizeMayaAction(...)`
    - `resolveMayaActionEntities(...)`
    - `executeMayaAction(...)`.

### 7) Actions currently allowed/executed
- Prompt-declared action model in `functions/yourcolor-config.js` (`MAYA_ACTION_JSON` rules).
- Strict schema actions in `functions/maya-action-schemas.js`:
  - client: `create_client`, `update_client`, `search_client`, `delete_client`
  - order/finance: `create_order`, `set_order_expenses`, `mark_order_delivered`, `add_income`, `add_expense`
- Frontend action executor supports:
  - `save_client`, `update_client`, `search_client`, `delete_client`
  - `create_order`, `update_order`, `delete_order`, `create_calendar_event`.

## Primary issues found
- Client save in frontend was previously blind `addDoc` without normalized phone merge.
- Matching by phone could miss records where phone format differed (non-normalized historical values).
- Delete-client confirmations were not consistently enforced in structured action validation.
- Operational observability logs were incomplete for action detection and write paths.
