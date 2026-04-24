import { randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";

/** Origen público por defecto (Firebase Hosting). Sobrescribible vía opts.origin. */
export const DEFAULT_PUBLIC_ORDER_ORIGIN = "https://clientflow-ai-7eb08.web.app";

export function generatePublicOrderId() {
  return randomBytes(16).toString("hex");
}

/**
 * @param {string} origin
 * @param {string} publicOrderId
 */
export function buildPublicOrderLink(origin, publicOrderId) {
  const base = (origin || DEFAULT_PUBLIC_ORDER_ORIGIN).replace(/\/$/, "");
  const id = encodeURIComponent(publicOrderId);
  return `${base}/pedido.html?id=${id}`;
}

/**
 * @param {number} total
 * @param {number} balance
 * @param {unknown} status
 */
export function derivePaymentStatus(total, balance, status) {
  const st = String(status || "").toLowerCase();
  if (st === "cancelado") return "cancelado";
  if (st === "entregado") return "completado";
  const t = Number(total) || 0;
  const bal = Math.max(0, Number(balance) || 0);
  if (t > 0 && bal <= 0.01) return "pagado";
  return "pendiente";
}

/**
 * Sincroniza `orderPublicViews/{publicOrderId}` y campos `publicOrderId` + `publicLink` en el pedido.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} businessId
 * @param {string} orderId
 * @param {Record<string, unknown>} orderData
 * @param {{ origin?: string }} [opts]
 */
export async function syncOrderPublicView(db, businessId, orderId, orderData, opts = {}) {
  const data = orderData && typeof orderData === "object" ? orderData : {};
  const existing =
    typeof data.publicOrderId === "string" && /^[a-f0-9]{32}$/i.test(data.publicOrderId.trim())
      ? data.publicOrderId.trim().toLowerCase()
      : generatePublicOrderId().toLowerCase();
  const publicOrderId = existing;
  const origin = opts.origin || process.env.PUBLIC_ORDER_PAGE_ORIGIN || DEFAULT_PUBLIC_ORDER_ORIGIN;
  const publicLink = buildPublicOrderLink(origin, publicOrderId);

  const total = Math.max(0, Number(data.total ?? data.amount) || 0);
  const deposit = Math.max(0, Number(data.deposit) || 0);
  const balanceRaw = Number(data.balance);
  const balance = Number.isFinite(balanceRaw) ? Math.max(0, balanceRaw) : Math.max(0, total - deposit);

  const orderRef = db.collection("businesses").doc(businessId).collection("orders").doc(orderId);
  await orderRef.set(
    {
      publicOrderId,
      publicLink,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  const viewRef = db.collection("orderPublicViews").doc(publicOrderId);
  await viewRef.set(
    {
      businessId,
      orderId,
      status: String(data.status || "nuevo"),
      clientName: String(data.clientName || "—"),
      product: String(data.product || "—"),
      quantity: Math.max(0, Number(data.quantity) || 0),
      total,
      deposit,
      balance,
      paymentStatus: derivePaymentStatus(total, balance, data.status),
      deliveryDate: data.deliveryDate ?? null,
      publicLink,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return { publicOrderId, publicLink };
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} publicOrderId
 */
export async function deleteOrderPublicView(db, publicOrderId) {
  const id = typeof publicOrderId === "string" ? publicOrderId.trim() : "";
  if (!id || !/^[a-f0-9]{32}$/i.test(id)) return;
  await db.collection("orderPublicViews").doc(id.toLowerCase()).delete();
}
