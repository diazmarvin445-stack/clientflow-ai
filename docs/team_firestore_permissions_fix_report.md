# Team work control — Firestore permissions fix

## Root cause

The browser error **`FirebaseError: Missing or insufficient permissions`** when clicking **Iniciar trabajo** was caused by a **missing Firestore rule** for the **`teamSessions`** subcollection.

Under Firestore’s default behavior, any path without an explicit `allow` is **denied**. The app was already allowed (for the business **owner**) to use:

- `businesses/{businessId}/teamMembers`
- `businesses/{businessId}/orders`
- `businesses/{businessId}/finance`

…but **`businesses/{businessId}/teamSessions` had no `match` block at all**, so **`addDoc` / `onSnapshot` on `teamSessions` always failed** for everyone.

## What was added / updated

### New helper (DRY + safe `get`)

In `firestore.rules`, under `match /databases/{database}/documents`:

- **`businessOwnerUid(businessId)`** — reads `ownerUid` from `businesses/{businessId}` (used only after `exists` check in `isBusinessOwner`).
- **`isBusinessOwner(businessId)`** — `request.auth != null`, business doc **exists**, and **`ownerUid == request.auth.uid`**.

No public or unauthenticated access was added.

### New rules: `teamSessions`

```text
match /businesses/{businessId}/teamSessions/{sessionId}
```

- **`read`**, **`create`**, **`update`**, **`delete`**: allowed only if **`isBusinessOwner(businessId)`**.

This matches how the Equipo module resolves the business today (`resolveBusinessForUser` → owner’s `businesses` document) and unblocks:

- Listening to sessions (`onSnapshot` on `teamSessions`)
- Creating a session when starting work (`addDoc`)
- Updating session on pause / resume / finalize (`updateDoc`)

### Refactors (same effective access)

Several subcollections already required **`ownerUid == request.auth.uid`**; they were switched to **`isBusinessOwner(businessId)`** for consistency and to avoid repeating `get(...)`:

- `leads` (read/update/delete; public **create** for leads unchanged)
- `jobs`, `campaigns`, `clients`, `teamMembers`, `teamSessions` (new)
- `conversations` + `messages`
- `orders`, `finance`, `calendar`, `internalChatHistory`

**Orders** and **finance** were already writable by the owner for full documents; the Team flow continues to update order fields such as **`workStatus`**, **`totalLaborHours`**, **`totalLaborCost`**, **`lastWorkedAt`**, and to **`create`** labor expenses under **`finance`**. No field-level subset was introduced (still owner-only, not public).

### Who is allowed

- **Authenticated user who owns the business** (`businesses/{businessId}.ownerUid == auth.uid`): full access above, including Team work control.

Staff accounts that are **not** the Firebase owner would need a **separate rules/product design** (e.g. custom claims or a dedicated membership model). That was **out of scope** for this fix; the regression was the **missing `teamSessions` path**.

## Frontend: clearer denial message

In **`equipo.js`**:

- **`handleEquipoFirestorePermissionDenied(context, err)`** detects **`permission-denied`** / “insufficient permissions” and:
  - logs **`[Equipo] Firestore permission denied (<context>): ...`**
  - shows **`Permiso denegado en Firestore para control de jornada`**

Used for: **`startWork`**, **`pauseWork`**, **`resumeWork`**, **`finalizeWork`**, subscriptions, list actions, member save/delete where relevant, and initial load.

## Files changed

| File | Change |
|------|--------|
| `firestore.rules` | `isBusinessOwner` helper; **`match /teamSessions/{sessionId}`**; refactor to helper on other business subcollections |
| `equipo.js` | Permission-denied detection + user-facing Spanish message |
| `docs/team_firestore_permissions_fix_report.md` | This report |

## Deploy

Rules must be published for production:

```bash
firebase deploy --only firestore:rules
```

(Static hosting for `equipo.html` / `equipo.js` still needs your usual hosting deploy if you serve from Firebase Hosting.)

## How Team can start work sessions now

1. User is **signed in** and **`resolveBusinessForUser`** returns a business whose **`ownerUid`** matches **`auth.uid`**.
2. Firestore allows **`update`** on the linked **`orders`** doc and **`create`** on **`teamSessions`**.
3. **`subscribeTeamSessions`** can **`read`** the `teamSessions` collection for that business.
4. **Iniciar trabajo** succeeds without **`permission-denied`** from the missing path.
