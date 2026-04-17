import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import {
  addDoc,
  collection,
  serverTimestamp,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import {
  resolveBusinessForUser,
  fetchJobsForBusiness,
  fetchClientsForBusiness,
  fetchCampaignsListAndStats,
  formatBusinessMeta,
  initialsFromName,
} from "./dashboard-data.js";
import { initDashShell } from "./dash-shell.js";
import { YOURCOLOR_BUSINESS, calculateOrderTotal } from "./yourcolor-config.js";

/** Misma región/proyecto que `generateCampaign`; tras `firebase deploy --only functions` verifica la URL en consola. */
const CHAT_WITH_AI_URL = "https://chatwithai-5laxqi2i4q-uc.a.run.app";

const MAX_API_MESSAGES = 40;
const DELIVERY_DAYS_OFFSET = 12;

/** @type {{ role: 'user' | 'assistant', content: string }[]} */
let apiConversation = [];

/** @type {Record<string, unknown> | null} */
let firebaseContextPayload = null;

/** @type {{ id: string, data: Record<string, unknown> } | null} */
let activeBusiness = null;

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

/** @param {string} text */
function tryBuildQuoteFromAssistantText(text) {
  const productKey = detectProductKey(text);
  const qty = detectQuantity(text);
  if (!productKey || qty == null || qty < 1) return null;

  if (productKey === "tarjetas") {
    const product = YOURCOLOR_BUSINESS.products.tarjetas;
    const range = product.pricePerPiece.find((r) => qty >= r.minQty && qty <= r.maxQty && r.price != null);
    if (!range) return null;
    const total = range.price;
    const deposit = total * 0.5;
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
    };
  }

  const calc = calculateOrderTotal(productKey, qty);
  if (!calc || typeof calc !== "object") return null;
  if ("needsQuote" in calc && calc.needsQuote) return null;

  const product = YOURCOLOR_BUSINESS.products[productKey];
  const productLabel = product ? product.name : productKey;

  return {
    productKey,
    productLabel,
    quantity: calc.quantity,
    pricePerPiece: calc.pricePerPiece,
    priceLabel: "Precio por pieza",
    subtotal: calc.subtotal,
    logoFee: calc.logoFee,
    total: calc.total,
    deposit: calc.deposit,
    isTarjetas: false,
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
  addRow("Total", formatMoney(quote.total), true);
  addRow("Depósito (50%)", formatMoney(quote.deposit), true);

  card.append(h, dl);
  return card;
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

  const { visible, actionPayload } = stripMayaActionJson(content);
  const displayText = visible;

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

  const quote = !opts.isWelcome ? tryBuildQuoteFromAssistantText(displayText) : null;
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
  if (apiConversation.length <= MAX_API_MESSAGES) return;
  apiConversation = apiConversation.slice(-MAX_API_MESSAGES);
}

function conversationSnippet(maxLen = 4000) {
  return apiConversation
    .slice(-10)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n\n")
    .slice(0, maxLen);
}

const MAYA_ACTION_PREFIX = "MAYA_ACTION_JSON:";

/**
 * Quita MAYA_ACTION_JSON del final y parsea el objeto (soporta JSON anidado en `data`).
 * @param {string} raw
 * @returns {{ visible: string, actionPayload: { action?: string, data?: Record<string, unknown> } | null }}
 */
function stripMayaActionJson(raw) {
  const text = String(raw ?? "").trim();
  const idx = text.indexOf(MAYA_ACTION_PREFIX);
  if (idx < 0) return { visible: text, actionPayload: null };

  const visible = text.slice(0, idx).trim();
  const after = text.slice(idx + MAYA_ACTION_PREFIX.length).trim();
  const jsonStart = after.indexOf("{");
  if (jsonStart < 0) return { visible: text, actionPayload: null };

  let depth = 0;
  let i = jsonStart;
  for (; i < after.length; i += 1) {
    const c = after[i];
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) return { visible: text, actionPayload: null };

  const jsonStr = after.slice(jsonStart, i + 1);
  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed && typeof parsed === "object" && typeof parsed.action === "string") {
      return { visible, actionPayload: /** @type {{ action: string, data?: Record<string, unknown> }} */ (parsed) };
    }
  } catch {
    /* ignore */
  }
  return { visible: text, actionPayload: null };
}

