# Team work control — simple rebuild

## What was replaced

The previous **Control de jornada** stacked several layers on top of each other:

- A Firestore-backed `activeSession` plus a parallel `workTimerState` / `timerInterval` engine
- `hydrateWorkTimerFromSession`, `startTimerLoop`, `togglePauseSession`, `startWorkSession`, and mixed optimistic + snapshot reconciliation
- UI that combined optional unlink, default rate field, pause-as-toggle (“Continuar”), and extra “today” totals in the same panel

That made failures hard to reason about (timer not ticking, session state out of sync, generic “No se pudo iniciar la jornada” without a clear console trail).

## What was built instead

### Single client model

- **`currentWorkSession`** — one object: `firestoreSessionId`, `orderId`, `orderStatus`, `sessionStatus`, `hourlyRate`, `startedAt` (ms for the active segment), `accumulatedMs`, plus optional labels for UI.
- **`workTimerInterval`** — one `setInterval` (1s) while `sessionStatus === 'activa'`; each tick updates the summary and logs **`timer tick`**.

Firestore remains the persistence layer (`businesses/{id}/teamSessions`, `orders`, `finance`). Snapshots refresh `teamSessions[]`, but **while the same session stays activa locally**, we do not overwrite the live clock on every snapshot (avoids the timer jumping backward).

### UI (`equipo.html`)

- **Pedido pendiente** — required for starting; clear button labeled **Limpiar selección**
- **Tarifa por hora** — `eq-work-hourly-rate` (must be &gt; 0 to start)
- Four actions: **Iniciar**, **Pausar**, **Retomar**, **Finalizar**
- Summary: **Estado sesión**, **Estado orden**, **Tiempo acumulado**, **Pago estimado**
- **Pedidos en preparación** — same three actions per row (**Retomar**, **Marcar listo**, **Quitar**)

Removed from this panel: default-rate field, “today hours / earnings” lines, and pause doubling as resume.

### Start / pause / resume / finalize

| Action | Behavior |
|--------|----------|
| **Iniciar trabajo** | Requires selected order and valid rate. Blocks if a paused session already exists for that order (use **Retomar**). If another order is activa, pauses it first. Writes `teamSessions` + sets order to **en_preparación**. Starts interval. |
| **Pausar** | Stops interval, computes `totalTrackedMs` from Firestore timestamps + `pauseSessionRemote`, sets **pausada**, keeps order work in **en_preparacion**. |
| **Retomar** | Resolves paused session (from current UI state or selected order), `resumeSessionRemote`, sets **activa**, restarts interval from `accumulatedMs` + new segment. |
| **Finalizar trabajo** | Stops interval, totals ms (including open segment if **activa**), updates session **finalizada**, order **workStatus** / **status** **listo** (not entregado), labor hours/cost on order, then finance expense. Clears local session. |

### Finance expense

Created in **`addFinanceExpenseLabor`**:

- `type`: `expense`
- `category`: `mano_obra`
- `description`: **`Pago por horas - {operatorName}`**
- `amount`: computed pay
- `linkedOrderId` / `orderId`: session order
- `createdBy`: `system`
- `date`: now

Console: **`finance expense created`** with document id.

### Preparation list

- **Retomar** — selects order in dropdown and calls **`resumeWork`**
- **Marcar listo** — order **listo**; if it is the active/paused session, **`finalizeWork`** runs (labor + finance)
- **Quitar** — confirm; resets workflow fields safely (does not delete the order)

## Debug logs (exact strings)

- `startWork called`
- `startWork failed: <reason>` (validation / catch)
- `pauseWork called` / `pauseWork failed: ...`
- `resumeWork called`
- `finalizeWork called`
- `timer tick` (each second while activa)
- `finance expense created`
- `session finalized` (with total pay)

## Files changed

| File | Change |
|------|--------|
| `equipo.js` | Replaced work-control and timer logic with **`currentWorkSession`** + **`workTimerInterval`**; simplified Firestore helpers; snapshot guard for active timer |
| `equipo.html` | Simpler control block, **`eq-work-hourly-rate`**, **`eq-btn-resume`**, summary labels |
| `styles.css` | Grid for four buttons (`.eq-time-actions--four`), small spacing helpers |
| `docs/team_simple_rebuild_report.md` | This report |

## Business rules preserved

- Labor time is tracked on the session and rolled into order **totalLaborHours** / **totalLaborCost** on finalize
- Labor cost is written to **Finance** as **mano_obra**
- Order moves to **en_preparacion** when work starts
- Order work state moves to **listo** on finalize (delivery / **entregado** stays separate)
- **Marcar listo** on the list still sets order **listo** without implying physical delivery
