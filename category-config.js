/**
 * Configuración de navegación por categoría de negocio (`businesses/{id}.category`).
 * Categorías no listadas aquí usan el menú universal definido en cada HTML + `ensureChatNavLink`.
 */

/** @typedef {{ id: string, name: string, href: string, icon: string }} CategoryMenuItem */

/** Clave en Firestore para YourColor (Custom Apparel). */
export const CATEGORY_CUSTOM_APPAREL = "Custom Apparel";

/**
 * @type {Record<string, { displayName: string, menuItems: CategoryMenuItem[] }>}
 */
export const CATEGORY_CONFIGS = {
  [CATEGORY_CUSTOM_APPAREL]: {
    displayName: "Custom Apparel",
    menuItems: [
      { id: "dashboard", name: "Dashboard", href: "dashboard.html", icon: "home" },
      { id: "chat", name: "Chat IA", href: "chat.html", icon: "chat" },
      { id: "calendario", name: "Calendario", href: "calendario.html", icon: "cal" },
      { id: "clientes", name: "Clientes", href: "clientes.html", icon: "users" },
      { id: "finanzas", name: "Finanzas", href: "finanzas.html", icon: "finance" },
      { id: "pedidos", name: "Pedidos", href: "dashboard.html#pedidos", icon: "orders" },
      { id: "campanas", name: "Campañas IA", href: "campanas.html", icon: "spark" },
      { id: "equipo", name: "Equipo", href: "equipo.html", icon: "team" },
      { id: "configuracion", name: "Configuración", href: "configuracion.html", icon: "gear" },
    ],
  },
  // "Carpentry": { displayName: "…", menuItems: [ … ] },
  // "Landscaping": { displayName: "…", menuItems: [ … ] },
};

/**
 * @param {unknown} category Value from `businesses/{id}.category`
 * @returns {CategoryMenuItem[] | null} null = usar menú universal del HTML
 */
export function getMenuItemsForCategory(category) {
  const k = String(category ?? "").trim();
  if (!k) return null;
  const cfg = CATEGORY_CONFIGS[k];
  if (!cfg || !Array.isArray(cfg.menuItems) || cfg.menuItems.length === 0) return null;
  return cfg.menuItems;
}
