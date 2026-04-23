# Chat Tabs Behavior Fix Report

## How tab switching works now
- Chat IA now uses strict two-panel tab behavior:
  - `Maya` tab shows only Maya internal chat panel.
  - `WhatsApp` tab shows only WhatsApp conversations panel.
- Switching is handled in `setChatPageTab()` with explicit visibility control:
  - sets root state attribute: `data-active-tab="maya|whatsapp"`
  - toggles `hidden` + `aria-hidden` on each panel
  - toggles `is-tab-hidden` CSS class
  - updates active tab style + `aria-selected`
- CSS now enforces panel exclusivity even if layout rules are aggressive:
  - `.maya-cc[data-active-tab="maya"]` hides WhatsApp/stats panels
  - `.maya-cc[data-active-tab="whatsapp"]` hides Maya/stats panels

## Default panel shown
- Default tab remains `Maya`.
- On page load:
  - Maya panel is visible.
  - WhatsApp panel is hidden.

## What was fixed from the previous broken version
- Previous version could still appear stacked/partially visible because layout styles could still render extra zones.
- Fix now uses both JS and CSS guardrails to enforce one-visible-panel-only behavior.
- Stats zone is intentionally hidden in tab mode so the screen behaves like a real two-tab switcher.
- Added explicit `.maya-cc-zone[hidden] { display: none !important; }` so the component’s `display:flex` style can never keep hidden panels visible.
- Default hidden panels (`WhatsApp`, `Estadísticas`) now also include `is-tab-hidden` class in markup as an extra fallback.

## Safety / functionality
- Maya chat flow remains unchanged.
- WhatsApp panel rendering and Firebase bindings remain unchanged.
- Message rendering behavior remains unchanged.
