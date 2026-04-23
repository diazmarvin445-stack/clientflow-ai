# Global Responsive Stability Report

## Files changed

- `styles.css`
- `index.html`
- `dashboard.html`
- `chat.html`
- `pedidos.html`
- `clientes.html`
- `finanzas.html`
- `equipo.html`

## Root causes of instability

- Mixed viewport strategies (`initial-scale=1.0` in app pages and aggressive zoom lock in `index.html`) caused inconsistent behavior on iPhone Safari.
- The dashboard shell used multiple `100vh` and `min-height` combinations in different blocks, which could create extra page height and blank bottom space on mobile.
- Some containers had large fixed minimum heights (especially in Maya zones/chat) that made mobile pages feel stretched.
- Scrolling responsibility was split inconsistently between body/shell/main in some flows.

## What was fixed globally

- Unified app viewport on core app modules to:
  - `width=device-width, initial-scale=1, viewport-fit=cover`
- Added global control for input sizing on mobile Safari:
  - `input, textarea, select, button { font-size: 16px; }`
- Kept horizontal stability:
  - `html, body { overflow-x: hidden; touch-action: manipulation; }`
- Added stable shell behavior:
  - `body.dash-body` now uses `height/min-height: 100dvh` (with `100vh` fallback)
  - `overflow: hidden` on shell body
  - `.dash-shell` uses full available height with `min-height: 0` and `overflow: hidden`
  - `.dash-main` is now the controlled vertical scroller (`overflow-y: auto`)

## Phone fixes

- Reduced oversized spacing at mobile breakpoints for topbar, pages, panel headers, tables, and action rows.
- Removed large forced mobile min-heights in Maya zones to avoid giant vertical blocks.
- Chat paddings are tighter on mobile so the composer and messages stay stable without pushing full-page height.

## Tablet fixes

- Tablet-level spacing was normalized for page wrappers and panel heads.
- Card/panel radius and spacing were balanced to avoid desktop-heavy density on medium screens.
- Action rows (orders/thread actions) wrap correctly instead of forcing horizontal layout stress.

## Desktop fixes

- Desktop grid and card structure remains intact.
- Shell height/scroll boundaries were stabilized without changing business logic or panel behavior.
- The main content area keeps controlled scroll and avoids accidental body growth.

## Hidden panels and layout space

- Hidden elements are enforced with:
  - `[hidden] { display: none !important; }`
- Existing Maya tab-hiding rules were preserved (`.is-tab-hidden`, `[hidden]`, and tab-specific selectors), ensuring inactive panels do not consume layout height.

## Blank bottom area removal

- Replaced conflicting `100vh` shell growth with `100dvh` app-shell constraints and a single scroll owner (`.dash-main`).
- Removed mobile Maya zone forced min-height that previously inflated page height.
- Result: no oversized dark/blank trailing space below real content in normal app navigation.
