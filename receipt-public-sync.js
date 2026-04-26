import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import { CLIENT_PUBLIC_WEBSITE_URL } from "./receipt-config.js";

/**
 * @returns {string}
 */
function newReceiptId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * @param {Record<string, unknown> & { id?: string }} row
 */
function getOrderTotal(row) {
  return Math.max(0, Number(row?.total ?? row?.amount) || 0);
}

/**
 * Customer-safe fields only (no expenses, profit, labor, internal notes).
 * @param {string} receiptId document id under publicReceipts
 * @param {Record<string, unknown> & { id?: string }} row
 * @param {Record<string, unknown>} biz from getReceiptPdfBusiness
 */
export function buildPublicReceiptPayload(receiptId, row, biz) {
  const total = getOrderTotal(row);
  const deposit = Math.max(0, Number(row?.deposit) || 0);
  const balRaw = Number(row?.balance);
  const balance = Number.isFinite(balRaw) ? Math.max(0, balRaw) : Math.max(0, total - deposit);
  const businessName =
    typeof biz.legalName === "string" && biz.legalName.trim() ? biz.legalName.trim() : "YourColor Corporation";
  return {
    receiptId,
    orderId: String(row.id),
    businessName,
    logoUrl: typeof biz.logoUrl === "string" ? biz.logoUrl.trim() : "",
    phone: typeof biz.phone === "string" ? biz.phone.trim() : "",
    website: CLIENT_PUBLIC_WEBSITE_URL,
    clientName: row.clientName != null ? String(row.clientName) : "",
    clientPhone: row.clientPhone != null ? String(row.clientPhone) : "",
    product: row.product != null ? String(row.product) : "",
    quantity: row.quantity != null && row.quantity !== "" ? String(row.quantity) : "",
    total,
    deposit,
    balance,
    deliveryDate: row.deliveryDate ?? null,
    status: row.status != null ? String(row.status) : "nuevo",
  };
}

/**
 * Create/update `users/{uid}/yourcolor/publicReceipts/{receiptId}` and persist `publicReceiptId` on the order once.
 * @param {import("https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js").Firestore} db
 * @param {string} uid
 * @param {Record<string, unknown> & { id?: string }} row
 * @param {Record<string, unknown>} biz from getReceiptPdfBusiness
 * @returns {Promise<{ receiptId: string }>}
 */
export async function ensurePublicReceiptDocument(db, uid, row, biz) {
  if (!uid || !row?.id) throw new Error("Falta uid o pedido.");
  const orderId = String(row.id);
  const existing =
    typeof row.publicReceiptId === "string" && row.publicReceiptId.trim() ? row.publicReceiptId.trim() : "";
  const receiptId = existing || newReceiptId();
  const ref = doc(db, "users", uid, "yourcolor", "publicReceipts", receiptId);
  const prev = await getDoc(ref);
  const payload = buildPublicReceiptPayload(receiptId, row, biz);

  if (!prev.exists()) {
    await setDoc(ref, { ...payload, receiptId, createdAt: serverTimestamp() });
  } else {
    await setDoc(ref, { ...payload, receiptId }, { merge: true });
  }

  if (!existing) {
    await updateDoc(doc(db, "users", uid, "yourcolor", "orders", orderId), { publicReceiptId: receiptId });
  }

  return { receiptId };
}
