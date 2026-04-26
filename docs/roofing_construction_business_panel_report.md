# Roofing Construction Business Panel Report

## Objetivo cumplido

Se implementó soporte para un negocio separado con categoría `roofing_construction`, aislado por `businessId` y sin mezclar datos con YourColor.

## Cambios implementados

- **Onboarding con nueva categoría**
  - `onboarding.html`: la categoría ahora incluye `roofing_construction`.
  - `onboarding.js`:
    - Se normaliza categoría (`construction_roofing` -> `roofing_construction`).
    - Se guarda categoría normalizada en:
      - `businesses/{id}.businessCategory`
      - `businesses/{id}.category`
      - `businesses/{id}/settings/businessProfile.category`

- **Navegación por categoría (panel separado)**
  - `category-config.js`:
    - Se define configuración para `roofing_construction`.
    - Menú dedicado con módulos: Dashboard, Chat IA, Pedidos, Clientes, Finanzas, Equipo, Diagnóstico y Configuración.
    - Se deja visible **Campañas IA** con etiqueta **"Muy pronto"**.
    - Se soporta alias heredado `construction_roofing`.

- **Aislamiento por negocio y navegación multi-negocio**
  - `dashboard-data.js`:
    - Nuevo helper `fetchBusinessesForOwnerList`.
    - `resolveBusinessForUser`/selección activa ahora respeta `sessionStorage` cuando el usuario elige un negocio específico.
  - `dash-shell.js`:
    - Se agregó selector de negocio activo en el menú de usuario cuando hay más de un negocio.
    - Al cambiar de negocio, se fija `businessId` activo por sesión y se recarga la app.
  - `styles.css`:
    - Estilos para el switcher de negocio dentro del dropdown.

- **Maya adaptada a roofing/construction**
  - `functions/yourcolor-config.js`:
    - Nuevo `getMayaInternalChatPromptForBusiness(business)`.
    - Si la categoría es `roofing_construction`, Maya usa prompt operativo para:
      - cotizaciones de techos/construcción,
      - seguimiento de clientes y trabajos,
      - materiales, equipo y horas,
      - finanzas y recordatorios.
    - Si no, mantiene prompt existente de YourColor.
  - `functions/index.js`:
    - `chatWithAI` ahora selecciona prompt según `firebaseContext.business`.

- **Campañas IA visibles pero desactivadas**
  - `campanas.js`:
    - Modo "Muy pronto" para `roofing_construction`.
    - Mantiene la sección visible.
    - Desactiva botones de generar/regenerar/guardar en campañas para esta categoría.
    - Ajusta subtítulo del módulo para comunicar estado.

## No se afecta YourColor

- No se borran ni migran datos de YourColor.
- La lógica de finanzas, pedidos, clientes y chat sigue aislada por `businessId`.
- Las reglas específicas de YourColor se conservan para `custom_apparel`.

## Resultado

Queda habilitada la base del panel independiente para el negocio de roofing/construction, con Maya adaptada y separación clara por categoría y por `businessId`.
