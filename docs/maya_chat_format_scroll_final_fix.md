# Maya Chat Format + Scroll Final Fix

## Problems addressed
- Raw markdown markers (e.g. `**Cantidad:**`) appearing in assistant bubbles.
- Quote responses collapsing into dense unreadable text.
- Mobile chat history scroll not consistently reaching older messages.
- Duplicate quote summary card had already been removed and remains removed.

## What changed

### 1) Markdown cleanup in Maya bubble
- Added a display normalizer that strips basic markdown markers before rendering:
  - `**bold**`, `__bold__`, inline code backticks, heading markers, markdown links.
  - Converts list prefixes (`-`, `*`) into clean bullet lines (`•`).
- This prevents raw markdown symbols from appearing in chat bubbles.

### 2) Quote formatting in the normal bubble
- Kept quote display inside the main Maya bubble only.
- Enforced line breaks for quote labels:
  - `Producto`, `Cantidad`, `Precio por pieza`, `Subtotal`, `Logo/diseño`, `Total`, `Depósito`, `Saldo`.
- Also normalizes compact follow-up question layout for readability.

### 3) Mobile scroll hardening
- Reinforced min-height and overflow ownership on mobile chat containers so the message stream remains the scroller.
- Kept input/composer fixed at bottom while conversation area owns vertical scroll.
- Increased bottom padding in message stream to avoid cramped end-of-list behavior.

### 4) Debug log added
- Added:
  - `console.log('[MayaChat] messages container scrollHeight/clientHeight', { scrollHeight, clientHeight })`
- Log fires when user or assistant messages are appended.

## Safety / behavior preserved
- Maya response logic unchanged.
- `Copiar` unchanged.
- `Convertir a orden` unchanged (quote metadata is still stored for conversion).
- Mic/send unchanged.
- WhatsApp tab unchanged.
- No duplicate quote cards are rendered.

## Files changed
- `chat.js`
- `styles.css`
- `docs/maya_chat_format_scroll_final_fix.md`
