# Chat Tabs Behavior Fix Report

## How tab switching works now
- Chat IA now uses strict two-panel tab behavior:
  - `Maya` tab shows only Maya internal chat panel.
  - `WhatsApp` tab shows only WhatsApp conversations panel.
- Switching is handled in `setChatPageTab()` with explicit visibility control:
  - `hidden` attribute toggle
  - `is-tab-hidden` CSS class toggle (`display: none !important`)
  - active tab styling and `aria-selected` updates

## Default panel shown
- Default tab remains `Maya`.
- On page load:
  - Maya panel is visible.
  - WhatsApp panel is hidden.

## What was fixed from the previous broken version
- Previous version could still appear stacked/partially visible because layout zones were not fully enforced as mutually exclusive.
- Fix now enforces one-visible-panel-only behavior through explicit show/hide logic.
- Stats zone is also hidden in this tabbed mode so the screen behaves like a real two-tab switcher.

## Safety / functionality
- Maya chat flow remains unchanged.
- WhatsApp panel rendering and Firebase bindings remain unchanged.
- Message rendering behavior remains unchanged.
