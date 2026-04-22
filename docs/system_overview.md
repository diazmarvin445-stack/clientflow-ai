# Clientes Flow - System Overview

## 1. Project Overview

Clientes Flow is a Firebase-based operations platform for small/custom-product businesses. It combines:

- Order lifecycle management (`pedidos.html` + backend functions)
- Finance tracking (`finanzas.html`)
- Client and conversation tracking (`clientes.html`, WhatsApp conversation docs)
- AI assistant automation via "Maya" (`chat.html` + `functions/index.js`)

Main purpose:

- Centralize daily operations (orders, expenses, deliveries, cash flow)
- Assist owner workflows with AI action execution (create order, set expenses, mark delivered, etc.)
- Prepare for human/AI hybrid customer handling (internal chat + WhatsApp integration)

Core modules:

- Orders: `pedidos.html`, `pedidos.js`, `updateOrderStatus`, `updateOrderAndSync`
- Finances: `finanzas.html`, `finanzas.js`
- Internal AI assistant (Maya): `chat.html`, `chat.js`, `chatWithAI` function
- WhatsApp AI assistant: `whatsappWebhook` function + `conversations` collections
- Clients and CRM-like entities: `clientes.js`, Firestore `clients`, `leads`

---

## 2. Data Architecture (Firestore)

Top-level pattern:

- `businesses/{businessId}` is the main tenant root.
- Most business data lives in subcollections under this document.

### Main subcollections used in current implementation

- `businesses/{businessId}/orders`
- `businesses/{businessId}/finance`
- `businesses/{businessId}/clients`
- `businesses/{businessId}/calendar`
- `businesses/{businessId}/campaigns`
- `businesses/{businessId}/conversations`
- `businesses/{businessId}/conversations/{phoneDocId}/messages`
- `businesses/{businessId}/internalChatHistory`
- `businesses/{businessId}/mayaWhatsAppSessions`
- `businesses/{businessId}/leads`
- `businesses/{businessId}/meetingRequests`

### Order document shape (real fields in code)

Reference: `functions/index.js` -> `processNewOrder()`

```json
{
  "id": "orderDocId",
  "clientId": "clientDocId",
  "clientName": "string",
  "clientPhone": "digits-string",
  "product": "string",
  "quantity": 100,
  "total": 250,
  "amount": 250,
  "deposit": 0,
  "balance": 250,
  "expenses": 0,
  "deliverySettled": false,
  "netProfit": 0,
  "status": "nuevo | produccion | listo | entregado | cancelado",
  "deliveryDate": "Timestamp",
  "notes": "string",
  "source": "manual | chat_interno | whatsapp | ...",
  "createdAt": "Timestamp",
  "createdBy": "marvin | maya",
  "updatedAt": "Timestamp?",
  "deliveredAt": "Timestamp?",
  "totalPaid": 250,
  "paidInFull": true,
  "linkedClientId": "clientDocId",
  "linkedFinanceId": "string",
  "linkedCobroTotalFinanceId": "financeDocId?",
  "linkedExpenseFinanceId": "financeDocId?",
  "linkedCalendarId": "calendarDocId"
}
```

### Finance entry document shape

References: `functions/index.js` (`finalizeOrderDeliveryAndProfit`, `mayaFinanceAddMovement`), `finanzas.js`

```json
{
  "id": "financeDocId",
  "type": "income | expense",
  "status": "cobrado | retenido | cancelado",
  "amount": 86,
  "category": "ventas | materiales | ...",
  "description": "string",
  "clientId": "clientDocId | null",
  "clientName": "string?",
  "orderId": "orderDocId?",
  "linkedOrderId": "orderDocId?",
  "createdAt": "Timestamp",
  "createdBy": "marvin | maya",
  "date": "Timestamp"
}
```

### Client document shape

References: `findOrCreateClient()` in `functions/index.js`, plus `clientes.js`

```json
{
  "id": "clientDocId",
  "fullName": "string",
  "name": "string",
  "phone": "digits-string",
  "email": "string?",
  "source": "manual | chat-maya | whatsapp-yourcolor | ...",
  "sourceLeadId": "leadDocId?",
  "createdAt": "Timestamp",
  "updatedAt": "Timestamp?"
}
```

### Conversation documents (Maya / WhatsApp)

References: `recordWhatsAppCustomerInbound()`, `recordWhatsAppMayaOutbound()` in `functions/index.js`

`businesses/{businessId}/conversations/{phoneDocId}`

```json
{
  "phoneNumber": "digits-string",
  "customerName": "string?",
  "lastMessage": "string",
  "lastMessageAt": "Timestamp",
  "status": "active | waiting | confirmed | needs_attention",
  "mayaInControl": true,
  "createdAt": "Timestamp",
  "updatedAt": "Timestamp"
}
```

`businesses/{businessId}/conversations/{phoneDocId}/messages/{msgId}`

