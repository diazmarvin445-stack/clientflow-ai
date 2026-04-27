# Step 1 - Configuracion YourColor Fix

## Scope
Applied changes only to `configuracion.js` for single-business YourColor behavior.

## What was fixed

1. **Auth-first load**
   - `onAuthStateChanged` is the entrypoint.
   - If no authenticated user, redirects to `login.html`.

2. **Official profile path only**
   - Config now reads profile from:
   - `users/{uid}/yourcolor/profile`
   - Uses `profileDocRef(db, { uid, businessPath: "users/{uid}/yourcolor" })`.

3. **No-error behavior when profile does not exist**
   - Missing profile document no longer triggers load error.
   - Empty form is rendered.
   - Save remains available.

4. **Save creates/updates profile**
   - All save actions write to the same profile document with `setDoc(..., { merge: true })`.
   - Works for first-time create and later updates.

5. **Header behavior**
   - Header business name now uses `profile.businessName`.
   - Fallback is `YourColor` when profile is empty.

6. **Category/workspace logic removed from Configuracion**
   - Removed Configuracion dependency on business/category resolution helpers.
   - Removed category/workspace-oriented context usage from this module.

## Acceptance checklist mapping

- Open `configuracion.html` -> loads through Auth listener.
- No profile exists -> no load error, empty form shown.
- Save profile -> writes to `users/{uid}/yourcolor/profile`.
- Refresh page -> saved values load from same profile path.
- Header -> uses saved `businessName`, fallback `YourColor`.
