import { db } from "./firebase.js";
import { getDoc } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import { generateOrderReceiptPdf } from "./receipt-pdf.js";
import { receiptPublicDocId, receiptPublicDocRef } from "./receipt-public-sync.js";
import { receiptStatusLabel } from "./receipt-config.js";

function money(v) {
  const n = Number(v) || 0;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function toDate(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();
  if (v instanceof Date) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getOrderTotalFromPublic(d) {
  return Math.max(0, Number(d?.total ?? d?.amount) || 0);
}

/**
 * @param {Record<string, unknown>} d
 */
function publicSnapToOrderRow(d) {
  const id = typeof d.orderId === "string" ? d.orderId : "";
  return {
    id,
    clientName: d.clientName,
    clientPhone: d.clientPhone,
    product: d.product,
    quantity: d.quantity,
    total: d.total,
    amount: d.amount,
    deposit: d.deposit,
    balance: d.balance,
    deliveryDate: d.deliveryDate,
    status: d.status,
  };
}

/**
 * @param {Record<string, unknown>} d
 */
function publicSnapToPdfBiz(d) {
  const rgb = Array.isArray(d.brandRgb) && d.brandRgb.length >= 3 ? d.brandRgb : [99, 102, 241];
  const lines = Array.isArray(d.addressLines) ? d.addressLines.filter((x) => typeof x === "string" && x.trim()) : [];
  return {
    legalName: typeof d.legalName === "string" && d.legalName.trim() ? d.legalName.trim() : "YourColor Corporation",
    phone: typeof d.phone === "string" ? d.phone.trim() : "",
    email: typeof d.email === "string" ? d.email.trim() : "",
    logoUrl: typeof d.logoUrl === "string" ? d.logoUrl.trim() : "",
    addressLines: lines.length ? lines : ["—"],
    brandRgb: [Number(rgb[0]) || 0, Number(rgb[1]) || 0, Number(rgb[2]) || 0],
    footerMessage: typeof d.footerMessage === "string" ? d.footerMessage.trim() : "",
    notesTerms: typeof d.notesTerms === "string" ? d.notesTerms.trim() : "",
    textLogo: typeof d.textLogo === "string" && d.textLogo.trim() ? d.textLogo.trim() : "YC",
  };
}

function appendDlRows(dl, pairs) {
  if (!dl) return;
  dl.innerHTML = "";
  pairs.forEach(([dt, dd]) => {
    const rowEl = document.createElement("div");
    rowEl.className = "orders-receipt-dl__row";
    const dtt = document.createElement("dt");
    dtt.textContent = dt;
    const ddd = document.createElement("dd");
    ddd.textContent = dd;
    rowEl.appendChild(dtt);
    rowEl.appendChild(ddd);
    dl.appendChild(rowEl);
  });
}

function renderReceipt(d) {
  const biz = publicSnapToPdfBiz(d);
  const nameEl = document.getElementById("recibo-business-name");
  const contactEl = document.getElementById("recibo-contact");
  const addrEl = document.getElementById("recibo-address");
  const logoWrap = document.getElementById("recibo-logo-wrap");
  const orderDl = document.getElementById("recibo-order-lines");
  const payDl = document.getElementById("recibo-payment-lines");
  const docEl = document.getElementById("recibo-doc");

  if (nameEl) nameEl.textContent = biz.legalName;
  if (contactEl) {
    const bits = [biz.phone ? `Tel: ${biz.phone}` : "", biz.email ? biz.email : ""].filter(Boolean);
    contactEl.textContent = bits.length ? bits.join(" · ") : "—";
  }
  if (addrEl) {
    const raw = Array.isArray(d.addressLines) ? d.addressLines.filter((x) => typeof x === "string" && x.trim()) : [];
    addrEl.textContent = raw.length ? raw.join("\n") : "—";
  }

  if (logoWrap) {
    logoWrap.innerHTML = "";
    const url = biz.logoUrl;
    if (url) {
      logoWrap.hidden = false;
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      img.className = "orders-receipt-logo";
      img.referrerPolicy = "no-referrer";
      img.onerror = () => {
        logoWrap.hidden = true;
      };
      logoWrap.appendChild(img);
    } else {
      logoWrap.hidden = true;
    }
  }

  const total = getOrderTotalFromPublic(d);
  const deposit = Math.max(0, Number(d.deposit) || 0);
  const balRaw = Number(d.balance);
  const balance = Number.isFinite(balRaw) ? Math.max(0, balRaw) : Math.max(0, total - deposit);

  appendDlRows(orderDl, [
    ["No. de recibo", typeof d.orderId === "string" ? d.orderId : "—"],
    ["Cliente", d.clientName != null ? String(d.clientName) : "—"],
    ["Teléfono", d.clientPhone != null ? String(d.clientPhone) : "—"],
    ["Producto", d.product != null ? String(d.product) : "—"],
    ["Cantidad", d.quantity != null && d.quantity !== "" ? String(d.quantity) : "—"],
    ["Entrega", toDate(d.deliveryDate)?.toLocaleDateString("es") || "—"],
    ["Estado", receiptStatusLabel(d.status)],
  ]);

  appendDlRows(payDl, [
    ["Total", money(total)],
    ["Depósito", money(deposit)],
    ["Saldo", money(balance)],
  ]);

  if (docEl) docEl.hidden = false;

  const pdfBtn = document.getElementById("recibo-download-pdf");
  if (pdfBtn) {
    pdfBtn.onclick = async () => {
      const row = publicSnapToOrderRow(d);
      const biz = publicSnapToPdfBiz(d);
      try {
        await generateOrderReceiptPdf(row, biz);
      } catch (e) {
        console.error(e);
        window.alert("No se pudo generar el PDF. Inténtalo de nuevo.");
      }
    };
  }
}

async function boot() {
  const statusEl = document.getElementById("recibo-status");
  const params = new URLSearchParams(window.location.search);
  const orderId = (params.get("id") || "").trim();
  const businessId = (params.get("b") || "").trim();

  if (!orderId) {
    if (statusEl) statusEl.textContent = "Falta el número de recibo en el enlace (id).";
    return;
  }
  if (!businessId) {
    if (statusEl) statusEl.textContent = "Enlace incompleto. Usa el enlace compartido desde Pedidos.";
    return;
  }

  const expected = receiptPublicDocId(businessId, orderId);
  if (!expected) {
    if (statusEl) statusEl.textContent = "Enlace no válido.";
    return;
  }

  if (statusEl) statusEl.textContent = "Cargando recibo…";

  try {
    const ref = receiptPublicDocRef(db, businessId, orderId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      if (statusEl) {
        statusEl.textContent =
          "Este recibo no está disponible aún. Pide al comercio que abra el recibo en el panel o pulse Compartir.";
      }
      return;
    }
    const d = snap.data() || {};
    if (statusEl) statusEl.textContent = "";
    renderReceipt(d);
  } catch (e) {
    console.error(e);
    if (statusEl) statusEl.textContent = "No se pudo cargar el recibo. Comprueba tu conexión.";
  }
}

boot();
