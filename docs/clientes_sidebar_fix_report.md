# Clientes Sidebar Fix Report

## Problema detectado

El botón `Clientes` no aparecía de forma consistente en el sidebar porque había dos caminos de render:

- navegación estática en los `.html`
- navegación dinámica por categoría en `dash-shell.js` + `category-config.js`

Cuando el menú se re-renderizaba por categoría, `Clientes` no estaba definido en esa configuración y desaparecía.

## Correcciones implementadas

### 1) Menú por categoría

Archivo: `category-config.js`

- Se agregó el item:
  - `id: "clientes"`
  - `name: "Clientes"`
  - `href: "clientes.html"`
  - `icon: "team"`
- Posición: justo debajo de `Pedidos`.

### 2) Fallback universal del sidebar

Archivo: `dash-shell.js`

- Se creó `ensureClientesNavLink()` para garantizar que `Clientes` exista siempre.
- Reglas:
  - inserta `Clientes` si no existe
  - lo posiciona debajo de `Pedidos`
  - aplica estado activo según la ruta actual
- Se invoca en:
  - `initSidebar()`
  - `renderCategoryNav(...)` (después del render dinámico)

Con esto, aunque cambie la categoría o se rehidrate el menú, `Clientes` sigue visible.

### 3) Plantillas HTML con nav estático

Se agregó `Clientes` debajo de `Pedidos` en los sidebars estáticos de:

- `dashboard.html`
- `chat.html`
- `pedidos.html`
- `finanzas.html`
- `campanas.html`
- `equipo.html`
- `configuracion.html`
- `profile.html`
- `solicitudes.html`
- `calendario.html`
- `clientes.html` (ya tenía el enlace activo)

Esto asegura visibilidad incluso si por alguna razón no corre el renderer JS.

## Verificación de `clientes.html`

- Archivo existe: `clientes.html`
- Carga script módulo: `clientes.js`
- Sidebar incluye `Clientes` con estado activo en esta vista.

## Resultado final

El item `Clientes` ahora aparece de forma visible y consistente:

- debajo de `Pedidos`
- con estilo e iconografía del sistema
- enlazando a `clientes.html`
- independientemente de si hay clientes cargados o no
