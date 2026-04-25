# Onboarding Navigation Fix

## What was broken

- The login page CTA **"Crear cuenta y configurar el negocio"** had no direct onboarding action in this flow and felt non-responsive.
- The top-right **"Configurar negocio"** button needed to consistently open onboarding.
- Post-login flow could send users to dashboard even when no business was configured yet.

## What was fixed

### 1) Login page setup-business actions

- Added `data-action="setup-business"` to both onboarding CTAs in `login.html`:
  - top-right **Configurar negocio**
  - inline **Crear cuenta y configurar el negocio**
- Added click handler in `login.js`:
  - Finds all `[data-action="setup-business"]`
  - Redirects to `onboarding.html`

### 2) Auth redirect when business is missing

- Updated `goAfterAuth()` in `login.js` to resolve business context with `resolveBusinessForUser(db, user)`.
- If no business is configured, user is redirected to:
  - `onboarding.html`
- If business exists, user goes to:
  - `dashboard.html`
- Existing `next` redirect behavior is preserved when explicitly provided.

### 3) Onboarding page readiness

- `onboarding.html` now includes a dedicated category + Maya setup section:
  - `custom_apparel`
  - `construction_roofing`
  - Maya setup prompts for services, estimates, deposits, scheduling, materials, tone, and no-promises.

### 4) Firestore save path for business profile

- `onboarding.js` now writes onboarding profile settings to:
  - `businesses/{businessId}/settings/businessProfile`
- Includes category and Maya guidance fields, scoped to the selected business only.

## How onboarding is triggered now

- Click **Configurar negocio** (header) → `onboarding.html`
- Click **Crear cuenta y configurar el negocio** (inline) → `onboarding.html`
- Login success:
  - **No business configured** → `onboarding.html`
  - **Business configured** → `dashboard.html`

## Safety / no-break notes

- Login form behavior remains intact.
- Existing auth sessions remain valid.
- Firebase Auth flow is unchanged.
- Existing YourColor business data is not modified by this navigation fix.
