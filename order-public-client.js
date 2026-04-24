import { doc, setDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

export function generatePublicOrderIdClient() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("").toLowerCase();
}

/**
 * @param {string} origin
 * @param {string} publicOrderId
 */
export function buildPublicOrderPageLink(origin, publicOrderId) {
  const base = (origin || "").replace(/\/$/, "");
  const id = encodeURIComponent(publicOrderId);
  return `${base}/pedido.html?id=${id}`;
}

function derivePaymentStatus(total, balance, status) {
  const st = String(status || "").toLowerCase();
  if (st === "cancelado") return "cancelado";
  if (st === "entregado") return "completado";
  const t = Number(total) || 0;
  const bal = Math.max(0, Number(balance) || 0);
  if (t > 0 && bal <= 0.01) return "pagado";
  return "pendiente";
}

/**
 * Crea token + docs si el pedido aún no tiene enlace público (dueño autenticado).
 * @param {import("https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js").Firestore} db
 * @param {string} businessId
 * @param {Record<string, unknown> & { id: string }} row
 */
export async function ensurePublicOrderTrackingClient(db, businessId, row) {
  const link = typeof row.publicLink === "string" ? row.publicLink.trim() : "";
  const pid = typeof row.publicOrderId === "string" ? row.publicOrderId.trim() : "";
  if (link && pid) return { publicLink: link, publicOrderId: pid.toLowerCase() };

  const publicOrderId = generatePublicOrderIdClient();
  const publicLink = buildPublicOrderPageLink(window.location.origin, publicOrderId);

  const total = Math.max(0, Number(row.total ?? row.amount) || 0);
  const deposit = Math.max(0, Number(row.deposit) || 0);
  const balRaw = Number(row.balance);
  const balance = Number.isFinite(balRaw) ? Math.max(0, balRaw) : Math.max(0, total - deposit);

  await updateDoc(doc(db, "businesses", businessId, "orders", row.id), {
    publicOrderId,
    publicLink,
  });

  await setDoc(
    doc(db, "orderPublicViews", publicOrderId),
    {
      businessId,
      orderId: row.id,
      status: String(row.status || "nuevo"),
      clientName: String(row.clientName || "—"),
      product: String(row.product || "—"),
      quantity: Math.max(0, Number(row.quantity) || 0),
      total,
      deposit,
      balance,
      paymentStatus: derivePaymentStatus(total, balance, row.status),
      deliveryDate: row.deliveryDate ?? null,
      publicLink,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  return { publicLink, publicOrderId };
}
