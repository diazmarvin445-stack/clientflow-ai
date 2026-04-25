# Maya UI real diagnostics upgrade

## Objective

Upgrade Diagnóstico so Chat Maya detects **real UI usability issues** (not only DOM presence).

## What was upgraded

In `diagnostico.js`, Chat Maya health now runs a runtime probe via hidden iframe:

- Loads `chat.html` in a same-origin hidden iframe.
- Waits for render/init.
- Inspects real rendered message/input nodes.
- Executes programmatic scroll test.
- Checks layout and parent overflow blockers.

## New Chat Maya checks

1. Scroll validation
- Reads `scrollHeight` and `clientHeight`.
- Verifies overflow exists (`scrollHeight > clientHeight`).
- Simulates `scrollTop += 120` and confirms movement.
- If overflow exists but no movement:
  - **ERROR**: `Chat not scrollable`

2. Layout validation
- Detects if multiple message containers exist.
- Verifies input is near viewport bottom and placed below message stream.
- Traverses parent chain and warns on `overflow-y: hidden` blockers.

3. Interaction test
- Programmatic scroll simulation with measured before/after `scrollTop`.
- Reports warning/error based on movement result and constraints.

## Output behavior

Panel now reports examples like:

- `ERROR: Chat not scrollable`
- `WARNING: Multiple containers interfering with layout`
- `WARNING: posible layout incorrecto (input no fijo al fondo)`

## Scope safety

- No business logic changed.
- No Maya action logic changed.
- Only diagnostics behavior upgraded.
