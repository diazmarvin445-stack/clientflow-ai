import { receiptStatusLabel } from "./receipt-config.js";

/** Loaded via UMD script in pedidos.html (GitHub Pages: no npm/babel). */
function getJsPDF() {
  const ns = globalThis.jspdf;
  if (!ns || typeof ns.jsPDF !== "function") {
    throw new Error("jsPDF no está disponible. Cargue jspdf.umd.min.js antes del módulo pedidos.js.");
  }
  return ns.jsPDF;
}

function moneyPdf(v) {
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

function getOrderTotal(row) {
  return Math.max(0, Number(row?.total ?? row?.amount) || 0);
}

/**
 * @param {string} url
 * @returns {Promise<{ dataUrl: string, format: "PNG" | "JPEG" } | null>}
 */
async function tryLoadImageDataUrl(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) return null;
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(typeof r.result === "string" ? r.result : null);
      r.onerror = () => reject(new Error("read"));
      r.readAsDataURL(blob);
    });
    if (!dataUrl) return null;
    if (dataUrl.startsWith("data:image/png")) return { dataUrl, format: "PNG" };
    if (dataUrl.startsWith("data:image/jpeg") || dataUrl.startsWith("data:image/jpg")) return { dataUrl, format: "JPEG" };
    return null;
  } catch {
    return null;
  }
}

/**
 * Client receipt only: no internal expenses or profit.
 * @param {Record<string, unknown> & { id?: string }} row
 * @param {typeof import("./receipt-config.js").RECEIPT_BUSINESS} biz
 */
export async function generateOrderReceiptPdf(row, biz) {
  const JsPDF = getJsPDF();
  const doc = new JsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 18;
  let y = margin;

  const [r, g, b] = biz.brandRgb || [99, 102, 241];
  doc.setFillColor(r, g, b);
  doc.rect(0, 0, pageW, 28, "F");

  const logoImg = await tryLoadImageDataUrl(biz.logoUrl);
  let headerTextX = margin;
  if (logoImg) {
    try {
      doc.addImage(logoImg.dataUrl, logoImg.format, margin, 6, 18, 18);
      headerTextX = margin + 22;
    } catch {
      headerTextX = margin;
    }
  }
  if (headerTextX === margin) {
    doc.setFillColor(255, 255, 255);
    doc.rect(margin, 7, 16, 16, "F");
    doc.setTextColor(r, g, b);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("YC", margin + 5.2, 17.5);
  }

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(biz.legalName || "YourColor Corporation", headerTextX, 14);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  const contactBits = [biz.phone ? `Tel: ${biz.phone}` : "", biz.email ? `Email: ${biz.email}` : ""].filter(Boolean);
  if (contactBits.length) {
    doc.text(contactBits.join(" · "), headerTextX, 21);
  }
  y = 36;
  doc.setTextColor(33, 37, 41);
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text("Recibo", margin, y);
  y += 10;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  const issued = new Date();
  const receiptNo = row?.id ? String(row.id) : "—";
  doc.text(`No. de recibo: ${receiptNo}`, margin, y);
  doc.text(`Emitido: ${issued.toLocaleString("es", { dateStyle: "medium", timeStyle: "short" })}`, pageW - margin, y, {
    align: "right",
  });
  y += 8;

  if (Array.isArray(biz.addressLines) && biz.addressLines.length) {
    doc.setFontSize(9);
    doc.setTextColor(80, 80, 90);
    biz.addressLines.forEach((line) => {
      if (line) {
        doc.text(String(line), margin, y);
        y += 4.5;
      }
    });
    doc.setTextColor(33, 37, 41);
    y += 4;
  }

  const total = getOrderTotal(row);
  const deposit = Math.max(0, Number(row?.deposit) || 0);
  const balStored = Number(row?.balance);
  const balance = Number.isFinite(balStored) ? Math.max(0, balStored) : Math.max(0, total - deposit);
  const delivery = toDate(row?.deliveryDate);
  const deliveryStr = delivery ? delivery.toLocaleDateString("es") : "—";

  /** @type {Array<[string, string]>} */
  const pairs = [
    ["Cliente", row?.clientName ? String(row.clientName) : "—"],
    ["Teléfono", row?.clientPhone ? String(row.clientPhone) : "—"],
    ["Producto", row?.product ? String(row.product) : "—"],
    ["Cantidad", row?.quantity != null && row.quantity !== "" ? String(row.quantity) : "—"],
    ["Total", moneyPdf(total)],
    ["Depósito", moneyPdf(deposit)],
    ["Saldo", moneyPdf(balance)],
    ["Fecha de entrega", deliveryStr],
    ["Estado del pedido", receiptStatusLabel(row?.status)],
  ];

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Detalle del pedido", margin, y);
  y += 7;

  const labelW = 52;
  const valueW = pageW - margin * 2 - labelW;
  doc.setFontSize(10);
  pairs.forEach(([label, value]) => {
    doc.setFont("helvetica", "bold");
    doc.text(`${label}:`, margin, y);
    doc.setFont("helvetica", "normal");
    const wrapped = doc.splitTextToSize(value, valueW);
    wrapped.forEach((line, i) => {
      doc.text(line, margin + labelW, y + i * 5);
    });
    y += Math.max(5, wrapped.length * 5) + 3;
    if (y > 270) {
      doc.addPage();
      y = margin;
    }
  });

  y += 6;
  doc.setDrawColor(220, 220, 230);
  doc.line(margin, y, pageW - margin, y);
  y += 8;
  doc.setFontSize(8.5);
  doc.setTextColor(120, 120, 130);
  const foot =
    "Documento informativo del pedido. Conserve este recibo para sus registros. " +
    "Los montos reflejan el acuerdo comercial; no incluye información interna de costos.";
  const footLines = doc.splitTextToSize(foot, pageW - margin * 2);
  footLines.forEach((line) => {
    doc.text(line, margin, y);
    y += 4;
  });

  const safeName = receiptNo.replace(/[^\w.-]+/g, "_").slice(0, 48);
  doc.save(`recibo-${safeName || "pedido"}.pdf`);
}
