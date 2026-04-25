# Finanzas: Gastos fijos mensuales (YourColor)

## Objetivo

Añadir **gastos fijos mensuales** como componente financiero para negocios **YourColor** (`businessName` normalizado `yourcolor` o categoría `custom_apparel`), sin alterar la lógica existente de ingresos, gastos variables ni transferencias en `finance`.

## Modelo de datos (Firestore)

Colección: `businesses/{businessId}/fixedExpenses/{expenseId}`

Campos por documento:

| Campo        | Tipo    | Descripción                                      |
|-------------|---------|--------------------------------------------------|
| `name`      | string  | Nombre (ej. Renta, Shopify, Canva)               |
| `amount`    | number  | Monto en USD                                     |
| `frequency` | string  | Por ahora solo `"monthly"` (listo para ampliar) |
| `active`    | boolean | Si `false`, no entra en totales del mes        |
| `createdAt` | server  | Al crear                                         |
| `updatedAt` | server  | Al crear/editar/toggle                           |

## Reglas de seguridad

En `firestore.rules`: subcolección `fixedExpenses` con `read, write` solo si `isBusinessOwner(businessId)` (igual que `finance`).

## UI (Finanzas)

Archivos: `finanzas.html`, `styles.css`, `finanzas.js`.

- Sección **«Gastos fijos mensuales»** (`#fin-fixed-panel`), visible solo en modo YourColor.
- Lista con nombre, monto, frecuencia (mensual), interruptor **Activo**, botones **Editar** y **Eliminar**.
- Botón **Agregar gasto fijo** y modal dedicado (`#fin-fixed-modal-host`) para alta/edición.
- Resumen de tarjetas: en período **Este mes**, el total de **Gastos** = gastos variables del mes + suma de gastos fijos activos mensuales; **Balance neto** = ingresos − ese total.
- Nota bajo el monto de gastos cuando aplica: desglose fijos vs variables.

Períodos **Hoy / Semana / Todo**: los gastos fijos **no** se suman (solo el mes calendario actual, alineado con el resumen mensual pedido).

## Cálculo (coherencia en la app)

- **Finanzas (`finanzas.js`)**: `summarize` suma el addon de fijos solo con `currentPeriod === "month"`.
- **Dashboard (`dashboard.js`)**: el mini balance del mes (`dash-mini-balance`) suma los mismos fijos activos mensuales solo para YourColor, vía snapshot en `fixedExpenses`.
- **Chat / contexto Maya (`chat.js`)**: `financeThisMonth.expense` incluye los fijos mensuales activos para YourColor, manteniendo ingresos y movimientos `finance` como hasta ahora.

## Futuro

- Añadir `weekly` / `yearly` en `frequency` y prorratear o acumular por período.
- Categorías y etiquetas en cada gasto fijo.
- Gráficos comparando variables vs fijos.

## Archivos tocados

- `firestore.rules` — reglas `fixedExpenses`
- `dashboard-data.js` — `fetchActiveFixedMonthlyExpenseTotal`
- `finanzas.html`, `finanzas.js`, `styles.css`
- `dashboard.js`, `chat.js`
- Este informe
