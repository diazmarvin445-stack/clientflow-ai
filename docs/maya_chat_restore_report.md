# Maya Chat Restore Report

## Why chat disappeared
- The Maya area had been changed to a newer wrapper/form structure while the surrounding layout was still sensitive to tab/height/overflow interactions.
- In practice, the visible region prioritized the alert/control section and the chat conversation area was not reliably visible.
- This created the perception that Maya chat had disappeared even though logic was still loaded.

## What was restored
- Restored Maya chat markup to a stable, previously working structure inside `chat.html`:
  - `yc-chat-wrap` as chat container
  - `yc-chat-panel` as chat card
  - `yc-chat-stream` (messages list)
  - `yc-chat-composer` (input + mic + send)
- Kept “Alertas / Control” above the chat, without replacing the conversation area.
- Ensured messages and input remain present in the Maya tab UI.

## Where chat container is now rendered
- File: `chat.html`
- Maya tab zone:
  - wrapper: `.yc-chat-wrap.maya-chat-page`
  - panel: `#yc-chat-panel`
  - messages: `#yc-chat-stream`
  - input bar: `#mayaInputBar` with `#yc-chat-input`, `#yc-chat-mic`, `#yc-chat-send`

## Functionality preserved
- Chat logic and message rendering were not removed.
- Send button behavior remains intact.
- Mic button remains intact.
- Existing action flows (Copiar, Convertir a orden, Maya actions) remain in code paths.
