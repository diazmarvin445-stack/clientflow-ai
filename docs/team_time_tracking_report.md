# Team Time Tracking + Finance Sync Report

## Scope Implemented
Se implemento un flujo simple de control de jornada dentro de `equipo` para el operador actual (owner inicialmente), con calculo de pago por hora y registro automatico del gasto en `finanzas`.

## Session Storage Model
Las sesiones se guardan en:

- `businesses/{businessId}/teamSessions`

Campos principales por sesion:

- `userId`
- `userName`
- `memberId` (si existe un miembro vinculado)
- `status` (`active`, `paused`, `completed`)
- `startTime`
- `endTime`
- `pausedAt`
- `pausedDurationMs`
- `totalHours`
- `hourlyRate`
- `totalPay`
- `linkedOrderId` (opcional)
- `createdAt`
- `updatedAt`

## Hourly Rate Resolution
Cada miembro puede tener `hourlyRate` en `teamMembers`.

Si el miembro no tiene tarifa definida:

- se usa una tarifa por defecto configurable desde UI (`Tarifa por hora por defecto`)
- el valor por defecto inicial es `15` USD/hora
- se persiste por negocio en `localStorage`

## Payment Calculation
Al finalizar jornada:

- se calcula tiempo efectivo restando pausas acumuladas
- `totalHours = elapsedMs / 3600000`
- `totalPay = totalHours * hourlyRate`

El resultado queda persistido en la sesion finalizada.

## Finance Integration
Despues de finalizar sesion, se crea automaticamente un movimiento en:

- `businesses/{businessId}/finance`

Con la forma:

- `type: "expense"`
- `category: "mano_obra"`
- `description: "Pago por horas - {userName}"`
- `amount: totalPay`
- `date: now`
- `linkedOrderId` (si existe)
- `orderId` (mismo valor para compatibilidad)
- `createdBy: "system"`
- `status: "cobrado"`

Tambien se agrego la categoria `mano_obra` en `finanzas.js` para visualizacion correcta.

## UI Behavior Added
En `equipo.html`:

- boton `Iniciar trabajo`
- boton `Pausar` (toggle a `Reanudar`)
- boton `Finalizar jornada`
- timer de sesion activa
- total de horas trabajadas hoy
- total de ganancias hoy
- campo opcional `Pedido vinculado`
- campo `Tarifa por hora por defecto`

Adicionalmente en el modal de miembro:

- campo `Tarifa por hora (USD)` por persona

## Limitations
- No es un sistema completo de nomina (sin cortes de quincena/mes, sin aprobaciones, sin deducciones/impuestos).
- La vinculacion miembro-usuario usa `userId` o fallback por email; para multiusuario completo se recomienda enlazar usuarios de Auth de forma explicita.
- Se asume una sesion activa por usuario a la vez.
