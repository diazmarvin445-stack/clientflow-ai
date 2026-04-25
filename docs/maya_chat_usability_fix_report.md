# Maya Chat Usability Fix Report

## Scope
Focused on Maya chat usability for YourColor first, before other categories.

## What caused the scroll problem
- The chat page had multiple containers participating in layout/scroll (`body`, shell, zone wrappers), but the chat card did not enforce a strict viewport-based height in Maya tab mode.
- That allowed the browser/page to compete with the message list for scroll behavior, which made the experience feel unstable and could expose empty background areas.
- The fix constrained the Maya chat zone to a stable height (`calc(100dvh - 160px)`), kept wrappers overflow-hidden, and ensured the message list remains the only vertical scroller.

## What caused mobile zoom/jump
- Mobile browsers (especially Safari/WebKit-based behavior) can zoom or shift viewport when focused input font size is below accessibility thresholds.
- Horizontal movement can also happen when containers exceed viewport bounds.
- The fix enforces `16px` chat input size, keeps horizontal overflow hidden, and hardens overscroll handling so body/page movement does not fight chat scrolling.

## How quote formatting was improved
- Budget-like assistant responses were displayed as raw paragraph text, which made estimates hard to scan.
- Added a display-only normalization pass in chat rendering that:
  - detects budget/quote-like content
  - inserts clean line breaks for key fields (Producto, Cantidad, Precio por pieza, Subtotal, Logo, Total, Depósito, Saldo)
  - preserves original business logic and response generation
- Also re-enabled clean quote card rendering in the bubble path (without changing conversion logic), improving readability while keeping actions intact.

## Files changed
- `styles.css`
  - Stabilized Maya chat layout and single-scroll behavior.
  - Added mobile/overscroll hardening and chat input font-size enforcement.
  - Improved quote row wrapping for cleaner budget visualization.
- `chat.js`
  - Added budget display formatter for readable multi-line quote responses.
  - Wired formatted display text into assistant bubble/copy/order actions.
  - Added quote card attachment back into assistant bubble flow.
- `docs/maya_chat_usability_fix_report.md`
  - This report.
