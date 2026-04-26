# YourColor Single-Business Cleanup Report

## Final state

This project now runs as **single-business YourColor only**.

- No dynamic workspace/category routing is used in runtime context.
- Runtime debug no longer shows `workspaceId` or `categoryId`.
- Official base path is now:
  - `users/{uid}/yourcolor`

## Official paths in use

- `users/{uid}/yourcolor/profile`
- `users/{uid}/yourcolor/clients`
- `users/{uid}/yourcolor/orders`
- `users/{uid}/yourcolor/finances`
- `users/{uid}/yourcolor/teamMembers`
- `users/{uid}/yourcolor/publicReceipts`
- `users/{uid}/yourcolor/settings/*`
- `users/{uid}/yourcolor/internalChat*`

## Runtime context simplification

`appContext.js` was simplified to use:

- `uid`
- `businessPath` (`users/{uid}/yourcolor`)

Removed from debug/runtime display:

- `workspaceId`
- `categoryId`

## Module normalization (YourColor-only path)

Normalized modules:

- `dashboard`
- `pedidos`
- `clientes`
- `finanzas`
- `chat / Maya`
- `configuracion`
- `recibos` (`receipt-settings.js`, `receipt-public-sync.js`)
- `equipo` (via shared scoped path helpers)
- `diagnostico`

## Header business name behavior

Header business name now resolves from:

- `users/{uid}/yourcolor/profile`

If profile is missing:

- default business name remains `YourColor`
- Configuración can create profile from empty state.

## Maya write behavior

Maya writes are routed only to `users/{uid}/yourcolor/...`.
If uid/business context is missing, write actions are blocked with explicit error.

## Delivered order behavior

Delivered flow in `pedidos` remains idempotent under YourColor path:

- income creation in finances
- expense creation (if applicable)
- duplicate prevention by `orderId`

## Security rules

Firestore rules include:

- `match /users/{uid}/yourcolor/{document=**}`

allowing authenticated owner read/write on the single business tree.

## Final acceptance checklist

1. Create client.
2. Create order.
3. Mark order delivered.
4. Verify income in Finanzas.
5. Verify expense (if applicable).
6. Verify balance.
7. Login same account on phone + desktop.
8. Confirm same dataset on both.
9. Ask Maya to create order.
10. Confirm order appears in Pedidos and Firestore under `users/{uid}/yourcolor/orders`.
