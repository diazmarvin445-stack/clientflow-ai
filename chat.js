import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import {
  resolveBusinessForUser,
  fetchJobsSplitForChat,
  fetchOrdersSplitForChat,
  fetchClientsForChatContext,
  fetchCampaignsListAndStats,
  fetchFinanceTransactionsCurrentMonth,
  fetchCalendarEventsForChat,
  formatBusinessMeta,
  financeIncomeCountsTowardRealized,
  initialsFromName,
} from "./dashboard-data.js";
import { initDashShell } from "./dash-shell.js";
import { YOURCOLOR_BUSINESS, calculateOrderTotal } from "./yourcolor-config.js";

/** Misma región/proyecto que `generateCampaign`; tras `firebase deploy --only functions` verifica la URL en consola. */
const CHAT_WITH_AI_URL = "https://chatwithai-5laxqi2i4q-uc.a.run.app";

/** Bienvenida estática (sin llamada a API — ahorro de tokens y respuesta instantánea). */
const MAYA_WELCOME_STATIC = "Hola Marvin 👋";

/** Últimos turnos enviados a Claude (memoria reciente; calidad de conversación). */
const MAX_API_MESSAGES = 20;
/** Máximo de turnos guardados en memoria local y en Firestore (historial del panel). */
const MAX_CHAT_MEMORY = 80;
const DELIVERY_DAYS_OFFSET = 12;

let panelChatUserIdCache = "";

/** @type {{ role: 'user' | 'assistant', content: string }[]} */
let apiConversation = [];

/** @type {Record<string, unknown> | null} */
let firebaseContextPayload = null;

/** @type {{ id: string, data: Record<string, unknown> } | null} */
let activeBusiness = null;

/** Centro de Control Maya: listeners en tiempo real. */
/** @type {(() => void) | null} */
let mayaUnsubConversations = null;
/** @type {(() => void) | null} */
let mayaUnsubOrders = null;
/** @type {(() => void) | null} */
let mayaUnsubMessages = null;
/** @type {string | null} */
let mayaCcBusinessId = null;
/** @type {string | null} */
let mayaSelectedPhoneId = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let mayaAvgDebounce = null;
/** @type {'maya' | 'whatsapp'} */
let chatPageTab = "maya";
const MAYA_VOICE_AUTO_SEND = false;
const SpeechRecognitionCtor =
  typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
/** @type {SpeechRecognition | null} */
let mayaSpeechRecognition = null;
let mayaSpeechSupported = Boolean(SpeechRecognitionCtor);
let mayaSpeechListening = false;
let mayaSpeechStarting = false;
let mayaSpeechBaseText = "";
let mayaSpeechFinalTranscript = "";

/** @param {HTMLElement | null} el */
function isNearBottom(el, thresholdPx = 120) {
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < thresholdPx;
}

/** @param {HTMLElement | null} stream */
function scrollChatStreamToBottomIfNear(stream) {
  if (!stream) return;
  if (isNearBottom(stream)) {
    stream.scrollTop = stream.scrollHeight;
  }
}

/** @param {HTMLElement | null} stream */
function scrollChatStreamToBottom(stream) {
  if (!stream) return;
  stream.scrollTop = stream.scrollHeight;
}

function setChatPageTab(tab) {
  chatPageTab = tab === "whatsapp" ? "whatsapp" : "maya";
  const root = document.querySelector(".maya-cc");
  const mayaBtn = document.getElementById("maya-cc-tab-maya");
  const waBtn = document.getElementById("maya-cc-tab-wa");
  const mayaZone = document.getElementById("maya-cc-zone-chat");
  const waZone = document.getElementById("maya-cc-zone-wa");
  const statsZone = document.getElementById("maya-cc-zone-stats");

  const mayaActive = chatPageTab === "maya";
  const waActive = !mayaActive;

  if (mayaBtn) {
    mayaBtn.classList.toggle("is-active", mayaActive);
    mayaBtn.setAttribute("aria-selected", mayaActive ? "true" : "false");
  }
  if (waBtn) {
    waBtn.classList.toggle("is-active", waActive);
    waBtn.setAttribute("aria-selected", waActive ? "true" : "false");
  }
  if (root) {
    root.setAttribute("data-active-tab", chatPageTab);
  }
  const setPanelVisible = (panel, visible) => {
    if (!panel) return;
    panel.hidden = !visible;
    panel.setAttribute("aria-hidden", visible ? "false" : "true");
    panel.classList.toggle("is-tab-hidden", !visible);
    if (visible) panel.open = true;
  };
  if (mayaZone) {
    setPanelVisible(mayaZone, mayaActive);
  }
  if (waZone) {
    setPanelVisible(waZone, waActive);
  }
  if (statsZone) {
    setPanelVisible(statsZone, false);
  }
}

