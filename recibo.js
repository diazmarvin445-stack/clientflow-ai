import { db } from "./firebase.js";
import {
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import { generateOrderReceiptPdf } from "./receipt-pdf.js";
import { receiptStatusLabel, RECEIPT_BUSINESS } from "./receipt-config.js";

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

function getOrderTotalFromPublic(d) {
  return Math.max(0, Number(d?.total) || 0);
}

/**
 * @param {Record<string, unknown>} d
 */
function publicDocToOrderRow(d) {
  const oid = typeof d.orderId === "string" ? d.orderId : "";
  return {
    id: oid,
    clientName: d.clientName,
    clientPhone: d.clientPhone,
    product: d.product,
    quantity: d.quantity,
    total: d.total,
    amount: d.total,
    deposit: d.deposit,
    balance: d.balance,
    deliveryDate: d.deliveryDate,
    status: d.status,
  };
}

/**
 * @param {Record<string, unknown>} d
 */
function publicDocToPdfBiz(d) {
  const legalName =
    typeof d.businessName === "string" && d.businessName.trim() ? d.businessName.trim() : "YourColor Corporation";
  return {
    legalName,
    phone: typeof d.phone === "string" ? d.phone.trim() : "",
    email: "",
    logoUrl: typeof d.logoUrl === "string" ? d.logoUrl.trim() : "",
    addressLines: [...RECEIPT_BUSINESS.addressLines],
    brandRgb: [...RECEIPT_BUSINESS.brandRgb],
    footerMessage: "",
    notesTerms: "",
    textLogo: textLogoFromName(legalName),
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
  const biz = publicDocToPdfBiz(d);
  const nameEl = document.getElementById("recibo-business-name");
  const contactEl = document.getElementById("recibo-contact");
  const addrEl = document.getElementById("recibo-address");
  const logoWrap = document.getElementById("recibo-logo-wrap");
  const orderDl = document.getElementById("recibo-order-lines");
  const payDl = document.getElementById("recibo-payment-lines");
  const docEl = document.getElementById("recibo-doc");

  if (nameEl) nameEl.textContent = biz.legalName;
  if (contactEl) {
    const bits = [biz.phone ? `Tel: ${biz.phone}` : ""].filter(Boolean);
    contactEl.textContent = bits.length ? bits.join(" · ") : "—";
  }
  if (addrEl) {
    addrEl.innerHTML = "";
    if (biz.addressLines.length) {
      biz.addressLines.forEach((line) => {
        const p = document.createElement("p");
        p.className = "orders-receipt-meta receipt-business-line";
        p.textContent = line;
        addrEl.appendChild(p);
      });
    } else {
      const p = document.createElement("p");
      p.className = "orders-receipt-meta receipt-business-line";
      p.textContent = "—";
      addrEl.appendChild(p);
    }
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
    ["No. de pedido", typeof d.orderId === "string" ? d.orderId : "—"],
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
      const row = publicDocToOrderRow(d);
      const pdfBiz = publicDocToPdfBiz(d);
      try {
        await generateOrderReceiptPdf(row, pdfBiz);
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
  const uid = (params.get("uid") || "").trim();
  const receiptId = (params.get("id") || "").trim();

  if (!uid) {
    if (statusEl) statusEl.textContent = "Falta el identificador del comercio en el enlace (uid).";
    return;
  }

  if (!receiptId) {
    if (statusEl) statusEl.textContent = "Falta el identificador del recibo en el enlace (id).";
    return;
  }

  if (statusEl) statusEl.textContent = "Cargando recibo…";

  try {
    const ref = doc(db, "users", uid, "yourcolor", "main", "publicReceipts", receiptId);
    const docSnap = await getDoc(ref);
    if (!docSnap.exists()) {
      if (statusEl) {
        statusEl.textContent =
          "Este recibo no está disponible. Pide al comercio que abra el recibo en el panel o pulse Compartir.";
      }
      return;
    }
    const d = docSnap.data() || {};
    if (typeof d.receiptId === "string" && d.receiptId.trim() && d.receiptId.trim() !== receiptId) {
      if (statusEl) statusEl.textContent = "Recibo no válido.";
      return;
    }
    if (statusEl) statusEl.textContent = "";
    renderReceipt(d);
  } catch (e) {
    console.error(e);
    if (statusEl) statusEl.textContent = "No se pudo cargar el recibo. Comprueba tu conexión.";
  }
}

boot();