```json
{
  "from": "customer | maya | marvin",
  "text": "string",
  "at": "Timestamp",
  "metadata": {}
}
```

---

## 3. Orders System

### How orders are created

Two main paths:

- Manual/UI: `pedidos.js` -> `CREATE_MANUAL_ORDER_URL` (`createManualOrder`)
- Maya internal actions: `chatWithAI` -> `applyMayaActionsFromPanelReply()` -> `action: "create_order"` -> `processNewOrder()`

Current creation rules in backend (`processNewOrder()`):

- Requires a positive total (`total ?? amount > 0`)
- Stores both `total` and `amount` for compatibility
- Initializes `expenses` (default `0`)
- Initializes `status` (normalized, default `nuevo`)
- Creates linked calendar delivery event
- Does **not** post finance movements at creation time

### How totals are calculated/stored

- Backend accepts `rawOrder.total ?? rawOrder.amount`
- Order amount persisted in both fields:
  - `total`
  - `amount`

### Deposits handling

- Order may still store `deposit` and derived `balance`
- Current flow no longer auto-posts deposit to `finance` on order creation
- Deposit is now informational/order-state unless explicitly handled elsewhere

### Expenses storage

- Stored at order level: `expenses`
- Updated via:
  - `updateOrderAndSync` endpoint (UI edit flow)
  - Maya action `set_order_expenses` (`mayaSetOrderExpenses`)

### Status flow

- Normalized values: `nuevo`, `produccion`, `listo`, `entregado`, `cancelado`
- Delivery transition is business-critical because it triggers finance posting

### What happens on delivered

`finalizeOrderDeliveryAndProfit()`:

- Marks order as delivered
- Sets `deliverySettled: true`
- Computes `netProfit = total - expenses`
- Creates `finance` income entry (total)
- Creates `finance` expense entry (expenses if `> 0`)
- Links finance IDs back to order (`linkedCobroTotalFinanceId`, `linkedExpenseFinanceId`)

---

## 4. Finances System

### Income and expense recording

- Manual from finances UI: `finanzas.js` (`addDoc` to `finance`)
- Automatic from order delivery:
  - income from order total
  - expense from order expenses (if any)

### Profit calculation

At order level:

- `netProfit = total - expenses` (stored on order when delivered)

At finance dashboard level (`finanzas.js`):

- `income` sums rows where `type === "income"` and `financeIncomeCountsTowardRealized(row)` is true
- `expense` sums rows where `type === "expense"`
- `net = income - expense`

### How delivery affects finance

- Delivery is the posting boundary for order financial realization.
- Before delivery, order edits do not post finance transactions.

### Duplicate protection

There is partial protection:

- `finalizeOrderDeliveryAndProfit()` checks `deliverySettled === true` to avoid re-posting on repeated delivery calls.
- UI repair function (`repairDeliveredOrders` in `pedidos.js`) checks existing income/expense by `orderId` before creating missing ones.

Not fully transactional across all entry points (see recommendations).

---

## 5. Current Maya Architecture (Critical)

### Where Maya is implemented

- Internal chat endpoint: `functions/index.js` -> `export const chatWithAI`
- Internal chat frontend: `chat.js` -> `CHAT_WITH_AI_URL`
- Prompt definitions: `functions/yourcolor-config.js`
- Action execution in backend: `applyMayaActionsFromPanelReply()`

### Message processing flow (internal)

1. `chat.js` sends recent messages + `firebaseContext` to `chatWithAI`.
2. Backend refreshes Firebase context (`loadFreshFirebaseContextForMaya`).
3. Backend builds system prompt and reduced context (`prepareMayaAnthropicPayload`).
4. Anthropic call returns text that may include `MAYA_ACTION_JSON`.
5. Backend parses and executes actions server-side (`applyMayaActionsFromPanelReply`).
6. Backend returns visible text (plus any system error block).

### Prompt construction

- `getMayaInternalChatPrompt()` in `functions/yourcolor-config.js`
- System payload built by `buildMayaSystemString(basePrompt, firebaseCtx)`
- Includes current date, business context JSON, and rules
- Uses Anthropic cache control via `buildAnthropicCachedSystem()`

### Output mode: text + structured actions

- Maya returns natural language plus tagged JSON actions, e.g.:
  - `MAYA_ACTION_JSON:{...}`
- Backend strips/executes tags and returns final visible text.

### Firestore interaction model

- Maya does not write directly.
- Backend executes whitelisted actions:
  - `create_order`
  - `set_order_expenses`
  - `mark_order_delivered`
  - finance add/delete
  - calendar/client/team actions

### Functions Maya can trigger now

From `MAYA_PANEL_EXECUTABLE_ACTIONS`:

- `create_client`, `create_order`, `create_calendar_event`
- `set_order_expenses`, `mark_order_delivered`
- `add_income`, `add_expense`, `get_balance`
- `delete_order`, `delete_client`, `delete_calendar_event`, `delete_transaction`, `delete_finance`
- team operations (`add_team_member`, etc.)

