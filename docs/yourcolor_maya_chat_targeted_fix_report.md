# YourColor Maya Chat Targeted Fix Report

## Scope
Applied the Maya chat rebuild only to the active YourColor chat route (`chat.html`) when the resolved business matches:
- `businessName === "yourcolor"` OR
- `businessCategory === "custom_apparel"`

No construction/roofing onboarding templates were targeted.

## Files changed (YourColor-targeted)
- `chat.js`
  - Added runtime body scoping class toggle in `bootWithUser(...)`:
    - adds `yourcolor-chat-page` only for YourColor/custom_apparel
    - removes it otherwise
- `styles.css`
  - Scoped rebuilt Maya chat layout selectors under:
    - `body.yourcolor-chat-page ...`
  - Scoped mobile height/overflow/scroll rules under:
    - `body.yourcolor-chat-page ...`
  - Scoped long-message bubble readability classes under:
    - `body.yourcolor-chat-page .maya-message...`
- `docs/yourcolor_maya_chat_targeted_fix_report.md`

## How construction category was avoided
- The new rebuilt UI CSS is no longer global; it applies only when `yourcolor-chat-page` is present on `<body>`.
- That class is set at runtime only for YourColor/custom_apparel business resolution.
- Non-YourColor businesses on the same route do not receive the rebuilt layout rules.

## Selectors scoped only to YourColor chat
- `body.yourcolor-chat-page .maya-chat-page`
- `body.yourcolor-chat-page .maya-chat-card`
- `body.yourcolor-chat-page .maya-chat-header`
- `body.yourcolor-chat-page .maya-chat-messages`
- `body.yourcolor-chat-page .maya-input-bar`
- `body.yourcolor-chat-page #yc-chat-input`
- `body.yourcolor-chat-page .maya-message`
- `body.yourcolor-chat-page .maya-message.assistant`
- `body.yourcolor-chat-page .maya-message.user`
- Mobile wrappers/scroll chain under:
  - `body.dash-body.maya-cc-page.yourcolor-chat-page ...`
  - `body.yourcolor-chat-page ...`

## Result
- YourColor Maya tab keeps the simplified stable layout/scroll behavior and long-message readability improvements.
- Construction/roofing flows are not globally restyled by this rebuild.
