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
/** Tras este tiempo sin actividad se guarda el historial y se limpia la vista (sesión de chat). */
const PANEL_CHAT_IDLE_MS = 60000;
const DELIVERY_DAYS_OFFSET = 12;

/** @type {ReturnType<typeof setTimeout> | null} */
let panelChatIdleTimer = null;
let panelChatUserIdCache = "";
/** Marca de tiempo de la última actividad en el chat (mensaje, scroll, etc.) para la ventana de 1 minuto al cambiar de página. */
let lastPanelChatActivityAt = 0;

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
  bubble.className = "yc-msg-bubble";
  bubble.textContent = content;

  const time = document.createElement("div");
  time.className = "yc-msg-time";
  time.textContent = formatTime();

  inner.appendChild(bubble);
  inner.appendChild(time);
  wrap.appendChild(inner);
  stream.appendChild(wrap);
  stream.scrollTop = stream.scrollHeight;
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

  const { displayText, orderPayload, actionPayload } = stripMayaPanelMetadata(content);

  const wrap = document.createElement("div");
  wrap.className = "yc-msg yc-msg--assistant";

  const col = document.createElement("div");
  col.className = "yc-msg-inner-col";

  const bubble = document.createElement("div");
  bubble.className = "yc-msg-bubble";
  bubble.textContent = displayText;

  const time = document.createElement("div");
  time.className = "yc-msg-time";
  time.textContent = formatTime();

  col.appendChild(bubble);

  if (orderPayload && !opts.isWelcome && !validateOrderConsistency(displayText, orderPayload)) {
    const warn = document.createElement("div");
    warn.className = "yc-msg-consistency-warning";
    warn.setAttribute("role", "status");
    warn.textContent = "⚠️ Los números no coinciden. Pedile a Maya que te vuelva a cotizar.";
    col.appendChild(warn);
  }

  const quote = !opts.isWelcome ? tryBuildQuoteFromAssistantText(displayText, orderPayload) : null;
  if (quote) {
    try {
      wrap.dataset.quoteJson = JSON.stringify(quote);
    } catch (_) {
      /* ignore */
    }
    col.appendChild(buildQuoteCardEl(quote));
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
        await navigator.clipboard.writeText(displayText);
        showToast("Copiado al portapapeles");
      } catch {
        showToast("No se pudo copiar", true);
      }
    });

    const btnOrder = document.createElement("button");
    btnOrder.type = "button";
    btnOrder.className = "yc-msg-action-btn yc-msg-action-btn--primary";
    btnOrder.textContent = "Convertir a orden";
    btnOrder.addEventListener("click", () => convertConversationToOrder(wrap, displayText));

    actions.append(btnCopy, btnOrder);
    col.appendChild(actions);
  }

  col.appendChild(time);

  wrap.appendChild(col);
  stream.appendChild(wrap);
  stream.scrollTop = stream.scrollHeight;

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

  return { visible: displayText, actionPayload };
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
  if (input) {
    input.disabled = !on;
  }
  if (btn) {
    btn.disabled = !on;
  }
}

function trimApiMessages() {
  if (apiConversation.length <= MAX_CHAT_MEMORY) return;
  apiConversation = apiConversation.slice(-MAX_CHAT_MEMORY);
}

function panelChatSessionStorageKey(userId, businessId) {
  return `cf_maya_panel_chat_v1_${userId}_${businessId}`;
}

function touchPanelChatActivityTime() {
  lastPanelChatActivityAt = Date.now();
}

/**
 * Guarda la conversación en sessionStorage al salir de la página (otra pestaña del panel).
 * Al volver antes de 1 min desde la última actividad, se restaura el hilo.
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
    const lastAt = lastPanelChatActivityAt || Date.now();
    sessionStorage.setItem(
      key,
      JSON.stringify({
        messages: apiConversation.slice(-MAX_CHAT_MEMORY).map((m) => ({
          role: m.role,
          content: String(m.content || "").slice(0, 12000),
        })),
        lastActivityAt: lastAt,
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

/**
 * @returns {boolean} true si se restauró una sesión reciente (< 1 min desde última actividad)
 */
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
  const lastAt = Number(parsed.lastActivityAt) || 0;
  if (!Array.isArray(messages) || !messages.length) {
    sessionStorage.removeItem(key);
    return false;
  }
  const elapsed = Date.now() - lastAt;
  if (elapsed >= PANEL_CHAT_IDLE_MS) {
    sessionStorage.removeItem(key);
    return false;
  }
  apiConversation = messages
    .filter((x) => x && (x.role === "user" || x.role === "assistant") && typeof x.content === "string")
    .map((x) => ({ role: /** @type {'user'|'assistant'} */ (x.role), content: x.content }))
    .slice(-MAX_CHAT_MEMORY);
  lastPanelChatActivityAt = lastAt;
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
  stream.scrollTop = stream.scrollHeight;
}

async function executePanelChatSessionIdleCleanup() {
  const bid = activeBusiness?.id;
  const uid = auth.currentUser?.uid;
  if (bid && uid) {
    clearChatSessionStorage(uid, bid);
    try {
      if (apiConversation.length) {
        await persistPanelChatHistory(bid, uid);
      }
    } catch (e) {
      console.warn("[YourColor Chat] idle save", e);
    }
  }
  apiConversation = [];
  lastPanelChatActivityAt = 0;
  const stream = document.getElementById("yc-chat-stream");
  if (stream) {
    stream.innerHTML = "";
    showWelcomeAssistant();
  }
}

/**
 * Programa el cierre por inactividad (1 min desde `lastPanelChatActivityAt`).
 * @param {number} [delayMs] por defecto ventana completa; al volver de otra página se usa el tiempo restante.
 */
