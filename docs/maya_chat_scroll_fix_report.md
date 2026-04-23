# Maya chat scroll fix (Chat IA)

## What caused the bad scroll

1. **Wrong scroll owner** — `.maya-cc-zone--chat > .maya-cc-zone__scroll` used **`overflow-y: auto`**, so the whole block (alertas + panel) scrolled as one. The message list (`.yc-chat-stream`) also had `overflow-y: auto`, producing **nested scroll regions** and a layout where the outer area grew instead of capping height, so the conversation felt stuck or the page showed a **large empty strip** (background below content).

2. **Forced minimum heights** — `.maya-cc-zone[open] > .maya-cc-zone__scroll` had **`min-height: 12rem`** and `.maya-cc-page … .yc-chat-panel` had **`min-height: min(42vh, 420px)`**, which inflated the chat card and pushed extra blank space.

3. **Mobile** — `.maya-cc` used **`overflow-y: auto`** and **`min-height: min-content`**, so on small screens the **entire Centro de Control** scrolled like a long page instead of keeping scroll inside the message list.

4. **Shell** — `body.dash-body .dash-shell` defaulted to **`overflow-y: auto`**, so with weak inner constraints the **shell** could scroll and show empty area below the app.

5. **Auto-scroll** — Every assistant chunk and bubble set **`scrollTop = scrollHeight`**, so users **could not read older messages** while Maya was streaming or replying.

## What owns scroll now

| Region | Role |
|--------|------|
| `body.dash-body.maya-cc-page .dash-shell` | **`overflow: hidden`** — not the primary scroll for chat. |
| `.maya-cc-page .maya-cc` | **`height: 100%`**, **`overflow: hidden`**, **`grid-template-rows: auto minmax(0, 1fr)`** — tabs row + one flexible row for zones. |
| `.maya-cc-zone--chat > .maya-cc-zone__scroll` | **`overflow: hidden`** — does **not** scroll; only lays out children. |
| `.yc-chat-wrap` / `.yc-chat-panel` | Flex column, **`min-height: 0`**, **`overflow: hidden`** — fill available height. |
| **`#yc-chat-stream.yc-chat-stream`** | **`flex: 1`**, **`min-height: 0`**, **`overflow-y: auto`**, **`overscroll-behavior: contain`** — **this is the only message history scroller.** |
| `.yc-chat-toolbar`, loading/error/toast, **`.yc-chat-composer`** | **`flex-shrink: 0`** — stay visible; composer stays at the bottom of the panel. |

## How the black / empty bottom area was removed

- Removed **outer** scroll from `.maya-cc-zone__scroll` (chat) and **mobile** scroll from `.maya-cc`.
- Removed **`min-height: 12rem`** on the open zone scroll and the **`min(42vh, 420px)`** minimum on the Maya chat panel so flex children can shrink.
- **`.dash-shell`** is **`overflow: hidden`** only on **`maya-cc-page`**, avoiding extra page-length scroll on this screen.
- Hidden tabs already use **`display: none !important`** (`.is-tab-hidden` / attribute rules); no change required there.

## Desktop vs mobile

- **Desktop** — Grid row 2 gets **`minmax(0, 1fr)`** height; the chat column fills the viewport under the top bar; messages scroll inside **`#yc-chat-stream`**; composer stays fixed at the bottom of the card.
- **Mobile / tablet** — Same inner model: **`.maya-cc`** no longer scrolls as a whole; **`#yc-chat-stream`** scrolls with touch; **`overscroll-behavior: contain`** reduces scroll chaining to the body.

## Auto-scroll behavior (`chat.js`)

- **`isNearBottom(el, thresholdPx = 120)`** — true when within **120px** of the bottom.
- **`scrollChatStreamToBottomIfNear(stream)`** — scrolls to bottom only if already near bottom.
- **User messages** — still **`scrollChatStreamToBottom`** so the sent line stays visible.
- **Assistant bubbles & streaming** — use **near-bottom** logic so reading history is not interrupted.
- **History restore** — **`renderChatHistoryFromMemory`** still scrolls to the **bottom** once after rebuild.

## Files changed

| File | Change |
|------|--------|
| `styles.css` | Maya/chat layout: scroll ownership, flex chain, shell overflow on `maya-cc-page`, stream `overscroll-behavior` / `min-height: 0`, composer `flex-shrink: 0` |
| `chat.js` | `isNearBottom`, `scrollChatStreamToBottomIfNear`, conditional scroll for assistant + streaming |
| `docs/maya_chat_scroll_fix_report.md` | This report |

## Not changed (per request)

- Maya business / Firebase logic, send pipeline, microphone, WhatsApp tab wiring — **layout and scroll only.**
