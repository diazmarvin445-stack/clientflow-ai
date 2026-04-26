/**
 * Configuración de navegación por categoría de negocio (`businesses/{id}.category`).
 * Categorías no listadas aquí usan el menú universal definido en cada HTML + `ensureChatNavLink`.
 */

/** @typedef {{ id: string, name: string, href: string, icon: string }} CategoryMenuItem */

/** Clave en Firestore para YourColor (Custom Apparel). */
export const CATEGORY_CUSTOM_APPAREL = "custom_apparel";
export const CATEGORY_ROOFING_CONSTRUCTION = "roofing_construction";
export const CATEGORY_CONSTRUCTION = "construction";

/**
 * @type {Record<string, { displayName: string, menuItems: CategoryMenuItem[] }>}
 */
export const CATEGORY_CONFIGS = {
  [CATEGORY_CUSTOM_APPAREL]: {
    displayName: "Custom Apparel",
    menuItems: [
      { id: "dashboard", name: "Dashboard", href: "dashboard.html", icon: "home" },
      { id: "chat", name: "Chat IA", href: "chat.html", icon: "chat" },
      { id: "pedidos", name: "Pedidos", href: "pedidos.html", icon: "orders" },
      { id: "clientes", name: "Clientes", href: "clientes.html", icon: "team" },
      { id: "finanzas", name: "Finanzas", href: "finanzas.html", icon: "finance" },
      { id: "campanas", name: "Campañas IA", href: "campanas.html", icon: "spark" },
      { id: "equipo", name: "Equipo", href: "equipo.html", icon: "team" },
      { id: "diagnostico", name: "Diagnóstico", href: "diagnostico.html", icon: "gear" },
      { id: "configuracion", name: "Configuración", href: "configuracion.html", icon: "gear" },
    ],
  },
  [CATEGORY_ROOFING_CONSTRUCTION]: {
    displayName: "Roofing & Construction",
    menuItems: [
      { id: "dashboard", name: "Dashboard", href: "dashboard.html", icon: "home" },
      { id: "chat_campaigns", name: "Chat IA + Campañas IA", href: "chat.html#campaigns", icon: "chat" },
      { id: "clientes", name: "Clientes", href: "clientes.html", icon: "team" },
      { id: "trabajos", name: "Trabajos", href: "trabajos.html", icon: "orders" },
      { id: "finanzas", name: "Finanzas", href: "finanzas.html", icon: "finance" },
      { id: "equipo", name: "Equipo", href: "equipo.html", icon: "team" },
      { id: "configuracion", name: "Configuración", href: "configuracion.html", icon: "gear" },
    ],
  },
  [CATEGORY_CONSTRUCTION]: {
    displayName: "Construction CRM",
    menuItems: [
      { id: "dashboard", name: "Dashboard", href: "dashboard.html", icon: "home" },
      { id: "chat_campaigns", name: "Chat IA + Campañas IA", href: "chat.html#campaigns", icon: "chat" },
      { id: "clientes", name: "Clientes", href: "clientes.html", icon: "team" },
      { id: "trabajos", name: "Trabajos", href: "trabajos.html", icon: "orders" },
      { id: "finanzas", name: "Finanzas", href: "finanzas.html", icon: "finance" },
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
  const low = k.toLowerCase();
  const normalized =
    low === "construction_roofing"
      ? CATEGORY_ROOFING_CONSTRUCTION
      : low === "roofing"
        ? CATEGORY_ROOFING_CONSTRUCTION
        : low;
  const cfg = CATEGORY_CONFIGS[normalized];
  if (!cfg || !Array.isArray(cfg.menuItems) || cfg.menuItems.length === 0) return null;
  return cfg.menuItems;
}
