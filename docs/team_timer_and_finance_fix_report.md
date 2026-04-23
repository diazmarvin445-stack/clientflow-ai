# Team Timer and Finance Fix Report

## Files changed

- `equipo.js`
- `docs/team_timer_and_finance_fix_report.md`

## How the live timer now works

- Starting a session now creates a real Firestore session document and stores the real `sessionRef.id` in local `activeSession` (no temporary local id).
- The live ticker refreshes every second and updates:
  - `Estado sesión`
  - `Estado orden`
  - `Sesión actual`
  - `Hoy (horas)`
  - `Pago estimado sesión`
- Timer logs:
  - `timer started`
  - `timer tick`

## How pause/resume works

- **Pause**:
  - preserves accumulated `totalTrackedMs`
  - sets session `status = pausada`
  - keeps order workflow in preparation context
  - logs `timer paused`
- **Resume**:
  - restores `totalTrackedMs`
  - sets session `status = activa`
  - continues elapsed time from accumulated milliseconds
  - updates top summary immediately
  - logs:
    - `session resumed`
    - `accumulated time restored`
    - `timer resumed`

## How finalize creates Finance expense

- Finalize now:
  - calculates `finalTrackedMs`
  - computes `totalHours = finalTrackedMs / 3600000`
  - computes labor pay `totalPay = totalHours * hourlyRate`
  - updates session to `finalizada`
  - creates automatic Finance expense entry:
    - `type: expense`
    - `category: mano_obra`
    - `description: Pago por horas - {operatorName}`
    - `amount: totalPay`
    - `linkedOrderId`
    - `createdBy: system`
    - `date/createdAt`
- Logs:
  - `session finalized`
  - `finance expense created`

## Summary synchronization improvements

- Top summary refresh runs after:
  - start
  - pause
  - resume
  - finalize
- Daily totals (`Hoy (horas)` and `Hoy (ganancias)`) now include non-finalized sessions by deriving values from current tracked milliseconds + hourly rate, so they do not stay stale while a session is active/paused.
