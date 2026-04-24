import { db } from "./firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

function money(n) {
  const v = Number(n) || 0;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function toDate(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();
  if (v instanceof Date) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function statusLabel(status) {
  const s = String(status || "").toLowerCase();
  const map = {
    entregado: "Entregado",
    cancelado: "Cancelado",
    nuevo: "Nuevo",
    en_preparacion: "En preparación",
    produccion: "Producción",
    listo: "Listo",
  };
  return map[s] || s || "—";
}

function paymentLabel(ps, balance, total) {
  const p = String(ps || "").toLowerCase();
  if (p === "cancelado") return "Pedido cancelado";
  if (p === "completado") return "Entregado — pago completado";
  if (p === "pagado") return "Saldo liquidado";
  const bal = Number(balance) || 0;
  const t = Number(total) || 0;
  if (t > 0 && bal > 0.01) return `Pendiente: ${money(bal)} por pagar`;
  if (t > 0) return "Al día según monto registrado";
  return "—";
}

function showError(msg) {
  const el = document.getElementById("pub-order-error");
  const load = document.getElementById("pub-order-loading");
  const card = document.getElementById("pub-order-card");
  if (load) load.hidden = true;
  if (card) card.hidden = true;
  if (el) {
    el.textContent = msg;
    el.hidden = false;
  }
}

async function boot() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  if (!id || !/^[a-f0-9]{32}$/i.test(id.trim())) {
    showError("Enlace no válido. Revisa el enlace que te enviaron.");
    return;
  }

  const token = id.trim().toLowerCase();
  const load = document.getElementById("pub-order-loading");
  const card = document.getElementById("pub-order-card");

  try {
    const snap = await getDoc(doc(db, "orderPublicViews", token));
    if (!snap.exists()) {
      showError("No encontramos este pedido. Puede que el enlace haya expirado o sea incorrecto.");
      return;
    }
    const v = snap.data();
    if (load) load.hidden = true;
    if (card) card.hidden = false;

    document.getElementById("pub-order-status").textContent = statusLabel(v.status);
    document.getElementById("pub-order-client").textContent = v.clientName || "—";
    document.getElementById("pub-order-product").textContent = v.product || "—";
    document.getElementById("pub-order-qty").textContent =
      v.quantity != null && v.quantity !== "" ? String(v.quantity) : "—";
    document.getElementById("pub-order-total").textContent = money(v.total);
    document.getElementById("pub-order-payment").textContent = paymentLabel(
      v.paymentStatus,
      v.balance,
      v.total,
    );
    const dd = toDate(v.deliveryDate);
    document.getElementById("pub-order-delivery").textContent = dd
      ? dd.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
      : "—";
  } catch (e) {
    console.error(e);
    showError("No se pudo cargar la información. Intenta más tarde.");
  }
}

boot();
