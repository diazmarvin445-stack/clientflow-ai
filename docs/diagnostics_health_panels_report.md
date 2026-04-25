# Diagnostics health panels update

## What changed

The Diagnóstico page now runs **real-time module health checks** even when there are no saved incidents.

The old empty-state behavior (`No hay incidentes recientes. Todo se ve estable.`) no longer hides module visibility.

## Panels now always shown

- Estado general
- Chat Maya
- Clientes
- Pedidos
- Recibos
- Firebase
- WhatsApp
- Equipo

Each panel now shows:

- `OK` / `Warning` / `Error`
- Plain-language explanation
- Last test result timestamp
- Concrete check details

## Live checks implemented

From `diagnostico.js`:

- Chat Maya:
  - Detects presence of Maya messages container in `chat.html` (`yc-chat-stream`)
  - Detects Maya input in `chat.html` (`yc-chat-input`)
  - Validates scroll CSS rule exists (`overflow-y: auto|scroll` on Maya stream classes)
- Business context:
  - Confirms current `businessId` resolution
- Clientes:
  - Tests Firestore read of `businesses/{businessId}/clients` (sample read)
- Pedidos:
  - Tests Firestore read of `businesses/{businessId}/orders` (sample read)
- Recibos:
  - Checks receipt settings doc `businesses/{businessId}/settings/receipt`
  - Probes public receipts access with `getDoc` on `businesses/{businessId}/publicReceipts/__diag_probe__`
- Firebase:
  - Confirms authenticated user + business document read access
- WhatsApp:
  - Reads `conversations` sample
  - Detects configured/pending state from business flags and/or existing conversations
- Equipo:
  - Tests Firestore read of `businesses/{businessId}/teamMembers` (sample read)

## Incident-aware + health-aware behavior

Panels now combine:

- Real live check result (primary)
- Recent saved incidents from `businesses/{businessId}/diagnostics` (secondary signal)

So diagnostics still shows warnings if incidents exist, even when live checks pass.

## Files changed

- `diagnostico.html`
- `diagnostico.js`
- `styles.css`
- `docs/diagnostics_health_panels_report.md` (new)
