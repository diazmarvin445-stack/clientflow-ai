# Onboarding Navigation Lock Fix

## Issue addressed
Existing users with an already configured business could get trapped in `onboarding.html` because navigation actions were not consistently bound to authenticated flow logic.

## What was fixed

### 1) Entrar al panel routing
- Wired onboarding panel-entry actions to always send users to `dashboard.html`.
- Added explicit navigation handler so users are never blocked on onboarding when they want to enter the panel.
- Included the requested auth/business guard behavior:
  - if user exists and business is configured, route to dashboard immediately.

### 2) Salir behavior
- Updated `Salir` behavior to:
  - call `signOut(auth)`
  - then redirect to `login.html`

### 3) Existing business guard on load
- On onboarding load, the script now checks whether the logged-in user already has a configured business in Firestore.
- When configured, a visible option is shown:
  - `Ya tienes un negocio configurado. Entrar al panel`
- This prevents forcing existing users through onboarding again.

### 4) New business flow preserved
- Users with no configured business still follow the onboarding form flow.
- Business creation and profile save logic remain unchanged.

### 5) Debug logs added
- Added logs:
  - `console.log('[Onboarding] user:', user?.uid);`
  - `console.log('[Onboarding] businessConfigured:', businessConfigured);`
  - `console.log('[Onboarding] entering dashboard');`
  - `console.log('[Onboarding] signing out');`

## Files changed
- `onboarding.html`
- `onboarding.js`
- `docs/onboarding_navigation_lock_fix.md`
