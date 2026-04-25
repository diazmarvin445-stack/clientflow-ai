# Maya Operational Logic Repair Report

## Summary
Maya was replying correctly but not always acting reliably on CRM data, especially for client phone persistence and controlled client operations. This repair focused on operational behavior (structured actions + safe writes), while preserving current chat UX and quote/order flows.

## Why phone was not saving reliably
- Frontend `save_client` previously always created a new doc with raw values and no robust merge/match strategy.
- No guaranteed normalized phone field was stored for consistent matching across phone formats.
- Existing clients with good phone data could be duplicated instead of merged.

## What was changed

### 1) Client phone save/merge logic (frontend)
- File: `chat.js`
- `save_client` now:
  - normalizes phone to digits for matching (`normalizedPhone`)
  - tries resolve in order: `clientId` → `normalizedPhone` → `phone` → `name`
  - updates existing record when found
  - creates only when no match exists
  - avoids overwriting good phone with empty incoming value
- Added operational logs:
  - `[ClientSave]` with `{ clientName, phone, normalizedPhone }`
  - `[MayaAction] Firestore write path` for client writes.

### 2) Added controlled client actions
- Frontend (`chat.js`) now supports:
  - `update_client`
  - `search_client`
  - `delete_client` by id/name/phone resolution
- Delete guard:
  - `delete_client` requires confirmation fields (`requiresConfirmation` + `confirmed`) in frontend executor.

### 3) Structured server-side action pipeline upgrades
- Files:
  - `functions/maya-action-schemas.js`
  - `functions/maya-action-validator.js`
  - `functions/maya-entity-resolver.js`
  - `functions/maya-action-executor.js`
  - `functions/maya-response-builder.js`
  - `functions/index.js`
- Added strict schema support for:
  - `create_client`, `update_client`, `search_client`, `delete_client`
- Added client entity resolver:
  - resolves by `clientId`, `normalizedPhone`/`phone`, then fuzzy name
  - handles ambiguity with candidates/follow-up prompts.
- Added server delete confirmation rule:
  - `delete_client` requires `confirmed:true` in strict validator.
- `syncClientRecord(...)` now writes/uses `normalizedPhone` and logs client save metadata.
- Strict action executor now runs client CRUD/search with structured success responses.

### 4) Prompt-level action capability update
- File: `functions/yourcolor-config.js`
- Internal action rules updated to include:
  - `update_client`
  - `search_client`
  - explicit `delete_client` confirmation requirement.

### 5) Mobile scroll fix status
- Kept single scroll owner design on chat stream and mobile debug metrics.
- Existing mobile scroll hardening remains in place (`styles.css` + `chat.js` logs).

## What Maya can execute now
- Client:
  - create/merge client with normalized phone
  - update client name/phone/email
  - search client
  - delete client with explicit confirmation
- Orders/finance:
  - create order
  - set order expenses
  - mark delivered
  - add income/expense
- Existing panel actions remain available.

## Safety / non-regression
- No changes to receipt generation flow.
- Quote calculations and “Convertir a orden” flow preserved.
- WhatsApp tab UI logic untouched.
- Existing chat UI preserved.

## Remaining limitations
- Some legacy client docs may still lack `normalizedPhone` until touched by new writes/updates.
- Fuzzy name resolution can still require disambiguation for duplicate/similar names.
- Full hard-delete safety policies (soft-delete/archive mode) are not yet centralized in one policy layer.
