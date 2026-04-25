# Finanzas: Gastos fijos (YourColor)

## Objetivo

Añadir **gastos fijos** (mensuales o semanales) para negocios **YourColor** (`businessName` normalizado `yourcolor` o categoría `custom_apparel`), sin alterar la lógica existente de ingresos, gastos variables ni transferencias en `finance`. Los fijos **no anticipan cobros**: solo suman al balance cuando la fecha de cobro ya ocurrió (hasta “hoy” en hora local).

## Modelo de datos (Firestore)

Colección: `businesses/{businessId}/fixedExpenses/{expenseId}`

Campos por documento:

| Campo               | Tipo    | Descripción |
|---------------------|---------|-------------|
| `name`              | string  | Nombre (ej. Renta, Shopify) |
| `amount`            | number  | Monto en USD **por periodo** (una vez al mes o una vez por semana según `frequency`) |
| `frequency`         | string  | `"monthly"` o `"weekly"` |
| `chargeDayOfMonth`  | number  | Si mensual: día del mes 1–31 (si el mes no tiene ese día, se usa el último día del mes) |
| `chargeWeekday`     | number  | Si semanal: 0=domingo … 6=sábado |
| `active`            | boolean | Si `false`, no entra en totales |
| `createdAt`         | server  | Al crear |
| `updatedAt`         | server  | Al crear/editar/toggle |

Al cambiar de mensual a semanal (o al revés), el cliente guarda el campo que no aplica como `null`.

## Reglas de seguridad

En `firestore.rules`: subcolección `fixedExpenses` con `read, write` solo si `isBusinessOwner(businessId)` (igual que `finance`).

## UI (Finanzas)

Archivos: `finanzas.html`, `styles.css`, `finanzas.js`.

- Sección **«Gastos fijos»** (`#fin-fixed-panel`), visible solo en modo YourColor.
- Lista con nombre, monto, texto de frecuencia y día de cobro, interruptor **Activo**, **Editar** y **Eliminar**.
- Modal: frecuencia, día del mes (mensual) o día de la semana (semanal).
- Resumen de tarjetas: en **Hoy**, **Esta semana** y **Este mes**, los **Gastos** incluyen variables del período más **fijos ya devengados** en ese mismo período (cobros con fecha ≤ hoy). En **Todo** no se suman fijos (solo movimientos `finance`).
- Nota bajo gastos cuando aplica: fijos ya cobrados en el período vs variables.

## Cálculo (coherencia en la app)

Función central en `dashboard-data.js`: `sumAccruedFixedExpensesBetween(rows, rangeStart, rangeEnd, asOfDate)` — recorta el rango por `asOfDate` (fin de día) y suma solo cobros cuya fecha cae dentro del rango.

- **Finanzas (`finanzas.js`)**: usa esa función con los límites del filtro de período y `asOfDate = hoy`.
- **Dashboard (`dashboard.js`)**: el mini balance del mes suma fijos devengados en el mes calendario actual (YourColor).
- **Chat / contexto Maya (`chat.js`)**: `fetchAccruedFixedExpenseTotalForCurrentMonth` para el gasto del mes en contexto.

## Archivos tocados

- `firestore.rules` — reglas `fixedExpenses`
- `dashboard-data.js` — `sumAccruedFixedExpensesBetween`, `fetchAccruedFixedExpenseTotalForCurrentMonth`
- `finanzas.html`, `finanzas.js`, `styles.css`
- `dashboard.js`, `chat.js`
- Este informe
