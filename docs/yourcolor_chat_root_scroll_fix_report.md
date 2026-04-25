# YourColor Maya Root Scroll Fix Report

## Problem confirmed

The browser page was still acting as a vertical scroller in `chat.html` (YourColor Maya), creating blank/dark space below the chat and detaching scroll ownership from the chat panel.

## What was fixed

Layout and scroll ownership were corrected at the root chain (not only message container level) in `styles.css`:

1. **Locked page/body scroll**
   - `body.dash-body.yourcolor-chat-page` now uses fixed viewport height (`100dvh`) with `overflow: hidden`.

2. **Workspace constrained to viewport**
   - `dash-shell` locked to `100dvh`.
   - `dash-main`, `maya-cc`, chat zone wrappers, and v2 panel wrappers enforce `min-height: 0` + `overflow: hidden`.

3. **Removed hardcoded chat-zone height pressure**
   - Maya active chat zone now uses flex fill (`flex: 1`, `height: auto`) instead of fixed viewport subtraction values that could overflow and create blank area.

4. **Single scroll owner**
   - `yc-maya-messages-v2` remains the only `overflow-y: auto` region.
   - input container (`yc-maya-input-v2`) is fixed as bottom flex row (`flex: 0 0 auto`), always visible.

5. **Old wrapper hard-hide guard**
   - Legacy chat wrappers are force-hidden if injected (`yc-chat-wrap`, `yc-chat-panel`, `yc-chat-stream`, `maya-chat-page`, `maya-chat-card`, `maya-input-bar`) so they cannot consume space.

6. **WhatsApp hidden tab zero-space guarantee**
   - When Maya tab is active, WhatsApp/stats zones are force-collapsed to zero footprint (`display:none`, `height/min-height:0`, no margin/padding/border).

## Scope safety

- No changes to Maya brain/business logic.
- No changes to clients/orders/receipts logic.
- Only layout/scroll ownership CSS was modified.

## Expected acceptance result

- Browser page no longer reveals dark/blank area below chat.
- Mouse/touch scroll inside messages moves conversation history.
- Input remains visible.
- User can scroll up to old messages and back down to newest messages.
- Desktop and iPhone behavior align with fixed viewport chat shell.