function schedulePanelChatIdleTimer(delayMs = PANEL_CHAT_IDLE_MS) {
  if (!activeBusiness || apiConversation.length === 0) return;
  if (panelChatIdleTimer) window.clearTimeout(panelChatIdleTimer);
  panelChatIdleTimer = window.setTimeout(() => {
    panelChatIdleTimer = null;
    void executePanelChatSessionIdleCleanup();
  }, delayMs);
}

function bumpPanelChatActivity() {
  if (!activeBusiness || apiConversation.length === 0) return;
  touchPanelChatActivityTime();
  schedulePanelChatIdleTimer();
}

function wirePanelChatIdleAndActivity() {
  const stream = document.getElementById("yc-chat-stream");
  const input = document.getElementById("yc-chat-input");
  const shell = document.querySelector(".yc-chat-page") || document.querySelector(".dash-shell");
  const bump = () => bumpPanelChatActivity();
  stream?.addEventListener("scroll", bump, { passive: true });
  input?.addEventListener("keydown", bump);
  input?.addEventListener("input", bump);
  input?.addEventListener("focus", bump);
  shell?.addEventListener("pointerdown", bump);
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
 * @returns {{ displayText: string, orderPayload: Record<string, unknown> | null, actionPayload: { action?: string, data?: Record<string, unknown> } | null }}
 */
function stripMayaPanelMetadata(raw) {
  let t = String(raw ?? "").trim();
  let orderPayload = null;
  let actionPayload = null;
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
  return { displayText: t, orderPayload, actionPayload };
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

  if (payload.action === "save_client") {
    const name = typeof data.name === "string" ? data.name.trim() : "";
    await addDoc(collection(db, "businesses", businessId, "clients"), {
      fullName: name || "Cliente",
      name: name || "Cliente",
      phone: typeof data.phone === "string" ? data.phone.trim() : "",
      email: typeof data.email === "string" ? data.email.trim() : "",
      source: "chat-maya",
      createdAt: serverTimestamp(),
    });
    return "save_client";
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
    const clientId =
      typeof data.clientId === "string" ? data.clientId.trim() : String(data.clientId ?? "").trim();
    if (!clientId) throw new Error("Falta clientId para eliminar el cliente.");
    await deleteDoc(doc(db, "businesses", businessId, "clients", clientId));
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
  if (!activeBusiness) {
    showToast("Espera a que cargue tu negocio o vuelve a iniciar sesión.", true);
    return;
  }

  hideError();
  appendUserBubble(text);
  if (input) input.value = "";

  apiConversation.push({ role: "user", content: text });
  trimApiMessages();
  bumpPanelChatActivity();

  if (btn) {
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
  }
  if (input) input.disabled = true;

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
          if (st) st.scrollTop = st.scrollHeight;
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
    bumpPanelChatActivity();

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
    input?.focus();
  }
}

function wireComposer() {
  const input = document.getElementById("yc-chat-input");
  const btn = document.getElementById("yc-chat-send");
  if (!input || !btn || btn.dataset.wired === "1") return;
  btn.dataset.wired = "1";

  btn.addEventListener("click", () => sendToClaude());

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendToClaude();
    }
  });
}

function showWelcomeAssistant() {
  const stream = document.getElementById("yc-chat-stream");
  if (!stream) return;
  const wrap = document.createElement("div");
  wrap.className = "yc-msg yc-msg--assistant";
  const col = document.createElement("div");
  col.className = "yc-msg-inner-col";
  const bubble = document.createElement("div");
  bubble.className = "yc-msg-bubble";
  bubble.textContent = MAYA_WELCOME_STATIC;
  const time = document.createElement("div");
  time.className = "yc-msg-time";
  time.textContent = formatTime();
  col.appendChild(bubble);
  col.appendChild(time);
  wrap.appendChild(col);
  stream.appendChild(wrap);
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
  bubble.className = "yc-msg-bubble";
  bubble.textContent = "";
  bubble.setAttribute("aria-busy", "true");
  const time = document.createElement("div");
  time.className = "yc-msg-time";
  time.textContent = formatTime();
  col.appendChild(bubble);
  col.appendChild(time);
  wrap.appendChild(col);
  stream.appendChild(wrap);
  stream.scrollTop = stream.scrollHeight;
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
    renderHeader(business);

    if (!business) {
      mayaTeardownControlCenter();
      if (loading) loading.hidden = true;
      showError("No hay negocio vinculado. Completa el onboarding o inicia sesión con la cuenta correcta.");
      return;
    }

    mayaInitControlCenter(business);

    const restoredFromTab = tryRestoreChatFromSessionStorage(business.id, user.uid);
    let hadHistory = restoredFromTab;
    if (!restoredFromTab) {
      hadHistory = await loadPanelChatHistory(business.id, user.uid);
    }

    if (loading) loading.hidden = true;
    if (stream) {
      stream.hidden = false;
      stream.innerHTML = "";
      if (hadHistory) {
        renderChatHistoryFromMemory();
        if (restoredFromTab) {
          const elapsed = Date.now() - lastPanelChatActivityAt;
          const remaining = Math.max(0, PANEL_CHAT_IDLE_MS - elapsed);
          schedulePanelChatIdleTimer(remaining);
        } else {
          touchPanelChatActivityTime();
          schedulePanelChatIdleTimer();
        }
      } else {
        showWelcomeAssistant();
      }
    }

    setComposerEnabled(true);
    wireComposer();
    wirePanelChatIdleAndActivity();
    if (!window.__cfMayaPagehideWired) {
      window.__cfMayaPagehideWired = true;
      window.addEventListener("pagehide", () => {
        persistChatToSessionStorage();
      });
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") persistChatToSessionStorage();
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
