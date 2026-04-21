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

const MODEL = "claude-sonnet-4-20250514";
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

  const orderRef = await db.collection("businesses").doc(businessId).collection("orders").add({
    clientId: client.id,
    clientName,
    clientPhone,
    product,
    quantity,
    amount,
    deposit,
    balance,
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
      amount: deposit,
      category: "ventas",
      description: `Depósito: ${product} - ${clientName}`,
      clientId: client.id,
      orderId: orderRef.id,
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
  "delete_client",
  "delete_transaction",
  "get_balance",
]);

const FINANCE_INCOME_KEYS = new Set(["ventas", "anticipos", "otros_ingresos"]);
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
    "amount",
    "description",
    "category",
    "period",
    "deliveryDate",
    "notes",
    "status",
  ]) {
    if (k in payload && payload[k] !== undefined && out[k] === undefined) {
      out[k] = payload[k];
    }
  }
  return out;
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
  for (const k of ["amount", "description", "category", "date", "period", "transactionId", "clientId", "orderId"]) {
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
    else income += amt;
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
  if (!tid) throw new Error("Falta transactionId para eliminar el movimiento.");
  await db.collection("businesses").doc(businessId).collection("finance").doc(tid).delete();
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
        const srcDate = data.date ?? data.deliveryDate;
        let date = new Date();
        if (srcDate != null) {
          const d = new Date(String(srcDate));
          if (!Number.isNaN(d.getTime())) date = d;
        }
        date.setHours(12, 0, 0, 0);
        await db.collection("businesses").doc(businessId).collection("calendar").add({
          title,
          date: Timestamp.fromDate(date),
          deliveryDate: srcDate == null ? "" : String(srcDate),
          source: "chat-maya",
          createdAt: FieldValue.serverTimestamp(),
        });
        continue;
      }
      if (action === "delete_client") {
        const data = mergeMayaActionData(payload);
        const clientId =
          typeof data.clientId === "string" ? data.clientId.trim() : String(data.clientId ?? "").trim();
        if (!clientId) throw new Error("Falta clientId para eliminar el cliente.");
        await db.collection("businesses").doc(businessId).collection("clients").doc(clientId).delete();
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
        const messages = asChatMessages(body.messages);
        const firebaseContext =
          body.firebaseContext && typeof body.firebaseContext === "object" ? body.firebaseContext : {};

        if (!messages.length) {
          return res.status(400).json({ error: "Se requiere al menos un mensaje de usuario." });
        }
        if (messages[messages.length - 1].role !== "user") {
          return res.status(400).json({ error: "El último mensaje debe ser del usuario." });
        }

        const system =
          getMayaInternalChatPrompt() +
          "\n\n" +
          "CONTEXTO DEL NEGOCIO:\n" +
          JSON.stringify(firebaseContext, null, 2);

        const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: 4096,
            system,
            messages,
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
        let patch = { status: nextStatus, updatedAt: FieldValue.serverTimestamp() };
        let financeId = "";

        if (nextStatus === "entregado") {
          const pendingBalance = Math.max(0, Number(order.balance) || 0);
          if (pendingBalance > 0) {
            const financeRef = await db.collection("businesses").doc(businessId).collection("finance").add({
              type: "income",
              amount: pendingBalance,
              category: "ventas",
              description: `Saldo final: ${asText(order.product, "Pedido")} - ${asText(order.clientName, "Cliente")}`,
              clientId: asText(order.linkedClientId),
              orderId,
              createdAt: FieldValue.serverTimestamp(),
              createdBy: "marvin",
              date: Timestamp.fromDate(new Date()),
            });
            financeId = financeRef.id;
            patch.balance = 0;
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
        }

        if (financeId) patch.linkedFinanceId = financeId;
        await orderRef.set(patch, { merge: true });
        res.status(200).json({ ok: true });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Error desconocido";
        res.status(500).json({ error: "No se pudo actualizar el estado del pedido.", details: message });
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
          model: MODEL,
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
