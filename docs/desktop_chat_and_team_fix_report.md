# Desktop Chat and Team Fix Report

## What caused desktop Chat IA to stay in mobile-like width

The desktop Maya container (`.maya-cc`) is a 3-column grid.  
When only one tab panel is visible (Maya or WhatsApp), the visible panel remained in a single grid column instead of spanning full width.  
That made desktop chat look like a narrow/mobile-sized box.

## What caused Team control to fail loading

`subscribeTeamSessions()` used an ordered Firestore query (`orderBy("createdAt")`).  
In environments where historical session docs are inconsistent for that field, the realtime subscription can fail and trigger:

- `No se pudo cargar el control de jornada.`

The loader itself was present, but the query failed before rendering could stabilize.

## Files fixed

- `styles.css`
- `equipo.js`

## Fixes applied

### Chat IA desktop width fix

In `styles.css`:

- Added full-width spanning for the active tab panel:
  - `.maya-cc[data-active-tab="maya"] #maya-cc-zone-chat { grid-column: 1 / -1; }`
  - `.maya-cc[data-active-tab="whatsapp"] #maya-cc-zone-wa { grid-column: 1 / -1; }`

Result:

- Desktop chat now uses proper available width.
- Mobile compact behavior remains unchanged.
- Maya/WhatsApp tab switching still works.

### Team control loading fix

In `equipo.js`:

- Replaced the fragile ordered query in `subscribeTeamSessions()` with:
  - `query(collection(..., "teamSessions"), limit(500))`

Result:

- Control de jornada renders on desktop and mobile without failing due to order-field issues.
- Start/Pause/Finalize controls remain functional.
- Error message now appears only for real backend/connectivity failures.

## Desktop/mobile behavior after fix

- **Desktop Chat IA:** wide, normal panel rendering.
- **Mobile Chat IA:** compact/touch-friendly layout is preserved.
- **Equipo control:** visible and operational on both desktop and mobile, with no forced collapse.
