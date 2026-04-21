import { createHash } from "node:crypto";
import { initializeApp, getApps } from "firebase-admin/app";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import cors from "cors";
import {
  getYourColorSystemPrompt,
  getMayaWhatsAppSystemPrompt,
  getMayaInternalChatPrompt,
  computeValidatedMayaOrder,
  computeValidatedMayaCombinedOrder,
  YOURCOLOR_BUSINESS,
} from "./yourcolor-config.js";

/** Chat interno (Marvin ↔ Maya): rápido y económico. */
const MODEL_INTERNAL_CHAT = "claude-haiku-4-5-20251001";
/** WhatsApp (cliente ↔ Maya): Sonnet para ventas y conversación con clientes. */
const MODEL_WHATSAPP = "claude-sonnet-4-6";
/** Otras rutas (p. ej. generateCampaign). */
const MODEL = MODEL_WHATSAPP;
const ANTHROPIC_KEY = defineSecret("ANTHROPIC_KEY");
/** Token de la API de WhatsApp Cloud (Meta) para enviar mensajes. */
const META_ACCESS_TOKEN = defineSecret("META_ACCESS_TOKEN");
/** ID del documento `businesses/{id}` de YourColor (Firestore). */
const YOURCOLOR_BUSINESS_ID = defineSecret("YOURCOLOR_BUSINESS_ID");

/** Phone Number ID de WhatsApp Cloud API (Meta). */
const META_WHATSAPP_PHONE_NUMBER_ID = "1009366522268908";
const META_GRAPH_API_VERSION = "v18.0";
const corsHandler = cors({ origin: true });

function getAdminDb() {
  if (!getApps().length) {
    initializeApp();
  }
  return getFirestore();
}

/**
 * Cuerpo JSON del POST (Meta a veces entrega rawBody).
 * @param {import("firebase-functions").https.Request} req
 */
