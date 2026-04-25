# YourColor Maya real chat container fix (`yc-chat-stream`)

## Objective

Fix the **real active** Maya message container (`yc-chat-stream`) so it is the only scrollable chat-message region, with:

- fixed-height chat shell (flex column)
- `yc-chat-stream` as middle flex area with scroll
- input bar fixed at bottom inside shell

## Where `yc-chat-stream` is created

- `chat.html`
  - `<div id="yc-chat-stream" class="yc-chat-stream maya-chat-messages" hidden></div>`

## Where `yc-chat-stream` is styled

- `styles.css`
  - `body.yourcolor-chat-page .maya-chat-messages` (same node via class)
  - `body.yourcolor-chat-page .yc-chat-stream` (mobile block)
  - `.yc-chat-stream` (base style)
  - theme surface styles (`body.dark-theme .yc-chat-stream`, `body.light-theme .yc-chat-stream`)

## Where `yc-chat-stream` is measured/scrolled in JS

- `chat.js`
  - `isNearBottom(el)` reads `scrollHeight`, `scrollTop`, `clientHeight`
  - `scrollChatStreamToBottomIfNear(stream)` writes `scrollTop`
  - `scrollChatStreamToBottom(stream)` writes `scrollTop`
  - `logChatScrollMetrics(messagesEl)` logs `scrollHeight`, `clientHeight`, `scrollTop`
  - `wireMayaMobileScrollDebug(messagesEl)` logs scroll events
  - Message render/streaming/welcome/bootstrap paths fetch `document.getElementById("yc-chat-stream")` and append/scroll there

## Fixes applied

1. **Removed legacy fallback to unused container**
   - Updated `chat.js` `clearChatHistory()` to use only:
     - `document.getElementById("yc-chat-stream")`
   - Deleted fallback logic that referenced `chatMessages`.

2. **Locked chat shell to real fixed-height flex layout**
   - Updated `styles.css`:
     - `body.yourcolor-chat-page .maya-chat-card` now uses:
       - `height: 100%`
       - `max-height: 100%`
       - `display: flex; flex-direction: column; overflow: hidden;`
   - This keeps the shell height constrained so stream gets a real `clientHeight`.

3. **Kept `yc-chat-stream` as the message scroller**
   - Existing stream styles remain active:
     - `flex: 1 1 auto`
     - `min-height: 0`
     - `overflow-y: auto/scroll`
   - No new message container was created.

4. **Input bar fixed to shell bottom (not sticky viewport behavior)**
   - Updated `styles.css` `body.yourcolor-chat-page .maya-input-bar`:
     - removed `position: sticky`, `bottom`, `z-index`
   - Composer now stays as fixed bottom flex item inside the shell.

5. **Eliminated extra scroll behavior in chat zone alert expansion**
   - Updated expanded alerts state from `overflow-y: auto` to `overflow: hidden`
   - Prevents nested scroll behavior in the chat column while Maya tab is active.

6. **Added explicit console diagnostics for the real container**
   - Added `logYcChatStreamDiagnostics(stream)` in `chat.js`
   - Called during boot after stream mount
   - Console output now includes:
     - exists
     - `scrollHeight`
     - `clientHeight`
     - `scrollTop` probe before/after write

## Expected acceptance behavior

With Maya tab open and enough messages:

- `yc-chat-stream` exists
- `yc-chat-stream.scrollHeight > yc-chat-stream.clientHeight`
- setting `yc-chat-stream.scrollTop = 200` changes `scrollTop` (when overflow exists)
- input bar remains visible at the bottom of chat shell

