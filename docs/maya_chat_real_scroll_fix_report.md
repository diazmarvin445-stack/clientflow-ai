# Maya chat real scroll fix report

## Problem confirmed

Diagnóstico reported real UI warnings in Chat Maya:

- `scrollHeight > clientHeight: no`
- `scrollTop changed after programmatic test: no`
- parent containers with `overflow-y: hidden`
- input not close to bottom viewport
- stacked layout risk

This matched user behavior: page scrolling instead of message stream scrolling.

## What was fixed (layout only)

Scope: **YourColor chat only** (`body.yourcolor-chat-page` selectors).

No changes were made to:

- Maya business logic
- CRM/actions logic
- other categories (construction/roofing)

### CSS adjustments

In `styles.css`:

1. Chat container ownership
- Enforced a column/flex chain with `min-height: 0` from chat shell wrappers down to card.
- Ensured the Maya tab chat area has stable viewport-based height:
  - `.maya-cc[data-active-tab="maya"] .maya-cc-zone--chat { height/max-height: calc(100dvh - 150px) }`

2. Scroll ownership
- Kept messages stream as scroll owner:
  - `body.yourcolor-chat-page .maya-chat-messages` remains `overflow-y: auto`.
- Removed/overrode blocking parent scroll traps for YourColor chat wrappers by forcing parent overflow visibility in the chat path.

3. Input pinned at card bottom
- `body.yourcolor-chat-page .maya-input-bar` now uses:
  - `position: sticky; bottom: 0; z-index: 2`

4. Alertas / Control compact above chat
- Reduced alerts visual footprint and constrained height:
  - `max-height: 84px; overflow-y: auto`
- Keeps Alertas above messages without taking over chat space.

5. Hidden WhatsApp tab height
- Existing hidden-tab rules remain active (`display: none !important`, zero height).

## Expected acceptance behavior

After this fix in YourColor chat:

- Header/sidebar remains normal
- Maya chat card stays stable in panel
- Messages area is the practical scroll target
- Input bar stays fixed at bottom of Maya card
- Diagnostics should move toward:
  - Chat Maya `OK`
  - `scrollTop changed after programmatic test: yes`
  - fewer/no parent overflow blocker warnings

## Files changed

- `styles.css`
- `docs/maya_chat_real_scroll_fix_report.md`
