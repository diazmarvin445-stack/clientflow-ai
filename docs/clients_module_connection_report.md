# Clients Module Connection Report

## Scope completed

Implemented a unified client pipeline so client records are created/updated from all order channels that pass through backend order creation, and strengthened the visible `Clientes` module UI/navigation.

## Files changed

- `functions/index.js`
- `functions/maya-context-snapshot.js`
- `dash-shell.js`
- `clientes.html`
- `clientes.js`
- `dashboard.html`
- `docs/clients_module_connection_report.md`

## Canonical client sync function

- Canonical function: `syncClientRecord(db, businessId, payload)` in `functions/index.js`.
- This function is now the single source of truth for client identity resolution and updates.

### Identity resolution behavior

1. Match by normalized phone first (`phone`).
2. If not found, match by `name`.
3. If no match, create new client.
4. If match exists, merge/update safely.

### Fields maintained

The sync function now maintains:

- `fullName`
- `name`
- `phone`
- `email`
- `source`
- `createdAt`
- `updatedAt`
- `lastOrderAt`
- `lastContactAt`
- `lastOrderId`
- `lastOrderSource`
- `totalOrders`
- `totalSpent`
- `status` (default `activo`)
- `notes` (default empty string)
- `tags` (default empty array)

## Channel connections

### Manual orders

- Manual order creation already routes to backend order creation (`processNewOrder`).
- `processNewOrder` now calls `syncClientRecord(...)` to:
  - ensure/create client before order save,
  - then update client again after order creation with `orderId`, `lastOrderAt`, `lastOrderSource`, `totalOrders`, `totalSpent`, and `lastContactAt`.

### Maya internal `create_order`

- Maya internal order creation uses the same backend creation path (`processNewOrder`).
- Therefore Maya now inherits the same canonical client sync automatically, with no duplicated logic.

### WhatsApp / Maya orders

- WhatsApp order creation path that reaches `processNewOrder` now syncs clients through the same canonical function.
- Additional contact sync added on inbound WhatsApp messages in `recordWhatsAppCustomerInbound(...)`:
  - updates/creates client by phone,
  - sets `source: "whatsapp"`,
  - updates `lastContactAt`.

## Clients page UI

- `clientes.html` kept and upgraded (not replaced).
- `clientes.js` now renders a clean table with:
  - Name
  - Phone
  - Last order date
  - Last contact date
  - Total orders
  - Status
  - Source
- Search is simplified and focused on:
  - name
  - phone

## Sidebar / navigation

- Added `Clientes` navigation item below `Pedidos`.
- Implemented globally via `dash-shell.js` sidebar initialization so all dashboard pages get the entry consistently.
- `clientes.html` includes the active nav state.

## Dashboard connection

- Dashboard client mini-card now links to `clientes.html` (instead of `pedidos.html`).
- Dashboard count continues to use live `clients` collection data.

## Maya awareness improvements

- Compact client memory was strengthened in the Maya context:
  - reduced firebase context now includes `status`, `totalOrders`, `lastOrderAt`, `lastContactAt`, `lastOrderId`.
- `buildMayaContextSnapshot(...)` now includes `clientsRecent` to support:
  - recurring client awareness,
  - latest order/contact reasoning,
  - quick client existence checks.

## Future-ready reactivation support

The client model now stores required time markers for future campaigns:

- `lastOrderAt`
- `lastContactAt`
- `status`
- `totalOrders`

This is enough to implement 30/60/90-day reactivation logic later without schema changes.

## Pending / notes

- `totalSpent` currently increments on order creation with provided order total. If stricter accounting is later needed, this can be switched to increment only on delivered orders.
- Name matching is currently exact normalized `name` equality fallback after phone. If needed, a stricter fuzzy strategy can be added with safeguards against false positives.
