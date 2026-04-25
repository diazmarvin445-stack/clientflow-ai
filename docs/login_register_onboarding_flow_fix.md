# Login/Register Onboarding Flow Fix

## What confusing link was removed

Removed the extra, confusing option:

- `¿Quieres cuenta con correo? Crear cuenta con correo`

Now the login view keeps a single clear account-creation CTA:

- `Crear cuenta y configurar el negocio`

## How account creation works now

1. User clicks **Crear cuenta y configurar el negocio** on `login.html`.
2. UI switches to the signup panel (email + password + confirm password).
3. `createUserWithEmailAndPassword` creates the Firebase Auth account.
4. On success, redirect is always:
   - `onboarding.html`

## How onboarding redirect works now

### Existing users (login flow)

- Login remains separate (`email` + `password` + `Entrar al panel`).
- After successful login:
  - If user has **no business configured** → redirect to `onboarding.html`
  - If user **has business configured** → redirect to `dashboard.html`

### Setup-business header button

- The top-right **Configurar negocio** action still routes to `onboarding.html`.
- Onboarding requires signed-in account, so unauthenticated users are sent back to login first.

## Additional confirmation

- `onboarding.html` remains a setup page only (category + business + Maya questions).
- No login card is shown on onboarding.
- Firebase Auth flow and existing business access behavior remain intact.
