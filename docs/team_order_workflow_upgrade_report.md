# Team Order Workflow Upgrade Report

## Session pause/resume model
- Team sessions now use explicit workflow statuses:
  - `activa`
  - `pausada`
  - `finalizada`
- `Iniciar trabajo` creates a new work block with structured tracking fields:
  - `operatorId`, `operatorName`
  - `linkedOrderId`, `linkedOrderClientName`, `linkedOrderProduct`, `linkedOrderStatus`
  - `startedAt`, `resumedAt`, `pausedAt`, `endedAt`
  - `totalTrackedMs`, `hourlyRate`, `calculatedPay`
- `Pausar` stores accumulated tracked milliseconds and keeps session open.
- `Continuar` resumes from paused state without losing accumulated time.

## Multi-day tracking
- Accumulation is based on `totalTrackedMs`, not single-day assumptions.
- A paused session can remain paused and be resumed later (same day or next day).
- Finalized session calculates:
  - `totalHours = totalTrackedMs / 3600000`
  - `calculatedPay = totalHours * hourlyRate`
- Order labor totals accumulate across finalized sessions:
  - `totalLaborHours`
  - `totalLaborCost`

## One-active-session-per-operator enforcement
- For the current operator, only one `activa` session is allowed at a time.
- If user starts work on a different order while another session is active:
  - current active session is auto-paused safely first
  - then the new order session starts
- This prevents two simultaneous active sessions for the same operator.

## Order state connection with Team workflow
- Order flow supported for production separation:
  - `nuevo`
  - `en_preparacion`
  - `listo`
  - `entregado` (kept separate from Team finalization)
- On start:
  - linked order is set to `en_preparacion` when applicable
  - order `workStatus` is set to `en_preparacion`
- On pause:
  - order stays in production flow (`status` unchanged)
  - `workStatus` becomes `pausado`
- On continue:
  - `workStatus` returns to `en_preparacion`
- On `Finalizar trabajo`:
  - session closes (`finalizada`)
  - order `workStatus` becomes `listo`
  - order `status` is set to `listo` unless already `entregado/cancelado`
  - Team module does **not** mark orders as `entregado`

## Finance safety rule
- Finance expense is created only when a work session is properly finalized.
- Pause/resume does not create additional expense entries.
- Finance entry remains linked to the same order via:
  - `linkedOrderId`
  - `orderId` (compatibility)
- This keeps payroll tracking compatible with existing finance flows and avoids duplicates.
