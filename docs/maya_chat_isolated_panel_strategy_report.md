# Maya Chat Isolated Panel Strategy Report

## Strategy change applied

Implemented a new isolated Maya chat layer for YourColor that is mounted at the end of `body`:

- container id: `yourcolor-maya-chat-isolated`

This layer bypasses old page scroll/wrapper dependencies and owns its own chat UI structure.

## What was changed

### 1) Old Maya visual panel removed from layout flow

- In `chat.html`, the old Maya visual panel block was replaced with:
  - `.yc-maya-legacy-host` (empty placeholder)
- No old chat input/messages ids remain in static Maya panel markup.
- This prevents duplicate ids and avoids accidental binding to old wrappers.

### 2) New isolated layer mounted dynamically

In `chat.js`:

- Added `ensureIsolatedMayaChatLayer()` that creates and appends:
  - `#yourcolor-maya-chat-isolated`
  - isolated header
  - isolated messages container: `#yc-maya-messages-isolated`
  - isolated input bar: `#yc-maya-input-v2`
  - reused functional controls/ids for existing behavior:
    - clear button (`#yc-chat-clear-btn`)
    - input (`#yc-chat-input`)
    - mic (`#yc-chat-mic`)
    - send (`#yc-chat-send`)
    - loading/context/error/toast ids used by current logic

### 3) Existing Maya brain reused

No business logic rewrite was made. Existing runtime logic remains:

- same send flow / API call / streaming behavior
- same message rendering and history usage
- same mic behavior
- same `Copiar`
- same `Convertir a orden`

Only DOM targeting was switched to isolated messages root:

- `getMayaMessagesEl()` now points to `#yc-maya-messages-isolated`

### 4) Isolated viewport fitting and visibility control

In `chat.js`:

- Added `positionIsolatedMayaChatLayer()` to map isolated layer bounds to `#dash-main` rectangle.
- Added `syncIsolatedMayaChatLayerVisibility()`:
  - visible only for YourColor + Maya tab active
  - hidden for WhatsApp tab
- Hooked layout refresh on:
  - tab changes
  - resize
  - orientation change

### 5) CSS isolation and old wrapper hard-hide

In `styles.css`:

- Added isolated-layer rules for `#yourcolor-maya-chat-isolated` and inner surface.
- Added hard-hide for `.yc-maya-legacy-host` to ensure zero visual footprint.
- Kept root scroll lock chain for YourColor chat page.
- Old wrapper hard-hide guard remains in place to prevent regressions if legacy nodes are injected.

### 6) Diagnostics update

In `diagnostico.js`:

- Static health check now also inspects `chat.js` for isolated-layer markers.
- Runtime probe now accepts:
  - `#yc-maya-messages-isolated`
  - fallback `#yc-maya-messages-v2` selector

## Result

Maya chat now runs in an isolated screen layer independent of old page scroll containers:

- body/page scroll is not used for chat history
- only isolated message list scrolls
- input remains fixed/visible at bottom of isolated panel
- old Maya visual panel is not used for active rendering
- WhatsApp tab remains separate and hides isolated Maya layer when inactive