function getNormalizedJsonBody(req) {
  const b = req.body;
  if (b && typeof b === "object" && !Buffer.isBuffer(b)) {
    return b;
  }
  const raw = req.rawBody;
  if (Buffer.isBuffer(raw)) {
    try {
      return JSON.parse(raw.toString("utf8"));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Meta WhatsApp: `req.body.entry[0].changes[0].value`, texto en `messages[0].text.body`, remitente en `messages[0].from`.
 * @returns {{ value: Record<string, unknown>, from: string, inboundBody: string } | null}
 */
function parseMetaWhatsAppWebhook(req) {
  const body = getNormalizedJsonBody(req);
  if (!body || typeof body !== "object") return null;
  const entry = body.entry;
  if (!Array.isArray(entry) || !entry[0] || typeof entry[0] !== "object") return null;
  const changes = entry[0].changes;
  if (!Array.isArray(changes) || !changes[0] || typeof changes[0] !== "object") return null;
  const value = changes[0].value;
  if (!value || typeof value !== "object") return null;

  const messages = value.messages;
  const msg =
    Array.isArray(messages) && messages[0] && typeof messages[0] === "object" ? messages[0] : null;
  const from = msg && typeof msg.from === "string" ? msg.from.trim() : "";
  let inboundBody = "";
  if (msg && msg.type === "text" && msg.text && typeof msg.text === "object") {
    const bodyText = /** @type {{ body?: string }} */ (msg.text).body;
    if (typeof bodyText === "string") inboundBody = asText(bodyText);
  }

  return { value: /** @type {Record<string, unknown>} */ (value), from, inboundBody };
}

/**
 * Envía un mensaje de texto por WhatsApp Cloud API (Meta).
 * @returns {Promise<boolean>}
 */
async function sendWhatsAppViaMetaGraph(accessToken, toPhone, textBody) {
  const url = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${META_WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const to = String(toPhone ?? "").replace(/^\+/, "").trim();
  if (!to || !accessToken) return false;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: truncateWhatsApp(textBody, 4096) },
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("[whatsappWebhook] Meta Graph API error", res.status, json);
    return false;
  }
  return true;
}

/**
 * Extrae MAYA_* JSON finales y devuelve texto visible para el cliente.
 * @param {string} raw
 * @returns {{ text: string, order: Record<string, unknown> | null, deposit: Record<string, unknown> | null, meeting: Record<string, unknown> | null, specialRequest: Record<string, unknown> | null, handoff: Record<string, unknown> | null }}
 */
function extractMayaOrderFromReply(raw) {
  let visible = asText(raw);
  let order = null;
  let deposit = null;
  let meeting = null;
  let specialRequest = null;
  let handoff = null;
  const depRe = /MAYA_DEPOSIT_JSON:\s*(\{[\s\S]*?\})\s*$/m;
  const orderRe = /MAYA_ORDER_JSON:\s*(\{[\s\S]*?\})\s*$/m;
  const meetingRe = /MAYA_MEETING_JSON:\s*(\{[\s\S]*?\})\s*$/m;
  const specialRe = /MAYA_SPECIAL_REQUEST_JSON:\s*(\{[\s\S]*?\})\s*$/m;
  const handoffRe = /MAYA_HANDOFF_JSON:\s*(\{[\s\S]*?\})\s*$/m;

  let m = visible.match(depRe);
  if (m) {
    try {
      deposit = JSON.parse(m[1]);
    } catch {
      deposit = null;
    }
    visible = visible.replace(depRe, "").trim();
  }
  m = visible.match(orderRe);
  if (m) {
    try {
      order = JSON.parse(m[1]);
    } catch {
      order = null;
    }
    visible = visible.replace(orderRe, "").trim();
  }
  m = visible.match(meetingRe);
  if (m) {
    try {
      meeting = JSON.parse(m[1]);
    } catch {
      meeting = null;
    }
    visible = visible.replace(meetingRe, "").trim();
  }
  m = visible.match(specialRe);
  if (m) {
    try {
      specialRequest = JSON.parse(m[1]);
    } catch {
      specialRequest = null;
    }
    visible = visible.replace(specialRe, "").trim();
  }
  m = visible.match(handoffRe);
  if (m) {
    try {
      handoff = JSON.parse(m[1]);
    } catch {
      handoff = null;
    }
    visible = visible.replace(handoffRe, "").trim();
  }
  return { text: visible, order, deposit, meeting, specialRequest, handoff };
}

/** ID de documento en `conversations/{id}`: solo dígitos (Meta envía el número sin +). */
function conversationDocIdFromWhatsAppFrom(from) {
  const digits = String(from ?? "").replace(/\D/g, "");
  return digits || "unknown";
}

/**
 * Mensaje entrante del cliente: conversación + subcolección messages.
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} businessId
 * @param {string} from
 * @param {string} text
 */
async function recordWhatsAppCustomerInbound(db, businessId, from, text) {
  const docId = conversationDocIdFromWhatsAppFrom(from);
  const convRef = db.collection("businesses").doc(businessId).collection("conversations").doc(docId);
  const snap = await convRef.get();
  const now = FieldValue.serverTimestamp();
  /** @type {Record<string, unknown>} */
  const patch = {
    phoneNumber: docId === "unknown" ? String(from) : docId,
    lastMessage: truncateWhatsApp(text, 500),
    lastMessageAt: now,
    status: "active",
    mayaInControl: false,
    updatedAt: now,
  };
  if (!snap.exists) {
    patch.createdAt = now;
  }
  await convRef.set(patch, { merge: true });
  await convRef.collection("messages").add({
    from: "customer",
    text,
    at: FieldValue.serverTimestamp(),
    metadata: {},
  });
}

/**
 * Respuesta de Maya vía WhatsApp: mensaje + estado de conversación.
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} businessId
 * @param {string} from
 * @param {string} text
 * @param {{ status: 'waiting' | 'confirmed' | 'needs_attention', mayaInControl: boolean, messageMetadata?: Record<string, unknown> }} opts
 */
async function recordWhatsAppMayaOutbound(db, businessId, from, text, opts) {
  const docId = conversationDocIdFromWhatsAppFrom(from);
  const convRef = db.collection("businesses").doc(businessId).collection("conversations").doc(docId);
  const now = FieldValue.serverTimestamp();
  const snap = await convRef.get();
  /** @type {Record<string, unknown>} */
  const patch = {
    phoneNumber: docId === "unknown" ? String(from) : docId,
    lastMessage: truncateWhatsApp(text, 500),
    lastMessageAt: now,
    status: opts.status,
    mayaInControl: opts.mayaInControl,
    updatedAt: now,
  };
  if (!snap.exists) {
    patch.createdAt = now;
  }
  await convRef.set(patch, { merge: true });
  const meta = opts.messageMetadata && typeof opts.messageMetadata === "object" ? opts.messageMetadata : {};
  await convRef.collection("messages").add({
    from: "maya",
    text,
    at: FieldValue.serverTimestamp(),
    metadata: meta,
  });
}

/** Entrega = fecha actual + N días hábiles (lun–vie). */
function deliveryDateAfterBusinessDays(start, businessDays) {
  const d = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 12, 0, 0, 0);
  let added = 0;
  while (added < businessDays) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return d;
}

function normalizePhoneDigits(raw) {
  return String(raw ?? "").replace(/\D/g, "");
}

function parseOrderDate(raw) {
  if (raw == null || raw === "") return null;
  const s = typeof raw === "string" ? raw.trim() : String(raw);
  const d = new Date(s.includes("T") ? s : `${s}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(12, 0, 0, 0);
  return d;
}

function normalizeOrderStatus(raw) {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (s === "produccion" || s === "in_production") return "produccion";
  if (s === "listo") return "listo";
  if (s === "entregado" || s === "completed") return "entregado";
  if (s === "cancelado" || s === "cancelled") return "cancelado";
  return "nuevo";
}

async function findOrCreateClient(db, businessId, payload) {
  const clientsCol = db.collection("businesses").doc(businessId).collection("clients");
  const name = asText(payload.clientName, "Cliente");
  const phone = normalizePhoneDigits(payload.clientPhone);
  let existing = null;

  if (phone) {
    const byPhone = await clientsCol.where("phone", "==", phone).limit(1).get();
    if (!byPhone.empty) {
      const docSnap = byPhone.docs[0];
      existing = { id: docSnap.id, data: docSnap.data() || {} };
    }
  }

  if (existing) {
    await clientsCol.doc(existing.id).set(
      {
        fullName: name || existing.data.fullName || "Cliente",
        name: name || existing.data.name || "Cliente",
        phone: phone || existing.data.phone || "",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { id: existing.id };
  }

  const created = await clientsCol.add({
    fullName: name || "Cliente",
    name: name || "Cliente",
    phone,
    source: payload.source || "manual",
    createdAt: FieldValue.serverTimestamp(),
  });
  return { id: created.id };
}

async function processNewOrder(db, businessId, rawOrder) {
  const clientName = asText(rawOrder.clientName, "Cliente");
  const clientPhone = normalizePhoneDigits(rawOrder.clientPhone);
  const product = asText(rawOrder.product, "Pedido");
  const quantity = Math.max(0, Number(rawOrder.quantity) || 0);
  const amount = Math.max(0, Number(rawOrder.amount) || 0);
  const deposit = Math.max(0, Number(rawOrder.deposit) || 0);
  const balance = Math.max(0, amount - deposit);
  const notes = asText(rawOrder.notes);
  const source = asText(rawOrder.source, "manual");
  const createdBy = asText(rawOrder.createdBy, "marvin");
  const status = normalizeOrderStatus(rawOrder.status);
  const sourceLeadId = asText(rawOrder.sourceLeadId);

  let deliveryDate = parseOrderDate(rawOrder.deliveryDate);
  if (!deliveryDate) {
    deliveryDate = deliveryDateAfterBusinessDays(new Date(), 12);
  }

  const client = await findOrCreateClient(db, businessId, {
    clientName,
    clientPhone,
    source,
  });

  const expensesInit = Math.max(0, Number(rawOrder.expenses) || 0);

  const orderRef = await db.collection("businesses").doc(businessId).collection("orders").add({
    clientId: client.id,
    clientName,
    clientPhone,
    product,
    quantity,
    amount,
    deposit,
    balance,
    expenses: expensesInit,
    deliverySettled: false,
    netProfit: 0,
    status,
    deliveryDate: Timestamp.fromDate(deliveryDate),
    notes,
    source,
    createdAt: FieldValue.serverTimestamp(),
    createdBy,
    linkedClientId: client.id,
    linkedFinanceId: "",
    linkedCalendarId: "",
  });

  let linkedFinanceId = "";
  if (deposit > 0) {
    const financeRef = await db.collection("businesses").doc(businessId).collection("finance").add({
      type: "income",
      status: "retenido",
      amount: deposit,
      category: "anticipos",
      description: `Depósito retenido (no es ingreso hasta entrega): ${product} - ${clientName}`,
      clientId: client.id,
      orderId: orderRef.id,
      linkedOrderId: orderRef.id,
      createdAt: FieldValue.serverTimestamp(),
      createdBy,
      date: Timestamp.fromDate(new Date()),
    });
    linkedFinanceId = financeRef.id;
  }

  let linkedCalendarId = "";
  const calRef = await db.collection("businesses").doc(businessId).collection("calendar").add({
    title: `Entrega: ${product} - ${clientName}`,
    date: Timestamp.fromDate(deliveryDate),
    type: "delivery",
    status: "pending",
    orderId: orderRef.id,
    clientId: client.id,
    sourceLeadId: sourceLeadId || null,
    createdAt: FieldValue.serverTimestamp(),
  });
  linkedCalendarId = calRef.id;

  await orderRef.set(
    {
      linkedFinanceId,
      linkedCalendarId,
    },
    { merge: true },
  );

  return {
    orderId: orderRef.id,
    linkedClientId: client.id,
    linkedFinanceId,
    linkedCalendarId,
  };
}

function truncateWhatsApp(s, max = 1500) {
  const t = asText(s);
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function asText(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isSameCalendarDay(a, b) {
  if (!a || !b || Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Ingresos: solo cobrado (o sin status, legado) cuentan en totales. retenido/cancelado no. */
function financeIncomeCountsAsRealizedAdmin(row) {
  if (!row || row.type !== "income") return false;
  const s = String(row.status ?? "cobrado")
    .trim()
    .toLowerCase();
  if (s === "retenido" || s === "cancelado") return false;
  return true;
}

function extractJsonObject(rawText) {
  const text = asText(rawText);
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (_) {
    // Continue with JSON block extraction.
  }

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    return JSON.parse(match[0]);
  } catch (_) {
    return null;
  }
}

function parsePayload(raw) {
  const body = raw && typeof raw === "object" ? raw : {};
  return {
    goal: asText(body.goal, "No especificado"),
    offer: asText(body.offer, "No especificado"),
    location: asText(body.location, "No especificado"),
    budget: asText(body.budget, "No especificado"),
    audience: asText(body.audience, "No especificado"),
    platformPref: asText(body.platformPref, "auto"),
    businessProfile: body.businessProfile && typeof body.businessProfile === "object" ? body.businessProfile : {},
  };
}

function buildUserPrompt(input, businessName) {
  const profileJson = JSON.stringify(input.businessProfile ?? {});
  return `
Genera una propuesta de campana para este negocio local:

- businessName: ${asText(businessName, "Tu negocio")}
- businessProfile (Firebase): ${profileJson}
- goal: ${input.goal}
- offer: ${input.offer}
- location: ${input.location}
- budget: ${input.budget}
- audience: ${input.audience}
- platformPref: ${input.platformPref}

Responde SOLO en JSON valido con estas llaves exactas:
headline, hook, bodyText, cta, platform, suggestedBudgetWeekly, estimatedLeadsWeekly, creativeIdea
`.trim();
}

export const generateCampaign = onRequest(
  { secrets: [ANTHROPIC_KEY] },
  async (req, res) => {
    corsHandler(req, res, async () => {
      if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
      }

      if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed. Use POST." });
      }

      try {
        const apiKey = ANTHROPIC_KEY.value();
        if (!apiKey) {
          return res.status(500).json({
            error: "Missing ANTHROPIC_KEY secret",
          });
        }

        const input = parsePayload(req.body);
        const businessProfile = input.businessProfile;
        const businessName = asText(businessProfile.businessName, "Tu negocio");

        const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: 1000,
            system: getYourColorSystemPrompt(),
            messages: [{ role: "user", content: buildUserPrompt(input, businessName) }],
          }),
        });

        const anthropicBody = await anthropicResponse.json();
        if (!anthropicResponse.ok) {
          const message = asText(anthropicBody?.error?.message, "Anthropic API request failed.");
          return res.status(anthropicResponse.status).json({ error: message });
        }

        const textContent = Array.isArray(anthropicBody?.content)
          ? anthropicBody.content
              .filter((item) => item?.type === "text")
              .map((item) => item?.text || "")
              .join("\n")
          : "";

        const parsed = extractJsonObject(textContent);
        if (!parsed || typeof parsed !== "object") {
          return res.status(502).json({ error: "Claude response did not include valid JSON output." });
        }

        return res.status(200).json({
          headline: asText(parsed.headline),
          hook: asText(parsed.hook),
          bodyText: asText(parsed.bodyText),
          cta: asText(parsed.cta),
          platform: asText(parsed.platform),
          suggestedBudgetWeekly: asNumber(parsed.suggestedBudgetWeekly),
          estimatedLeadsWeekly: asNumber(parsed.estimatedLeadsWeekly),
          creativeIdea: asText(parsed.creativeIdea),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return res.status(500).json({ error: "Failed to generate campaign.", details: message });
      }
    });
  },
);

function asChatMessages(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const role = m.role === "assistant" ? "assistant" : m.role === "user" ? "user" : null;
    const content = typeof m.content === "string" ? m.content.trim() : "";
    if (!role || !content) continue;
    out.push({ role, content });
  }
  return out;
}

/** Últimos turnos enviados a Claude (panel Chat Maya). */
const MAYA_MAX_CONVERSATION_MESSAGES = 20;
/** Objetivo por debajo del límite de entrada (~200k tokens); priorizar calidad si el prompt es rico. */
const MAYA_TARGET_TOTAL_INPUT_TOKENS = 170000;

function estimateTokensFromCharLength(len) {
  return Math.ceil(Number(len) / 4);
}

function trimMayaChatMessages(msgs, max = MAYA_MAX_CONVERSATION_MESSAGES) {
  if (!Array.isArray(msgs) || msgs.length <= max) return msgs;
  return msgs.slice(-max);
}

function cloneJsonSafe(obj) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return {};
  }
}

function mayaAnthropicInputTokenEstimate(systemStr, messages) {
  const ser = JSON.stringify(messages);
  return estimateTokensFromCharLength(systemStr.length) + estimateTokensFromCharLength(ser.length);
}

function shrinkFirebaseContextInitial(fc) {
  const c = fc && typeof fc === "object" ? cloneJsonSafe(fc) : {};
  const cal = c.calendarUpcomingFourWeeks ?? c.calendarNextTwoWeeks;
  if (Array.isArray(cal) && cal.length > 90) {
    if (c.calendarUpcomingFourWeeks) c.calendarUpcomingFourWeeks = cal.slice(0, 90);
    else c.calendarNextTwoWeeks = cal.slice(0, 90);
  }
  if (Array.isArray(c.campaigns) && c.campaigns.length > 26) {
    c.campaigns = c.campaigns.slice(0, 22);
  }
  if (Array.isArray(c.financeRecent) && c.financeRecent.length > 100) {
    c.financeRecent = c.financeRecent.slice(0, 95);
  }
  if (Array.isArray(c.clients) && c.clients.length > 34) {
    c.clients = c.clients.slice(0, 30);
  }
  if (Array.isArray(c.orders) && c.orders.length > 55) {
    c.orders = c.orders.slice(0, 50);
  }
  if (Array.isArray(c.jobs) && c.jobs.length > 55) {
    c.jobs = c.jobs.slice(0, 50);
  }
  if (Array.isArray(c.jobsRecentDelivered) && c.jobsRecentDelivered.length > 14) {
    c.jobsRecentDelivered = c.jobsRecentDelivered.slice(0, 12);
  }
  if (Array.isArray(c.ordersRecentDelivered) && c.ordersRecentDelivered.length > 14) {
    c.ordersRecentDelivered = c.ordersRecentDelivered.slice(0, 12);
  }
  return c;
}

function mayaPlainJsonForContext(input) {
  if (input === null || input === undefined) return input;
  if (typeof input !== "object") return input;
  if (input instanceof Date) return input.toISOString();
  if (typeof /** @type {{ toDate?: () => Date }} */ (input).toDate === "function") {
    try {
      const d = /** @type {{ toDate: () => Date }} */ (input).toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
    } catch {
      return null;
    }
  }
  if (Array.isArray(input)) return input.map((x) => mayaPlainJsonForContext(x));
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    out[k] = mayaPlainJsonForContext(v);
  }
  return out;
}

function mayaAdminToDate(v) {
  if (v == null) return null;
  if (typeof /** @type {{ toDate?: () => Date }} */ (v).toDate === "function") {
    try {
      const d = /** @type {{ toDate: () => Date }} */ (v).toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    } catch {
      return null;
    }
  }
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  return null;
}

const MAYA_CHAT_INACTIVE = new Set([
  "entregado",
  "cancelado",
  "cancelada",
  "cancelled",
  "completed",
  "done",
]);
const MAYA_CHAT_DELIVERED = new Set(["entregado", "completed", "done"]);

function mayaChatRowActive(row) {
  const s = String(row?.status ?? "")
    .trim()
    .toLowerCase();
  if (!s) return true;
  return !MAYA_CHAT_INACTIVE.has(s);
}

function mayaChatRowDelivered(row) {
  const s = String(row?.status ?? "")
    .trim()
    .toLowerCase();
  return MAYA_CHAT_DELIVERED.has(s);
}

function mayaChatRowSortTime(row) {
  const u = mayaAdminToDate(row?.updatedAt);
  const c = mayaAdminToDate(row?.createdAt);
  const tu = u && !Number.isNaN(u.getTime()) ? u.getTime() : 0;
  const tc = c && !Number.isNaN(c.getTime()) ? c.getTime() : 0;
  return Math.max(tu, tc);
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} businessId
 * @param {number} daysAhead
 * @param {number} maxResults
 */
async function mayaFetchCalendarForChatServer(db, businessId, daysAhead, maxResults) {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const limitEnd = new Date(dayStart);
  limitEnd.setDate(limitEnd.getDate() + daysAhead);
  limitEnd.setHours(23, 59, 59, 999);
  const col = db.collection("businesses").doc(businessId).collection("calendar");
  let snap;
  try {
    snap = await col
      .where("date", ">=", Timestamp.fromDate(dayStart))
      .orderBy("date", "asc")
      .limit(maxResults)
      .get();
  } catch (e) {
    console.warn("[chatWithAI] calendar query ascendente falló, usando escaneo acotado", e);
    snap = await col.orderBy("date", "desc").limit(150).get();
  }
  const rows = [];
  snap.forEach((docSnap) => {
    const data = docSnap.data();
    const d = mayaAdminToDate(data.date);
    if (!d || Number.isNaN(d.getTime())) return;
    if (d.getTime() < dayStart.getTime() || d.getTime() > limitEnd.getTime()) return;
    rows.push({ id: docSnap.id, ...data });
  });
  rows.sort((a, b) => (mayaAdminToDate(a.date)?.getTime() ?? 0) - (mayaAdminToDate(b.date)?.getTime() ?? 0));
  return rows.slice(0, maxResults);
}

/**
 * Reemplaza listas de datos del contexto con lectura directa desde Firestore (sin caché del cliente).
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {Record<string, unknown>} incomingRaw
 */
async function loadFreshFirebaseContextForMaya(db, incomingRaw) {
  const incoming = incomingRaw && typeof incomingRaw === "object" ? cloneJsonSafe(incomingRaw) : {};
  const businessId = typeof incoming.businessId === "string" ? incoming.businessId.trim() : "";
  if (!businessId) return incoming;

  const bizSnap = await db.collection("businesses").doc(businessId).get();
  const bizData = bizSnap.exists ? bizSnap.data() || {} : {};

  const [jobsSnap, ordersSnap, clientsSnap, financeSnap, calendarRows, campSnap] = await Promise.all([
    db.collection("businesses").doc(businessId).collection("jobs").orderBy("createdAt", "desc").limit(150).get(),
    db.collection("businesses").doc(businessId).collection("orders").orderBy("createdAt", "desc").limit(150).get(),
    db.collection("businesses").doc(businessId).collection("clients").orderBy("createdAt", "desc").limit(35).get(),
    db.collection("businesses").doc(businessId).collection("finance").orderBy("date", "desc").limit(300).get(),
    mayaFetchCalendarForChatServer(db, businessId, 28, 120),
    db.collection("businesses").doc(businessId).collection("campaigns").limit(40).get(),
  ]);

  const jobRows = [];
  jobsSnap.forEach((d) => jobRows.push({ id: d.id, ...d.data(), _cfCollection: "jobs" }));
  const orderRows = [];
  ordersSnap.forEach((d) => orderRows.push({ id: d.id, ...d.data(), _cfCollection: "orders" }));

  const jobsActive = jobRows.filter(mayaChatRowActive).slice(0, 50);
  const jobsDelivered = jobRows
    .filter(mayaChatRowDelivered)
    .sort((a, b) => mayaChatRowSortTime(b) - mayaChatRowSortTime(a))
    .slice(0, 10);
  const ordersActive = orderRows.filter(mayaChatRowActive).slice(0, 50);
  const ordersDelivered = orderRows
    .filter(mayaChatRowDelivered)
    .sort((a, b) => mayaChatRowSortTime(b) - mayaChatRowSortTime(a))
    .slice(0, 10);

  const clients = [];
  clientsSnap.forEach((d) => clients.push({ id: d.id, ...d.data() }));

  const financeAll = [];
  financeSnap.forEach((d) => financeAll.push({ id: d.id, ...d.data() }));

  const now = new Date();
  const startM = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const endM = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const financeMonth = [];
  for (const row of financeAll) {
    const rawD = row.date ?? row.createdAt;
    const d = mayaAdminToDate(rawD);
    if (!d || Number.isNaN(d.getTime())) continue;
    const t = d.getTime();
    if (t >= startM.getTime() && t <= endM.getTime()) financeMonth.push(row);
  }
  financeMonth.sort((a, b) => {
    const ta = mayaAdminToDate(a.date ?? a.createdAt)?.getTime() ?? 0;
    const tb = mayaAdminToDate(b.date ?? b.createdAt)?.getTime() ?? 0;
    return tb - ta;
  });

  let monthIncome = 0;
  let monthExpense = 0;
  for (const row of financeMonth) {
    const amt = Number(row.amount);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    if (row.type === "expense") monthExpense += amt;
    else if (financeIncomeCountsAsRealizedAdmin(row)) monthIncome += amt;
  }

  const financeRecentCap = financeMonth.slice(0, 95);
  const campaigns = [];
  campSnap.forEach((d) => campaigns.push({ id: d.id, ...d.data() }));
  campaigns.sort(
    (a, b) => (mayaAdminToDate(b.createdAt)?.getTime() ?? 0) - (mayaAdminToDate(a.createdAt)?.getTime() ?? 0),
  );
  const campaignsShort = campaigns.slice(0, 22);

  const profile = {
    businessName: typeof bizData.businessName === "string" ? bizData.businessName.trim() : "",
    serviceArea: typeof bizData.serviceArea === "string" ? bizData.serviceArea.trim() : "",
    phone: typeof bizData.phone === "string" ? bizData.phone.trim() : "",
  };

  return {
    ...incoming,
    businessId,
    profile,
    jobs: mayaPlainJsonForContext(jobsActive),
    jobsRecentDelivered: mayaPlainJsonForContext(jobsDelivered),
    orders: mayaPlainJsonForContext(ordersActive),
    ordersRecentDelivered: mayaPlainJsonForContext(ordersDelivered),
    clients: mayaPlainJsonForContext(clients.slice(0, 30)),
    calendarUpcomingFourWeeks: mayaPlainJsonForContext(calendarRows),
    financeThisMonth: {
      income: monthIncome,
      expense: monthExpense,
      net: monthIncome - monthExpense,
    },
    financeRecent: mayaPlainJsonForContext(financeRecentCap),
    campaigns: mayaPlainJsonForContext(campaignsShort),
    stats: {
      jobsActiveCount: jobsActive.length,
      jobsDeliveredListed: jobsDelivered.length,
      ordersActiveCount: ordersActive.length,
      ordersDeliveredListed: ordersDelivered.length,
      clientCount: clients.length,
      campaignCount: campaignsShort.length,
      financeMonthCount: financeMonth.length,
      calendarEventCount: calendarRows.length,
    },
    contextNote:
      "Datos del negocio recargados desde Firestore en el servidor en esta petición (instantánea actual, no caché del navegador).",
    contextServerRefreshedAt: new Date().toISOString(),
  };
}

/**
 * @param {Record<string, unknown>} c
 * @returns {Set<string>}
 */
function mayaDataFocusProtectSet(c) {
  const raw = c.dataFocus;
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.map((x) => String(x).toLowerCase()));
}

function mayaAggressiveShrinkFirebaseContext(c) {
  if (!c || typeof c !== "object") return false;
  const prot = mayaDataFocusProtectSet(c);

  if (!prot.has("campaigns") && Array.isArray(c.campaigns) && c.campaigns.length > 2) {
    c.campaigns = c.campaigns.slice(0, Math.max(2, Math.floor(c.campaigns.length / 2)));
    return true;
  }

  const calKey = Array.isArray(c.calendarUpcomingFourWeeks)
    ? "calendarUpcomingFourWeeks"
    : Array.isArray(c.calendarNextTwoWeeks)
      ? "calendarNextTwoWeeks"
      : null;
  if (!prot.has("calendar") && calKey && c[calKey].length > 2) {
    c[calKey] = c[calKey].slice(0, Math.max(2, Math.floor(c[calKey].length / 2)));
    return true;
  }

  if (!prot.has("finance") && Array.isArray(c.financeRecent) && c.financeRecent.length > 4) {
    c.financeRecent = c.financeRecent.slice(0, Math.max(3, Math.floor(c.financeRecent.length / 2)));
    return true;
  }

  if (Array.isArray(c.jobsRecentDelivered) && c.jobsRecentDelivered.length > 2) {
    c.jobsRecentDelivered = c.jobsRecentDelivered.slice(0, Math.max(1, Math.floor(c.jobsRecentDelivered.length / 2)));
    return true;
  }
  if (Array.isArray(c.ordersRecentDelivered) && c.ordersRecentDelivered.length > 2) {
    c.ordersRecentDelivered = c.ordersRecentDelivered.slice(0, Math.max(1, Math.floor(c.ordersRecentDelivered.length / 2)));
    return true;
  }

  if (!prot.has("clients") && Array.isArray(c.clients) && c.clients.length > 4) {
    c.clients = c.clients.slice(0, Math.max(3, Math.floor(c.clients.length / 2)));
    return true;
  }

  if (!prot.has("orders") && Array.isArray(c.orders) && c.orders.length > 4) {
    c.orders = c.orders.slice(0, Math.max(3, Math.floor(c.orders.length / 2)));
    return true;
  }
  if (!prot.has("orders") && Array.isArray(c.jobs) && c.jobs.length > 4) {
    c.jobs = c.jobs.slice(0, Math.max(3, Math.floor(c.jobs.length / 2)));
    return true;
  }

  if (Array.isArray(c.clientsMentionedInMessage) && c.clientsMentionedInMessage.length > 1) {
    c.clientsMentionedInMessage = c.clientsMentionedInMessage.slice(0, 1);
    return true;
  }

  if (c.profile && typeof c.profile === "object") {
    delete c.profile.businessDescription;
    delete c.profile.description;
    return true;
  }
  if (c.stats) {
    delete c.stats;
    return true;
  }
  if (typeof c.contextNote === "string" && c.contextNote.length > 12) {
    c.contextNote = "…";
    return true;
  }
  if (typeof c.dataFocusHint === "string" && c.dataFocusHint.length > 8) {
    c.dataFocusHint = "";
    return true;
  }
  return false;
}

function buildMayaSystemString(basePrompt, firebaseCtx) {
  return `${basePrompt}\n\nCONTEXTO DEL NEGOCIO:\n${JSON.stringify(firebaseCtx)}`;
}

/**
 * Recorta mensajes y contexto Firebase hasta acercarse al presupuesto de tokens (sin tocar el prompt base).
 * @param {string} basePrompt
 * @param {Record<string, unknown>} firebaseContextRaw
 * @param {unknown} messagesRaw
 * @returns {{ system: string, messages: { role: string, content: string }[] }}
 */
function prepareMayaAnthropicPayload(basePrompt, firebaseContextRaw, messagesRaw) {
  let messages = trimMayaChatMessages(asChatMessages(messagesRaw));
  let fc = shrinkFirebaseContextInitial(
    firebaseContextRaw && typeof firebaseContextRaw === "object" ? firebaseContextRaw : {},
  );
  let system = buildMayaSystemString(basePrompt, fc);

  for (let i = 0; i < 80 && mayaAnthropicInputTokenEstimate(system, messages) > MAYA_TARGET_TOTAL_INPUT_TOKENS; i++) {
    if (mayaAggressiveShrinkFirebaseContext(fc)) {
      system = buildMayaSystemString(basePrompt, fc);
      continue;
    }
    if (messages.length > 8) {
      messages = messages.slice(-Math.max(6, messages.length - 4));
      continue;
    }
    if (messages.length > 4) {
      messages = messages.slice(-4);
      continue;
    }
    if (messages.length > 2) {
      messages = messages.slice(-2);
      continue;
    }
    break;
  }
  return { system, messages };
}

const MAYA_PANEL_ACTION_PREFIX = "MAYA_ACTION_JSON:";
const MAYA_PANEL_ACTION_ALIASES = {
  save_client: "create_client",
  schedule_delivery: "create_calendar_event",
};
const MAYA_PANEL_EXECUTABLE_ACTIONS = new Set([
  "create_client",
  "create_order",
  "add_income",
  "add_expense",
  "create_calendar_event",
  "delete_order",
  "delete_client",
  "delete_calendar_event",
  "delete_transaction",
  "add_team_member",
  "update_team_member",
  "delete_team_member",
  "assign_task",
  "list_team",
  "get_balance",
  "set_order_expenses",
  "mark_order_delivered",
]);

const FINANCE_INCOME_KEYS = new Set(["ventas", "anticipos", "otros_ingresos", "ganancias"]);
const FINANCE_EXPENSE_KEYS = new Set([
  "materiales",
  "transporte",
  "personal",
  "servicios",
  "alquiler",
  "marketing",
  "otros_gastos",
]);

/**
 * @param {string} text
 * @param {string} prefix
 * @returns {{ text: string, payload: Record<string, unknown> | null }}
 */
function extractAndRemoveSingleTaggedJson(text, prefix) {
  const raw = String(text ?? "");
  const idx = raw.indexOf(prefix);
  if (idx < 0) return { text: raw, payload: null };
  const afterPrefix = raw.slice(idx + prefix.length).trimStart();
  const jsonStartInAfter = afterPrefix.indexOf("{");
  if (jsonStartInAfter < 0) return { text: raw, payload: null };
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
  if (end < 0) return { text: raw, payload: null };
  const jsonStr = fromBrace.slice(0, end + 1);
  let payload = null;
  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed && typeof parsed === "object") payload = /** @type {Record<string, unknown>} */ (parsed);
  } catch {
    return { text: raw, payload: null };
  }
  const removeEnd = idx + prefix.length + afterPrefix.slice(0, jsonStartInAfter).length + end + 1;
  const nextText = (raw.slice(0, idx) + raw.slice(removeEnd)).replace(/\n{3,}/g, "\n\n").trim();
  return { text: nextText, payload };
}

/**
 * @param {string} text
 * @param {string} prefix
 * @returns {{ text: string, payloads: Record<string, unknown>[] }}
 */
function extractAndRemoveAllTaggedJson(text, prefix) {
  let out = String(text ?? "");
  const payloads = [];
  while (true) {
    const step = extractAndRemoveSingleTaggedJson(out, prefix);
    if (!step.payload) break;
    payloads.push(step.payload);
    out = step.text;
  }
  return { text: out, payloads };
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {Record<string, unknown>}
 */
function mergeMayaActionData(payload) {
  const nested =
    payload.data && typeof payload.data === "object"
      ? /** @type {Record<string, unknown>} */ ({ ...payload.data })
      : {};
  const out = { ...nested };
  for (const k of [
    "name",
    "phone",
    "email",
    "clientName",
    "clientPhone",
    "product",
    "quantity",
    "clientId",
    "transactionId",
    "title",
    "date",
    "amount",
    "deposit",
    "expenses",
    "amount",
    "description",
    "category",
    "period",
    "deliveryDate",
    "notes",
    "status",
    "orderId",
    "memberId",
    "task",
    "role",
    "permissions",
    "changes",
    "eventId",
    "eventTitle",
    "weekday",
  ]) {
    if (k in payload && payload[k] !== undefined && out[k] === undefined) {
      out[k] = payload[k];
    }
  }
  return out;
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} businessId
 * @param {Record<string, unknown>} payload
 */
async function mayaDeleteOrderCascade(db, businessId, payload) {
  const { ref: orderRef, snap: orderSnap } = await mayaResolveOrderRef(db, businessId, payload);
  if (!orderSnap.exists) throw new Error("La orden indicada no existe.");
  const orderId = orderRef.id;
  const order = orderSnap.data() || {};

  const linkedCalendarId =
    typeof order.linkedCalendarId === "string" && order.linkedCalendarId.trim()
      ? order.linkedCalendarId.trim()
      : "";
  if (linkedCalendarId) {
    await db.collection("businesses").doc(businessId).collection("calendar").doc(linkedCalendarId).delete();
  }

  if (typeof order.linkedFinanceId === "string" && order.linkedFinanceId.trim()) {
    await db
      .collection("businesses")
      .doc(businessId)
      .collection("finance")
      .doc(order.linkedFinanceId.trim())
      .delete();
  }

  const financeSnap = await db
    .collection("businesses")
    .doc(businessId)
    .collection("finance")
    .where("orderId", "==", orderId)
    .get();
  for (const d of financeSnap.docs) {
    await d.ref.delete();
  }

  await orderRef.delete();
}

/**
 * Elimina un cliente por `clientId` o búsqueda por nombre (`clientName` / `name`).
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} businessId
 * @param {Record<string, unknown>} payload
 */
async function mayaDeleteClientByPayload(db, businessId, payload) {
  const data = mergeMayaActionData(payload);
  let clientId =
    typeof data.clientId === "string"
      ? data.clientId.trim()
      : String(data.clientId ?? "").trim();
  if (clientId) {
    const ref = db.collection("businesses").doc(businessId).collection("clients").doc(clientId);
    const snap = await ref.get();
    if (!snap.exists) throw new Error("Cliente no encontrado con ese id.");
    await ref.delete();
    return;
  }
  const nameRaw =
    typeof data.clientName === "string" && data.clientName.trim()
      ? data.clientName.trim()
      : typeof data.name === "string" && data.name.trim()
        ? data.name.trim()
        : "";
  const name = nameRaw.toLowerCase();
  if (!name) throw new Error("Falta clientId o clientName para eliminar el cliente.");
  const snap = await db.collection("businesses").doc(businessId).collection("clients").limit(400).get();
  /** @type {{ doc: import("firebase-admin/firestore").QueryDocumentSnapshot; full: string }[]} */
  const matches = [];
  snap.forEach((d) => {
    const x = d.data() || {};
    const fn = typeof x.fullName === "string" ? x.fullName.trim().toLowerCase() : "";
    const n = typeof x.name === "string" ? x.name.trim().toLowerCase() : "";
    const cand = fn || n;
    if (!cand) return;
    if (cand.includes(name) || name.includes(cand)) matches.push({ doc: d, full: cand });
  });
  if (matches.length === 0) throw new Error("No encontré un cliente con ese nombre.");
  if (matches.length > 1) {
    const exact = matches.find((m) => m.full === name);
    if (exact) {
      await exact.doc.ref.delete();
      return;
    }
    throw new Error(
      "Hay varios clientes con nombres parecidos; pasá el clientId del contexto Firebase o el nombre completo exacto.",
    );
  }
  await matches[0].doc.ref.delete();
}

/** Día de la semana en JS (0=domingo … 6=sábado) desde texto en español. */
const MAYA_WEEKDAY_ES = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  "miércoles": 3,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  "sábado": 6,
  sabado: 6,
};

/**
 * Elimina un evento por `eventId` o por criterios (título, día de la semana, fecha ISO).
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} businessId
 * @param {Record<string, unknown>} payload
 */
async function mayaDeleteCalendarEvent(db, businessId, payload) {
  const data = mergeMayaActionData(payload);
  const eventId = typeof data.eventId === "string" ? data.eventId.trim() : "";
  if (eventId) {
    const ref = db.collection("businesses").doc(businessId).collection("calendar").doc(eventId);
    const snap = await ref.get();
    if (!snap.exists) throw new Error("Evento de calendario no encontrado.");
    await ref.delete();
    return;
  }

  const titleNeedle = (
    typeof data.title === "string" && data.title.trim()
      ? data.title.trim()
      : typeof data.eventTitle === "string" && data.eventTitle.trim()
        ? data.eventTitle.trim()
        : ""
  ).toLowerCase();

  const weekdayRaw = typeof data.weekday === "string" ? data.weekday.trim().toLowerCase() : "";
  let targetWd = MAYA_WEEKDAY_ES[weekdayRaw];

  let wantDay = null;
  if (data.date != null && String(data.date).trim()) {
    wantDay = parseFinanceMovementDate(data.date);
  }

  const snap = await db.collection("businesses").doc(businessId).collection("calendar").limit(500).get();
  /** @type {{ doc: import("firebase-admin/firestore").QueryDocumentSnapshot; dt: Date | null }[]} */
  const candidates = [];
  snap.forEach((doc) => {
    const row = doc.data() || {};
    let dt = null;
    if (row.date && typeof row.date.toDate === "function") {
      try {
        dt = row.date.toDate();
      } catch {
        dt = null;
      }
    }
    const t = typeof row.title === "string" ? row.title.toLowerCase() : "";
    let ok = true;
    if (titleNeedle && !t.includes(titleNeedle)) ok = false;
    if (targetWd !== undefined && dt && dt.getDay() !== targetWd) ok = false;
    if (wantDay && dt && !isSameCalendarDay(dt, wantDay)) ok = false;
    if (ok) candidates.push({ doc, dt });
  });

  if (candidates.length === 0) {
    throw new Error("No encontré un evento de calendario con esos criterios.");
  }

  if (candidates.length === 1) {
    await candidates[0].doc.ref.delete();
    return;
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  if (targetWd !== undefined && !titleNeedle && !wantDay) {
    const future = candidates.filter((c) => c.dt && c.dt >= todayStart);
    future.sort((a, b) => (a.dt?.getTime() || 0) - (b.dt?.getTime() || 0));
    if (future.length) {
      await future[0].doc.ref.delete();
      return;
    }
    const past = [...candidates].filter((c) => c.dt).sort((a, b) => (b.dt?.getTime() || 0) - (a.dt?.getTime() || 0));
    if (past.length) {
      await past[0].doc.ref.delete();
      return;
    }
  }

  throw new Error(
    "Hay varios eventos que coinciden; pasá el eventId del contexto o más detalle (título, fecha o día de la semana único).",
  );
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} businessId
 * @param {Record<string, unknown>} payload
 */
async function mayaTeamAddMember(db, businessId, payload) {
  const data = mergeMayaActionData(payload);
  const name = typeof data.name === "string" ? data.name.trim() : "";
  if (!name) throw new Error("Falta nombre del miembro.");
  const role = typeof data.role === "string" && data.role.trim() ? data.role.trim() : "miembro";
  const phone = typeof data.phone === "string" ? data.phone.trim() : "";
  const email = typeof data.email === "string" ? data.email.trim() : "";
  const permissions = Array.isArray(data.permissions) ? data.permissions.filter((x) => typeof x === "string") : [];
  await db.collection("businesses").doc(businessId).collection("team").add({
    name,
    phone,
    email,
    role,
    permissions,
    status: "active",
    createdAt: FieldValue.serverTimestamp(),
    createdBy: "maya",
  });
}

async function mayaResolveTeamMemberId(db, businessId, data) {
  let memberId = typeof data.memberId === "string" ? data.memberId.trim() : "";
  if (memberId) return memberId;
  const name = typeof data.name === "string" ? data.name.trim().toLowerCase() : "";
  if (!name) throw new Error("Falta memberId o nombre del miembro.");
  const snap = await db.collection("businesses").doc(businessId).collection("team").limit(200).get();
  let found = "";
  snap.forEach((d) => {
    if (found) return;
    const v = d.data() || {};
    const n = typeof v.name === "string" ? v.name.trim().toLowerCase() : "";
    if (n && n.includes(name)) found = d.id;
  });
  if (!found) throw new Error("No encontré miembro de equipo con ese nombre.");
  return found;
}

async function mayaTeamUpdateMember(db, businessId, payload) {
  const data = mergeMayaActionData(payload);
  const memberId = await mayaResolveTeamMemberId(db, businessId, data);
  const changes =
    data.changes && typeof data.changes === "object"
      ? { ...data.changes }
      : {};
  for (const k of ["name", "phone", "email", "role", "status", "permissions"]) {
    if (data[k] !== undefined && changes[k] === undefined) changes[k] = data[k];
  }
  const out = {};
  if (typeof changes.name === "string") out.name = changes.name.trim();
  if (typeof changes.phone === "string") out.phone = changes.phone.trim();
  if (typeof changes.email === "string") out.email = changes.email.trim();
  if (typeof changes.role === "string") out.role = changes.role.trim();
  if (typeof changes.status === "string") out.status = changes.status.trim();
  if (Array.isArray(changes.permissions)) out.permissions = changes.permissions.filter((x) => typeof x === "string");
  if (!Object.keys(out).length) throw new Error("No hay cambios válidos para actualizar miembro.");
  out.updatedAt = FieldValue.serverTimestamp();
  out.updatedBy = "maya";
  await db.collection("businesses").doc(businessId).collection("team").doc(memberId).update(out);
}

async function mayaTeamDeleteMember(db, businessId, payload) {
  const data = mergeMayaActionData(payload);
  const memberId = await mayaResolveTeamMemberId(db, businessId, data);
  await db.collection("businesses").doc(businessId).collection("team").doc(memberId).delete();
}

async function mayaTeamAssignTask(db, businessId, payload) {
  const data = mergeMayaActionData(payload);
  const memberId = await mayaResolveTeamMemberId(db, businessId, data);
  const task = typeof data.task === "string" ? data.task.trim() : "";
  if (!task) throw new Error("Falta tarea para asignar.");
  const t = {
    text: task,
    status: "pending",
    assignedAt: new Date().toISOString(),
    assignedBy: "maya",
  };
  await db
    .collection("businesses")
    .doc(businessId)
    .collection("team")
    .doc(memberId)
    .set(
      {
        tasks: FieldValue.arrayUnion(t),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}

async function mayaTeamListBlock(db, businessId) {
  const snap = await db.collection("businesses").doc(businessId).collection("team").limit(100).get();
  if (snap.empty) return "Equipo: no hay miembros registrados todavía.";
  const lines = [];
  snap.forEach((d) => {
    const x = d.data() || {};
    const n = typeof x.name === "string" && x.name.trim() ? x.name.trim() : "Sin nombre";
    const r = typeof x.role === "string" && x.role.trim() ? x.role.trim() : "miembro";
    const s = typeof x.status === "string" && x.status.trim() ? x.status.trim() : "active";
    lines.push(`- ${n} (${r}) [${s}] id:${d.id}`);
  });
  return `Equipo actual:\n${lines.join("\n")}`;
}

/**
 * @param {Record<string, unknown>} payload
 */
function mergeFinancePayload(payload) {
  const nested =
    payload.data && typeof payload.data === "object"
      ? /** @type {Record<string, unknown>} */ ({ ...payload.data })
      : {};
  const out = { ...nested };
  for (const k of [
    "amount",
    "description",
    "category",
    "date",
    "period",
    "transactionId",
    "clientId",
    "orderId",
    "dateHint",
    "type",
  ]) {
    if (k in payload && payload[k] !== undefined && out[k] === undefined) {
      out[k] = payload[k];
    }
  }
  return out;
}

function formatMoneyUsd(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "$0.00";
  const sign = v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * @param {string} period
 */
function normalizeFinancePeriod(period) {
  const p = String(period ?? "")
    .trim()
    .toLowerCase();
  if (p === "day" || p === "today" || p === "hoy") return "day";
  if (p === "week" || p === "semana") return "week";
  if (p === "month" || p === "mes") return "month";
  if (p === "all" || p === "todo" || p === "total") return "all";
  return "month";
}

/**
 * @param {"day" | "week" | "month" | "all"} period
 * @returns {{ contains: (d: Date | null | undefined) => boolean, label: string }}
 */
function financeBoundsForPeriod(period) {
  const now = new Date();
  if (period === "all") {
    return {
      contains: () => true,
      label: "En total registrado",
    };
  }
  if (period === "day") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return {
      contains: (d) => !!d && !Number.isNaN(d.getTime()) && d >= start && d <= end,
      label: "Hoy",
    };
  }
  if (period === "week") {
    const x = new Date(now);
    const day = (x.getDay() + 6) % 7;
    x.setDate(x.getDate() - day);
    const start = new Date(x.getFullYear(), x.getMonth(), x.getDate(), 0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return {
      contains: (d) => !!d && !Number.isNaN(d.getTime()) && d >= start && d <= end,
      label: "Esta semana",
    };
  }
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return {
    contains: (d) => !!d && !Number.isNaN(d.getTime()) && d >= start && d <= end,
    label: "Este mes",
  };
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} businessId
 * @param {"day" | "week" | "month" | "all"} period
 */
async function aggregateFinanceTotals(db, businessId, period) {
  const { contains } = financeBoundsForPeriod(period);
  const snap = await db.collection("businesses").doc(businessId).collection("finance").limit(3000).get();
  let income = 0;
  let expense = 0;
  snap.forEach((docSnap) => {
    const d = docSnap.data();
    const raw = d.date;
    let dt = null;
    if (raw && typeof raw.toDate === "function") {
      try {
        dt = raw.toDate();
      } catch {
        dt = null;
      }
    }
    if (!contains(dt)) return;
    const amt = Number(d.amount);
    if (!Number.isFinite(amt) || amt <= 0) return;
    if (d.type === "expense") expense += amt;
    else if (financeIncomeCountsAsRealizedAdmin(d)) income += amt;
  });
  return { income, expense, net: income - expense };
}

/**
 * @param {string} raw
 * @param {"income" | "expense"} kind
 */
function normalizeFinanceCategory(raw, kind) {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (kind === "income") {
    if (s === "otros_ingresos" || s === "otros" || s === "otrosingresos") return "otros_ingresos";
    if (s === "ganancias" || s === "ganancia") return "ganancias";
    if (FINANCE_INCOME_KEYS.has(s)) return s;
    return "otros_ingresos";
  }
  if (FINANCE_EXPENSE_KEYS.has(s)) return s;
  const map = {
    material: "materiales",
    materiales: "materiales",
    transport: "transporte",
    transporte: "transporte",
    rent: "alquiler",
    alquiler: "alquiler",
  };
  if (map[s]) return map[s];
  return "otros_gastos";
}

/**
 * @param {unknown} raw
 */
function parseFinanceMovementDate(raw) {
  if (raw == null || raw === "") {
    const t = new Date();
    t.setHours(12, 0, 0, 0);
    return t;
  }
  const s = typeof raw === "string" ? raw.trim() : String(raw);
  const d = new Date(s.includes("T") ? s : `${s}T12:00:00`);
  if (Number.isNaN(d.getTime())) {
    const t = new Date();
    t.setHours(12, 0, 0, 0);
    return t;
  }
  d.setHours(12, 0, 0, 0);
  return d;
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} businessId
 * @param {Record<string, unknown>} payload
 */
async function mayaFinanceAddMovement(db, businessId, payload, kind) {
  const data = mergeFinancePayload(payload);
  const amt = Number(data.amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw new Error("Monto inválido para registrar.");
  }
  const description =
    typeof data.description === "string" && data.description.trim()
      ? data.description.trim()
      : "Movimiento (Chat IA)";
  const category = normalizeFinanceCategory(data.category, kind);
  const movementDate = parseFinanceMovementDate(data.date);
  const clientId = typeof data.clientId === "string" && data.clientId.trim() ? data.clientId.trim() : null;
  const orderId = typeof data.orderId === "string" && data.orderId.trim() ? data.orderId.trim() : null;

  await db.collection("businesses").doc(businessId).collection("finance").add({
    type: kind,
    status: "cobrado",
    amount: amt,
    category,
    description,
    clientId,
    orderId,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: "maya",
    date: Timestamp.fromDate(movementDate),
  });
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} businessId
 * @param {Record<string, unknown>} payload
 */
async function mayaFinanceDelete(db, businessId, payload) {
  const data = mergeFinancePayload(payload);
  const tid =
    typeof data.transactionId === "string"
      ? data.transactionId.trim()
      : String(data.transactionId ?? "").trim();
  if (tid) {
    const ref = db.collection("businesses").doc(businessId).collection("finance").doc(tid);
    const snap = await ref.get();
    if (!snap.exists) throw new Error("Movimiento financiero no encontrado.");
    await ref.delete();
    return;
  }

  const amountHint = data.amount != null ? Number(data.amount) : NaN;
  const dateHintRaw =
    typeof data.dateHint === "string"
      ? data.dateHint.trim().toLowerCase()
      : typeof data.date === "string"
        ? data.date.trim().toLowerCase()
        : "";
  const descHint = typeof data.description === "string" ? data.description.trim().toLowerCase() : "";
  const typeRaw = typeof data.type === "string" ? data.type.trim().toLowerCase() : "";

  const snap = await db.collection("businesses").doc(businessId).collection("finance").limit(800).get();
  /** @type {import("firebase-admin/firestore").QueryDocumentSnapshot[]} */
  const candidates = [];

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);

  snap.forEach((doc) => {
    const row = doc.data() || {};
    const rowAmt = Number(row.amount);
    const rowDesc = typeof row.description === "string" ? row.description.toLowerCase() : "";
    const rowType = typeof row.type === "string" ? row.type.toLowerCase() : "";
    let rowDate = null;
    if (row.date && typeof row.date.toDate === "function") {
      try {
        rowDate = row.date.toDate();
      } catch {
        rowDate = null;
      }
    }

    let dateOk = true;
    if (dateHintRaw === "ayer" || dateHintRaw === "yesterday") {
      dateOk = !!(rowDate && isSameCalendarDay(rowDate, yesterdayStart));
    } else if (dateHintRaw === "hoy" || dateHintRaw === "today") {
      dateOk = !!(rowDate && isSameCalendarDay(rowDate, todayStart));
    } else if (dateHintRaw && /^\d{4}-\d{2}-\d{2}/.test(dateHintRaw)) {
      const d = new Date(dateHintRaw.includes("T") ? dateHintRaw : `${dateHintRaw}T12:00:00`);
      dateOk = !!(rowDate && !Number.isNaN(d.getTime()) && isSameCalendarDay(rowDate, d));
    }

    if (!dateOk) return;

    if (typeRaw === "gasto" || typeRaw === "expense") {
      if (rowType !== "expense") return;
    } else if (typeRaw === "ingreso" || typeRaw === "income") {
      if (rowType !== "income") return;
    }

    if (Number.isFinite(amountHint) && amountHint > 0) {
      if (Math.abs(rowAmt - amountHint) > 0.02) return;
    }

    if (descHint && !rowDesc.includes(descHint)) return;

    candidates.push(doc);
  });

  if (candidates.length === 0) {
    throw new Error("No encontré un movimiento que coincida con esos criterios (usa transactionId del contexto si sigue fallando).");
  }
  if (candidates.length > 1) {
    throw new Error(
      "Hay varios movimientos que coinciden; pasá el transactionId del contexto o más detalles (monto + fecha + tipo).",
    );
  }
  await candidates[0].ref.delete();
}

/**
 * Cierra un pedido como entregado: anula el depósito retenido en finance, registra un único ingreso real
 * (`status: cobrado`) por el total del pedido; `netProfit` queda en el documento del pedido.
 * Idempotente si `deliverySettled` ya es true.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} businessId
 * @param {import("firebase-admin/firestore").DocumentReference} orderRef
 * @param {Record<string, unknown>} order
 */
async function finalizeOrderDeliveryAndProfit(db, businessId, orderRef, order) {
  if (order.deliverySettled === true) {
    await orderRef.set(
      { status: "entregado", updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    return { already: true };
  }

  const orderId = orderRef.id;
  const clientName = asText(order.clientName, "Cliente");
  const product = asText(order.product, "Pedido");
  const linkedClientId = asText(order.linkedClientId);

  const amount = Math.max(0, Number(order.amount) || 0);
  const expenses = Math.max(0, Number(order.expenses) || 0);
  const netProfit = Math.max(0, amount - expenses);

  /** @type {Record<string, unknown>} */
  const patch = {
    status: "entregado",
    balance: 0,
    deliverySettled: true,
    netProfit,
    updatedAt: FieldValue.serverTimestamp(),
  };

  const linkedFinanceDeposit = asText(order.linkedFinanceId);
  if (linkedFinanceDeposit) {
    const depRef = db.collection("businesses").doc(businessId).collection("finance").doc(linkedFinanceDeposit);
    const depSnap = await depRef.get();
    if (depSnap.exists) {
      await depRef.set(
        {
          status: "cancelado",
          cancelledReason: "Pedido entregado: depósito retenido absorbido en cobro total",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
  }

  if (amount > 0) {
    const finRef = await db.collection("businesses").doc(businessId).collection("finance").add({
      type: "income",
      status: "cobrado",
      amount,
      category: "ventas",
      description: `Cobro total pedido entregado: ${product} - ${clientName}`,
      clientId: linkedClientId || null,
      orderId,
      linkedOrderId: orderId,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: "marvin",
      date: Timestamp.fromDate(new Date()),
    });
    patch.linkedCobroTotalFinanceId = finRef.id;
  }

  const linkedCalendarId = asText(order.linkedCalendarId);
  if (linkedCalendarId) {
    await db
      .collection("businesses")
      .doc(businessId)
      .collection("calendar")
      .doc(linkedCalendarId)
      .set(
        {
          status: "completed",
          completedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
  }

  await orderRef.set(patch, { merge: true });
  return { already: false, netProfit };
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} businessId
 * @param {Record<string, unknown>} payload
 */
async function mayaResolveOrderRef(db, businessId, payload) {
  const data = mergeMayaActionData(payload);
  let orderId = typeof data.orderId === "string" ? data.orderId.trim() : "";
  if (orderId) {
    const ref = db.collection("businesses").doc(businessId).collection("orders").doc(orderId);
    const snap = await ref.get();
    if (snap.exists) return { ref, snap };
  }
  const name = typeof data.clientName === "string" ? data.clientName.trim().toLowerCase() : "";
  if (!name) throw new Error("Falta orderId o clientName para identificar el pedido.");
  const qs = await db
    .collection("businesses")
    .doc(businessId)
    .collection("orders")
    .orderBy("createdAt", "desc")
    .limit(80)
    .get();
  /** @type {import("firebase-admin/firestore").QueryDocumentSnapshot | null} */
  let pick = null;
  qs.forEach((doc) => {
    if (pick) return;
    const d = doc.data() || {};
    const cn = typeof d.clientName === "string" ? d.clientName.trim().toLowerCase() : "";
    if (cn && (cn.includes(name) || name.includes(cn))) pick = doc;
  });
  if (!pick) throw new Error("No encontré un pedido para ese cliente.");
  return { ref: pick.ref, snap: pick };
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} businessId
 * @param {Record<string, unknown>} payload
 */
async function mayaSetOrderExpenses(db, businessId, payload) {
  const data = mergeMayaActionData(payload);
  const exp = Number(data.expenses);
  if (!Number.isFinite(exp) || exp < 0) throw new Error("Monto de gastos inválido.");
  const { ref } = await mayaResolveOrderRef(db, businessId, payload);
  await ref.set(
    { expenses: Math.max(0, exp), updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} businessId
 * @param {Record<string, unknown>} payload
 */
async function mayaMarkOrderDelivered(db, businessId, payload) {
  const { ref, snap } = await mayaResolveOrderRef(db, businessId, payload);
  const order = snap.data() || {};
  return finalizeOrderDeliveryAndProfit(db, businessId, ref, order);
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} businessId
 * @param {"day" | "week" | "month" | "all"} period
 */
async function mayaFinanceBalanceBlock(db, businessId, period) {
  const { label } = financeBoundsForPeriod(period);
  const { income, expense, net } = await aggregateFinanceTotals(db, businessId, period);
  const face = net >= 0 ? "✅" : "⚠️";
  return `${label} llevas:
• Ingresos: ${formatMoneyUsd(income)}
• Gastos: ${formatMoneyUsd(expense)}
• Ganancia neta: ${formatMoneyUsd(net)} ${face}`;
}

/**
 * Ejecuta acciones financieras del panel en el servidor (MAYA_ACTION_JSON).
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {Record<string, unknown>} firebaseContext
 * @param {string} rawReply
 */
async function applyMayaActionsFromPanelReply(db, firebaseContext, rawReply) {
  const extracted = extractAndRemoveAllTaggedJson(rawReply, MAYA_PANEL_ACTION_PREFIX);
  const visibleText = extracted.text.trim();
  const payloads = extracted.payloads;
  if (!payloads.length) return rawReply;

  const businessId =
    typeof firebaseContext.businessId === "string" ? firebaseContext.businessId.trim() : "";
  if (!businessId) {
    return (
      (visibleText || rawReply) +
      "\n\n(No se pudo ejecutar la acción financiera: falta businessId en el contexto.)"
    ).trim();
  }

  const extraBlocks = [];
  try {
    for (const payload of payloads) {
      const actionRaw = typeof payload.action === "string" ? payload.action.trim() : "";
      const action = MAYA_PANEL_ACTION_ALIASES[actionRaw] || actionRaw;
      if (!MAYA_PANEL_EXECUTABLE_ACTIONS.has(action)) continue;
      if (action === "get_balance") {
        const data = mergeFinancePayload(payload);
        const period = normalizeFinancePeriod(data.period);
        const block = await mayaFinanceBalanceBlock(db, businessId, period);
        extraBlocks.push(block);
        continue;
      }
      if (action === "add_income") {
        await mayaFinanceAddMovement(db, businessId, payload, "income");
        continue;
      }
      if (action === "add_expense") {
        await mayaFinanceAddMovement(db, businessId, payload, "expense");
        continue;
      }
      if (action === "delete_transaction") {
        await mayaFinanceDelete(db, businessId, payload);
        continue;
      }
      if (action === "delete_calendar_event") {
        await mayaDeleteCalendarEvent(db, businessId, payload);
        continue;
      }
      if (action === "delete_order") {
        await mayaDeleteOrderCascade(db, businessId, payload);
        continue;
      }
      if (action === "create_client") {
        const data = mergeMayaActionData(payload);
        const name = typeof data.name === "string" ? data.name.trim() : "";
        await db.collection("businesses").doc(businessId).collection("clients").add({
          fullName: name || "Cliente",
          name: name || "Cliente",
          phone: typeof data.phone === "string" ? data.phone.trim() : "",
          email: typeof data.email === "string" ? data.email.trim() : "",
          source: "chat-maya",
          createdAt: FieldValue.serverTimestamp(),
        });
        continue;
      }
      if (action === "create_order") {
        const data = mergeMayaActionData(payload);
        await processNewOrder(db, businessId, {
          clientName: data.clientName,
          clientPhone: data.clientPhone,
          product: data.product,
          quantity: data.quantity,
          amount: data.amount ?? data.total,
          deposit: data.deposit,
          deliveryDate: data.deliveryDate ?? data.date,
          notes: data.notes,
          source: "chat_interno",
          createdBy: "maya",
          status: "nuevo",
        });
        continue;
      }
      if (action === "create_calendar_event") {
        const data = mergeMayaActionData(payload);
        const title =
          typeof data.title === "string" && data.title.trim()
            ? data.title.trim()
            : "Evento (Chat IA)";
        const time = typeof data.time === "string" ? data.time.trim() : "";
        const rawType = typeof data.type === "string" ? data.type.trim().toLowerCase() : "";
        const type = rawType === "delivery" ? "entrega" : rawType || "recordatorio";
        const clientName = typeof data.clientName === "string" ? data.clientName.trim() : "";
        const srcDate = data.date ?? data.deliveryDate;
        let date = new Date();
        if (srcDate != null) {
          const d = new Date(String(srcDate));
          if (!Number.isNaN(d.getTime())) date = d;
        }
        if (time) {
          const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
          if (m) {
            date.setHours(Number(m[1]), Number(m[2]), 0, 0);
          } else {
            date.setHours(12, 0, 0, 0);
          }
        } else {
          date.setHours(12, 0, 0, 0);
        }
        await db.collection("businesses").doc(businessId).collection("calendar").add({
          title,
          date: Timestamp.fromDate(date),
          time,
          type,
          clientId: null,
          clientName: clientName || null,
          notes: typeof data.notes === "string" ? data.notes.trim() : "",
          status: "pending",
          createdBy: "maya",
          deliveryDate: srcDate == null ? "" : String(srcDate),
          source: "chat-maya",
          createdAt: FieldValue.serverTimestamp(),
        });
        continue;
      }
      if (action === "delete_client") {
        await mayaDeleteClientByPayload(db, businessId, payload);
        continue;
      }
      if (action === "add_team_member") {
        await mayaTeamAddMember(db, businessId, payload);
        continue;
      }
      if (action === "update_team_member") {
        await mayaTeamUpdateMember(db, businessId, payload);
        continue;
      }
      if (action === "delete_team_member") {
        await mayaTeamDeleteMember(db, businessId, payload);
        continue;
      }
      if (action === "assign_task") {
        await mayaTeamAssignTask(db, businessId, payload);
        continue;
      }
      if (action === "list_team") {
        const block = await mayaTeamListBlock(db, businessId);
        extraBlocks.push(block);
        continue;
      }
      if (action === "set_order_expenses") {
        await mayaSetOrderExpenses(db, businessId, payload);
        continue;
      }
      if (action === "mark_order_delivered") {
        await mayaMarkOrderDelivered(db, businessId, payload);
        continue;
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    const base = visibleText.trim();
    return (base ? `${base}\n\n` : "") + `(No se pudo completar la acción: ${msg})`;
  }

  const base = visibleText || rawReply;
  if (!extraBlocks.length) return base;
  return `${base}\n\n${extraBlocks.join("\n\n")}`.trim();
}

/**
 * Parsea el stream SSE de Anthropic Messages y acumula texto del asistente.
 * @param {import("node:stream").Readable | ReadableStream<Uint8Array> | null} body
 * @param {(chunk: string) => void} onDelta
 * @returns {Promise<string>}
 */
async function readAnthropicMessageStream(body, onDelta) {
  if (!body || typeof body.getReader !== "function") {
    return "";
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let lineBuf = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    lineBuf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = lineBuf.indexOf("\n")) >= 0) {
      const line = lineBuf.slice(0, nl).trimEnd();
      lineBuf = lineBuf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === "[DONE]") continue;
      let evt;
      try {
        evt = JSON.parse(raw);
      } catch {
        continue;
      }
      if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta" && typeof evt.delta.text === "string") {
        const t = evt.delta.text;
        fullText += t;
        onDelta(t);
      }
    }
  }

  for (const line of lineBuf.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const raw = t.slice(5).trim();
    if (!raw || raw === "[DONE]") continue;
    let evt;
    try {
      evt = JSON.parse(raw);
    } catch {
      continue;
    }
    if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta" && typeof evt.delta.text === "string") {
      fullText += evt.delta.text;
      onDelta(evt.delta.text);
    }
  }
  return fullText;
}

export const chatWithAI = onRequest(
  { secrets: [ANTHROPIC_KEY] },
  async (req, res) => {
    corsHandler(req, res, async () => {
      if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
      }

      if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed. Use POST." });
      }

      try {
        const apiKey = ANTHROPIC_KEY.value();
        if (!apiKey) {
          return res.status(500).json({
            error: "Missing ANTHROPIC_KEY secret",
          });
        }

        const body = req.body && typeof req.body === "object" ? req.body : {};
        let firebaseContext =
          body.firebaseContext && typeof body.firebaseContext === "object" ? body.firebaseContext : {};
        const wantStream = body.stream === true;

        try {
          const dbChat = getAdminDb();
          firebaseContext = await loadFreshFirebaseContextForMaya(dbChat, firebaseContext);
        } catch (e) {
          console.error("[chatWithAI] loadFreshFirebaseContextForMaya", e);
        }

        const basePrompt = getMayaInternalChatPrompt();
        const { system, messages } = prepareMayaAnthropicPayload(basePrompt, firebaseContext, body.messages);

        if (!messages.length) {
          return res.status(400).json({ error: "Se requiere al menos un mensaje de usuario." });
        }
        if (messages[messages.length - 1].role !== "user") {
          return res.status(400).json({ error: "El último mensaje debe ser del usuario." });
        }

        const anthropicPayload = {
          model: MODEL_INTERNAL_CHAT,
          max_tokens: 4096,
          system,
          messages,
        };

        if (wantStream) {
          const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              ...anthropicPayload,
              stream: true,
            }),
          });

          if (!anthropicResponse.ok) {
            const errText = await anthropicResponse.text();
            let errMsg = errText;
            try {
              const j = JSON.parse(errText);
              errMsg = asText(j?.error?.message, errText);
            } catch {
              /* ignore */
            }
            return res.status(anthropicResponse.status).json({ error: errMsg });
          }

          res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
          res.setHeader("Cache-Control", "no-cache, no-transform");
          res.setHeader("X-Accel-Buffering", "no");

          const rawAccum = await readAnthropicMessageStream(anthropicResponse.body, (chunk) => {
            res.write(`${JSON.stringify({ type: "delta", text: chunk })}\n`);
          });

          const db = getAdminDb();
          const replyOut = await applyMayaActionsFromPanelReply(db, firebaseContext, rawAccum);
          res.write(`${JSON.stringify({ type: "done", reply: replyOut })}\n`);
          res.end();
          return;
        }

        const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify(anthropicPayload),
        });

        const anthropicBody = await anthropicResponse.json();
        if (!anthropicResponse.ok) {
          const message = asText(anthropicBody?.error?.message, "Anthropic API request failed.");
          return res.status(anthropicResponse.status).json({ error: message });
        }

        const textContent = Array.isArray(anthropicBody?.content)
          ? anthropicBody.content
              .filter((item) => item?.type === "text")
              .map((item) => item?.text || "")
              .join("\n")
          : "";

        const db = getAdminDb();
        const replyOut = await applyMayaActionsFromPanelReply(db, firebaseContext, textContent);

        return res.status(200).json({
          reply: replyOut,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return res.status(500).json({ error: "Chat request failed.", details: message });
      }
    });
  },
);

export const createManualOrder = onRequest(
  { secrets: [] },
  async (req, res) => {
    corsHandler(req, res, async () => {
      if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
      }
      if (req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed. Use POST." });
        return;
      }
      try {
        const body = req.body && typeof req.body === "object" ? req.body : {};
        const businessId = asText(body.businessId);
        if (!businessId) {
          res.status(400).json({ error: "businessId es requerido." });
          return;
        }
        const db = getAdminDb();
        const result = await processNewOrder(db, businessId, {
          clientName: body.clientName,
          clientPhone: body.clientPhone,
          product: body.product,
          quantity: body.quantity,
          amount: body.amount,
          deposit: body.deposit,
          expenses: body.expenses,
          deliveryDate: body.deliveryDate,
          notes: body.notes,
          source: "manual",
          createdBy: "marvin",
          status: body.status,
        });
        res.status(200).json({ ok: true, ...result });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Error desconocido";
        res.status(500).json({ error: "No se pudo crear el pedido.", details: message });
      }
    });
  },
);

export const updateOrderStatus = onRequest(
  { secrets: [] },
  async (req, res) => {
    corsHandler(req, res, async () => {
      if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
      }
      if (req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed. Use POST." });
        return;
      }
      try {
        const body = req.body && typeof req.body === "object" ? req.body : {};
        const businessId = asText(body.businessId);
        const orderId = asText(body.orderId);
        const nextStatus = normalizeOrderStatus(body.status);
        if (!businessId || !orderId) {
          res.status(400).json({ error: "businessId y orderId son requeridos." });
          return;
        }

        const db = getAdminDb();
        const orderRef = db.collection("businesses").doc(businessId).collection("orders").doc(orderId);
        const snap = await orderRef.get();
        if (!snap.exists) {
          res.status(404).json({ error: "Pedido no encontrado." });
          return;
        }
        const order = snap.data() || {};

        if (nextStatus === "entregado") {
          await finalizeOrderDeliveryAndProfit(db, businessId, orderRef, order);
        } else {
          await orderRef.set({ status: nextStatus, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        }
        res.status(200).json({ ok: true });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Error desconocido";
        res.status(500).json({ error: "No se pudo actualizar el estado del pedido.", details: message });
      }
    });
  },
);

export const updateOrderAndSync = onRequest(
  { secrets: [] },
  async (req, res) => {
    corsHandler(req, res, async () => {
      if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
      }
      if (req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed. Use POST." });
        return;
      }
      try {
        const body = req.body && typeof req.body === "object" ? req.body : {};
        const businessId = asText(body.businessId);
        const orderId = asText(body.orderId);
        if (!businessId || !orderId) {
          res.status(400).json({ error: "businessId y orderId son requeridos." });
          return;
        }
        const db = getAdminDb();
        const orderRef = db.collection("businesses").doc(businessId).collection("orders").doc(orderId);
        const snap = await orderRef.get();
        if (!snap.exists) {
          res.status(404).json({ error: "Pedido no encontrado." });
          return;
        }
        const old = snap.data() || {};
        const nextAmount = Math.max(0, Number(body.amount ?? old.amount) || 0);
        const nextDeposit = Math.max(0, Number(body.deposit ?? old.deposit) || 0);
        const nextBalance = Math.max(0, nextAmount - nextDeposit);
        const nextClientName = asText(body.clientName, asText(old.clientName, "Cliente"));
        const nextClientPhone = normalizePhoneDigits(body.clientPhone ?? old.clientPhone);
        const nextProduct = asText(body.product, asText(old.product, "Pedido"));
        const nextNotes = asText(body.notes, asText(old.notes));
        const nextStatus = normalizeOrderStatus(body.status ?? old.status);
        const prevStatus = normalizeOrderStatus(old.status);
        const nextQuantity = Math.max(0, Number(body.quantity ?? old.quantity) || 0);
        const nextDeliveryDate = parseOrderDate(body.deliveryDate) || parseOrderDate(old.deliveryDate) || new Date();
        const nextExpenses = Math.max(0, Number(body.expenses ?? old.expenses) || 0);

        await orderRef.set(
          {
            clientName: nextClientName,
            clientPhone: nextClientPhone,
            product: nextProduct,
            quantity: nextQuantity,
            amount: nextAmount,
            deposit: nextDeposit,
            balance: nextBalance,
            expenses: nextExpenses,
            notes: nextNotes,
            status: nextStatus,
            deliveryDate: Timestamp.fromDate(nextDeliveryDate),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

        if (nextStatus === "entregado" && prevStatus !== "entregado") {
          const fresh = await orderRef.get();
          await finalizeOrderDeliveryAndProfit(db, businessId, orderRef, fresh.data() || {});
        }

        const clientId = asText(old.linkedClientId);
        if (clientId) {
          await db
            .collection("businesses")
            .doc(businessId)
            .collection("clients")
            .doc(clientId)
            .set(
              {
                fullName: nextClientName,
                name: nextClientName,
                phone: nextClientPhone,
                updatedAt: FieldValue.serverTimestamp(),
              },
              { merge: true },
            );
        }

        const linkedCalendarId = asText(old.linkedCalendarId);
        if (linkedCalendarId) {
          await db
            .collection("businesses")
            .doc(businessId)
            .collection("calendar")
            .doc(linkedCalendarId)
            .set(
              {
                title: `Entrega: ${nextProduct} - ${nextClientName}`,
                date: Timestamp.fromDate(nextDeliveryDate),
                status: nextStatus === "entregado" ? "completed" : "pending",
                updatedAt: FieldValue.serverTimestamp(),
              },
              { merge: true },
            );
        }

        const oldAmount = Math.max(0, Number(old.amount) || 0);
        if (nextAmount !== oldAmount && nextDeposit > 0) {
          await db.collection("businesses").doc(businessId).collection("finance").add({
            type: "income",
            status: "cobrado",
            amount: nextDeposit,
            category: "ventas",
            description: `Ajuste pedido: ${nextProduct} - ${nextClientName}`,
            clientId: clientId || null,
            orderId,
            createdAt: FieldValue.serverTimestamp(),
            createdBy: "marvin",
            date: Timestamp.fromDate(new Date()),
          });
        }

        res.status(200).json({ ok: true });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Error desconocido";
        res.status(500).json({ error: "No se pudo actualizar y sincronizar pedido.", details: message });
      }
    });
  },
);

export const deleteOrderCascade = onRequest(
  { secrets: [] },
  async (req, res) => {
    corsHandler(req, res, async () => {
      if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
      }
      if (req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed. Use POST." });
        return;
      }
      try {
        const body = req.body && typeof req.body === "object" ? req.body : {};
        const businessId = asText(body.businessId);
        const orderId = asText(body.orderId);
        if (!businessId || !orderId) {
          res.status(400).json({ error: "businessId y orderId son requeridos." });
          return;
        }
        const db = getAdminDb();
        const orderRef = db.collection("businesses").doc(businessId).collection("orders").doc(orderId);
        const snap = await orderRef.get();
        if (!snap.exists) {
          res.status(404).json({ error: "Pedido no encontrado." });
          return;
        }
        const row = snap.data() || {};
        const linkedCalendarId = asText(row.linkedCalendarId);
        if (linkedCalendarId) {
          await db.collection("businesses").doc(businessId).collection("calendar").doc(linkedCalendarId).delete();
        }

        const finSnap = await db
          .collection("businesses")
          .doc(businessId)
          .collection("finance")
          .where("orderId", "==", orderId)
          .get();
        for (const d of finSnap.docs) {
          await d.ref.delete();
        }

        await orderRef.delete();
        res.status(200).json({ ok: true });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Error desconocido";
        res.status(500).json({ error: "No se pudo eliminar pedido.", details: message });
      }
    });
  },
);

const MAYA_PRODUCT_KEYS = new Set([
  "mangaLargaPoliester",
  "mangaLargaAlgodon",
  "mangaCortaAlgodon",
  "mangaCortaPoliester",
  "capuchaPoliester",
  "polo",
  "gorras",
  "tarjetas",
  "magnetosVehiculo",
  "letrerosYarda",
]);

/**
 * Pedido MAYA_ORDER_JSON: un producto o varios vía `items`.
 * @param {Record<string, unknown> | null} payload
 */
function isValidMayaOrderPayload(payload) {
  if (!payload || payload.confirmed !== true) return false;
  if (Array.isArray(payload.items) && payload.items.length > 0) {
    return payload.items.every(
      (it) =>
        it &&
        typeof it === "object" &&
        typeof it.productKey === "string" &&
        MAYA_PRODUCT_KEYS.has(it.productKey) &&
        Number.isFinite(Number(it.quantity)) &&
        Number(it.quantity) >= 1,
    );
  }
  return (
    typeof payload.productKey === "string" &&
    MAYA_PRODUCT_KEYS.has(payload.productKey) &&
    Number.isFinite(Number(payload.quantity)) &&
    Number(payload.quantity) >= 1
  );
}

/** Webhook Meta WhatsApp Cloud API → Claude (YourColor) → respuesta vía Graph API (JSON). */
export const whatsappWebhook = onRequest(
  {
    region: "us-central1",
    secrets: [ANTHROPIC_KEY, META_ACCESS_TOKEN, YOURCOLOR_BUSINESS_ID],
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (req, res) => {
    res.set("Cache-Control", "no-store");

    if (req.method === "GET") {
      const mode = req.query["hub.mode"];
      const token = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];

      if (mode === "subscribe" && token === "yourcolor2026") {
        res.status(200).send(challenge);
        return;
      } else {
        res.status(403).send("Forbidden");
        return;
      }
    }

    if (req.method !== "POST") {
      res.status(405).type("application/json").send({ error: "Method not allowed" });
      return;
    }

    const metaToken = META_ACCESS_TOKEN.value();
    const businessId = YOURCOLOR_BUSINESS_ID.value();
    const apiKey = ANTHROPIC_KEY.value();

    if (!metaToken) {
      console.error("[whatsappWebhook] Missing META_ACCESS_TOKEN");
      res.status(200).type("application/json").send({ ok: false, error: "missing_meta_token" });
      return;
    }
    if (!businessId) {
      console.error("[whatsappWebhook] Missing YOURCOLOR_BUSINESS_ID secret");
      res.status(200).type("application/json").send({ ok: false, error: "missing_business_id" });
      return;
    }
    if (!apiKey) {
      console.error("[whatsappWebhook] Missing ANTHROPIC_KEY");
      res.status(200).type("application/json").send({ ok: false, error: "missing_anthropic_key" });
      return;
    }

    const parsed = parseMetaWhatsAppWebhook(req);
    if (!parsed) {
      res.status(200).type("application/json").send({ received: true, ignored: true });
      return;
    }

    const { from, inboundBody } = parsed;

    if (!from) {
      res.status(200).type("application/json").send({ received: true, ignored: "no_sender" });
      return;
    }

    let effectiveInbound = inboundBody;
    if (!effectiveInbound) {
      await sendWhatsAppViaMetaGraph(
        metaToken,
        from,
        "Por ahora solo puedo ayudarte con mensajes de texto. Escríbenos en texto cuando puedas.",
      );
      res.status(200).type("application/json").send({ received: true, skipped: "non_text" });
      return;
    }

    const db = getAdminDb();

    try {
      await recordWhatsAppCustomerInbound(db, businessId, from, effectiveInbound);
    } catch (e) {
      console.warn("[whatsappWebhook] conversation inbound", e);
    }

    let confirmedOrderSaved = false;

    const sessionId = createHash("sha256").update(from).digest("hex").slice(0, 40);
    const sessionRef = db
      .collection("businesses")
      .doc(businessId)
      .collection("mayaWhatsAppSessions")
      .doc(sessionId);

    let priorMessages = [];
    /** Último lead de esta sesión WhatsApp (para confirmación de depósito). */
    let sessionLastLeadId = null;
    try {
      const sessionSnap = await sessionRef.get();
      if (sessionSnap.exists) {
        const data = sessionSnap.data();
        if (typeof data?.lastLeadId === "string" && data.lastLeadId.trim()) {
          sessionLastLeadId = data.lastLeadId.trim();
        }
        const arr = Array.isArray(data?.messages) ? data.messages : [];
        priorMessages = arr
          .filter(
            (m) =>
              m &&
              typeof m === "object" &&
              (m.role === "user" || m.role === "assistant") &&
              typeof m.content === "string",
          )
          .map((m) => ({ role: m.role, content: m.content.trim() }))
          .filter((m) => m.content)
          .slice(-24);
      }
    } catch (e) {
      console.warn("[whatsappWebhook] session read", e);
    }

    const userMessage = { role: "user", content: effectiveInbound };
    const messagesForClaude = [...priorMessages, userMessage];

    let assistantRaw = "";
    try {
      const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL_WHATSAPP,
          max_tokens: 2048,
          system: getMayaWhatsAppSystemPrompt(),
          messages: messagesForClaude,
        }),
      });

      const anthropicBody = await anthropicResponse.json();
      if (!anthropicResponse.ok) {
        const message = asText(anthropicBody?.error?.message, "Anthropic API failed");
        console.error("[whatsappWebhook] Anthropic", message);
        const fallbackMsg =
          "Ahora mismo no puedo responder. Escríbenos al " +
          YOURCOLOR_BUSINESS.phone +
          " o intenta de nuevo en unos minutos.";
        try {
          await recordWhatsAppMayaOutbound(db, businessId, from, fallbackMsg, {
            status: "waiting",
            mayaInControl: true,
            messageMetadata: {},
          });
        } catch (e) {
          console.warn("[whatsappWebhook] conversation maya outbound (anthropic_error)", e);
        }
        await sendWhatsAppViaMetaGraph(metaToken, from, fallbackMsg);
        res.status(200).type("application/json").send({ ok: true, fallback: "anthropic_error" });
        return;
      }

      assistantRaw = Array.isArray(anthropicBody?.content)
        ? anthropicBody.content
            .filter((item) => item?.type === "text")
            .map((item) => item?.text || "")
            .join("\n")
        : "";
    } catch (e) {
      console.error("[whatsappWebhook] Anthropic fetch", e);
      const fallbackMsg =
        "Tuve un problema técnico. Intenta de nuevo o llama al " + YOURCOLOR_BUSINESS.phone;
      try {
        await recordWhatsAppMayaOutbound(db, businessId, from, fallbackMsg, {
          status: "waiting",
          mayaInControl: true,
          messageMetadata: {},
        });
      } catch (err) {
        console.warn("[whatsappWebhook] conversation maya outbound (anthropic_exception)", err);
      }
      await sendWhatsAppViaMetaGraph(metaToken, from, fallbackMsg);
      res.status(200).type("application/json").send({ ok: true, fallback: "anthropic_exception" });
      return;
    }

    const {
      text: visibleReply,
      order: orderPayload,
      deposit: depositPayload,
      meeting: meetingPayload,
      specialRequest: specialRequestPayload,
      handoff: handoffPayload,
    } = extractMayaOrderFromReply(assistantRaw);
    const defaultWhatsAppReply = "Gracias por escribir a YourColor.";
    let outbound = visibleReply || defaultWhatsAppReply;
    /** Historial sin líneas MAYA_* JSON para siguientes turnos con Claude. */
    let assistantForSession = (visibleReply || assistantRaw || defaultWhatsAppReply).trim();

    const confirmed = orderPayload && isValidMayaOrderPayload(orderPayload);

    if (confirmed) {
      const customerName =
        typeof orderPayload.customerName === "string" && orderPayload.customerName.trim()
          ? orderPayload.customerName.trim()
          : "Cliente WhatsApp";

      /** @type {null | ReturnType<typeof computeValidatedMayaOrder> | ReturnType<typeof computeValidatedMayaCombinedOrder>} */
      let calc = null;
      let description = "";
      /** @type {Record<string, unknown>} */
      let leadPayload = {};

      if (Array.isArray(orderPayload.items) && orderPayload.items.length > 0) {
        calc = computeValidatedMayaCombinedOrder(
          orderPayload.items.map((it) => ({
            productKey: it.productKey,
            quantity: Number(it.quantity),
          })),
        );
        if (calc) {
          const lineParts = calc.lines.map((ln) => {
            const product = YOURCOLOR_BUSINESS.products[ln.productKey];
            const productLabel = product?.name || ln.productKey;
            if (ln.isTarjetas) {
              return `${productLabel}: ${ln.quantity} unidades → ${formatUsd(ln.subtotal)} (total paquete)`;
            }
            return `${productLabel}: ${ln.quantity} × ${formatUsd(ln.pricePerPiece)} = ${formatUsd(ln.subtotal)}`;
          });
          description = [
            `Pedido confirmado vía WhatsApp (YourColor) — varios productos.`,
            ...lineParts,
            calc.logoFee > 0 ? `Logo/arte: ${formatUsd(calc.logoFee)}` : null,
            `Total: ${formatUsd(calc.total)}`,
            `Depósito ${YOURCOLOR_BUSINESS.rules.depositPercent}%: ${formatUsd(calc.deposit)}`,
            `Métodos: ${YOURCOLOR_BUSINESS.rules.paymentMethods.join(", ")}`,
          ]
            .filter(Boolean)
            .join("\n");

          leadPayload = {
            customerName,
            phone: from.replace(/^whatsapp:/i, ""),
            address: "",
            service: `Pedido múltiple (${orderPayload.items.length} líneas)`,
            description,
            status: "new",
            estimatedPrice: calc.total,
            depositAmount: calc.deposit,
            depositPercent: YOURCOLOR_BUSINESS.rules.depositPercent,
            source: "whatsapp-yourcolor",
            whatsappFrom: from,
            productKey: "multi",
            quantity: calc.lines.reduce((s, l) => s + l.quantity, 0),
            mayaOrder: {
              items: orderPayload.items,
              lines: calc.lines,
              logoFee: calc.logoFee,
              subtotal: calc.subtotal,
              total: calc.total,
              deposit: calc.deposit,
              isCombined: true,
            },
            createdAt: FieldValue.serverTimestamp(),
          };
        }
      } else {
        const qty = Number(orderPayload.quantity);
        calc = computeValidatedMayaOrder(orderPayload.productKey, qty);
        if (calc) {
          const product = YOURCOLOR_BUSINESS.products[orderPayload.productKey];
          const productLabel = product?.name || orderPayload.productKey;

          description = [
            `Pedido confirmado vía WhatsApp (YourColor).`,
            `Producto: ${productLabel}`,
            `Cantidad: ${qty}`,
            calc.isTarjetas
              ? `Total (paquete): ${formatUsd(calc.total)}`
              : `Precio por pieza: ${formatUsd(calc.pricePerPiece)} · Subtotal prendas: ${formatUsd(calc.subtotal)}`,
            calc.logoFee > 0 ? `Logo/arte: ${formatUsd(calc.logoFee)}` : null,
            `Total: ${formatUsd(calc.total)}`,
            `Depósito ${YOURCOLOR_BUSINESS.rules.depositPercent}%: ${formatUsd(calc.deposit)}`,
            `Métodos: ${YOURCOLOR_BUSINESS.rules.paymentMethods.join(", ")}`,
          ]
            .filter(Boolean)
            .join("\n");

          leadPayload = {
            customerName,
            phone: from.replace(/^whatsapp:/i, ""),
            address: "",
            service: productLabel,
            description,
            status: "new",
            estimatedPrice: calc.total,
            depositAmount: calc.deposit,
            depositPercent: YOURCOLOR_BUSINESS.rules.depositPercent,
            source: "whatsapp-yourcolor",
            whatsappFrom: from,
            productKey: orderPayload.productKey,
            quantity: qty,
            mayaOrder: {
              pricePerPiece: calc.pricePerPiece,
              subtotal: calc.subtotal,
              logoFee: calc.logoFee,
              total: calc.total,
              deposit: calc.deposit,
              isTarjetas: Boolean(calc.isTarjetas),
            },
            createdAt: FieldValue.serverTimestamp(),
          };
        }
      }

      if (calc) {
        try {
          const leadDocRef = await db.collection("businesses").doc(businessId).collection("leads").add(leadPayload);
          sessionLastLeadId = leadDocRef.id;

          const convNameRef = db
            .collection("businesses")
            .doc(businessId)
            .collection("conversations")
            .doc(conversationDocIdFromWhatsAppFrom(from));
          await convNameRef.set(
            { customerName, updatedAt: FieldValue.serverTimestamp() },
            { merge: true },
          );

          await processNewOrder(db, businessId, {
            clientName: customerName,
            clientPhone: from.replace(/^whatsapp:/i, ""),
            product:
              (typeof leadPayload.service === "string" && leadPayload.service.trim()) || "Pedido WhatsApp",
            quantity: Number(leadPayload.quantity) || 0,
            amount: calc.total,
            deposit: calc.deposit,
            deliveryDate: deliveryDateAfterBusinessDays(new Date(), 12).toISOString().slice(0, 10),
            notes: description,
            source: "whatsapp",
            createdBy: "maya",
            status: "nuevo",
            sourceLeadId: leadDocRef.id,
          });
          confirmedOrderSaved = true;

          outbound = `${outbound}\n\n✅ Pedido registrado. Total ${formatUsd(calc.total)}. Depósito del ${YOURCOLOR_BUSINESS.rules.depositPercent}%: ${formatUsd(calc.deposit)} (${YOURCOLOR_BUSINESS.rules.paymentMethods.join(" o ")}).`;
          assistantForSession = outbound;
        } catch (e) {
          console.error("[whatsappWebhook] Firestore lead", e);
          outbound = `${outbound}\n\n(No pude guardar el pedido en el sistema. Llama al ${YOURCOLOR_BUSINESS.phone}.)`;
          assistantForSession = outbound;
        }
      } else {
        outbound = `${outbound}\n\n(No pude validar cantidad/rango para este producto. Llama al ${YOURCOLOR_BUSINESS.phone}.)`;
        assistantForSession = outbound;
      }
    }

    if (
      depositPayload &&
      depositPayload.confirmed === true &&
      typeof sessionLastLeadId === "string" &&
      sessionLastLeadId.trim()
    ) {
      const leadId = sessionLastLeadId.trim();
      try {
        const leadRef = db.collection("businesses").doc(businessId).collection("leads").doc(leadId);
        const leadSnap = await leadRef.get();
        if (leadSnap.exists) {
          const leadData = leadSnap.data() || {};
          const currentStatus = typeof leadData.status === "string" ? leadData.status : "";

          if (currentStatus !== "deposit_confirmed") {
            const phoneClean = from.replace(/^whatsapp:/i, "");
            const customerName =
              typeof leadData.customerName === "string" && leadData.customerName.trim()
                ? leadData.customerName.trim()
                : "Cliente WhatsApp";
            const productLabel =
              typeof leadData.service === "string" && leadData.service.trim()
                ? leadData.service.trim()
                : "Pedido";
            const mayaOrder =
              leadData.mayaOrder && typeof leadData.mayaOrder === "object"
                ? leadData.mayaOrder
                : {};
            const qtyLead = Number(leadData.quantity);
            const total = Number(mayaOrder.total ?? leadData.estimatedPrice);
            const depositPaid = Number(mayaOrder.deposit ?? leadData.depositAmount);

            const now = new Date();
            const delivery = deliveryDateAfterBusinessDays(now, 12);
            const deliveryTs = Timestamp.fromDate(delivery);

            await leadRef.update({
              status: "deposit_confirmed",
              depositConfirmedAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            });

            const clientsCol = db.collection("businesses").doc(businessId).collection("clients");
            const calCol = db.collection("businesses").doc(businessId).collection("calendar");

            const dupClient = await clientsCol.where("sourceLeadId", "==", leadId).limit(1).get();
            if (dupClient.empty) {
              await clientsCol.add({
                fullName: customerName,
                name: customerName,
                phone: phoneClean,
                product: productLabel,
                quantity: Number.isFinite(qtyLead) ? qtyLead : 0,
                total: Number.isFinite(total) ? total : 0,
                deposit: Number.isFinite(depositPaid) ? depositPaid : 0,
                deliveryDate: deliveryTs,
                status: "in_production",
                sourceLeadId: leadId,
                source: "whatsapp-yourcolor-deposit",
                createdAt: FieldValue.serverTimestamp(),
              });
            }

            const dupCal = await calCol.where("sourceLeadId", "==", leadId).limit(1).get();
            if (dupCal.empty) {
              await calCol.add({
                title: `Entrega: ${customerName} - ${productLabel}`,
                date: deliveryTs,
                clientName: customerName,
                phone: phoneClean,
                product: productLabel,
                quantity: Number.isFinite(qtyLead) ? qtyLead : 0,
                sourceLeadId: leadId,
                createdAt: FieldValue.serverTimestamp(),
              });
            }

            outbound = `${outbound}\n\n✅ Depósito recibido. Tu pedido está en producción. Entrega orientativa (12 días hábiles desde hoy): ${delivery.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.`;
            assistantForSession = outbound;
          }
        }
      } catch (e) {
        console.error("[whatsappWebhook] deposit confirmation", e);
      }
    }

    if (meetingPayload && typeof meetingPayload === "object") {
      const city = asText(meetingPayload.city);
      const preferredTime = asText(
        meetingPayload.preferredTime || meetingPayload.time || meetingPayload.slot,
      );
      const clientName = asText(
        meetingPayload.clientName || meetingPayload.name || meetingPayload.customerName,
        "Cliente WhatsApp",
      );
      const phoneClean = from.replace(/^whatsapp:/i, "");

      if (city && preferredTime) {
        try {
          await db.collection("businesses").doc(businessId).collection("meetingRequests").add({
            clientName,
            phone: phoneClean,
            city,
            preferredTime,
            status: "pending",
            createdAt: FieldValue.serverTimestamp(),
          });
        } catch (e) {
          console.error("[whatsappWebhook] meetingRequests write", e);
        }
      }
    }

    if (
      specialRequestPayload &&
      specialRequestPayload.confirmed === true &&
      typeof specialRequestPayload.description === "string" &&
      asText(specialRequestPayload.description)
    ) {
      try {
        await db.collection("businesses").doc(businessId).collection("specialRequests").add({
          description: asText(specialRequestPayload.description),
          whatsappFrom: from,
          source: "whatsapp-maya",
          createdAt: FieldValue.serverTimestamp(),
        });
      } catch (e) {
        console.error("[whatsappWebhook] specialRequests write", e);
        outbound = `${outbound}\n\n(No pude registrar tu solicitud en el sistema. Llama al ${YOURCOLOR_BUSINESS.phone}.)`;
        assistantForSession = outbound;
      }
    }

    const nextMessages = [...messagesForClaude, { role: "assistant", content: assistantForSession }].slice(
      -40,
    );

    try {
      const sessionUpdate = {
        messages: nextMessages,
        lastWhatsAppFrom: from,
        lastWhatsAppTo: META_WHATSAPP_PHONE_NUMBER_ID,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (sessionLastLeadId) {
        sessionUpdate.lastLeadId = sessionLastLeadId;
      }
      await sessionRef.set(sessionUpdate, { merge: true });
    } catch (e) {
      console.warn("[whatsappWebhook] session write", e);
    }

    /** Estado del Centro de Control para esta respuesta de Maya. */
    let convStatus = "waiting";
    let mayaCtrl = true;
    /** @type {Record<string, unknown>} */
    let mayaMsgMeta = {};
    if (confirmedOrderSaved) {
      convStatus = "confirmed";
      mayaCtrl = true;
    } else if (
      handoffPayload &&
      typeof handoffPayload.reason === "string" &&
      asText(handoffPayload.reason)
    ) {
      convStatus = "needs_attention";
      mayaCtrl = false;
      mayaMsgMeta = { reason: asText(handoffPayload.reason) };
    }

    try {
      await recordWhatsAppMayaOutbound(db, businessId, from, outbound, {
        status: convStatus,
        mayaInControl: mayaCtrl,
        messageMetadata: mayaMsgMeta,
      });
    } catch (e) {
      console.warn("[whatsappWebhook] conversation maya outbound", e);
    }

    const graphSent = await sendWhatsAppViaMetaGraph(metaToken, from, outbound);
    res.status(200).type("application/json").send({ ok: true, sent: graphSent });
  },
);

function formatUsd(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "$0";
  return `$${v.toFixed(2)}`;
}
