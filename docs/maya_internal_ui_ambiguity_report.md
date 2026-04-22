# Maya Internal UI Ambiguity Report

## What UI Was Added

- Added ambiguity candidate UI in internal chat (`chat.js` + `styles.css`):
  - Renders compact selectable cards when backend returns ambiguity candidates.
  - Each card shows:
    - client name
    - product
    - total
    - status
    - date

- Added lightweight styles for mobile-friendly cards:
  - `.yc-ambiguity-cards`
  - `.yc-ambiguity-card`
  - `.yc-ambiguity-card__title`
  - `.yc-ambiguity-card__meta`

## How Candidate Selection Works

1. Backend ambiguity response now includes a structured metadata block:
   - `MAYA_AMBIGUITY_JSON:{ action, followUpQuestion, candidates[] }`
2. `chat.js` parses this block inside `stripMayaPanelMetadata(...)`.
3. If candidates exist, assistant bubble renders one button/card per candidate.
4. On click, UI auto-sends a follow-up message with selected `orderId`:
   - `Selecciono el pedido orderId ...`
5. Chat continues with the current internal flow and strict action pipeline.

## Backend/UI Integration Notes

- `functions/index.js` now emits structured ambiguity payloads when resolver reports ambiguous matches.
- Fallback remains intact:
  - If candidate payload is missing or parsing fails, normal text response is still shown.
  - Existing message rendering and action flows continue working.

## Remaining Limitations

- Selection currently sends a generic follow-up message with `orderId`; it does not yet carry an explicit machine-only continuation token.
- If model output omits ambiguity payload (only plain text), cards are not rendered (text fallback only).
- Candidate cards are stateless in UI history (no persisted “selected” marker yet).