/**
 * @param {string} businessId
 * @param {{ action: string, data?: Record<string, unknown> }} payload
 */
async function executeMayaActionFromChat(businessId, payload) {
  const data = payload.data && typeof payload.data === "object" ? payload.data : {};

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

  return null;
}

function mayaActionCompletedLabel(kind) {
  if (kind === "save_client") return "guardar cliente";
  if (kind === "create_order") return "crear orden";
  if (kind === "schedule_delivery") return "programar entrega";
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
  if (!text || !firebaseContextPayload) return;

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

  try {
    const res = await fetch(CHAT_WITH_AI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: apiConversation,
        firebaseContext: firebaseContextPayload,
      }),
    });
    const raw = await res.text();
    let json;
    try {
      json = JSON.parse(raw);
    } catch {
      json = {};
    }
    if (!res.ok) {
      const errMsg = typeof json.error === "string" ? json.error : raw || `Error ${res.status}`;
      throw new Error(errMsg);
    }
    const reply = typeof json.reply === "string" ? json.reply.trim() : "";
    if (!reply) {
      throw new Error("Respuesta vacía del asistente.");
    }

    const { visible: assistantVisible, actionPayload } = appendAssistantBubble(reply);
    apiConversation.push({ role: "assistant", content: assistantVisible });
    trimApiMessages();

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
  bubble.textContent =
    "Hola, soy el asistente de YourColor. Ya tengo cargados tu perfil, órdenes, clientes y campañas guardadas. Pregúntame por precios, estrategias o lo que necesites.";
  const time = document.createElement("div");
  time.className = "yc-msg-time";
  time.textContent = formatTime();
  col.appendChild(bubble);
  col.appendChild(time);
  wrap.appendChild(col);
  stream.appendChild(wrap);
}

/**
 * @param {{ id: string, data: Record<string, unknown> }} business
 */
async function loadFirebaseContext(business) {
  const [orders, clients, campAgg] = await Promise.all([
    fetchJobsForBusiness(db, business.id),
    fetchClientsForBusiness(db, business.id),
    fetchCampaignsListAndStats(db, business.id),
  ]);

  const profile = serializeForAi(business.data) || {};
  firebaseContextPayload = {
    businessId: business.id,
    profile,
    orders: serializeForAi(orders),
    clients: serializeForAi(clients),
    campaigns: serializeForAi(campAgg.campaigns || []),
    stats: {
      orderCount: orders.length,
      clientCount: clients.length,
      campaignCount: (campAgg.campaigns || []).length,
    },
  };

  const meta = document.getElementById("yc-chat-context-meta");
  if (meta) {
    meta.textContent = `${orders.length} órdenes · ${clients.length} clientes · ${(campAgg.campaigns || []).length} campañas`;
  }
}

async function bootWithUser(user) {
  const loading = document.getElementById("yc-chat-loading");
  const stream = document.getElementById("yc-chat-stream");
  try {
    const business = await resolveBusinessForUser(db, user);
    activeBusiness = business;
    renderHeader(business);

    if (!business) {
      if (loading) loading.hidden = true;
      showError("No hay negocio vinculado. Completa el onboarding o inicia sesión con la cuenta correcta.");
      return;
    }

    await loadFirebaseContext(business);

    if (loading) loading.hidden = true;
    if (stream) {
      stream.hidden = false;
      stream.innerHTML = "";
      showWelcomeAssistant();
    }

    setComposerEnabled(true);
    wireComposer();
    document.getElementById("yc-chat-input")?.focus();
  } catch (e) {
    console.error("[YourColor Chat]", e);
    if (loading) loading.hidden = true;
    showError(
      e instanceof Error ? e.message : "No se pudieron cargar los datos. Revisa Firestore y la red.",
    );
  }
}

function boot() {
  initDashShell({ auth });

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.replace("login.html");
      return;
    }
    bootWithUser(user).catch((err) => {
      console.error(err);
      const ld = document.getElementById("yc-chat-loading");
      if (ld) ld.hidden = true;
      showError("Error inesperado al iniciar el chat.");
    });
  });
}

boot();