---

## 6. Current Problems with Maya

Technical failure modes observed in current codebase evolution:

- Field-name drift (`total` vs `amount`):
  - Previously, actions could carry `total` while merge logic only forwarded `amount`.
  - This caused false "monto total obligatorio" errors even when Maya had value.
  - Recent fix added `total/monto/price` mapping support.

- Prompt-to-handler contract fragility:
  - If prompt and backend action schema diverge, Maya can produce valid-looking text with invalid backend payloads.
  - No formal JSON schema validation layer is enforced before execution.

- Entity resolution complexity:
  - Some actions still rely on `orderId`; fallback by `clientName` may be ambiguous.
  - Name collisions can trigger disambiguation friction.

- Finance sync consistency historically depended on flow:
  - If delivery was updated outside canonical finalize path, finance could desync.
  - Repair helpers exist, but this indicates missing hard invariants.

- Error UX in internal chat:
  - Without explicit action-aware error rewriting, assistant text may sound successful while backend action fails.
  - A targeted fix now returns explicit create-order failure message.

---

## 7. Target Architecture for Maya

Recommended architecture for scale and reliability:

- Keep Maya as planner, not data writer.
- Enforce command bus style action execution:
  - `createOrder()`
  - `updateOrderStatus()`
  - `markOrderDelivered()`
  - `setOrderExpenses()`
  - `syncOrderToFinance()` (if separated)

### Required properties

- Structured JSON actions only (no implicit free-text side effects)
- Strict backend schema validation per action
- Server-side entity resolution:
  - client/order lookup by names, phone, recency
  - deterministic conflict response if ambiguous
- Idempotency keys for mutation actions
- Action-level audit log (requested payload, normalized payload, result, error)

### Suggested execution pipeline

1. Parse assistant output -> action envelopes
2. Validate against action schema
3. Normalize fields (`total/amount`, dates, status)
4. Resolve IDs/entities
5. Execute transaction/function
6. Return explicit success/failure block for UI

---

## 8. WhatsApp Integration Plan (Meta API)

Current baseline already exists:

- Endpoint: `whatsappWebhook` in `functions/index.js`
- Uses Meta Cloud API for inbound/outbound
- Stores conversation state/messages in Firestore
- Calls Anthropic with WhatsApp-specific prompt

### Incoming processing (current + target)

- Parse Meta webhook payload
- Persist inbound customer message:
  - `conversations/{phoneDocId}`
  - `conversations/{phoneDocId}/messages`
- Build message history from `mayaWhatsAppSessions`
- Call Maya model
- Parse structured tags (`MAYA_ORDER_JSON`, etc.)
- Persist resulting business operations
- Send outbound via Meta Graph API

### Conversation storage design

- Keep normalized immutable message log under `conversations/*/messages`
- Keep lightweight rolling session state under `mayaWhatsAppSessions`
- Add conversation ownership/escalation fields for human handoff

### Human override model (recommended)

- `mayaInControl = true/false` at conversation level
- Admin action to "take over" sets:
  - `mayaInControl = false`
  - `status = needs_attention`
- Outbound sender `from: "marvin"` resumes as needed
- AI reply should pause until control returned

---

## 9. Missing Pieces / Recommendations

### Validation and contracts

- Add explicit JSON schema validation for each Maya action payload.
- Add required-field checks with actionable error codes (not only strings).

### Business logic hardening

- Use one canonical delivery service/function everywhere (UI + AI + APIs).
- Wrap delivery->finance posting in transaction or idempotent guard with unique markers.

### Logging and observability

- Standardize logs per action:
  - action name
  - normalized payload
  - resolved IDs
  - mutation IDs created
  - outcome
- Correlate with request/session IDs.

### AI action layer structure

- Separate parser, validator, resolver, executor modules.
- Version action schema (e.g., `actionVersion: 1`) to avoid prompt drift breakage.

### Data consistency operations

- Keep and harden repair utilities, but make them admin-only tools.
- Add scheduled integrity checks for:
  - delivered orders missing finance rows
  - finance rows linked to non-delivered orders
  - orphan links (`linked*Id` not found)

---

## Code Reference Index

- Internal Maya endpoint: `functions/index.js` -> `chatWithAI`
- Maya action executor: `functions/index.js` -> `applyMayaActionsFromPanelReply`
- Order creation: `functions/index.js` -> `processNewOrder`
- Delivery settlement: `functions/index.js` -> `finalizeOrderDeliveryAndProfit`
- Order status APIs: `functions/index.js` -> `updateOrderStatus`, `updateOrderAndSync`
- Internal chat client: `chat.js`
- Orders UI: `pedidos.js`, `pedidos.html`
- Finances UI: `finanzas.js`, `finanzas.html`
- Prompt config: `functions/yourcolor-config.js`
- WhatsApp webhook: `functions/index.js` -> `whatsappWebhook`
