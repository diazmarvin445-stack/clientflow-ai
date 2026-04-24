/** Sitio oficial mostrado en recibos (enlace fijo para clientes). */
export const CLIENT_PUBLIC_WEBSITE_URL = "https://your-color.com";

/**
 * Branding and contact data for client-facing receipts (recibos).
 * Edit here so all PDF receipts stay consistent.
 */
export const RECEIPT_BUSINESS = {
  /** Legal / display name on the receipt header */
  legalName: "YourColor Corporation",
  phone: "772-212-3882",
  /** Set when you have a public inbox; omitted on the PDF if empty */
  email: "",
  /** Shown under the business name (street, city, etc.) */
  addressLines: ["Fort Pierce, FL", "Entrega a domicilio en la zona"],
  /**
   * Optional: URL to a PNG or JPEG logo (same origin or CORS-enabled).
   * If empty or load fails, a simple monogram block is drawn instead.
   */
  logoUrl: "",
  /** RGB accent for header bar (matches app indigo) */
  brandRgb: [99, 102, 241],
};

const STATUS_LABELS = {
  entregado: "Entregado",
  cancelado: "Cancelado",
  nuevo: "Nuevo",
  en_preparacion: "En preparación",
  produccion: "Producción",
  listo: "Listo",
};

/**
 * @param {string | undefined} status
 */
export function receiptStatusLabel(status) {
  const key = String(status || "nuevo").toLowerCase();
  return STATUS_LABELS[key] || "Pendiente";
}