function wireChatPageTabs() {
  const mayaBtn = document.getElementById("maya-cc-tab-maya");
  const waBtn = document.getElementById("maya-cc-tab-wa");
  if (mayaBtn && mayaBtn.dataset.wired !== "1") {
    mayaBtn.dataset.wired = "1";
    mayaBtn.addEventListener("click", () => setChatPageTab("maya"));
  }
  if (waBtn && waBtn.dataset.wired !== "1") {
    waBtn.dataset.wired = "1";
    waBtn.addEventListener("click", () => setChatPageTab("whatsapp"));
  }
  setChatPageTab("maya");
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function stripAccents(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function formatMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** @param {unknown} v */
function isTruthyLogoProvided(v) {
  if (v === true) return true;
  if (v === false || v == null) return false;
  if (typeof v === "number") return v === 1;
  if (typeof v === "string") {
    const normalized = v.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "si";
  }
  return false;
}

/**
 * Logo $0 si el cliente ya tiene logo, o si el subtotal de prendas (antes del logo) supera el umbral.
 * @param {number} prendasSubtotalUsd subtotal de líneas que cuentan para el umbral (excl. tarjetas en pedidos mixtos)
 * @param {Record<string, unknown> | null | undefined} orderPayload MAYA_ORDER_JSON parseado
 */
function computeEffectiveLogoFee(prendasSubtotalUsd, orderPayload) {
  const threshold = YOURCOLOR_BUSINESS.rules.logoFreeThreshold;
  const design = YOURCOLOR_BUSINESS.rules.logoDesignCost;
  if (orderPayload && isTruthyLogoProvided(orderPayload.logo_provided)) return 0;
  if (Number.isFinite(prendasSubtotalUsd) && prendasSubtotalUsd > threshold) return 0;
  return design;
}

/**
 * Precio de una línea de pedido (misma lógica que calculateOrderTotal por línea).
 * @returns {{ subtotal: number, isTarjetas: boolean, productLabel: string, pricePerPiece: number | null, quantity: number, productKey: string } | null}
 */
function getQuoteLinePricing(productKey, quantity) {
  const product = YOURCOLOR_BUSINESS.products[productKey];
  if (!product) return null;
  const q = Number(quantity);
  if (!Number.isFinite(q) || q < 1) return null;

  if (productKey === "tarjetas") {
    const range = product.pricePerPiece.find((r) => q >= r.minQty && q <= r.maxQty && r.price != null);
    if (!range) return null;
    return {
      subtotal: range.price,
      isTarjetas: true,
      productLabel: product.name,
      pricePerPiece: null,
      quantity: q,
      productKey,
    };
  }

  const range = product.pricePerPiece.find((r) => q >= r.minQty && q <= r.maxQty && r.price != null);
  if (!range || range.price == null) return null;
  return {
    subtotal: q * range.price,
    isTarjetas: false,
    productLabel: product.name,
    pricePerPiece: range.price,
    quantity: q,
    productKey,
  };
}

/**
 * Intenta detectar producto del catálogo en el texto del asistente.
 * @param {string} text
 * @returns {string | null} productKey
 */
function detectProductKey(text) {
  const t = stripAccents(String(text).toLowerCase());
  if (/tarjeta/.test(t)) return "tarjetas";
  if (/gorra/.test(t)) return "gorras";
  if (/capucha|hoodie|sudadera/.test(t)) return "capuchaPoliester";
  if (/\bpolo\b/.test(t) && !/manga/.test(t)) return "polo";
  if (/manga corta/.test(t)) {
    if (/algodon|algodón/.test(t)) return "mangaCortaAlgodon";
    if (/poliester|poliéster|polyester/.test(t)) return "mangaCortaPoliester";
  }
  if (/manga larga/.test(t)) {
    if (/algodon|algodón/.test(t)) return "mangaLargaAlgodon";
    if (/poliester|poliéster|polyester/.test(t)) return "mangaLargaPoliester";
    return "mangaLargaPoliester";
  }
  return null;
}

/**
 * @param {string} text
 * @returns {number | null}
 */
function detectQuantity(text) {
  const raw = String(text);
  const tj = raw.match(/(\d{3,5})\s*tarjetas/i);
  if (tj) return parseInt(tj[1], 10);
  const lines = raw.split(/\n/);
  for (const line of lines) {
    const m1 = line.match(/(\d{1,6})\s*(?:piezas|pzas|unidades|prendas|camisetas|polos|gorras|tarjetas)\b/i);
    if (m1) return parseInt(m1[1], 10);
    const m2 = line.match(/cantidad[:\s]*(\d{1,6})/i);
    if (m2) return parseInt(m2[1], 10);
  }
  const x = raw.match(/(\d{1,6})\s*[x×]\s*[\$€]/);
  if (x) return parseInt(x[1], 10);
  const g = raw.match(/\b(\d{1,5})\s+(?:piezas|polos|gorras|camisetas|mangas|tarjetas)\b/i);
  if (g) return parseInt(g[1], 10);
  const t = raw.match(/(?:^|\s)(\d{3,5})(?:\s|$)(?=[^\n]{0,80}tarjeta)/i);
  if (t) return parseInt(t[1], 10);
  return null;
}

/**
 * @param {string} text
 * @param {RegExp} re
 * @returns {number | null}
 */
function extractNumber(text, re) {
  const m = String(text).match(re);
  if (!m || m[1] == null) return null;
  const n = parseFloat(String(m[1]).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Comprueba que cantidad/total del texto coincidan con MAYA_ORDER_JSON (misma respuesta).
 * @param {string} messageText
 * @param {Record<string, unknown>} orderJson
 * @returns {boolean}
 */
function validateOrderConsistency(messageText, orderJson) {
  if (!orderJson || typeof orderJson !== "object") return true;
  if (Array.isArray(orderJson.items) && orderJson.items.length > 0) {
    return true;
  }

  const jTotalRaw = orderJson.total != null ? orderJson.total : orderJson.amount;
  const jQtyRaw = orderJson.quantity;

  let textTotal = extractNumber(messageText, /total[:\s]*\$?\s*([\d,.]+)/i);
  if (textTotal == null) textTotal = extractNumber(messageText, /\btotal\s+de\s+\$?\s*([\d,.]+)/i);
  if (textTotal == null) textTotal = extractNumber(messageText, /=\s*\$?\s*([\d,.]+)\s*$/im);

  let textQty = extractNumber(messageText, /(\d+)\s*piezas?/i);
  if (textQty == null) textQty = extractNumber(messageText, /cantidad[:\s]*(\d+)/i);

  const jTotal = Number(jTotalRaw);
  const jQty = Number(jQtyRaw);

  if (Number.isFinite(jTotal) && textTotal != null && Math.abs(textTotal - jTotal) > 0.02) {
    console.warn("⚠️ Total inconsistente:", textTotal, "vs", jTotal);
    return false;
  }
  if (Number.isFinite(jQty) && jQty >= 1 && textQty != null && Math.round(textQty) !== Math.round(jQty)) {
    console.warn("⚠️ Cantidad inconsistente:", textQty, "vs", jQty);
    return false;
  }
  return true;
}

/**
 * @param {string} text
 * @param {Record<string, unknown> | null} [orderPayload] MAYA_ORDER_JSON si existe
 */
function tryBuildQuoteFromAssistantText(text, orderPayload = null) {
  if (orderPayload && orderPayload.confirmed === true && Array.isArray(orderPayload.items) && orderPayload.items.length > 0) {
    /** @type {{ label: string, detail: string }[]} */
    const multiLines = [];
    let prendasSubtotal = 0;
    let sumSubtotal = 0;
    for (const it of orderPayload.items) {
      if (!it || typeof it !== "object") return null;
      const pk = /** @type {{ productKey?: string, quantity?: unknown }} */ (it).productKey;
      const qn = Number(/** @type {{ quantity?: unknown }} */ (it).quantity);
      const line = getQuoteLinePricing(typeof pk === "string" ? pk : "", qn);
      if (!line) return null;
      sumSubtotal += line.subtotal;
      if (!line.isTarjetas) prendasSubtotal += line.subtotal;
      if (line.isTarjetas) {
        multiLines.push({
          label: line.productLabel,
          detail: `${line.quantity} tarjetas (paquete) → ${formatMoney(line.subtotal)}`,
        });
      } else {
        multiLines.push({
          label: line.productLabel,
          detail: `${line.quantity} × ${formatMoney(line.pricePerPiece ?? 0)} = ${formatMoney(line.subtotal)}`,
        });
      }
    }
    const logoFee = computeEffectiveLogoFee(prendasSubtotal, orderPayload);
    const total = sumSubtotal + logoFee;
    const deposit = total * (YOURCOLOR_BUSINESS.rules.depositPercent / 100);
    return {
      isMulti: true,
      multiLines,
      productKey: "multi",
      productLabel: "Varios productos",
      quantity: orderPayload.items.length,
      pricePerPiece: null,
      priceLabel: "",
      subtotal: sumSubtotal,
      prendasSubtotal,
      logoFee,
      total,
      deposit,
      isTarjetas: false,
    };
  }

  if (orderPayload && orderPayload.confirmed === true) {
    const pk =
      typeof orderPayload.productKey === "string" ? orderPayload.productKey : detectProductKey(text);
    const qn = Number(orderPayload.quantity);
    const qty = Number.isFinite(qn) && qn >= 1 ? qn : detectQuantity(text);
    if (pk && qty != null && qty >= 1) {
      if (pk === "tarjetas") {
        const line = getQuoteLinePricing(pk, qty);
        if (!line) return null;
        const total = line.subtotal;
        const deposit = total * (YOURCOLOR_BUSINESS.rules.depositPercent / 100);
        return {
          productKey: pk,
          productLabel: line.productLabel,
          quantity: qty,
          pricePerPiece: null,
          priceLabel: "Precio total (paquete)",
          subtotal: total,
          logoFee: 0,
          total,
          deposit,
          isTarjetas: true,
          isMulti: false,
        };
      }
      const calc = calculateOrderTotal(pk, qty);
      if (!calc || typeof calc !== "object" || ("needsQuote" in calc && calc.needsQuote)) return null;
      const product = YOURCOLOR_BUSINESS.products[pk];
      const productLabel = product ? product.name : pk;
      const logoFee = computeEffectiveLogoFee(calc.subtotal, orderPayload);
      const total = calc.subtotal + logoFee;
      const deposit = total * (YOURCOLOR_BUSINESS.rules.depositPercent / 100);
      return {
        productKey: pk,
        productLabel,
        quantity: calc.quantity,
        pricePerPiece: calc.pricePerPiece,
        priceLabel: "Precio por pieza",
        subtotal: calc.subtotal,
        logoFee,
        total,
        deposit,
        isTarjetas: false,
        isMulti: false,
      };
    }
  }

  const productKey = detectProductKey(text);
  const qty = detectQuantity(text);
  if (!productKey || qty == null || qty < 1) return null;

  if (productKey === "tarjetas") {
    const product = YOURCOLOR_BUSINESS.products.tarjetas;
    const range = product.pricePerPiece.find((r) => qty >= r.minQty && qty <= r.maxQty && r.price != null);
    if (!range) return null;
    const total = range.price;
    const deposit = total * (YOURCOLOR_BUSINESS.rules.depositPercent / 100);
    return {
      productKey,
      productLabel: product.name,
      quantity: qty,
      pricePerPiece: null,
      priceLabel: "Precio total (paquete)",
      subtotal: total,
      logoFee: 0,
      total,
      deposit,
      isTarjetas: true,
      isMulti: false,
    };
  }

  const calc = calculateOrderTotal(productKey, qty);
  if (!calc || typeof calc !== "object") return null;
  if ("needsQuote" in calc && calc.needsQuote) return null;

  const product = YOURCOLOR_BUSINESS.products[productKey];
  const productLabel = product ? product.name : productKey;

  const logoFee = computeEffectiveLogoFee(calc.subtotal, orderPayload);
  const total = calc.subtotal + logoFee;
  const deposit = total * (YOURCOLOR_BUSINESS.rules.depositPercent / 100);

  return {
    productKey,
    productLabel,
    quantity: calc.quantity,
    pricePerPiece: calc.pricePerPiece,
    priceLabel: "Precio por pieza",
    subtotal: calc.subtotal,
    logoFee,
    total,
    deposit,
    isTarjetas: false,
    isMulti: false,
  };
}

function buildQuoteCardEl(quote) {
  const card = document.createElement("div");
  card.className = "yc-quote-card";
  const h = document.createElement("div");
  h.className = "yc-quote-title";
  h.textContent = "Resumen de presupuesto";

  const dl = document.createElement("dl");
  dl.className = "yc-quote-rows";

  const addRow = (label, value, accent = false) => {
    const row = document.createElement("div");
    row.className = `yc-quote-row${accent ? " yc-quote-row--accent" : ""}`;
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    row.append(dt, dd);
    dl.appendChild(row);
  };

  const depPct = YOURCOLOR_BUSINESS.rules.depositPercent;

  if (quote.isMulti && Array.isArray(quote.multiLines)) {
    addRow("Producto", quote.productLabel);
    for (const row of quote.multiLines) {
      addRow(row.label, row.detail);
    }
    if (quote.logoFee > 0) {
      addRow("Logo / arte", formatMoney(quote.logoFee));
    }
  } else {
    addRow("Producto", quote.productLabel);
    addRow("Cantidad", String(quote.quantity));
    if (quote.isTarjetas) {
      addRow("Precio (paquete)", formatMoney(quote.total));
    } else {
      addRow("Precio por pieza", formatMoney(quote.pricePerPiece));
      if (quote.logoFee > 0) {
        addRow("Subtotal prendas", formatMoney(quote.subtotal));
        addRow("Logo / arte", formatMoney(quote.logoFee));
      }
    }
  }
  addRow("Total", formatMoney(quote.total), true);
  addRow(`Depósito (${depPct}%)`, formatMoney(quote.deposit), true);

  card.append(h, dl);
  return card;
}

/**
 * Perfil mínimo del negocio para el contexto de Maya (sin campos pesados innecesarios).
 * @param {Record<string, unknown>} data
 */
function slimBusinessProfileForChat(data) {
  if (!data || typeof data !== "object") return {};
  const keys = [
    "businessName",
    "name",
    "phone",
    "businessPhone",
    "email",
    "serviceArea",
    "businessDescription",
    "description",
  ];
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const k of keys) {
    const v = /** @type {Record<string, unknown>} */ (data)[k];
    if (v != null && v !== "") out[k] = v;
  }
  return serializeForAi(out);
}

function serializeForAi(val, seen = new WeakSet()) {
  if (val === undefined) return null;
  if (val === null) return null;
  if (typeof val === "bigint") return val.toString();
  if (val instanceof Date) return val.toISOString();
  if (typeof val === "object" && val !== null && typeof val.toDate === "function") {
    try {
      const d = val.toDate();
      return d instanceof Date ? d.toISOString() : String(val);
    } catch (_) {
      return null;
    }
  }
  if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") return val;
  if (Array.isArray(val)) {
    return val.map((x) => serializeForAi(x, seen));
  }
  if (typeof val === "object") {
    if (seen.has(val)) return "[Circular]";
    seen.add(val);
    /** @type {Record<string, unknown>} */
    const o = {};
    for (const k of Object.keys(val)) {
      o[k] = serializeForAi(/** @type {Record<string, unknown>} */ (val)[k], seen);
    }
    return o;
  }
  return String(val);
}

/**
 * Heurística: qué bloques de datos son más relevantes según el último mensaje (ahorro inteligente de tokens).
 * @param {string} text
 */
function inferMayaDataFocus(text) {
  const t = String(text || "").toLowerCase();
  const flags = {
    finance:
      /\b(finanz|balance|gast(o|é|e)|ingres|cobr|pag(ué|o)|cobré|dinero|dólar|presupuesto|margen|rentabil|flujo)/i.test(
        t,
      ) || /\$\s*\d/.test(t),
    calendar:
      /\b(calendari|entrega(s)?|cita|agend|reuni|program(ar|ación)|mañana|pasado mañana|esta semana|próxim)/i.test(
        t,
      ) || /\b20\d{2}-\d{2}-\d{2}\b/.test(t),
    orders:
      /\b(pedido|orden(es)?|trabajo|pendiente|producci|imprimir|dtf|bordad)/i.test(t),
    clients: /\b(cliente|contacto|llamar|tel(e|é)fono|whatsapp|correo|email)\b/i.test(t),
    campaigns: /\b(campañ|marketing|meta|facebook|instagram|anunci|publicidad|alcance)\b/i.test(t),
  };
  /** @type {string[]} */
  const priority = [];
  if (flags.finance) priority.push("finance");
  if (flags.calendar) priority.push("calendar");
  if (flags.orders) priority.push("orders");
  if (flags.clients) priority.push("clients");
  if (flags.campaigns) priority.push("campaigns");
  if (!priority.length) priority.push("general");
  return { flags, priority };
}

/**
 * Clientes cuyo nombre aparece mencionado en el texto (priorizar contexto personalizado).
 * @param {string} text
 * @param {Record<string, unknown>[]} clients
 */
function findClientsMentionedInText(text, clients) {
  const raw = String(text || "").trim();
  if (!raw || !Array.isArray(clients) || !clients.length) return [];
  const low = stripAccents(raw).toLowerCase();
  /** @type {Record<string, unknown>[]} */
  const out = [];
  const seen = new Set();
  for (const c of clients) {
    const name = String(c.fullName ?? c.name ?? "")
      .trim()
      .replace(/\s+/g, " ");
    if (name.length < 3) continue;
    const nameLow = stripAccents(name).toLowerCase();
    if (low.includes(nameLow)) {
      if (!seen.has(name)) {
        seen.add(name);
        out.push(c);
      }
      continue;
    }
    const parts = nameLow.split(/\s+/).filter((p) => p.length > 2);
    for (const p of parts) {
      if (p.length >= 3 && low.includes(p)) {
        if (!seen.has(name)) {
          seen.add(name);
          out.push(c);
        }
        break;
      }
    }
  }
  return out.slice(0, 5);
}

function formatTime(d = new Date()) {
  return d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

function cleanMayaMessage(text) {
  let out = String(text ?? "");
  out = out.replace(/```json[\s\S]*?```/gi, "");
  out = out.replace(/```[\s\S]*?```/g, "");
  out = out.replace(/MAYA_[A-Z_]+:?\s*\{[\s\S]*?\}/g, "");
  out = out.replace(/\n{3,}/g, "\n\n").trim();
  return out;
}

/**
 * Limpia markdown básico para evitar ver símbolos crudos en la burbuja.
 * @param {string} text
 */
function normalizeMayaDisplayText(text) {
  let out = String(text ?? "");
  out = out.replace(/\r\n?/g, "\n");
  out = out.replace(/\*\*(.*?)\*\*/g, "$1");
  out = out.replace(/__(.*?)__/g, "$1");
  out = out.replace(/`([^`]+)`/g, "$1");
  out = out.replace(/^#{1,6}\s*/gm, "");
  out = out.replace(/\[(.*?)\]\((.*?)\)/g, "$1");
  out = out.replace(/^\s*[-*]\s+/gm, "• ");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

/**
 * Normaliza respuestas de cotización/presupuesto para mostrarlas en líneas legibles.
 * Solo afecta display del bubble (no altera la lógica de Maya).
 * @param {string} text
 */
function formatMayaBudgetDisplayText(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return raw;
  const budgetLike =
    /presupuesto|cotizaci[oó]n|precio por pieza|subtotal|dep[oó]sito|saldo|logo\/?\s*(arte|diseño)?/i.test(raw) ||
    /(producto|cantidad|total)\s*:/i.test(raw);
  if (!budgetLike) return raw;

  let out = raw.replace(/\r\n?/g, "\n");
  out = out.replace(/[ \t]+\n/g, "\n");
  out = out.replace(/\n{3,}/g, "\n\n");

  // Si vino compacto, abrimos cada campo clave como bloque independiente.
  out = out.replace(
    /\s*(Producto|Cantidad|Precio por pieza|Precio \(paquete\)|Subtotal(?:\s+prendas)?|Logo\/?\s*(?:arte|diseño)?|Total|Dep[oó]sito(?:\s*\d+%?)?|Saldo)\s*:/gi,
    "\n$1:",
  );
  out = out.replace(/(Presupuesto|Cotizaci[oó]n)\s+(?=\w+:)/i, "$1\n");
  out = out.replace(/\s+\?\s*Quieres agregar logo, dep[oó]sito o cliente\?/i, "\n\n¿Quieres agregar logo, depósito o cliente?");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

/**
 * Mejora legibilidad para respuestas largas (sin cambiar lógica).
 * @param {string} text
 */
function formatMayaReadableBlocks(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return raw;
  const lines = raw.split("\n");
  /** @type {string[]} */
  const out = [];
  for (const line of lines) {
    const clean = line.trim();
    if (!clean) {
      out.push("");
      continue;
    }
    if (clean.length > 220 && !/:/.test(clean)) {
      const chunks = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
      if (chunks.length > 1) {
        out.push(chunks.join("\n"));
        continue;
      }
    }
    out.push(clean);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** @param {HTMLElement | null} messagesEl */
function logChatScrollMetrics(messagesEl) {
  if (!messagesEl) return;
  console.log("[MayaChat] messages container scrollHeight/clientHeight", {
    scrollHeight: messagesEl.scrollHeight,
    clientHeight: messagesEl.clientHeight,
  });
  console.log("[MayaChat Mobile Scroll]", {
    scrollTop: messagesEl.scrollTop,
    scrollHeight: messagesEl.scrollHeight,
    clientHeight: messagesEl.clientHeight,
  });
}

/** @param {HTMLElement | null} messagesEl */
function wireMayaMobileScrollDebug(messagesEl) {
  if (!messagesEl) return;
  if (messagesEl.dataset.mobileScrollDebugWired === "1") return;
  messagesEl.dataset.mobileScrollDebugWired = "1";
  messagesEl.addEventListener(
    "scroll",
    () => {
      console.log("[MayaChat Mobile Scroll]", {
        scrollTop: messagesEl.scrollTop,
        scrollHeight: messagesEl.scrollHeight,
        clientHeight: messagesEl.clientHeight,
      });
    },
    { passive: true },
  );
}

function renderHeader(business) {
  const nameEl = document.getElementById("dash-business-name");
  const metaEl = document.getElementById("dash-business-meta");
  const av = document.getElementById("dash-avatar-initials");
  if (!business) {
    if (nameEl) nameEl.textContent = "Chat IA";
    if (metaEl) metaEl.textContent = "Sin negocio";
    if (av) av.textContent = "?";
    return;
  }
  const displayName =
    (typeof business.data.businessName === "string" && business.data.businessName.trim()) || "Tu negocio";
  const { metaLine } = formatBusinessMeta(business.data);
  if (nameEl) nameEl.textContent = displayName;
  if (metaEl) metaEl.textContent = metaLine;
  if (av) av.textContent = initialsFromName(displayName);
}

function appendUserBubble(content) {
  const stream = document.getElementById("yc-chat-stream");
  if (!stream) return;
  const wrap = document.createElement("div");
  wrap.className = "yc-msg yc-msg--user";

  const inner = document.createElement("div");
  const bubble = document.createElement("div");
  bubble.className = "yc-msg-bubble maya-message user";
  bubble.textContent = content;

  const time = document.createElement("div");
  time.className = "yc-msg-time";
  time.textContent = formatTime();

  inner.appendChild(bubble);
  inner.appendChild(time);
  wrap.appendChild(inner);
  stream.appendChild(wrap);
  logChatScrollMetrics(stream);
  scrollChatStreamToBottom(stream);
}

/**
 * @param {string} content
 * @param {{ isWelcome?: boolean }} [opts]
 * @returns {{ visible: string, actionPayload: { action?: string, data?: Record<string, unknown> } | null }}
 */
function appendAssistantBubble(content, opts = {}) {
  const empty = { visible: String(content ?? "").trim(), actionPayload: null };
  const stream = document.getElementById("yc-chat-stream");
  if (!stream) return empty;

  const { displayText, orderPayload, actionPayload, ambiguityPayload } = stripMayaPanelMetadata(content);
  if (actionPayload?.action) {
    console.log("[MayaAction] detected action", actionPayload.action, actionPayload);
  }
  if (orderPayload) {
    console.log("[MayaAction] extracted client/order data", orderPayload);
  }
  const cleanText = cleanMayaMessage(displayText);
  const normalizedText = normalizeMayaDisplayText(cleanText);
  const displayBubbleText = formatMayaReadableBlocks(formatMayaBudgetDisplayText(normalizedText));

  const wrap = document.createElement("div");
  wrap.className = "yc-msg yc-msg--assistant";

  const col = document.createElement("div");
  col.className = "yc-msg-inner-col";

  const bubble = document.createElement("div");
  bubble.className = "yc-msg-bubble maya-message assistant";
  bubble.textContent = displayBubbleText;

  const time = document.createElement("div");
  time.className = "yc-msg-time";
  time.textContent = formatTime();

  col.appendChild(bubble);

  if (orderPayload && !opts.isWelcome && !validateOrderConsistency(cleanText, orderPayload)) {
    const warn = document.createElement("div");
    warn.className = "yc-msg-consistency-warning";
    warn.setAttribute("role", "status");
    warn.textContent = "⚠️ Los números no coinciden. Pedile a Maya que te vuelva a cotizar.";
    col.appendChild(warn);
  }

  if (!opts.isWelcome && ambiguityPayload && Array.isArray(ambiguityPayload.candidates)) {
    const cards = document.createElement("div");
    cards.className = "yc-ambiguity-cards";
    for (const cand of ambiguityPayload.candidates.slice(0, 6)) {
      if (!cand || typeof cand !== "object") continue;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "yc-ambiguity-card";
      const clientName = String(cand.clientName || "Cliente");
      const product = String(cand.product || "Pedido");
      const total = Number(cand.total || 0);
      const status = String(cand.status || "nuevo");
      const date = cand.date ? new Date(String(cand.date)) : null;
      const dateLabel = date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("es") : "sin fecha";
      btn.innerHTML = `<span class="yc-ambiguity-card__title">${clientName}</span><span class="yc-ambiguity-card__meta">${product}</span><span class="yc-ambiguity-card__meta">Total: $${total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · ${status} · ${dateLabel}</span>`;
      const orderId = String(cand.id || "").trim();
      btn.addEventListener("click", () => {
        if (!orderId) return;
        const followUp = `Selecciono el pedido orderId ${orderId}. Continúa con la acción solicitada.`;
        const input = document.getElementById("yc-chat-input");
        if (input && "value" in input) {
          input.value = followUp;
        }
        void sendToClaude();
      });
      cards.appendChild(btn);
    }
    if (cards.childElementCount > 0) col.appendChild(cards);
  }

  if (!opts.isWelcome) {
    const actions = document.createElement("div");
    actions.className = "yc-msg-actions";

    const btnCopy = document.createElement("button");
    btnCopy.type = "button";
    btnCopy.className = "yc-msg-action-btn";
    btnCopy.textContent = "Copiar";
    btnCopy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(displayBubbleText);
        showToast("Copiado al portapapeles");
      } catch {
        showToast("No se pudo copiar", true);
      }
    });

    const btnOrder = document.createElement("button");
    btnOrder.type = "button";
    btnOrder.className = "yc-msg-action-btn yc-msg-action-btn--primary";
    btnOrder.textContent = "Convertir a orden";
    btnOrder.addEventListener("click", () => convertConversationToOrder(wrap, displayBubbleText));

    actions.append(btnCopy, btnOrder);
    col.appendChild(actions);
  }

  col.appendChild(time);

  const stickToBottom = isNearBottom(stream);
  const quote = tryBuildQuoteFromAssistantText(displayBubbleText, orderPayload);
  if (quote) {
    wrap.dataset.quoteJson = JSON.stringify(quote);
  }
  wrap.appendChild(col);
  stream.appendChild(wrap);
  logChatScrollMetrics(stream);
  if (stickToBottom) {
    scrollChatStreamToBottom(stream);
  }

  if (!opts.isWelcome && actionPayload?.action === "save_client") {
    if (activeBusiness?.id) {
      void (async () => {
        try {
          await executeMayaActionFromChat(activeBusiness.id, actionPayload);
          showToast("✅ Cliente guardado correctamente");
          await loadFirebaseContext(activeBusiness);
        } catch (e) {
          console.error("[YourColor Chat] save_client", e);
          showToast(e instanceof Error ? e.message : "No se pudo guardar el cliente.", true);
        }
      })();
    } else {
      showToast("No hay negocio activo para guardar el cliente.", true);
    }
  }

  return { visible: displayBubbleText, actionPayload };
}

function showToast(message, isError = false) {
  const el = document.getElementById("yc-chat-toast");
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  if (isError) {
    el.style.background = "#fef2f2";
    el.style.borderColor = "#fecaca";
    el.style.color = "#991b1b";
  } else {
    el.style.background = "";
    el.style.borderColor = "";
    el.style.color = "";
  }
  window.clearTimeout(showToast._t);
  showToast._t = window.setTimeout(() => {
    el.hidden = true;
  }, 3200);
}

function showError(msg) {
  const el = document.getElementById("yc-chat-error");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
}

function hideError() {
  const el = document.getElementById("yc-chat-error");
  if (el) el.hidden = true;
}

function setComposerEnabled(on) {
  const input = document.getElementById("yc-chat-input");
  const btn = document.getElementById("yc-chat-send");
  const mic = document.getElementById("yc-chat-mic");
  if (input) {
    input.disabled = !on;
  }
  if (btn) {
    btn.disabled = !on;
  }
  if (mic) {
    mic.disabled = !on;
  }
}

function setVoiceMicUiState({ listening = false, supported = true } = {}) {
  const mic = document.getElementById("yc-chat-mic");
  if (!(mic instanceof HTMLButtonElement)) return;
  mic.disabled = document.getElementById("yc-chat-input")?.disabled ?? true;
  mic.classList.toggle("is-listening", listening);
  mic.classList.toggle("is-unsupported", !supported);
  mic.setAttribute("aria-pressed", listening ? "true" : "false");
  mic.setAttribute("aria-label", listening ? "Detener dictado de voz" : "Dictar mensaje con voz");
  mic.title = listening ? "Detener dictado de voz" : "Dictar mensaje con voz";
}

function stopVoiceRecognition() {
  if (mayaSpeechRecognition && (mayaSpeechListening || mayaSpeechStarting)) {
    try {
      mayaSpeechRecognition.stop();
    } catch {
      mayaSpeechListening = false;
      mayaSpeechStarting = false;
      setVoiceMicUiState({ listening: false, supported: mayaSpeechSupported });
    }
  }
}

function startVoiceRecognition() {
  if (!mayaSpeechRecognition) {
    showToast("Dictado por voz no disponible en este navegador.", true);
    return;
  }
  const input = document.getElementById("yc-chat-input");
  if (!(input instanceof HTMLTextAreaElement) || input.disabled) return;
  if (mayaSpeechListening || mayaSpeechStarting) return;
  try {
    mayaSpeechBaseText = String(input.value || "").trim();
    mayaSpeechFinalTranscript = "";
    mayaSpeechStarting = true;
    mayaSpeechRecognition.start();
  } catch (e) {
    mayaSpeechStarting = false;
    const msg = e instanceof Error ? e.message : "No se pudo iniciar el micrófono.";
    console.error("[Maya Voice] speech error", e);
    showToast(msg, true);
  }
}

function initVoiceInput() {
  const mic = document.getElementById("yc-chat-mic");
  const input = document.getElementById("yc-chat-input");
  if (!(mic instanceof HTMLButtonElement) || !(input instanceof HTMLTextAreaElement)) return;
  if (mic.dataset.wired === "1") return;
  mic.dataset.wired = "1";

  if (!SpeechRecognitionCtor) {
    mayaSpeechSupported = false;
    console.error("[Maya Voice] Este navegador no soporta reconocimiento de voz");
    setVoiceMicUiState({ listening: false, supported: false });
    mic.addEventListener("click", () => {
      showToast("Dictado por voz no disponible en este navegador.", true);
    });
    return;
  }

  mayaSpeechRecognition = new SpeechRecognitionCtor();
  mayaSpeechRecognition.lang = "es-US";
  mayaSpeechRecognition.interimResults = true;
  mayaSpeechRecognition.continuous = false;
  mayaSpeechSupported = true;
  setVoiceMicUiState({ listening: false, supported: true });

  mayaSpeechRecognition.addEventListener("start", () => {
    console.log("[Maya Voice] mic started");
    mayaSpeechStarting = false;
    mayaSpeechListening = true;
    setVoiceMicUiState({ listening: true, supported: true });
  });

  mayaSpeechRecognition.addEventListener("result", (event) => {
    let interimTranscript = "";
    let latestFinalChunk = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const chunk = String(result[0]?.transcript || "").trim();
      if (!chunk) continue;
      if (result.isFinal) {
        latestFinalChunk += `${chunk} `;
      } else {
        interimTranscript += `${chunk} `;
      }
    }
    const cleanInterim = interimTranscript.trim();
    const cleanFinalChunk = latestFinalChunk.trim();
    if (cleanFinalChunk) {
      mayaSpeechFinalTranscript = `${mayaSpeechFinalTranscript} ${cleanFinalChunk}`.trim();
      console.log("[Maya Voice] final transcript", cleanFinalChunk);
    }
    if (cleanInterim) {
      console.log("[Maya Voice] interim transcript", cleanInterim);
    }
    if (!mayaSpeechFinalTranscript && !cleanInterim) return;
    const speechText = `${mayaSpeechFinalTranscript} ${cleanInterim}`.trim();
    const nextValue = mayaSpeechBaseText ? `${mayaSpeechBaseText} ${speechText}`.trim() : speechText;
    input.value = nextValue;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.focus();
    if (MAYA_VOICE_AUTO_SEND) {
      void sendToClaude();
    }
  });

  mayaSpeechRecognition.addEventListener("error", (event) => {
    mayaSpeechStarting = false;
    mayaSpeechListening = false;
    setVoiceMicUiState({ listening: false, supported: true });
    console.error("[Maya Voice] speech error", event.error);
    if (event.error === "no-speech" || event.error === "aborted") return;
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      showToast("Permiso de micrófono denegado. Actívalo para usar dictado por voz.", true);
      return;
    }
    showToast("No se pudo procesar el audio. Intenta nuevamente.", true);
  });

  mayaSpeechRecognition.addEventListener("end", () => {
    console.log("[Maya Voice] mic ended");
    mayaSpeechStarting = false;
    mayaSpeechListening = false;
    const finalText = mayaSpeechFinalTranscript.trim();
    if (finalText) {
      const settledValue = mayaSpeechBaseText ? `${mayaSpeechBaseText} ${finalText}`.trim() : finalText;
      input.value = settledValue;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.focus();
    }
    mayaSpeechBaseText = "";
    mayaSpeechFinalTranscript = "";
    setVoiceMicUiState({ listening: false, supported: true });
  });

  mic.addEventListener("click", () => {
    if (mayaSpeechListening) {
      stopVoiceRecognition();
      return;
    }
    startVoiceRecognition();
  });
}

function trimApiMessages() {
  if (apiConversation.length <= MAX_CHAT_MEMORY) return;
  apiConversation = apiConversation.slice(-MAX_CHAT_MEMORY);
}

function panelChatSessionStorageKey(userId, businessId) {
  return `cf_maya_panel_chat_v1_${userId}_${businessId}`;
}

/**
 * Guarda la conversación en sessionStorage al salir de la página (otra pestaña del panel).
 */
function persistChatToSessionStorage() {
  const uid = auth.currentUser?.uid;
  const bid = activeBusiness?.id;
  if (!uid || !bid) return;
  const key = panelChatSessionStorageKey(uid, bid);
  try {
    if (!apiConversation.length) {
      sessionStorage.removeItem(key);
      return;
    }
    sessionStorage.setItem(
      key,
      JSON.stringify({
        messages: apiConversation.slice(-MAX_CHAT_MEMORY).map((m) => ({
          role: m.role,
          content: String(m.content || "").slice(0, 12000),
        })),
      }),
    );
  } catch (e) {
    console.warn("[YourColor Chat] sessionStorage save", e);
  }
}

function clearChatSessionStorage(uid, businessId) {
  if (!uid || !businessId) return;
  try {
    sessionStorage.removeItem(panelChatSessionStorageKey(uid, businessId));
  } catch {
    /* ignore */
  }
}

function tryRestoreChatFromSessionStorage(businessId, userId) {
  const key = panelChatSessionStorageKey(userId, businessId);
  let raw;
  try {
    raw = sessionStorage.getItem(key);
  } catch {
    return false;
  }
  if (!raw) return false;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    sessionStorage.removeItem(key);
    return false;
  }
  const messages = parsed.messages;
  if (!Array.isArray(messages) || !messages.length) {
    sessionStorage.removeItem(key);
    return false;
  }
  apiConversation = messages
    .filter((x) => x && (x.role === "user" || x.role === "assistant") && typeof x.content === "string")
    .map((x) => ({ role: /** @type {'user'|'assistant'} */ (x.role), content: x.content }))
    .slice(-MAX_CHAT_MEMORY);
  return apiConversation.length > 0;
}

async function persistPanelChatHistory(businessId, userId) {
  if (!businessId || !userId || !apiConversation.length) return;
  const messages = apiConversation.slice(-MAX_CHAT_MEMORY).map((m) => ({
    role: m.role,
    content: String(m.content || "").slice(0, 12000),
  }));
  await setDoc(
    doc(db, "businesses", businessId, "internalChatHistory", userId),
    { messages, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

async function loadPanelChatHistory(businessId, userId) {
  try {
    const s = await getDoc(doc(db, "businesses", businessId, "internalChatHistory", userId));
    if (!s.exists()) return false;
    const data = s.data();
    const m = data?.messages;
    if (!Array.isArray(m) || !m.length) return false;
    apiConversation = m
      .filter((x) => x && (x.role === "user" || x.role === "assistant") && typeof x.content === "string")
      .map((x) => ({ role: /** @type {'user'|'assistant'} */ (x.role), content: x.content }))
      .slice(-MAX_CHAT_MEMORY);
    return apiConversation.length > 0;
  } catch (e) {
    console.warn("[YourColor Chat] load history", e);
    return false;
  }
}

function renderChatHistoryFromMemory() {
  const stream = document.getElementById("yc-chat-stream");
  if (!stream) return;
  stream.innerHTML = "";
  for (const m of apiConversation) {
    if (m.role === "user") appendUserBubble(m.content);
    else appendAssistantBubble(m.content);
  }
  scrollChatStreamToBottom(stream);
}

function conversationSnippet(maxLen = 4000) {
  return apiConversation
    .slice(-10)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n\n")
    .slice(0, maxLen);
}

const MAYA_ORDER_PREFIX = "MAYA_ORDER_JSON:";
const MAYA_ACTION_PREFIX = "MAYA_ACTION_JSON:";
const MAYA_HANDOFF_PREFIX = "MAYA_HANDOFF_JSON:";
const MAYA_AMBIGUITY_PREFIX = "MAYA_AMBIGUITY_JSON:";

/**
 * Extrae un bloque JSON tras `prefix` y lo elimina del texto (llaves anidadas).
 * @param {string} text
 * @param {string} prefix
 * @returns {{ text: string, payload: Record<string, unknown> | null }}
 */
function extractAndRemoveMayaJsonLine(text, prefix) {
  const idx = text.indexOf(prefix);
  if (idx < 0) return { text, payload: null };
  const afterPrefix = text.slice(idx + prefix.length).trimStart();
  const jsonStartInAfter = afterPrefix.indexOf("{");
  if (jsonStartInAfter < 0) return { text, payload: null };
  const fromBrace = afterPrefix.slice(jsonStartInAfter);
  let depth = 0;
  let end = -1;
  for (let i = 0; i < fromBrace.length; i += 1) {
    const c = fromBrace[i];
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return { text, payload: null };
  const jsonStr = fromBrace.slice(0, end + 1);
  let payload = null;
  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed && typeof parsed === "object") payload = /** @type {Record<string, unknown>} */ (parsed);
  } catch {
    return { text, payload: null };
  }
  const removeEnd = idx + prefix.length + afterPrefix.slice(0, jsonStartInAfter).length + end + 1;
  const newText = (text.slice(0, idx) + text.slice(removeEnd)).replace(/\n{3,}/g, "\n\n").trim();
  return { text: newText, payload };
}

/**
 * Quita MAYA_ORDER_JSON y MAYA_ACTION_JSON del mensaje (no deben verse en el chat).
 * @param {string} raw
 * @returns {{ displayText: string, orderPayload: Record<string, unknown> | null, actionPayload: { action?: string, data?: Record<string, unknown> } | null, ambiguityPayload: { action?: string, followUpQuestion?: string, candidates?: Record<string, unknown>[] } | null }}
 */
function stripMayaPanelMetadata(raw) {
  let t = String(raw ?? "").trim();
  let orderPayload = null;
  let actionPayload = null;
  let ambiguityPayload = null;
  while (true) {
    const rOrder = extractAndRemoveMayaJsonLine(t, MAYA_ORDER_PREFIX);
    if (!rOrder.payload) break;
    t = rOrder.text;
    if (!orderPayload) orderPayload = rOrder.payload;
  }
  while (true) {
    const rAct = extractAndRemoveMayaJsonLine(t, MAYA_ACTION_PREFIX);
    if (!rAct.payload) break;
    t = rAct.text;
    if (!actionPayload && typeof rAct.payload.action === "string") {
      actionPayload = /** @type {{ action: string, data?: Record<string, unknown> }} */ (rAct.payload);
    }
  }
  while (true) {
    const rHandoff = extractAndRemoveMayaJsonLine(t, MAYA_HANDOFF_PREFIX);
    if (!rHandoff.payload) break;
    t = rHandoff.text;
  }
  while (true) {
    const rAmb = extractAndRemoveMayaJsonLine(t, MAYA_AMBIGUITY_PREFIX);
    if (!rAmb.payload) break;
    t = rAmb.text;
    if (
      !ambiguityPayload &&
      rAmb.payload &&
      typeof rAmb.payload === "object" &&
      Array.isArray(rAmb.payload.candidates)
    ) {
      ambiguityPayload = /** @type {{ action?: string, followUpQuestion?: string, candidates?: Record<string, unknown>[] }} */ (
        rAmb.payload
      );
    }
  }
  return { displayText: t, orderPayload, actionPayload, ambiguityPayload };
}

/**
 * Combina `data` con campos en la raíz del JSON (p. ej. clientId junto a action).
 * @param {Record<string, unknown>} payload
 */
function mergeMayaActionData(payload) {
  const nested =
    payload.data && typeof payload.data === "object"
      ? /** @type {Record<string, unknown>} */ ({ ...payload.data })
      : {};
  /** @type {Record<string, unknown>} */
  const out = { ...nested };
  for (const k of [
    "clientId",
    "orderId",
    "changes",
    "date",
    "title",
    "amount",
    "description",
    "category",
    "period",
    "transactionId",
  ]) {
    if (k in payload && payload[k] !== undefined && out[k] === undefined) {
      out[k] = payload[k];
    }
  }
  return out;
}

/**
 * @param {unknown} raw
 */
function pickOrderChanges(raw) {
  if (!raw || typeof raw !== "object") return {};
  const allowed = [
    "status",
    "title",
    "clientName",
    "product",
    "quantity",
    "total",
    "amount",
    "estimatedAmount",
    "notes",
  ];
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const k of allowed) {
    if (!(k in /** @type {Record<string, unknown>} */ (raw))) continue;
    const v = /** @type {Record<string, unknown>} */ (raw)[k];
    if (v === null || v === undefined) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    }
  }
  return out;
}

function normalizePhoneForMatch(raw) {
  return String(raw ?? "").replace(/\D/g, "");
}

function hasValidPhoneDigits(raw) {
  return normalizePhoneForMatch(raw).length >= 7;
}

async function resolveClientDocRefByActionData(businessId, data) {
  const byId = typeof data.clientId === "string" ? data.clientId.trim() : String(data.clientId ?? "").trim();
  if (byId) {
    const ref = doc(db, "businesses", businessId, "clients", byId);
    const snap = await getDoc(ref);
    if (snap.exists) return { ref, snap };
  }

  const phoneRaw =
    typeof data.phone === "string"
      ? data.phone
      : typeof data.clientPhone === "string"
        ? data.clientPhone
        : "";
  const normalizedPhone = normalizePhoneForMatch(phoneRaw);
  if (hasValidPhoneDigits(normalizedPhone)) {
    const byNormalized = await getDocs(
      query(
        collection(db, "businesses", businessId, "clients"),
        where("normalizedPhone", "==", normalizedPhone),
        limit(1),
      ),
    );
    if (!byNormalized.empty) {
      const hit = byNormalized.docs[0];
      return { ref: hit.ref, snap: hit };
    }
    const byPhone = await getDocs(
      query(collection(db, "businesses", businessId, "clients"), where("phone", "==", normalizedPhone), limit(1)),
    );
    if (!byPhone.empty) {
      const hit = byPhone.docs[0];
      return { ref: hit.ref, snap: hit };
    }
  }

  const nameRaw =
    typeof data.name === "string"
      ? data.name.trim()
      : typeof data.clientName === "string"
        ? data.clientName.trim()
        : "";
  if (nameRaw) {
    const byName = await getDocs(
      query(collection(db, "businesses", businessId, "clients"), where("name", "==", nameRaw), limit(1)),
    );
    if (!byName.empty) {
      const hit = byName.docs[0];
      return { ref: hit.ref, snap: hit };
    }
  }
  return null;
}

/**
 * Resuelve un pedido en `jobs` o `orders` por id de documento.
 * @param {string} businessId
 * @param {string} orderId
 */
async function resolveOrderDocRef(businessId, orderId) {
  const refJobs = doc(db, "businesses", businessId, "jobs", orderId);
  const refOrders = doc(db, "businesses", businessId, "orders", orderId);
  const sj = await getDoc(refJobs);
  if (sj.exists) return { ref: refJobs, kind: "jobs" };
  const so = await getDoc(refOrders);
  if (so.exists) return { ref: refOrders, kind: "orders" };
  return null;
}

/**
 * @param {string} businessId
 * @param {{ action: string, data?: Record<string, unknown> }} payload
 */
async function executeMayaActionFromChat(businessId, payload) {
  const data = mergeMayaActionData(
    payload && typeof payload === "object" ? /** @type {Record<string, unknown>} */ (payload) : {},
  );
  console.log("[MayaAction]", { action: payload.action, data });

  if (payload.action === "save_client") {
    const nameRaw = typeof data.name === "string" ? data.name.trim() : "";
    const phoneRaw =
      typeof data.phone === "string"
        ? data.phone.trim()
        : typeof data.clientPhone === "string"
          ? data.clientPhone.trim()
          : "";
    const normalizedPhone = normalizePhoneForMatch(phoneRaw);
    const emailRaw = typeof data.email === "string" ? data.email.trim() : "";
    console.log("[ClientSave]", { clientName: nameRaw, phone: phoneRaw, normalizedPhone });

    const existing = await resolveClientDocRefByActionData(businessId, {
      clientId: data.clientId,
      name: nameRaw,
      clientName: nameRaw,
      phone: normalizedPhone || phoneRaw,
    });
    if (existing) {
      const prev = existing.snap.data() || {};
      const prevPhone = typeof prev.phone === "string" ? prev.phone : "";
      const prevNormalized = typeof prev.normalizedPhone === "string" ? prev.normalizedPhone : "";
      const patch = {
        fullName: nameRaw || String(prev.fullName || prev.name || "Cliente"),
        name: nameRaw || String(prev.name || prev.fullName || "Cliente"),
        email: emailRaw || String(prev.email || ""),
        source: "chat-maya",
        updatedAt: serverTimestamp(),
      };
      if (normalizedPhone) {
        patch.phone = phoneRaw || normalizedPhone;
        patch.normalizedPhone = normalizedPhone;
      } else if (!prevNormalized && hasValidPhoneDigits(prevPhone)) {
        patch.normalizedPhone = normalizePhoneForMatch(prevPhone);
      }
      console.log("[MayaAction] Firestore write path", `businesses/${businessId}/clients/${existing.ref.id}`);
      await updateDoc(existing.ref, patch);
      return "save_client";
    }

    const createdRef = await addDoc(collection(db, "businesses", businessId, "clients"), {
      fullName: nameRaw || "Cliente",
      name: nameRaw || "Cliente",
      phone: normalizedPhone ? phoneRaw || normalizedPhone : "",
      normalizedPhone: normalizedPhone || "",
      email: emailRaw,
      source: "chat-maya",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    console.log("[MayaAction] Firestore write path", `businesses/${businessId}/clients/${createdRef.id}`);
    return "save_client";
  }

  if (payload.action === "search_client") {
    const found = await resolveClientDocRefByActionData(businessId, data);
    if (!found) throw new Error("No encontré el cliente solicitado.");
    return "search_client";
  }

  if (payload.action === "update_client") {
    const resolved = await resolveClientDocRefByActionData(businessId, data);
    if (!resolved) throw new Error("No encontré el cliente para actualizar.");
    const prev = resolved.snap.data() || {};
    const nameRaw =
      typeof data.name === "string"
        ? data.name.trim()
        : typeof data.clientName === "string"
          ? data.clientName.trim()
          : "";
    const phoneRaw =
      typeof data.phone === "string"
        ? data.phone.trim()
        : typeof data.clientPhone === "string"
          ? data.clientPhone.trim()
          : "";
    const normalizedPhone = normalizePhoneForMatch(phoneRaw);
    const emailRaw = typeof data.email === "string" ? data.email.trim() : "";
    const patch = { updatedAt: serverTimestamp() };
    if (nameRaw) {
      patch.name = nameRaw;
      patch.fullName = nameRaw;
    }
    if (normalizedPhone) {
      patch.phone = phoneRaw || normalizedPhone;
      patch.normalizedPhone = normalizedPhone;
    } else if (!prev.normalizedPhone && hasValidPhoneDigits(prev.phone)) {
      patch.normalizedPhone = normalizePhoneForMatch(prev.phone);
    }
    if (emailRaw) patch.email = emailRaw;
    console.log("[MayaAction] Firestore write path", `businesses/${businessId}/clients/${resolved.ref.id}`);
    await updateDoc(resolved.ref, patch);
    return "update_client";
  }

  if (payload.action === "create_order") {
    const qty = Number(data.quantity);
    const total = Number(data.total);
    const clientName = typeof data.clientName === "string" ? data.clientName.trim() : "";
    const product = typeof data.product === "string" ? data.product.trim() : "";
    await addDoc(collection(db, "businesses", businessId, "jobs"), {
      status: "Pendiente",
      title: clientName && product ? `${clientName} — ${product}` : "Pedido desde Chat IA",
      clientName,
      product,
      quantity: Number.isFinite(qty) ? qty : 0,
      total: Number.isFinite(total) ? total : 0,
      amount: Number.isFinite(total) ? total : 0,
      estimatedAmount: Number.isFinite(total) ? total : 0,
      source: "chat-maya",
      createdAt: serverTimestamp(),
    });
    return "create_order";
  }

  if (payload.action === "schedule_delivery") {
    const clientName = typeof data.clientName === "string" ? data.clientName.trim() : "";
    const product = typeof data.product === "string" ? data.product.trim() : "";
    const rawDate = data.deliveryDate;
    let dateTs = Timestamp.now();
    if (rawDate != null) {
      const d = new Date(
        typeof rawDate === "string" || typeof rawDate === "number" ? rawDate : String(rawDate),
      );
      if (!Number.isNaN(d.getTime())) {
        d.setHours(12, 0, 0, 0);
        dateTs = Timestamp.fromDate(d);
      }
    }
    await addDoc(collection(db, "businesses", businessId, "calendar"), {
      title:
        clientName && product
          ? `Entrega: ${clientName} — ${product}`
          : "Entrega programada (Chat IA)",
      date: dateTs,
      clientName,
      product,
      deliveryDate:
        rawDate == null ? "" : typeof rawDate === "string" ? rawDate : String(rawDate),
      source: "chat-maya",
      createdAt: serverTimestamp(),
    });
    return "schedule_delivery";
  }

  if (payload.action === "delete_client") {
    const needsConfirm = data.requiresConfirmation === true || payload.requiresConfirmation === true;
    const confirmed = data.confirmed === true || payload.confirmed === true;
    if (needsConfirm && !confirmed) {
      throw new Error("¿Confirmas borrar este cliente?");
    }
    const clientId =
      typeof data.clientId === "string" ? data.clientId.trim() : String(data.clientId ?? "").trim();
    if (clientId) {
      await deleteDoc(doc(db, "businesses", businessId, "clients", clientId));
      console.log("[MayaAction] Firestore write path", `businesses/${businessId}/clients/${clientId}`);
      return "delete_client";
    }
    const resolved = await resolveClientDocRefByActionData(businessId, data);
    if (!resolved) throw new Error("No encontré el cliente para eliminar.");
    await deleteDoc(resolved.ref);
    console.log("[MayaAction] Firestore write path", `businesses/${businessId}/clients/${resolved.ref.id}`);
    return "delete_client";
  }

  if (payload.action === "delete_order") {
    const orderId =
      typeof data.orderId === "string" ? data.orderId.trim() : String(data.orderId ?? "").trim();
    if (!orderId) throw new Error("Falta orderId para eliminar el pedido.");
    const resolved = await resolveOrderDocRef(businessId, orderId);
    if (!resolved) throw new Error("No se encontró el pedido en órdenes ni en trabajos.");
    await deleteDoc(resolved.ref);
    return "delete_order";
  }

  if (payload.action === "update_order") {
    const orderId =
      typeof data.orderId === "string" ? data.orderId.trim() : String(data.orderId ?? "").trim();
    const rawChanges = data.changes && typeof data.changes === "object" ? data.changes : {};
    if (!orderId) throw new Error("Falta orderId para actualizar el pedido.");
    const changes = pickOrderChanges(rawChanges);
    if (Object.keys(changes).length === 0) throw new Error("No hay cambios válidos en el pedido.");
    const resolved = await resolveOrderDocRef(businessId, orderId);
    if (!resolved) throw new Error("No se encontró el pedido para actualizar.");
    await updateDoc(resolved.ref, {
      ...changes,
      updatedAt: serverTimestamp(),
    });
    return "update_order";
  }

  if (payload.action === "create_calendar_event") {
    const title =
      typeof data.title === "string" ? data.title.trim() : String(data.title ?? "").trim();
    const rawDate = data.date;
    if (!title) throw new Error("Falta el título del evento en calendario.");
    let dateTs = Timestamp.now();
    if (rawDate != null) {
      const d = new Date(
        typeof rawDate === "string" || typeof rawDate === "number" ? rawDate : String(rawDate),
      );
      if (!Number.isNaN(d.getTime())) {
        d.setHours(12, 0, 0, 0);
        dateTs = Timestamp.fromDate(d);
      }
    }
    await addDoc(collection(db, "businesses", businessId, "calendar"), {
      title,
      date: dateTs,
      deliveryDate: rawDate == null ? "" : typeof rawDate === "string" ? rawDate : String(rawDate),
      source: "chat-maya",
      createdAt: serverTimestamp(),
    });
    return "create_calendar_event";
  }

  return null;
}

function mayaActionCompletedLabel(kind) {
  if (kind === "save_client") return "guardar cliente";
  if (kind === "search_client") return "buscar cliente";
  if (kind === "update_client") return "actualizar cliente";
  if (kind === "create_order") return "crear orden";
  if (kind === "schedule_delivery") return "programar entrega";
  if (kind === "delete_client") return "eliminar cliente";
  if (kind === "delete_order") return "eliminar pedido";
  if (kind === "update_order") return "actualizar pedido";
  if (kind === "create_calendar_event") return "crear evento en calendario";
  return "acción";
}

/**
 * @param {HTMLElement} assistantWrap
 * @param {string} assistantText
 */
async function convertConversationToOrder(assistantWrap, assistantText) {
  if (!activeBusiness) {
    showToast("No hay negocio activo.", true);
    return;
  }

  let quote = null;
  const raw = assistantWrap.dataset.quoteJson;
  if (raw) {
    try {
      quote = JSON.parse(raw);
    } catch {
      quote = null;
    }
  }

  const delivery = new Date();
  delivery.setDate(delivery.getDate() + DELIVERY_DAYS_OFFSET);
  delivery.setHours(12, 0, 0, 0);

  const deliveryTs = Timestamp.fromDate(delivery);
  const deliveryLabel = delivery.toLocaleDateString("es", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const notes = conversationSnippet();

  /** @type {Record<string, unknown>} */
  const payload = {
    status: "Pendiente",
    title: quote ? `${quote.productLabel} × ${quote.quantity}` : "Pedido desde Chat IA",
    source: "chat-ai",
    notes,
    assistantExcerpt: assistantText.slice(0, 2000),
    createdAt: serverTimestamp(),
    deliveryDate: deliveryTs,
    estimatedDeliveryLabel: deliveryLabel,
    deliveryDaysOffset: DELIVERY_DAYS_OFFSET,
  };

  if (quote) {
    payload.productKey = quote.productKey;
    payload.quantity = quote.quantity;
    payload.pricePerPiece = quote.pricePerPiece;
    payload.subtotal = quote.subtotal;
    payload.logoFee = quote.logoFee ?? 0;
    payload.total = quote.total;
    payload.deposit = quote.deposit;
    payload.estimatedAmount = quote.total;
    payload.amount = quote.total;
  } else {
    payload.estimatedAmount = 0;
    payload.amount = 0;
  }

  try {
    await addDoc(collection(db, "businesses", activeBusiness.id, "jobs"), payload);
    showToast("Orden creada como Pendiente. Revisa el calendario para la fecha de entrega.");
    if (activeBusiness) {
      await loadFirebaseContext(activeBusiness);
    }
  } catch (e) {
    console.error("[YourColor Chat] orden", e);
    showToast(e instanceof Error ? e.message : "No se pudo crear la orden.", true);
  }
}

async function sendToClaude() {
  const input = document.getElementById("yc-chat-input");
  const btn = document.getElementById("yc-chat-send");
  const text = input && "value" in input ? String(input.value).trim() : "";
  if (!text) return;
  console.log("[MayaAction] incoming user message", text);
  if (!activeBusiness) {
    showToast("Espera a que cargue tu negocio o vuelve a iniciar sesión.", true);
    return;
  }

  hideError();
  appendUserBubble(text);
  if (input) input.value = "";

  apiConversation.push({ role: "user", content: text });
  trimApiMessages();

  if (btn) {
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
  }
  if (input) input.disabled = true;
  setVoiceMicUiState({ listening: false, supported: mayaSpeechSupported });

  try {
    await loadFirebaseContext(activeBusiness, { userMessage: text });

    const res = await fetch(CHAT_WITH_AI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        messages: apiConversation.slice(-MAX_API_MESSAGES),
        firebaseContext: firebaseContextPayload,
        stream: true,
      }),
    });

    const rawErr = !res.ok ? await res.text() : "";
    if (!res.ok) {
      let errMsg = rawErr || `Error ${res.status}`;
      try {
        const j = JSON.parse(rawErr);
        if (typeof j.error === "string") errMsg = j.error;
      } catch {
        /* ignore */
      }
      throw new Error(errMsg);
    }

    // Siempre enviamos stream:true al backend; el cuerpo es NDJSON aunque el Content-Type venga alterado por un proxy.
    let reply = "";
    if (res.body) {
      const shell = createStreamingAssistantShell();
      if (!shell) throw new Error("No se pudo mostrar la respuesta.");
      try {
        reply = await readMayaNdjsonStream(res, (chunk) => {
          shell.bubble.textContent += chunk;
          const st = document.getElementById("yc-chat-stream");
          scrollChatStreamToBottomIfNear(st);
        });
      } finally {
        shell.bubble.removeAttribute("aria-busy");
        shell.wrap.remove();
      }
      reply = String(reply || "").trim();
    } else {
      const json = await res.json();
      reply = typeof json.reply === "string" ? json.reply.trim() : "";
    }

    if (!reply) {
      throw new Error("Respuesta vacía del asistente.");
    }

    const { visible: assistantVisible, actionPayload } = appendAssistantBubble(reply);
    apiConversation.push({ role: "assistant", content: assistantVisible });
    trimApiMessages();

    if (activeBusiness) {
      void loadFirebaseContext(activeBusiness).catch((e) => {
        console.warn("[YourColor Chat] context refresh", e);
      });
    }

    if (actionPayload && activeBusiness?.id && actionPayload.action !== "save_client") {
      try {
        const kind = await executeMayaActionFromChat(activeBusiness.id, actionPayload);
        if (kind) {
          showToast(`✅ ${mayaActionCompletedLabel(kind)} completada`);
          await loadFirebaseContext(activeBusiness);
        }
      } catch (e) {
        console.error("[YourColor Chat] MAYA_ACTION_JSON", e);
        showToast(e instanceof Error ? e.message : "No se pudo ejecutar la acción.", true);
      }
    } else if (actionPayload && !activeBusiness?.id && actionPayload.action !== "save_client") {
      showToast("No hay negocio activo para ejecutar la acción.", true);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al contactar el asistente.";
    showError(msg);
    apiConversation.pop();
    if (input) input.value = text;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
    }
    if (input) input.disabled = false;
    setVoiceMicUiState({ listening: false, supported: mayaSpeechSupported });
    input?.focus();
  }
}

function wireComposer() {
  const input = document.getElementById("yc-chat-input");
  const btn = document.getElementById("yc-chat-send");
  const form = document.getElementById("mayaInputBar");
  if (!input || !btn || btn.dataset.wired === "1") return;
  btn.dataset.wired = "1";

  btn.addEventListener("click", () => sendToClaude());
  if (form && form.dataset.wired !== "1") {
    form.dataset.wired = "1";
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      sendToClaude();
    });
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendToClaude();
    }
  });

  initVoiceInput();
}

function showWelcomeAssistant() {
  const stream = document.getElementById("yc-chat-stream");
  if (!stream) return;
  const wrap = document.createElement("div");
  wrap.className = "yc-msg yc-msg--assistant";
  const col = document.createElement("div");
  col.className = "yc-msg-inner-col";
  const bubble = document.createElement("div");
  bubble.className = "yc-msg-bubble maya-message assistant";
  bubble.textContent = MAYA_WELCOME_STATIC;
  const time = document.createElement("div");
  time.className = "yc-msg-time";
  time.textContent = formatTime();
  col.appendChild(bubble);
  col.appendChild(time);
  wrap.appendChild(col);
  stream.appendChild(wrap);
  scrollChatStreamToBottom(stream);
}

async function clearChatHistory() {
  // Limpiar UI del chat
  const chatContainer = document.getElementById("chatMessages") || document.getElementById("yc-chat-stream");
  if (chatContainer) chatContainer.innerHTML = "";

  // Limpiar localStorage
  localStorage.removeItem("mayaConversationHistory");
  localStorage.removeItem("lastMayaMessage");

  // Limpiar memoria en runtime del chat interno
  apiConversation = [];

  // Limpiar historial persistido en Firestore para evitar restaurar conversaciones viejas
  const businessId = activeBusiness?.id;
  const userId = auth.currentUser?.uid;
  if (businessId && userId) {
    clearChatSessionStorage(userId, businessId);
    try {
      await deleteDoc(doc(db, "businesses", businessId, "internalChatHistory", userId));
    } catch (e) {
      console.warn("[YourColor Chat] clear internalChatHistory", e);
    }
    try {
      const internalChatSnap = await getDocs(collection(db, "businesses", businessId, "internalChat"));
      await Promise.all(internalChatSnap.docs.map((x) => deleteDoc(x.ref)));
    } catch (e) {
      console.warn("[YourColor Chat] clear internalChat", e);
    }
  }

  // Mostrar bienvenida
  const container = document.getElementById("chatMessages") || document.getElementById("yc-chat-stream");
  if (container) {
    if (container.id === "chatMessages") {
      container.innerHTML = `
      <div class="maya-message">Hola Marvin 👋</div>
    `;
    } else {
      showWelcomeAssistant();
    }
  }
}

function clearChatPageSession() {
  const businessId = activeBusiness?.id;
  const userId = auth.currentUser?.uid || panelChatUserIdCache;
  apiConversation = [];
  localStorage.removeItem("mayaConversationHistory");
  localStorage.removeItem("lastMayaMessage");
  if (businessId && userId) {
    clearChatSessionStorage(userId, businessId);
  }
}

/**
 * Burbuja vacía para ir rellenando con streaming.
 * @returns {{ wrap: HTMLDivElement, bubble: HTMLDivElement } | null}
 */
function createStreamingAssistantShell() {
  const stream = document.getElementById("yc-chat-stream");
  if (!stream) return null;
  const wrap = document.createElement("div");
  wrap.className = "yc-msg yc-msg--assistant";
  const col = document.createElement("div");
  col.className = "yc-msg-inner-col";
  const bubble = document.createElement("div");
  bubble.className = "yc-msg-bubble maya-message assistant";
  bubble.textContent = "";
  bubble.setAttribute("aria-busy", "true");
  const time = document.createElement("div");
  time.className = "yc-msg-time";
  time.textContent = formatTime();
  col.appendChild(bubble);
  col.appendChild(time);
  wrap.appendChild(col);
  stream.appendChild(wrap);
  scrollChatStreamToBottomIfNear(stream);
  return { wrap, bubble };
}

/**
 * Lee respuesta NDJSON del endpoint con streaming (delta + done).
 * @param {Response} res
 * @param {(chunk: string) => void} onDelta
 * @returns {Promise<string>}
 */
async function readMayaNdjsonStream(res, onDelta) {
  const body = res.body;
  if (!body || !body.getReader) {
    return "";
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let finalReply = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (ev.type === "delta" && typeof ev.text === "string") {
        onDelta(ev.text);
      }
      if (ev.type === "done" && typeof ev.reply === "string") {
        finalReply = ev.reply;
      }
      if (ev.type === "error") {
        throw new Error(typeof ev.message === "string" ? ev.message : "Error del asistente");
      }
    }
  }
  const tail = buf.trim();
  if (tail) {
    try {
      const ev = JSON.parse(tail);
      if (ev.type === "done" && typeof ev.reply === "string") finalReply = ev.reply;
    } catch {
      /* ignore */
    }
  }
  return finalReply;
}

/**
 * @param {{ id: string, data: Record<string, unknown> }} business
 * @param {{ userMessage?: string }} [options]
 */
async function loadFirebaseContext(business, options = {}) {
  const userMessage = typeof options.userMessage === "string" ? options.userMessage : "";
  const bootstrap = options.bootstrap === true;
  const { flags, priority } = inferMayaDataFocus(userMessage);

  let campaignCap = flags.campaigns ? 22 : flags.finance ? 8 : 14;
  let financeDetailCap = flags.finance ? 95 : 60;
  let clientLimit = 30;
  let calendarDays = 28;
  let financeReadCap = 280;

  if (bootstrap) {
    campaignCap = Math.min(campaignCap, 8);
    financeDetailCap = 40;
    clientLimit = 18;
    calendarDays = 14;
    financeReadCap = 140;
  }

  const [jobSplit, orderSplit, clientsRaw, campAgg, financeMonth, calendarNext] = await Promise.all([
    fetchJobsSplitForChat(db, business.id, bootstrap ? 90 : 150, bootstrap ? 35 : 50, bootstrap ? 8 : 10),
    fetchOrdersSplitForChat(db, business.id, bootstrap ? 90 : 150, bootstrap ? 35 : 50, bootstrap ? 8 : 10),
    fetchClientsForChatContext(db, business.id, clientLimit),
    fetchCampaignsListAndStats(db, business.id),
    fetchFinanceTransactionsCurrentMonth(db, business.id, financeReadCap),
    fetchCalendarEventsForChat(db, business.id, calendarDays),
  ]);

  const financeRows = financeMonth.slice(0, financeDetailCap);

  let monthIncome = 0;
  let monthExpense = 0;
  for (const row of financeMonth) {
    const amt = Number(row.amount);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    if (row.type === "expense") monthExpense += amt;
    else if (financeIncomeCountsTowardRealized(row)) monthIncome += amt;
  }

  const campaignsShort = (campAgg.campaigns || []).slice(0, campaignCap);
  const clientsMentioned = findClientsMentionedInText(userMessage, clientsRaw);

  const profile = slimBusinessProfileForChat(business.data) || {};
  firebaseContextPayload = {
    businessId: business.id,
    profile,
    dataFocus: priority,
    dataFocusHint: flags.finance
      ? "Prioridad: finanzas del mes."
      : flags.calendar
        ? "Prioridad: agenda y entregas."
        : flags.orders
          ? "Prioridad: pedidos y producción."
          : flags.clients
            ? "Prioridad: clientes y seguimiento."
            : flags.campaigns
              ? "Prioridad: campañas y marketing."
              : "Contexto general del negocio.",
    jobs: serializeForAi(jobSplit.active),
    jobsRecentDelivered: serializeForAi(jobSplit.recentDelivered),
    orders: serializeForAi(orderSplit.active),
    ordersRecentDelivered: serializeForAi(orderSplit.recentDelivered),
    clients: serializeForAi(clientsRaw),
    clientsMentionedInMessage: serializeForAi(clientsMentioned),
    campaigns: serializeForAi(campaignsShort),
    calendarUpcomingFourWeeks: serializeForAi(calendarNext),
    financeThisMonth: {
      income: monthIncome,
      expense: monthExpense,
      net: monthIncome - monthExpense,
    },
    financeRecent: serializeForAi(financeRows),
    stats: {
      jobsActiveCount: jobSplit.active.length,
      jobsDeliveredListed: jobSplit.recentDelivered.length,
      ordersActiveCount: orderSplit.active.length,
      ordersDeliveredListed: orderSplit.recentDelivered.length,
      clientCount: clientsRaw.length,
      campaignCount: campaignsShort.length,
      financeMonthCount: financeMonth.length,
      calendarEventCount: calendarNext.length,
    },
    contextNote: bootstrap
      ? "Carga inicial ligera para arranque rápido; al escribir, el contexto se amplía según el tema."
      : "Datos cargados con foco inteligente: clientes recientes; trabajos/pedidos activos + últimas entregas; finanzas del mes; calendario próximas semanas. Si falta algo, dilo con naturalidad y pide a Marvin lo que necesites.",
    contextBootstrap: bootstrap,
  };

  const meta = document.getElementById("yc-chat-context-meta");
  if (meta) {
    meta.textContent = `${jobSplit.active.length} trabajos activos · ${orderSplit.active.length} pedidos activos · ${clientsRaw.length} clientes recientes`;
  }
}

// ——— Centro de Control Maya (Firebase en vivo) ———

/** @param {unknown} ts */
function mayaTimestampToDate(ts) {
  if (ts == null) return null;
  if (typeof ts === "object" && ts !== null && typeof /** @type {{ toDate?: () => Date }} */ (ts).toDate === "function") {
    try {
      const d = /** @type {{ toDate: () => Date }} */ (ts).toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    } catch {
      return null;
    }
  }
  if (ts instanceof Date) return Number.isNaN(ts.getTime()) ? null : ts;
  return null;
}

function mayaStartOfToday() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 0, 0, 0, 0);
}

/** @param {unknown} ts */
function mayaFormatRelativeTime(ts) {
  const d = mayaTimestampToDate(ts);
  if (!d) return "—";
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 0) return "ahora";
  const diffM = Math.floor(diffMs / 60000);
  if (diffM < 1) return "ahora";
  if (diffM < 60) return `hace ${diffM} min`;
  const diffH = Math.floor(diffM / 60);
  if (diffH < 24 && d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) {
    return `hace ${diffH} h`;
  }
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (
    d.getDate() === y.getDate() &&
    d.getMonth() === y.getMonth() &&
    d.getFullYear() === y.getFullYear()
  ) {
    return "ayer";
  }
  return d.toLocaleDateString("es", { weekday: "short", day: "numeric", month: "short" });
}

/** @param {string} phoneDocId */
function mayaFormatPhoneDisplay(phoneDocId) {
  const raw = String(phoneDocId ?? "").replace(/\D/g, "");
  if (!raw || raw === "unknown") return "—";
  if (raw.length === 11 && raw.startsWith("1")) {
    return `+1 ${raw.slice(1, 4)}-${raw.slice(4, 7)}-${raw.slice(7)}`;
  }
  if (raw.length === 10) {
    return `+1 ${raw.slice(0, 3)}-${raw.slice(3, 6)}-${raw.slice(6)}`;
  }
  return `+${raw}`;
}

/**
 * @param {Record<string, unknown>} data
 * @returns {{ label: string, className: string }}
 */
function mayaStatusBadge(data) {
  const s = typeof data.status === "string" ? data.status : "";
  switch (s) {
    case "active":
      return { label: "🟢 Activa", className: "maya-cc-conv__status maya-cc-conv__status--green" };
    case "waiting":
      return { label: "🟡 Esperando cliente", className: "maya-cc-conv__status maya-cc-conv__status--yellow" };
    case "confirmed":
      return { label: "✅ Orden confirmada", className: "maya-cc-conv__status maya-cc-conv__status--ok" };
    case "needs_attention":
      return { label: "⚠️ Necesita a Marvin", className: "maya-cc-conv__status maya-cc-conv__status--warn" };
    default:
      return { label: "—", className: "maya-cc-conv__status" };
  }
}

/** @param {string} key */
function mayaSetStat(key, display) {
  const el = document.querySelector(`[data-maya-stat="${key}"]`);
  if (el) el.textContent = display;
}

/**
 * @param {Record<string, unknown>[]} conversations
 * @param {Record<string, unknown>[]} orders
 */
function mayaUpdateStats(conversations, orders) {
  const sod = mayaStartOfToday().getTime();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const weekCut = Date.now() - weekMs;

  let chatsActiveToday = 0;
  for (const c of conversations) {
    const t = mayaTimestampToDate(c.lastMessageAt);
    if (t && t.getTime() >= sod) chatsActiveToday += 1;
  }

  let salesClosedToday = 0;
  let totalSalesToday = 0;
  for (const o of orders) {
    const t = mayaTimestampToDate(o.createdAt);
    if (t && t.getTime() >= sod) {
      salesClosedToday += 1;
      totalSalesToday += Number(o.total) || 0;
    }
  }

  const pendingAttention = conversations.filter((c) => c.status === "needs_attention").length;

  const convIdsWeek = new Set();
  for (const c of conversations) {
    const t = mayaTimestampToDate(c.lastMessageAt);
    if (t && t.getTime() >= weekCut) convIdsWeek.add(String(c.id ?? ""));
  }
  const chatsWeek = convIdsWeek.size;

  let salesWeek = 0;
  let revenueWeek = 0;
  for (const o of orders) {
    const t = mayaTimestampToDate(o.createdAt);
    if (t && t.getTime() >= weekCut) {
      salesWeek += 1;
      revenueWeek += Number(o.total) || 0;
    }
  }

  const conversionPct = chatsWeek > 0 ? (salesWeek / chatsWeek) * 100 : 0;

  const nConv = conversations.length;
  const autoReplyPct = nConv > 0 ? (conversations.filter((c) => c.mayaInControl === true).length / nConv) * 100 : 0;
  const escalatedPct = nConv > 0 ? (conversations.filter((c) => c.status === "needs_attention").length / nConv) * 100 : 0;

  mayaSetStat("chats-active-today", String(chatsActiveToday));
  mayaSetStat("sales-closed-today", String(salesClosedToday));
  mayaSetStat("sales-total-today", formatMoney(totalSalesToday));
  mayaSetStat("pending-today", String(pendingAttention));

  mayaSetStat("chats-week", String(chatsWeek));
  mayaSetStat("sales-week", String(salesWeek));
  mayaSetStat("revenue-week", formatMoney(revenueWeek));
  mayaSetStat("conversion-week", `${Math.round(conversionPct)}%`);

  mayaSetStat("auto-reply-pct", `${Math.round(autoReplyPct)}%`);
  mayaSetStat("escalated-pct", `${Math.round(escalatedPct)}%`);
}

/**
 * @param {string} businessId
 * @param {string[]} phoneIds
 */
async function mayaComputeAvgResponseMinutes(businessId, phoneIds) {
  const cap = Math.min(phoneIds.length, 40);
  const deltas = [];
  for (let i = 0; i < cap; i += 1) {
    const pid = phoneIds[i];
    try {
      const ref = collection(db, "businesses", businessId, "conversations", pid, "messages");
      const q = query(ref, orderBy("at", "asc"), limit(120));
      const snap = await getDocs(q);
      /** @type {{ from?: string, at?: unknown }[]} */
      const rows = [];
      snap.forEach((d) => {
        const x = d.data();
        rows.push({ from: typeof x.from === "string" ? x.from : "", at: x.at });
      });
      for (let j = 0; j < rows.length - 1; j += 1) {
        if (rows[j].from !== "customer") continue;
        const next = rows[j + 1];
        if (next.from !== "maya") continue;
        const t0 = mayaTimestampToDate(rows[j].at);
        const t1 = mayaTimestampToDate(next.at);
        if (t0 && t1) {
          const ms = t1.getTime() - t0.getTime();
          if (ms > 0 && ms < 48 * 60 * 60 * 1000) deltas.push(ms);
        }
      }
    } catch (e) {
      console.warn("[Maya CC] avg response for", pid, e);
    }
  }
  if (deltas.length === 0) return 0;
  const sum = deltas.reduce((a, b) => a + b, 0);
  return sum / deltas.length / 60000;
}

/**
 * @param {string} businessId
 * @param {Record<string, unknown>[]} conversations
 */
function mayaScheduleAvgResponse(businessId, conversations) {
  if (mayaAvgDebounce) clearTimeout(mayaAvgDebounce);
  mayaAvgDebounce = setTimeout(async () => {
    mayaAvgDebounce = null;
    const ids = conversations.map((c) => String(c.id ?? "")).filter(Boolean);
    const avgMin = await mayaComputeAvgResponseMinutes(businessId, ids);
    if (avgMin <= 0) {
      mayaSetStat("avg-response-min", "0 min");
    } else if (avgMin < 1) {
      mayaSetStat("avg-response-min", "< 1 min");
    } else {
      mayaSetStat("avg-response-min", `${Math.round(avgMin)} min`);
    }
  }, 600);
}

/**
 * @param {string} businessId
 * @param {Record<string, unknown>[]} convRows
 */
async function mayaFetchAttentionReason(businessId, phoneDocId) {
  try {
    const ref = collection(db, "businesses", businessId, "conversations", phoneDocId, "messages");
    const q = query(ref, orderBy("at", "desc"), limit(8));
    const snap = await getDocs(q);
    for (const doc of snap.docs) {
      const x = doc.data();
      if (x.from !== "maya" || !x.metadata || typeof x.metadata !== "object") continue;
      const r = /** @type {{ reason?: unknown }} */ (x.metadata).reason;
      if (typeof r === "string" && r.trim()) return r.trim();
    }
  } catch (e) {
    console.warn("[Maya CC] attention reason", e);
  }
  return null;
}

/**
 * @param {string} businessId
 * @param {Record<string, unknown>[]} convRows
 */
async function mayaRenderAlerts(businessId, convRows) {
  const list = document.getElementById("maya-cc-alerts-list");
  const empty = document.getElementById("maya-cc-alerts-empty");
  if (!list) return;

  const need = convRows.filter((c) => c.status === "needs_attention");
  list.innerHTML = "";

  if (need.length === 0) {
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;

  const reasons = await Promise.all(need.map((c) => mayaFetchAttentionReason(businessId, String(c.id ?? ""))));

  need.forEach((c, idx) => {
    const phoneId = String(c.id ?? "");
    const name =
      typeof c.customerName === "string" && c.customerName.trim()
        ? c.customerName.trim()
        : mayaFormatPhoneDisplay(phoneId);
    const reason = reasons[idx];
    const preview =
      reason ||
      (typeof c.lastMessage === "string" && c.lastMessage.trim() ? c.lastMessage.trim() : "Requiere tu atención.");

    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "maya-cc-alert";
    btn.dataset.mayaPhone = phoneId;
    btn.innerHTML = `<span class="maya-cc-alert__ico" aria-hidden="true">⚠️</span><span class="maya-cc-alert__text"></span><span class="maya-cc-alert__hint">Abrir en WhatsApp →</span>`;
    const textSpan = btn.querySelector(".maya-cc-alert__text");
    if (textSpan) textSpan.textContent = `${name}: ${preview}`;

    btn.addEventListener("click", () => {
      mayaOpenConversationInWaZone(phoneId);
    });

    li.appendChild(btn);
    list.appendChild(li);
  });
}

/** @param {string} phoneDocId */
function mayaOpenConversationInWaZone(phoneDocId) {
  setChatPageTab("whatsapp");
  mayaSelectedPhoneId = phoneDocId;
  const zone = document.querySelector("details.maya-cc-zone--wa");
  if (zone) {
    zone.open = true;
    zone.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  const listRoot = document.getElementById("maya-cc-wa-list");
  if (listRoot) {
    const safe =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(phoneDocId)
        : phoneDocId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const btn = listRoot.querySelector(`button[data-phone-id="${safe}"]`);
    if (btn instanceof HTMLButtonElement) btn.click();
  }
}

function mayaWireWaToolbar() {
  const intervene = document.getElementById("maya-cc-btn-intervene");
  const release = document.getElementById("maya-cc-btn-release");
  const note = document.getElementById("maya-cc-btn-note");
  if (intervene && !intervene.dataset.wired) {
    intervene.dataset.wired = "1";
    intervene.addEventListener("click", () => showToast("Intervenir: próximamente envío como Marvin desde el panel."));
  }
  if (release && !release.dataset.wired) {
    release.dataset.wired = "1";
    release.addEventListener("click", () => showToast("Soltar: Maya volverá a responder sola en la siguiente versión."));
  }
  if (note && !note.dataset.wired) {
    note.dataset.wired = "1";
    note.addEventListener("click", () => showToast("Nota interna: se guardará en Firebase en una iteración próxima."));
  }
}

/**
 * @param {string} businessId
 * @param {Record<string, unknown>[]} rows
 */
function mayaRenderConversationList(businessId, rows) {
  const empty = document.getElementById("maya-cc-wa-empty");
  const split = document.getElementById("maya-cc-wa-split");
  const listRoot = document.getElementById("maya-cc-wa-list");
  if (!listRoot || !split || !empty) return;

  if (rows.length === 0) {
    empty.hidden = false;
    split.hidden = true;
    if (mayaUnsubMessages) {
      mayaUnsubMessages();
      mayaUnsubMessages = null;
    }
    return;
  }

  empty.hidden = true;
  split.hidden = false;

  listRoot.innerHTML = "";
  for (const c of rows) {
    const phoneId = String(c.id ?? "");
    const title =
      typeof c.customerName === "string" && c.customerName.trim()
        ? c.customerName.trim()
        : mayaFormatPhoneDisplay(phoneId);
    const preview =
      typeof c.lastMessage === "string" && c.lastMessage.trim()
        ? c.lastMessage.trim()
        : "—";
    const timeLabel = mayaFormatRelativeTime(c.lastMessageAt);
    const badge = mayaStatusBadge(c);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "maya-cc-conv";
    btn.dataset.phoneId = phoneId;
    if (mayaSelectedPhoneId === phoneId) btn.classList.add("is-active");

    btn.innerHTML = `<span class="maya-cc-conv__top"><span class="maya-cc-conv__name"></span><span class="maya-cc-conv__time"></span></span><span class="maya-cc-conv__preview"></span><span class="maya-cc-conv__status"></span>`;
    const nameEl = btn.querySelector(".maya-cc-conv__name");
    const timeEl = btn.querySelector(".maya-cc-conv__time");
    const prevEl = btn.querySelector(".maya-cc-conv__preview");
    const stEl = btn.querySelector(".maya-cc-conv__status");
    if (nameEl) nameEl.textContent = title;
    if (timeEl) timeEl.textContent = timeLabel;
    if (prevEl) prevEl.textContent = preview;
    if (stEl) {
      stEl.className = badge.className;
      stEl.textContent = badge.label;
    }

    btn.addEventListener("click", () => {
      mayaSelectedPhoneId = phoneId;
      listRoot.querySelectorAll(".maya-cc-conv").forEach((el) => el.classList.remove("is-active"));
      btn.classList.add("is-active");
      const titleEl = document.getElementById("maya-cc-wa-thread-title");
      if (titleEl) titleEl.textContent = title;
      mayaSubscribeMessages(businessId, phoneId, title);
    });

    listRoot.appendChild(btn);
  }

  if (mayaSelectedPhoneId) {
    const exists = rows.some((r) => String(r.id) === mayaSelectedPhoneId);
    if (!exists) mayaSelectedPhoneId = null;
  }
  if (!mayaSelectedPhoneId && rows[0]) {
    const first = listRoot.querySelector(".maya-cc-conv");
    if (first instanceof HTMLButtonElement) first.click();
  }
}

/**
 * @param {string} businessId
 * @param {string} phoneDocId
 * @param {string} title
 */
function mayaSubscribeMessages(businessId, phoneDocId, title) {
  if (mayaUnsubMessages) {
    mayaUnsubMessages();
    mayaUnsubMessages = null;
  }
  const msgsEl = document.getElementById("maya-cc-wa-msgs");
  if (!msgsEl) return;

  const ref = collection(db, "businesses", businessId, "conversations", phoneDocId, "messages");
  const q = query(ref, orderBy("at", "asc"), limit(200));

  mayaUnsubMessages = onSnapshot(
    q,
    (snap) => {
      msgsEl.innerHTML = "";
      if (snap.empty) {
        const p = document.createElement("p");
        p.className = "maya-cc-wa-empty-thread";
        p.textContent = "Sin mensajes aún.";
        msgsEl.appendChild(p);
        return;
      }
      snap.forEach((docSnap) => {
        const x = docSnap.data();
        const fromRaw = typeof x.from === "string" ? x.from : "";
        const text = typeof x.text === "string" ? x.text : "";
        let who = "Cliente";
        let mod = "maya-cc-msg--client";
        if (fromRaw === "maya") {
          who = "Maya";
          mod = "maya-cc-msg--maya";
        } else if (fromRaw === "marvin") {
          who = "Marvin";
          mod = "maya-cc-msg--marvin";
        }
        const wrap = document.createElement("div");
        wrap.className = `maya-cc-msg ${mod}`;
        const w = document.createElement("span");
        w.className = "maya-cc-msg__who";
        w.textContent = who;
        const body = document.createElement("p");
        body.className = "maya-cc-msg__body";
        body.textContent = text;
        wrap.append(w, body);
        msgsEl.appendChild(wrap);
      });
      msgsEl.scrollTop = msgsEl.scrollHeight;
    },
    (err) => {
      console.error("[Maya CC] messages", err);
      msgsEl.innerHTML = "";
      const p = document.createElement("p");
      p.className = "maya-cc-wa-empty-thread";
      p.textContent = "No se pudieron cargar los mensajes.";
      msgsEl.appendChild(p);
    },
  );

  const titleEl = document.getElementById("maya-cc-wa-thread-title");
  if (titleEl) titleEl.textContent = title;
}

function mayaTeardownControlCenter() {
  if (mayaUnsubConversations) {
    mayaUnsubConversations();
    mayaUnsubConversations = null;
  }
  if (mayaUnsubOrders) {
    mayaUnsubOrders();
    mayaUnsubOrders = null;
  }
  if (mayaUnsubMessages) {
    mayaUnsubMessages();
    mayaUnsubMessages = null;
  }
  if (mayaAvgDebounce) {
    clearTimeout(mayaAvgDebounce);
    mayaAvgDebounce = null;
  }
  mayaCcBusinessId = null;
  mayaSelectedPhoneId = null;
}

/**
 * @param {{ id: string, data: Record<string, unknown> }} business
 */
function mayaInitControlCenter(business) {
  mayaTeardownControlCenter();
  mayaCcBusinessId = business.id;
  mayaWireWaToolbar();

  /** @type {Record<string, unknown>[]} */
  let convRows = [];
  /** @type {Record<string, unknown>[]} */
  let orderRows = [];

  const pushStats = () => {
    mayaUpdateStats(convRows, orderRows);
    void mayaRenderAlerts(business.id, convRows).catch((e) => console.error("[Maya CC] alerts", e));
    mayaScheduleAvgResponse(business.id, convRows);
  };

  const convCol = collection(db, "businesses", business.id, "conversations");
  mayaUnsubConversations = onSnapshot(
    convCol,
    (snap) => {
      convRows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      convRows.sort((a, b) => {
        const ta = mayaTimestampToDate(a.lastMessageAt)?.getTime() ?? 0;
        const tb = mayaTimestampToDate(b.lastMessageAt)?.getTime() ?? 0;
        return tb - ta;
      });
      mayaRenderConversationList(business.id, convRows);
      pushStats();
    },
    (e) => console.error("[Maya CC] conversations", e),
  );

  const ordCol = collection(db, "businesses", business.id, "orders");
  mayaUnsubOrders = onSnapshot(
    ordCol,
    (snap) => {
      orderRows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      pushStats();
    },
    (e) => console.error("[Maya CC] orders", e),
  );
}

async function bootWithUser(user) {
  const loading = document.getElementById("yc-chat-loading");
  const stream = document.getElementById("yc-chat-stream");
  try {
    const business = await resolveBusinessForUser(db, user);
    activeBusiness = business;
    const body = document.body;
    if (body) {
      const businessName = typeof business?.data?.businessName === "string" ? business.data.businessName.trim().toLowerCase() : "";
      const businessCategory =
        typeof business?.data?.businessCategory === "string" ? business.data.businessCategory.trim().toLowerCase() : "";
      const isYourColorBusiness = businessName === "yourcolor" || businessCategory === "custom_apparel";
      body.classList.toggle("yourcolor-chat-page", isYourColorBusiness);
      body.classList.toggle("non-yourcolor-chat-page", !isYourColorBusiness);
    }
    renderHeader(business);

    if (!business) {
      mayaTeardownControlCenter();
      if (loading) loading.hidden = true;
      showError("No hay negocio vinculado. Completa el onboarding o inicia sesión con la cuenta correcta.");
      return;
    }

    mayaInitControlCenter(business);

    clearChatSessionStorage(user.uid, business.id);

    if (loading) loading.hidden = true;
    if (stream) {
      stream.hidden = false;
      stream.innerHTML = "";
      showWelcomeAssistant();
      wireMayaMobileScrollDebug(stream);
      console.log("[MayaChat] rebuilt simple layout mounted");
      console.log("[MayaChat] message scroll container:", stream);
    }

    setComposerEnabled(true);
    wireComposer();
    const clearBtn = document.getElementById("yc-chat-clear-btn");
    if (clearBtn && clearBtn.dataset.wired !== "1") {
      clearBtn.dataset.wired = "1";
      clearBtn.addEventListener("click", () => {
        void clearChatHistory();
      });
    }
    if (!window.__cfMayaPagehideWired) {
      window.__cfMayaPagehideWired = true;
      window.addEventListener("pagehide", () => {
        clearChatPageSession();
        persistChatToSessionStorage();
      });
    }
    if (!window.__cfMayaBeforeUnloadWired) {
      window.__cfMayaBeforeUnloadWired = true;
      window.addEventListener("beforeunload", () => {
        clearChatPageSession();
      });
    }
    document.getElementById("yc-chat-input")?.focus();

    void loadFirebaseContext(business, { bootstrap: true }).catch((e) => {
      console.warn("[YourColor Chat] context bootstrap", e);
    });
  } catch (e) {
    console.error("[YourColor Chat]", e);
    if (loading) loading.hidden = true;
    showError(
      e instanceof Error ? e.message : "No se pudieron cargar los datos. Revisa Firestore y la red.",
    );
  }
}

function boot() {
  initDashShell({ auth, db });
  wireChatPageTabs();

  /** Evita tratar el primer `null` como cierre de sesión antes de restaurar persistencia. */
  let previousAuthUser = null;

  onAuthStateChanged(auth, (user) => {
    if (user) {
      panelChatUserIdCache = user.uid;
      previousAuthUser = user;
      bootWithUser(user).catch((err) => {
        console.error(err);
        const ld = document.getElementById("yc-chat-loading");
        if (ld) ld.hidden = true;
        showError("Error inesperado al iniciar el chat.");
      });
      return;
    }

    if (previousAuthUser) {
      const bid = activeBusiness?.id;
      const uid = panelChatUserIdCache;
      void (async () => {
        try {
          if (bid && uid && apiConversation.length) {
            await persistPanelChatHistory(bid, uid);
          }
        } catch (e) {
          console.warn("[YourColor Chat] save before sign-out", e);
        } finally {
          window.location.replace("login.html");
        }
      })();
      previousAuthUser = null;
      return;
    }

    window.location.replace("login.html");
  });
}

boot();
