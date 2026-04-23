# Pedidos Mobile Cleanup Report

## What Changed on Mobile
- Added a dedicated mobile orders list rendered as compact cards (`#orders-mobile-list`).
- Hid the desktop table wrapper on mobile breakpoints and show cards instead.
- Simplified card content priority for quick scan:
  - client name
  - product
  - total
  - expenses
  - projected/net profit (depending on status)
  - status badge
  - delivery date
  - source label
- Added compact mobile action buttons per card:
  - Editar
  - Entregar (quick deliver / mark delivered)
  - Eliminar
- Reduced visual weight of top metrics, panel spacing, and filters on mobile:
  - less padding
  - tighter spacing
  - smaller typography where needed
  - stacked filters for narrow screens

## What Remains on Desktop
- Desktop table view remains intact (`#orders-tbody` inside `.dash-table-wrap`).
- Existing table columns and row interactions remain unchanged.
- Existing detail panel behavior remains unchanged.

## Responsive Order Actions Behavior
- Both desktop rows and mobile cards use the same core actions:
  - edit flow via modal (`openModalFor`)
  - quick deliver via `markOrderDelivered`
  - delete flow via `deleteOrder`
- Tap/click on a row/card (outside buttons) still opens the detail panel.
- Existing backend sync and finance-related logic were not modified.
