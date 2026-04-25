# YourColor Maya Chat Panel V2 Report

## What changed

For `chat.html` in YourColor mode, the old Maya chat layout was replaced with a new panel structure and new classes:

- `yc-maya-panel-v2-wrap`
- `yc-maya-panel-v2`
- `yc-maya-header-v2`
- `yc-maya-messages-v2`
- `yc-maya-input-v2`

The old visual wrappers (`yc-chat-wrap` / `yc-chat-panel` / `yc-chat-stream` / `mayaInputBar`) are no longer rendered in the Maya tab markup.

## New panel structure

The new Maya tab panel now follows:

- fixed-height card inside the available viewport (`yc-maya-panel-v2`)
- header (`yc-maya-header-v2`) with Maya title/subtitle and clear button
- middle messages region (`yc-maya-messages-v2`) as the only scroll container
- bottom input region (`yc-maya-input-v2`) always visible

## Existing Maya logic kept

Business/chat logic was not changed. Existing functionality is still wired:

- send message flow
- Maya API request/streaming
- chat history restore/clear
- "Copiar"
- "Convertir a orden"
- microphone
- WhatsApp tab behavior

Only container lookups were switched from old stream id to the new one:

- `yc-chat-stream` -> `yc-maya-messages-v2`
- `mayaInputBar` -> `yc-maya-input-v2`

## Scroll isolation

Scroll is isolated to `yc-maya-messages-v2` by CSS:

- `overflow-y: auto` on `yc-maya-messages-v2`
- `overflow: hidden` on enclosing Maya chat zone wrappers
- input area (`yc-maya-input-v2`) remains a fixed bottom flex row
- old alert strip is hidden in YourColor Maya view to avoid stealing height/scroll budget

Result: page scroll no longer controls chat-message movement; only the messages area scrolls.

## Diagnostics update

`diagnostico.js` now validates the new container:

- static checks look for `id="yc-maya-messages-v2"`
- CSS scroll rule check targets `.yc-maya-messages-v2`
- runtime probe queries `#yc-maya-messages-v2` and `#yc-maya-input-v2`

So Diagnóstico now detects the new Maya message container, not the old one.

