# PROJECT SUMMARY — ClientFlow AI

## 1) Lista de archivos y qué hace cada uno

### Raíz del proyecto

- `.firebaserc`: alias/configuración básica de proyecto Firebase.
- `.gitignore`: reglas de exclusión para git.
- `.vscode/settings.json`: preferencias del workspace en VSCode/Cursor.
- `firebase.json`: configuración de Firestore, Hosting y Functions.
- `firestore.rules`: reglas de seguridad Firestore (ownership por `ownerUid` y alta pública de leads).
- `firestore.indexes.json`: índices de Firestore.
- `package.json`: dependencias de raíz (`express`, `dotenv`) y tipo de módulo.
- `package-lock.json`: lockfile npm de raíz.
- `styles.css`: estilos globales de todas las pantallas.

### Frontend (HTML)

- `index.html`: landing pública.
- `login.html`: acceso/registro y redirección al flujo autenticado.
- `onboarding.html`: formulario inicial de alta de negocio.
- `dashboard.html`: panel principal con métricas y leads recientes.
- `solicitudes.html`: gestión de solicitudes/leads.
- `campanas.html`: campañas IA (recomendaciones + generador).
- `clientes.html`: gestión de clientes.
- `calendario.html`: vista de calendario.
- `equipo.html`: gestión de equipo.
- `configuracion.html`: edición de perfil de negocio y preferencias.
- `profile.html`: perfil del usuario autenticado.
- `settings.html`: pantalla utilitaria de redirección/config.
- `solicitar.html`: formulario público para que clientes envíen solicitudes.
- `testquery.html`: página de prueba/debug de query strings.
- `public/index.html`: página default de Firebase Hosting (stub).

### Frontend (JS)

- `firebase.js`: inicializa Firebase App + exporta `db` y `auth`.
- `landing-entry.js`: lógica de entrada en landing.
- `login.js`: login/signup con Firebase Auth y navegación posterior.
- `onboarding.js`: guarda el perfil inicial en `businesses` y valida escritura/lectura.
- `dashboard.js`: carga negocio del usuario y métricas del panel.
- `dashboard-data.js`: capa de datos compartida (resolución de negocio, métricas, normalizaciones, utilidades).
- `dash-shell.js`: UI shell común (sidebar, menú de usuario, estados “coming soon”).
- `solicitudes.js`: lista/actualiza leads y conversión a cliente.
- `solicitar.js`: formulario público que crea leads en Firestore.
- `campanas.js`: recomendaciones, generador IA, guardado de campañas.
- `campanas-campaign-sim.js`: motor heurístico de recomendaciones simuladas (perfil -> campañas).
- `campanas-ai-generator.js`: wrapper frontend para generar campaña vía endpoint backend (`/api/campaign`).
- `clientes.js`: listado/edición ligera de clientes.
- `calendario.js`: render de semana y placeholders de agenda.
- `equipo.js`: CRUD de miembros de equipo.
- `configuracion.js`: carga/guardado de configuración del negocio.
- `profile.js`: datos de cuenta actual + logout.
- `settings.js`: lógica de página de settings.
- `script.js`: script legacy/general de soporte (no principal del dashboard).
- `server.js`: backend Express local para proxyear a Anthropic (`POST /api/campaign`).

### Scripts utilitarios / pruebas

- `setup-env.mjs`: crea/sobrescribe `.env` con `ANTHROPIC_API_KEY`.
- `set-key-mjs`: script interactivo para guardar API key en `.env` (archivo sin extensión `.mjs` real).
- `test-claude.mjs`: prueba directa de llamada a Anthropic leyendo key desde `.env`.

### Carpeta `functions/` (Firebase Functions)

- `functions/index.js`: Cloud Function `generateCampaign` (HTTP) con Secret Manager (`ANTHROPIC_KEY`) y llamada a Claude.
- `functions/package.json`: dependencias y scripts de Functions.
- `functions/package-lock.json`: lockfile de Functions.
- `functions/.eslintrc.js`: configuración de lint en Functions.
- `functions/.gitignore`: ignores locales de Functions.
- `functions/README.md`: documentación previa (desactualizada respecto a Anthropic actual).

## 2) Estructura de datos en Firebase (colecciones)

Colección principal:

- `businesses/{businessId}`
  - Perfil del negocio: `businessName`, `industry`, `services`, `serviceArea`, contacto, branding, horarios, marketing, etc.
  - Campos de ownership: `ownerUid`, `email`, timestamps.

Subcolecciones por negocio:

- `businesses/{businessId}/leads`
  - Solicitudes de clientes (creadas públicamente desde `solicitar.html`).
- `businesses/{businessId}/clients`
  - Clientes convertidos desde leads o gestión manual.
- `businesses/{businessId}/campaigns`
  - Campañas guardadas (IA/recomendadas), presupuesto, plataforma, estado, copy.
- `businesses/{businessId}/jobs`
  - Trabajos/servicios cerrados (usados en métricas).
- `businesses/{businessId}/teamMembers`
  - Integrantes del equipo.

## 3) Flujo completo del usuario

1. Usuario entra a `index.html` (landing).
2. Va a `login.html` y se autentica.
3. Si no tiene negocio, completa `onboarding.html`.
   - `onboarding.js` crea documento en `businesses` con `ownerUid`.
4. Desde ahí navega al `dashboard.html`.
   - `dashboard.js` usa `resolveBusinessForUser` para obtener su negocio y métricas.
5. Puede operar módulos:
   - `solicitudes.html`: revisar/convertir leads.
   - `campanas.html`: generar campañas (heurísticas + IA backend).
   - `clientes.html`: ver clientes.
   - `calendario.html`: agenda.
   - `equipo.html`: equipo.
   - `configuracion.html`: actualizar datos de negocio y marketing.
