# Maya Chat Simple Rebuild Report

## What old layout was removed/replaced
- Replaced the Maya chat area wrapper structure with a simplified, stable chat shell:
  - `maya-chat-page` (page container)
  - `maya-chat-card` (chat card)
  - `maya-chat-messages` (single scroll container)
  - `maya-input-bar` (fixed input row)
- Kept existing action/runtime IDs (`yc-chat-*`) so message sending, mic, copy, convert-to-order, and Maya actions remain operational.

## How tabs are separated now
- Maya/WhatsApp tab visibility remains controlled by active tab state.
- Hidden tab panels use `display: none !important` and now also force:
  - `height: 0 !important`
  - `min-height: 0 !important`
  - `overflow: hidden !important`
- Hidden tab content no longer contributes scroll/height interference.

## How mobile scroll works now
- Mobile-first chain keeps only one scroll owner for Maya messages:
  - `maya-chat-messages` / `yc-chat-stream` scrolls
  - parent wrappers are flex column, `min-height: 0`, and overflow hidden
  - input bar remains fixed at bottom inside chat card
- Uses iOS-safe settings:
  - `overflow-y: scroll`
  - `-webkit-overflow-scrolling: touch`
  - `overscroll-behavior-y: contain`
  - `touch-action: pan-y`

## How long messages are formatted
- Added readable block formatting before assistant render:
  - strips raw markdown symbols (`**`, headings, inline links formatting)
  - preserves line breaks
  - keeps bullets as separate lines
  - splits very long plain paragraphs into readable sentence blocks
  - quote/presupuesto lines are still normalized into clean multiline sections
- Assistant bubbles now use `maya-message assistant` class and user bubbles use `maya-message user` for clearer spacing/readability.

## Debug logs added
- `console.log('[MayaChat] rebuilt simple layout mounted')`
- `console.log('[MayaChat] message scroll container:', stream)`

## Safety notes
- Preserved:
  - message send flow
  - microphone flow
  - `Copiar`
  - `Convertir a orden`
  - Maya action execution
  - WhatsApp tab logic
