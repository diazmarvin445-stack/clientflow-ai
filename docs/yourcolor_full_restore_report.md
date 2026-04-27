# YourColor Full Restore Report

## Goal
Restore the app as **YourColor CRM only** and remove operational reliance on construction/jobs/category/workspace runtime logic.

## Canonical Firestore Scope
- Enforced runtime scope: `users/{uid}/yourcolor/...`
- Modules now point to:
  - `users/{uid}/yourcolor/profile`
  - `users/{uid}/yourcolor/clients`
  - `users/{uid}/yourcolor/orders`
  - `users/{uid}/yourcolor/finances`
  - `users/{uid}/yourcolor/team`
  - `users/{uid}/yourcolor/settings`
  - `users/{uid}/yourcolor/receipts` (via public receipt sync + settings)
  - `users/{uid}/yourcolor/maya` (chat context/write scope remains under `yourcolor`)

## Restored Modules

### 1) Dashboard
- Removed construction card language from UI.
- Mini cards now show order/business metrics (pedidos activos, entregas, pagos pendientes, facturado, gastos, utilidad).
- Runtime data source locked to `orders`, `clients`, `finances`, `calendar`, `campaigns` in `users/{uid}/yourcolor/...`.

### 2) Pedidos
- Kept on `users/{uid}/yourcolor/orders`.
- Preserved create/edit/mark delivered/deposit/balance/delivery date/receipt behavior.
- Delivery financial repair/upsert remains idempotent (creates missing movements only once per order/type).

### 3) Finanzas
- Reads/writes through `users/{uid}/yourcolor/finances`.
- Empty state remains non-failing.
- Summary cards keep income/expense/net calculations.
- Delivered-order movement creation remains guarded by existence checks.

### 4) Clientes
- Reads/writes kept in `users/{uid}/yourcolor/clients`.
- Empty state remains non-failing.
- Removed construction wording from metadata and labels.
- Linked count now computed from `orders` (not jobs).

### 5) Equipo
- Collection path switched from `teamMembers` to `team` for module CRUD.
- Business scope forced to `yourcolor`.
- Empty/loading behavior preserved without hard-fail regressions.

### 6) Configuración
- Profile doc remains `users/{uid}/yourcolor/profile`.
- If profile is missing, form remains usable with empty defaults.
- Header fallback now defaults to `YourColor`.

### 7) Chat IA / Maya
- Action writes for order creation/conversion changed from `jobs` to `orders`.
- Order resolver now checks only `orders`.
- Context payload removed `jobs` split and uses `orders` as canonical operational stream.
- Construction chat body class forcing removed.
- Existing write-failure path still surfaces errors instead of false “saved” confirmations.

### 8) Diagnóstico
- Diagnostics flow now verifies only YourColor-focused modules:
  - maya
  - profile
  - clients
  - orders
  - finances
  - team
  - receipts
- Removed architecture/category/workspace active auditing from runtime checks.

## Additional Cleanup
- `dataPaths` team helpers now map to `team` instead of `teamMembers`.
- `dashboard-data` team fetch now reads `team`.
- Firestore rules: removed legacy user-level `workspaces` and `categories` path blocks.

## Notes
- `trabajos.html` / legacy docs still exist in repository as files, but primary module runtime and navigation for restored modules now operate under YourColor paths and order-first logic.
- If you want full physical removal of legacy files (`trabajos.*`, category config docs/helpers), that can be done as a second cleanup pass after functional verification.
