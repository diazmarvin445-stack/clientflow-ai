# Maya Mobile Scroll Fix Report

## Problem addressed
On iPhone/mobile, Maya chat history could get trapped and fail to scroll back to older messages even when desktop behavior was acceptable.

## Root causes
- Mobile viewport/height chain was not fully constrained to a single scroll owner in all parent containers.
- Multiple nested wrappers had strict overflow behavior, which could interfere with touch scroll propagation on iOS.
- Message list needed stronger explicit mobile scroll ownership (`overflow-y: scroll`) and iOS-friendly touch settings.

## Fix implemented

### 1) Single mobile scroll container
- On mobile (`max-width: 768px`), enforced a strict container chain where:
  - root/page wrappers are height-bounded and non-scrolling
  - chat panel wrappers are `min-height: 0`, `overflow: hidden`, flex-column
  - only `yc-chat-stream` is the scroll owner

### 2) iPhone viewport handling
- Added mobile-specific `100dvh` usage on chat shell container to avoid iOS viewport mismatch from classic `100vh`.

### 3) Scroll behavior hardening
- `yc-chat-stream` mobile now uses:
  - `overflow-y: scroll`
  - `-webkit-overflow-scrolling: touch`
  - `overscroll-behavior-y: contain`
  - `touch-action: pan-y`

### 4) Auto-scroll behavior preserved
- Existing logic already auto-scrolls only when near bottom (`isNearBottom` checks), so reading older messages does not get force-jumped.

### 5) Debug log added
- Added requested log in `chat.js`:
  - `console.log('[MayaChat Mobile Scroll]', { scrollTop, scrollHeight, clientHeight })`
- Emits on message append and on stream scroll events.

## Files changed
- `styles.css`
- `chat.js`
- `docs/maya_mobile_scroll_fix_report.md`

## Not changed
- Firestore rules
- Maya response logic
- Copiar
- Convertir a orden
- Mic/send behavior
- WhatsApp tab behavior