6. Clientes externos usan `solicitar.html?businessId=...` para enviar nuevas solicitudes.

## 4) Funciones importantes por archivo JS

### Núcleo de datos/autenticación

- `firebase.js`
  - Inicializa app Firebase.
  - Exporta `db` y `auth`.

- `dashboard-data.js`
  - `normalizeBusinessDocument(raw)`: normaliza shape del negocio.
  - `resolveBusinessForUser(db, user)`: resuelve negocio principal por `ownerUid` (y claim por email si aplica).
  - `fetchDashboardMetrics(...)`: agrega leads/jobs/campaigns para dashboard.
  - `fetchLeadsForBusiness`, `fetchClientsForBusiness`, `fetchTeamMembersForBusiness`.
  - `fetchCampaignsListAndStats`: lista campañas + KPIs.
  - `getCampaignGeneratorProfileDefaults`: defaults para formulario de campañas.
  - helpers UI/data: `campaignPlatformDisplayName`, `formatBusinessMeta`, `initialsFromName`, etc.

### Pantallas principales

- `onboarding.js`
  - `val`, `stripUndefined`, `syncBillingPanels`.
  - Submit handler: construye `docData`, `addDoc(collection(db, "businesses"), ...)`, verifica lectura server y owner.

- `dashboard.js`
  - `loadDashboardForUser`: carga negocio, métricas y tabla de leads.

- `solicitudes.js`
  - `loadSolicitudesForUser`: carga leads.
  - `convertLeadToClientRecord`: mueve lead -> client.
  - `refreshConvertUI` y render cards/list.

- `solicitar.js`
  - Resuelve `businessId` desde URL/hash.
  - `initFormSubmit`: valida y crea lead en `businesses/{id}/leads`.

- `campanas.js`
  - `renderCampaignsPage`: recomendaciones simuladas + hub real.
  - `runCampaignGenerator`: payload del formulario -> backend IA -> render salida.
  - `generateCampaignWithAI`: `POST` a Cloud Run URL de function.
  - `saveGeneratedCampaign`: guarda campaña IA en Firestore.

- `campanas-campaign-sim.js`
  - `detectVertical`, `buildThreeCampaigns`, `generateCampaignRecommendations`.
  - Motor heurístico/simulado de recomendación.

- `campanas-ai-generator.js`
  - `generateCampaignWithClaude(inputs, businessName, businessProfileRaw)`: llama `/api/campaign` en backend Express local.

- `configuracion.js`
  - `applyFormFromBusiness`: hydrate formulario desde Firestore.
  - `saveSection(section)`: persiste bloques (`business`, `brand`, `marketing`, `platform`).
  - `wireIndustrySelector` + `syncIndustryCustomFields`: muestra campos extra para custom apparel.

- `clientes.js`
  - Carga y filtra clientes.
  - Render de cards y edición de notas/campos.

- `equipo.js`
  - CRUD de team members y estadísticas.

- `calendario.js`
  - Render semanal y placeholders de citas.

- `login.js`
  - Login/signup y `goAfterAuth`.

- `profile.js`, `settings.js`, `landing-entry.js`, `dash-shell.js`
  - Lógica de shell, navegación, perfil y utilidades UI compartidas.

### Backend / server-side

- `functions/index.js`
  - `generateCampaign` (Cloud Function v2 HTTP).
  - Usa secret `ANTHROPIC_KEY`.
  - Construye system/user prompts con perfil + formulario.
  - Llama Anthropic y normaliza respuesta a:
    `headline, hook, bodyText, cta, platform, suggestedBudgetWeekly, estimatedLeadsWeekly, creativeIdea`.

- `server.js`
  - Backend Express local alterno (`POST /api/campaign`) con Anthropic vía `process.env.ANTHROPIC_API_KEY`.

## 5) Qué está conectado vs qué sigue simulado

### Conectado (real)

- Firebase Auth (login/sesión).
- Firestore para negocios, leads, clients, campaigns, jobs, teamMembers.
- Formulario público de leads (`solicitar.js`).
- Cloud Function `generateCampaign` con Anthropic (backend seguro por secret).
- Generador de campañas de `campanas.js` conectado a URL desplegada de Function.

### Simulado / placeholder

- Parte de recomendaciones de campañas en `campanas-campaign-sim.js` (heurísticas locales).
- Algunas interacciones de UI “coming soon” en `dash-shell.js`.
- `calendario.js` usa placeholders de appointments.
- `functions/README.md` está desactualizado (menciona OpenAI histórico).
- `server.js` coexiste como backend local alterno, pero en producción se usa Function URL.

## 6) Variables de entorno y secretos usados

### Backend local (Node/Express)

- `ANTHROPIC_API_KEY` (`server.js`)
- `PORT` (`server.js`, opcional)

### Firebase Functions (Secret Manager)

- `ANTHROPIC_KEY` (`functions/index.js` via `defineSecret("ANTHROPIC_KEY")`)

### Scripts locales

- `.env` con `ANTHROPIC_API_KEY` usado por:
  - `test-claude.mjs`
  - `setup-env.mjs`
  - `set-key-mjs`

---

## Notas rápidas de estado

- Hosting en `firebase.json` apunta a carpeta `public/`, pero la app principal vive en la raíz con múltiples HTML.
- Hay coexistencia de dos rutas backend IA:
  - local: `server.js` + `/api/campaign`
  - cloud: Firebase Function desplegada (`generatecampaign-...a.run.app`)
- El flujo activo en `campanas.js` usa actualmente la URL cloud para generar campañas.
