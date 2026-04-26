import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import { RECEIPT_BUSINESS } from "./receipt-config.js";

export const RECEIPT_SETTINGS_DEFAULTS = Object.freeze({
  businessName: "YourColor Corporation",
  logoUrl: "",
  phone: RECEIPT_BUSINESS.phone,
  email: "",
  address: "Fort Pierce, FL\nEntrega a domicilio en la zona",
  footerMessage:
    "Documento informativo del pedido. Conserve este recibo para sus registros. Los montos reflejan el acuerdo comercial.",
  primaryColor: "#6366f1",
  notesTerms: "",
});

/**
 * @param {import("https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js").Firestore} db
 * @param {string} uid
 */
export function receiptSettingsDocRef(db, uid) {
  return doc(db, "users", uid, "yourcolor", "settings", "receipt");
}

/**
 * @param {string} hex
 * @returns {[number, number, number]}
 */
export function primaryColorToRgb(hex) {
  const s = String(hex || "").trim();
  const m = s.match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return [...RECEIPT_BUSINESS.brandRgb];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function textLogoFromName(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 3);
  }
  return String(name || "YC")
    .trim()
    .slice(0, 2)
    .toUpperCase() || "YC";
}

/**
 * Shape expected by {@link generateOrderReceiptPdf}.
 * @param {Record<string, unknown>} raw
 */
export function receiptSettingsToPdfBiz(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  const def = RECEIPT_SETTINGS_DEFAULTS;
  const businessName =
    typeof d.businessName === "string" && d.businessName.trim() ? d.businessName.trim() : def.businessName;
  const phone = typeof d.phone === "string" ? d.phone.trim() : def.phone;
  const email = typeof d.email === "string" ? d.email.trim() : "";
  const logoUrl = typeof d.logoUrl === "string" ? d.logoUrl.trim() : "";
  const addressRaw = typeof d.address === "string" && d.address.trim() ? d.address.trim() : def.address;
  const addressLines = addressRaw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const footerMessage =
    typeof d.footerMessage === "string" && d.footerMessage.trim()
      ? d.footerMessage.trim()
      : def.footerMessage;
  const notesTerms = typeof d.notesTerms === "string" ? d.notesTerms.trim() : def.notesTerms;
  const primaryColor = typeof d.primaryColor === "string" && d.primaryColor.trim() ? d.primaryColor.trim() : def.primaryColor;

  return {
    legalName: businessName,
    phone,
    email,
    logoUrl,
    addressLines: addressLines.length ? addressLines : def.address.split(/\r?\n/).filter(Boolean),
    brandRgb: primaryColorToRgb(primaryColor),
    footerMessage,
    notesTerms,
    textLogo: textLogoFromName(businessName),
  };
}

/**
 * @param {import("https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js").Firestore} db
 * @param {string} businessId
 */
export async function getReceiptPdfBusiness(db, businessId) {
  const snap = await getDoc(receiptSettingsDocRef(db, businessId));
  const raw = snap.exists() ? snap.data() : {};
  return receiptSettingsToPdfBiz({ ...RECEIPT_SETTINGS_DEFAULTS, ...raw });
}

/**
 * Valores para el formulario de Configuración.
 * @param {import("https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js").Firestore} db
 * @param {string} businessId
 */
export async function loadReceiptSettingsForForm(db, businessId) {
  const snap = await getDoc(receiptSettingsDocRef(db, businessId));
  const raw = snap.exists() ? snap.data() : {};
  /** @type {Record<string, string>} */
  const out = { ...RECEIPT_SETTINGS_DEFAULTS };
  for (const key of Object.keys(RECEIPT_SETTINGS_DEFAULTS)) {
    if (Object.prototype.hasOwnProperty.call(raw, key) && raw[key] != null) {
      const v = raw[key];
      if (typeof v === "string") out[key] = v;
      else if (typeof v === "number" || typeof v === "boolean") out[key] = String(v);
    }
  }
  return out;
}
