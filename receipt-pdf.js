/** @typedef {{ legalName: string, phone: string, email: string, logoUrl: string, addressLines: string[], brandRgb: number[], footerMessage: string, notesTerms: string, textLogo: string }} ReceiptPdfBiz */

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
  const u = url.trim();
  if (u.startsWith("data:image/png")) return { dataUrl: u, format: "PNG" };
  if (u.startsWith("data:image/jpeg") || u.startsWith("data:image/jpg")) return { dataUrl: u, format: "JPEG" };
  try {
    const res = await fetch(u, { mode: "cors" });
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
 * @param {import("jspdf").jsPDF} doc
 * @param {string} dataUrl
 * @param {"PNG"|"JPEG"} format
 * @param {number} maxW
 * @param {number} maxH
 */
function imageDrawSizeMm(doc, dataUrl, format, maxW, maxH) {
  try {
    const props = doc.getImageProperties(dataUrl);
    const pxToMm = 25.4 / 96;
    const iwMm = props.width * pxToMm;
    const ihMm = props.height * pxToMm;
    const scale = Math.min(maxW / iwMm, maxH / ihMm, 1);
    return { w: iwMm * scale, h: ihMm * scale, format };
  } catch {
    return { w: maxW, h: maxH * 0.6, format };
  }
}

/**
 * Client receipt: customer-facing fields only (no expenses, profit, or order status).
 * @param {Record<string, unknown> & { id?: string }} row
 * @param {ReceiptPdfBiz} biz
 */
export async function generateOrderReceiptPdf(row, biz) {
  const JsPDF = getJsPDF();
  const doc = new JsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 16;
  const contentW = pageW - margin * 2;
  const [r, g, b] = biz.brandRgb || [99, 102, 241];

  const headerH = 36;
  doc.setFillColor(248, 249, 252);
  doc.rect(0, 0, pageW, headerH, "F");
  doc.setDrawColor(r, g, b);
  doc.setLineWidth(0.35);
  doc.line(0, headerH, pageW, headerH);

  const logoMaxW = 40;
  const logoMaxH = 22;
  const logoX = margin;
  const logoY0 = 8;

  const logoImg = await tryLoadImageDataUrl(biz.logoUrl);
  let logoDrawn = false;
  if (logoImg) {
    try {
      const { w, h } = imageDrawSizeMm(doc, logoImg.dataUrl, logoImg.format, logoMaxW, logoMaxH);
      const yLogo = logoY0 + (logoMaxH - h) / 2;
      doc.addImage(logoImg.dataUrl, logoImg.format, logoX, yLogo, w, h);
      logoDrawn = true;
    } catch {
      logoDrawn = false;
    }
  }

  let headerTextX = margin + logoMaxW + 8;
  if (!logoDrawn) {
    const mono = 18;
    doc.setFillColor(r, g, b);
    doc.rect(logoX, logoY0 + 2, mono, mono, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    const initials = biz.textLogo || "YC";
    doc.text(initials, logoX + mono / 2, logoY0 + 2 + mono / 2 + 1, { align: "center" });
    headerTextX = margin + mono + 7;
  }

  doc.setTextColor(33, 37, 41);
  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.text(biz.legalName || "Negocio", headerTextX, 16);
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(80, 86, 96);
  const contactLine = [biz.phone ? `Tel: ${biz.phone}` : "", biz.email ? biz.email : ""].filter(Boolean).join("  ·  ");
  if (contactLine) doc.text(contactLine, headerTextX, 22);
  let addrY = 27;
  if (Array.isArray(biz.addressLines) && biz.addressLines.length) {
    biz.addressLines.slice(0, 3).forEach((line) => {
      doc.text(String(line), headerTextX, addrY);
      addrY += 4;
    });
  }

  let y = headerH + 12;
  doc.setTextColor(33, 37, 41);
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("Recibo", margin, y);
  y += 8;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  const issued = new Date();
  const receiptNo = row?.id ? String(row.id) : "—";
  doc.setTextColor(60, 60, 68);
  doc.text(`No. de recibo: ${receiptNo}`, margin, y);
  doc.text(`Emitido: ${issued.toLocaleString("es", { dateStyle: "medium", timeStyle: "short" })}`, pageW - margin, y, {
    align: "right",
  });
  y += 10;

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
  ];

  const pad = 5;
  const labelW = 46;
  const valueW = contentW - labelW - pad * 3;
  const rowHeights = pairs.map(([, value]) => {
    const wrapped = doc.splitTextToSize(value, valueW);
    return Math.max(7, 4 + wrapped.length * 4.8);
  });
  const boxPad = 6;
  const boxH = rowHeights.reduce((a, h) => a + h, 0) + boxPad * 2;
  const boxTop = y;

  doc.setFillColor(252, 252, 254);
  doc.rect(margin, boxTop, contentW, boxH, "F");
  doc.setDrawColor(230, 232, 240);
  doc.setLineWidth(0.2);
  doc.rect(margin, boxTop, contentW, boxH, "S");

  let ry = boxTop + boxPad;
  pairs.forEach(([label, value], i) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(70, 75, 85);
    doc.text(`${label}`, margin + pad, ry + 4);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(33, 37, 41);
    const wrapped = doc.splitTextToSize(value, valueW);
    wrapped.forEach((line, j) => {
      doc.text(line, margin + pad + labelW, ry + 4 + j * 4.8);
    });
    ry += rowHeights[i];
  });

  y = boxTop + boxH + 12;

  const trackLink = typeof row?.publicLink === "string" ? row.publicLink.trim() : "";
  if (trackLink) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(33, 37, 41);
    doc.text("Ver tu pedido en línea", margin, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(37, 99, 235);
    const urlLines = doc.splitTextToSize(trackLink, contentW);
    urlLines.forEach((line) => {
      if (y > 275) {
        doc.addPage();
        y = margin;
      }
      const lineY = y;
      doc.text(line, margin, lineY);
      const tw = doc.getTextWidth(line);
      doc.link(margin, lineY - 3.5, tw, 5, { url: trackLink });
      y += 4.2;
    });
    y += 6;
    doc.setTextColor(33, 37, 41);
  }

  doc.setDrawColor(220, 222, 230);
  doc.line(margin, y, pageW - margin, y);
  y += 7;

  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(110, 115, 125);
  const foot = biz.footerMessage || "";
  doc.splitTextToSize(foot, contentW).forEach((line) => {
    if (y > 278) {
      doc.addPage();
      y = margin;
    }
    doc.text(line, margin, y);
    y += 3.8;
  });

  if (biz.notesTerms && biz.notesTerms.trim()) {
    y += 4;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("Notas y términos", margin, y);
    y += 4;
    doc.setFont("helvetica", "normal");
    doc.splitTextToSize(biz.notesTerms.trim(), contentW).forEach((line) => {
      if (y > 278) {
        doc.addPage();
        y = margin;
      }
      doc.text(line, margin, y);
      y += 3.8;
    });
  }

  const safeName = receiptNo.replace(/[^\w.-]+/g, "_").slice(0, 48);
  doc.save(`recibo-${safeName || "pedido"}.pdf`);
}
