# YourColor Device Consistency and Maya Write Fix

## Scope

This urgent stabilization was applied **only for YourColor** (`custom_apparel`).

- No work was done for `roofing_construction`.
- No data migration was added.
- No new features were added.
- No existing data was deleted.

## Root issue addressed

Desktop and phone were not guaranteed to resolve the same active context, causing inconsistent reads/writes.

To stabilize, YourColor context is now forced on critical modules:

- `workspaceId = "yourcolor"`
- `categoryId = "custom_apparel"`

## Context consistency fix

### Central context hardening

Updated `appContext.js` with:

- `ensureYourColorContext(user)`:
  - forces and persists YourColor context in URL + session
- `buildActiveFirestoreBasePath(ctx)`:
  - computes active Firestore base path string
- `renderContextDebugBadge(...)`:
  - visible only for admin/dev users
- `isDevOrAdminUser(user)`:
  - enables debug view for admin/dev only

### Debug visibility (admin/dev only)

Added visible debug badge in key pages showing:

- `uid`
- `workspaceId`
- `categoryId`
- active Firestore path
- module/page name

Modules wired:

- `configuracion`
- `clientes`
- `pedidos`
- `finanzas`
- `chat_maya`

## YourColor path enforcement

All key operational modules now run with YourColor context before reading/writing:

- `pedidos.js` -> orders under YourColor scope
- `clientes.js` -> clients under YourColor scope
- `finanzas.js` -> finances under YourColor scope
- `configuracion.js` -> profile/settings under YourColor scope
- `chat.js` (Maya) -> actions and subscriptions under YourColor scope

## Maya write stabilization

In `chat.js`:

- Maya context is forced to YourColor immediately after auth user is available.
- `activeBusiness` scope is normalized to `custom_apparel`.
- if context is missing (`uid/workspace/category`), Maya action throws clear error:
  - `"No se pudo guardar: falta contexto YourColor (uid/workspace/category)."`
- Maya write logs were updated to reflect YourColor workspace/category path.

This prevents false-positive “saved” behavior when context is invalid.

## Delivered order flow

`pedidos.js` already had idempotent delivered-flow logic using `orderId` checks in finances.
With forced YourColor scope applied, this flow now executes consistently for:

- income creation
- expense creation (if applicable)
- no duplication by `orderId`
- dashboard totals fed from same category data source

## Acceptance checklist (manual)

1. Login on desktop with YourColor account.
2. Login on phone with same account.
3. Open `pedidos` on phone and create an order.
4. Refresh desktop `pedidos`:
   - same order appears.
5. Mark order as delivered on desktop.
6. Refresh phone `finanzas`:
   - finance update appears on both devices.
7. Ask Maya to create an order in chat.
8. Confirm order appears in `pedidos` and Firestore under YourColor scope.

## Notes

- This stabilization is intentionally isolated to YourColor to stop cross-device inconsistency first.
- `roofing_construction` was not modified in this pass.
