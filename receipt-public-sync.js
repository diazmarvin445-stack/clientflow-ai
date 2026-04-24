import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

/**
 * Public receipt snapshot (no internal P&L). Doc id = businessId + "__" + orderId.
 * @param {string} businessId
 * @param {string} orderId
 */
export function receiptPublicDocId(businessId, orderId) {
  const b = String(businessId || "").trim();
  const o = String(orderId || "").trim();
  if (!b || !o) return "";
  return `${b}__${o}`;
}

/**
 * @param {import("https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js").Firestore} db
 * @param {string} businessId
 * @param {string} orderId
 */
export function receiptPublicDocRef(db, businessId, orderId) {
  const id = receiptPublicDocId(businessId, orderId);
  if (!id) throw new Error("receiptPublic id inválido");
  return doc(db, "receiptPublic", id);
}

/**
 * @param {Record<string, unknown> & { id?: string }} row
 */
function getOrderTotal(row) {
  return Math.max(0, Number(row?.total ?? row?.amount) || 0);
}

/**
 * Customer-safe payload for `receiptPublic` (must match Firestore rules).
 * @param {string} businessId
 * @param {Record<string, unknown> & { id?: string }} row
 * @param {Record<string, unknown>} biz from getReceiptPdfBusiness
 */
export function buildReceiptPublicPayload(businessId, row, biz) {
  const total = getOrderTotal(row);
  const deposit = Math.max(0, Number(row?.deposit) || 0);
  const balRaw = Number(row?.balance);
  const balance = Number.isFinite(balRaw) ? Math.max(0, balRaw) : Math.max(0, total - deposit);
  const rgb = Array.isArray(biz.brandRgb) && biz.brandRgb.length >= 3 ? biz.brandRgb : [99, 102, 241];
  const addressLines = Array.isArray(biz.addressLines) ? biz.addressLines.filter(Boolean) : [];
  return {
    businessId,
    orderId: row.id,
    legalName: biz.legalName || "",
    phone: biz.phone || "",
    email: biz.email || "",
    logoUrl: biz.logoUrl || "",
    addressLines,
    footerMessage: biz.footerMessage || "",
    notesTerms: biz.notesTerms || "",
    textLogo: biz.textLogo || "YC",
    brandRgb: [Number(rgb[0]) || 0, Number(rgb[1]) || 0, Number(rgb[2]) || 0],
    clientName: row.clientName != null ? String(row.clientName) : "",
    clientPhone: row.clientPhone != null ? String(row.clientPhone) : "",
    product: row.product != null ? String(row.product) : "",
    quantity: row.quantity != null && row.quantity !== "" ? String(row.quantity) : "",
    total,
    amount: Math.max(0, Number(row?.amount) || total),
    deposit,
    balance,
    deliveryDate: row.deliveryDate ?? null,
    status: row.status != null ? String(row.status) : "nuevo",
  };
}

/**
 * Upsert public receipt snapshot (owner only; rules enforce).
 * @param {import("https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js").Firestore} db
 * @param {string} businessId
 * @param {Record<string, unknown> & { id?: string }} row
 * @param {Record<string, unknown>} biz from getReceiptPdfBusiness
 */
export async function syncReceiptPublicSnapshot(db, businessId, row, biz) {
  if (!businessId || !row?.id) return;
  const payload = buildReceiptPublicPayload(businessId, row, biz);
  const ref = receiptPublicDocRef(db, businessId, String(row.id));
  await setDoc(ref, { ...payload, updatedAt: serverTimestamp() });
}
