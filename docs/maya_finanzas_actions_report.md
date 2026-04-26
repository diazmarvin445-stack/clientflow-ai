# Maya Finanzas Actions Report

## Objetivo

Conectar Maya con Finanzas para registrar movimientos reales en Firestore desde el chat interno, con confirmaciones de seguridad y búsqueda de movimientos.

## Cambios implementados

- **Registro real en Firestore (`finance`)** desde Maya:
  - `add_expense`
  - `add_income`
- **Gasto fijo recurrente** ya soportado:
  - `add_fixed_expense`
  - `update_fixed_expense` (requiere `confirmed:true`)
  - `delete_fixed_expense` (requiere `confirmed:true`)
- **Búsqueda de movimientos financieros**:
  - `search_finance` con filtros opcionales (`type`, `category`, `description`, `amount`, `limit`)
- **Confirmación antes de borrar/editar**:
  - `delete_finance` / `delete_transaction` ahora exige `confirmed:true`
  - `update_fixed_expense` y `delete_fixed_expense` exigen `confirmed:true`

## Reglas de datos y parsing

- Si falta categoría en `add_income` / `add_expense`, se usa `general`.
- Si el texto menciona gasolina/gas, la categoría se normaliza a `transporte`.
- Si falta monto, la validación falla y Maya debe preguntar el monto.

## Anti-duplicados

Para evitar duplicar movimientos cuando se repite el mensaje:

- Se genera `mayaDedupeKey` con:
  - tipo
  - monto
  - categoría
  - descripción
  - fecha (día)
- Antes de insertar, Maya revisa recientes creados por `createdBy: "maya"`.
- Si existe la misma clave, no vuelve a insertar y responde que evitó duplicado.

## Campos clave guardados en `finance`

- `createdBy: "maya"`
- `source: "maya"`
- `mayaDedupeKey: "<signature>"`

Además de campos estándar: `type`, `amount`, `category`, `description`, `status`, `date`, etc.

## Compatibilidad y no regresiones

No se modificó la ruta manual de Finanzas ni flujos de pedidos/clientes/recibos.
La integración se mantiene en el pipeline de acciones de Maya (`MAYA_ACTION_JSON`) y Cloud Functions.
