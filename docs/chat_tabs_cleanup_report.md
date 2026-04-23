# Chat Tabs Cleanup Report

## Separation of Maya and WhatsApp
- Added a compact top tab switch in `chat.html` with:
  - `Maya`
  - `WhatsApp`
- Wired in `chat.js` using `setChatPageTab()` + `wireChatPageTabs()` to toggle visibility of:
  - Maya internal chat zone
  - WhatsApp conversations zone

## Default view
- Default selected tab is `Maya`.
- On first load, only Maya internal chat is visible.
- WhatsApp panel is hidden until user switches to the `WhatsApp` tab.

## What was removed from stacked layout
- The previous behavior showing Maya and WhatsApp zones together in the same stacked flow was removed.
- Now only one of the two main panels is visible at a time, reducing visual clutter on mobile.

## Mobile-first UI behavior
- Added compact, tap-friendly tab styles.
- Active tab has a clear visual state.
- On narrow screens, tabs expand horizontally for easier touch interaction.

## Logic/functionality safety
- Maya chat flow remains unchanged.
- WhatsApp panel data/rendering remains unchanged.
- Firebase bindings/listeners remain unchanged.
- Existing message rendering remains unchanged.
- No extra click/open behavior was introduced.
