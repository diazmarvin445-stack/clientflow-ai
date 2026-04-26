# Chat Auth Context UID Fix

## Problema

En `chat.html` / `chat.js` aparecia el error:

`Cannot read properties of undefined (reading 'uid')`

La causa era inicializar flujo de chat sin garantizar primero el contexto de Auth + contexto de app.

## Ajuste aplicado

Archivo modificado: `chat.js`

### 1) Inicializacion de contexto solo despues de Auth

Se agrego `ensureChatAuthContext(user)` que:

- usa `resolveAppContext(user)` solamente cuando ya existe `user`
- define fallback para YourColor cuando falta contexto en URL/session:
  - `workspaceId = "yourcolor"`
  - `categoryId = "custom_apparel"`
- persiste ese contexto en URL con `ensureContextInUrl(...)`

### 2) Orden correcto en `onAuthStateChanged`

En la rama `if (user)` ahora:

1. resuelve contexto (`ensureChatAuthContext`)
2. guarda `panelChatUserIdCache` desde contexto validado
3. ejecuta `bootWithUser(user)` para iniciar Maya/Chat

En la rama sin usuario se mantiene redirección a `login.html`.

## Flujo final

- carga Firebase
- espera `onAuthStateChanged`
- si hay usuario:
  - obtiene `uid`
  - asegura `workspaceId/categoryId` (con fallback YourColor)
  - inicializa chat
- si no hay usuario:
  - redirige a login

## Resultado esperado

- YourColor Chat IA inicia sin error de `uid` undefined
- no se intenta construir contexto/rutas antes de tener usuario autenticado
- no se rompe el comportamiento de otros módulos
