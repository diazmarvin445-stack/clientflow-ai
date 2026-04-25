# Maya chat scroll height fix (YourColor only)

## Diagnosis

Diagnostics showed the messages container had **no scrollable gap**:

- `scrollHeight === clientHeight` (e.g. 122/122)
- Programmatic `scrollTop` did not change
- Input was not anchored to the bottom of the viewport
- Parent nodes still reported `overflow-y: hidden` while the stream never received a **bounded** height

Meaning: `#yc-chat-stream` existed and had `overflow-y: auto`, but the **flex height chain was broken**, so the stream grew with its content instead of living inside a fixed column. Scroll then fell through to the page.

## Root cause

1. A YourColor-only block had set **`overflow: visible`** on several ancestors (`.dash-shell`, `.dash-main`, `.maya-cc`, `.maya-cc-zone__scroll`, `.yc-chat-wrap`, etc.). That prevents flex children from getting a definite **clipped** height, so `flex: 1` on the message stream does not resolve to a real `clientHeight` smaller than `scrollHeight`.

2. `.maya-chat-page` used **`height: 100%`**, which is unreliable when the parent’s height is not explicitly defined in the same way as a flex item.

3. **Alertas** sat above the card inside `.maya-cc-zone__scroll` and consumed part of the vertical budget, reducing room for the card without collapsing.

## Fix (CSS only, YourColor / `body.yourcolor-chat-page`)

All changes are in `styles.css`, scoped under `body.yourcolor-chat-page`.

1. **Restore scroll chain**  
   Replaced the `overflow: visible` override with **`overflow: hidden`** on the same flex ancestors (shell → main → maya-cc → zone → zone scroll → wrap → panel → chat page), so the message column gets a real maximum height.

2. **Real height for the card / wrap**  
   - `.maya-chat-page`: `flex: 1 1 auto; min-height: 0` (removed dependence on `height: 100%`).  
   - `.maya-chat-card`: `max-height: min(720px, calc(100dvh - 200px))` so the card has a **viewport-based cap** even when flex math is tight.

3. **Message stream**  
   Kept `flex: 1 1 auto; min-height: 0; overflow-y: auto` on `.maya-chat-messages` / `.yc-chat-stream` so only that region scrolls once height is constrained.

4. **Input bar**  
   Remains `flex: 0 0 auto` at the bottom of the card; `position: sticky; bottom: 0` kept as extra anchoring inside the card.

5. **Alertas collapsed by default**  
   `.maya-cc-alerts` starts at `max-height: 0` with no border so it **does not participate in the height budget**. On **hover or focus-within** the zone scroll strip, it expands to `max-height: 84px` with its own mini-scroll if needed.

6. **Desktop grid**  
   Added `min-height: min(720px, calc(100dvh - 200px))` on `#maya-cc-zone-chat` under YourColor so the Maya zone still gets height when `.maya-cc` is a **grid** (wide screens), not only in the mobile flex column.

## What was not changed

- No edits to `chat.js` / Maya business logic
- No changes to clientes, pedidos, recibos, WhatsApp logic
- No construction-specific files; selectors remain `body.yourcolor-chat-page` only

## Acceptance (Diagnóstico)

After deploy, with enough messages loaded, Chat Maya checks should trend toward:

- `scrollHeight > clientHeight`: **yes**
- `scrollTop` changes after programmatic test: **yes**
- Input near bottom of viewport: **yes**
- Fewer or no “parent overflow hidden” false positives tied to a broken chain (parents are intentionally `hidden` to **enable** inner scroll)

## Files touched

- `styles.css`
- `docs/maya_chat_scroll_height_fix_report.md`
