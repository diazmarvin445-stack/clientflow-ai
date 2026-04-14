import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import {
  resolveBusinessForUser,
  fetchJobsForBusiness,
  fetchClientsForBusiness,
  fetchCampaignsListAndStats,
  formatBusinessMeta,
  initialsFromName,
} from "./dashboard-data.js";
import { initDashShell } from "./dash-shell.js";

/** Misma región/proyecto que `generateCampaign`; tras `firebase deploy --only functions` verifica la URL en consola. */
const CHAT_WITH_AI_URL = "https://chatwithai-5laxqi2i4q-uc.a.run.app";

const MAX_API_MESSAGES = 40;

/** @type {{ role: 'user' | 'assistant', content: string }[]} */
let apiConversation = [];

/** @type {Record<string, unknown> | null} */
let firebaseContextPayload = null;

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
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

function appendBubble(role, content) {
  const stream = document.getElementById("yc-chat-stream");
  if (!stream) return;
  const wrap = document.createElement("div");
  wrap.className = `yc-msg yc-msg--${role === "user" ? "user" : "assistant"}`;

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

async function sendToClaude() {
  const input = document.getElementById("yc-chat-input");
  const btn = document.getElementById("yc-chat-send");
  const text = input && "value" in input ? String(input.value).trim() : "";
  if (!text || !firebaseContextPayload) return;

  hideError();
  appendBubble("user", text);
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
    apiConversation.push({ role: "assistant", content: reply });
    trimApiMessages();
    appendBubble("assistant", reply);
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
  const inner = document.createElement("div");
  const bubble = document.createElement("div");
  bubble.className = "yc-msg-bubble";
  bubble.textContent =
    "Hola, soy el asistente de YourColor. Ya tengo cargados tu perfil, órdenes, clientes y campañas guardadas. Pregúntame por precios, estrategias o lo que necesites.";
  const time = document.createElement("div");
  time.className = "yc-msg-time";
  time.textContent = formatTime();
  inner.appendChild(bubble);
  inner.appendChild(time);
  wrap.appendChild(inner);
  stream.appendChild(wrap);
}

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
