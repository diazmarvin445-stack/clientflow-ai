import { createHash } from "node:crypto";
import { parse as parseQuery } from "node:querystring";
import { initializeApp, getApps } from "firebase-admin/app";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import cors from "cors";
import {
  getYourColorSystemPrompt,
  getYourColorChatSystemPrompt,
  getYourColorWhatsAppWebhookPrompt,
  computeValidatedMayaOrder,
  computeValidatedMayaCombinedOrder,
  YOURCOLOR_BUSINESS,
} from "./yourcolor-config.js";

const MODEL = "claude-sonnet-4-20250514";
const ANTHROPIC_KEY = defineSecret("ANTHROPIC_KEY");
const TWILIO_ACCOUNT_SID = defineSecret("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = defineSecret("TWILIO_AUTH_TOKEN");
/** ID del documento `businesses/{id}` de YourColor (Firestore). */
const YOURCOLOR_BUSINESS_ID = defineSecret("YOURCOLOR_BUSINESS_ID");
const corsHandler = cors({ origin: true });

function getAdminDb() {
  if (!getApps().length) {
    initializeApp();
  }
  return getFirestore();
}

/**
 * Twilio envía `application/x-www-form-urlencoded`; normaliza a objeto plano.
 * @param {import("firebase-functions").https.Request} req
 */
function parseTwilioFormBody(req) {
  const b = req.body;
  if (b && typeof b === "object" && !Buffer.isBuffer(b) && typeof b.Body !== "undefined") {
    return /** @type {Record<string, string>} */ (b);
  }
  const raw = req.rawBody;
  if (Buffer.isBuffer(raw)) {
    return /** @type {Record<string, string>} */ (parseQuery(raw.toString("utf8")));
  }
  if (typeof raw === "string") {
    return /** @type {Record<string, string>} */ (parseQuery(raw));
  }
  if (typeof b === "string") {
    return /** @type {Record<string, string>} */ (parseQuery(b));
  }
  return {};
}

/**
 * Extrae MAYA_* JSON finales y devuelve texto visible para el cliente.
 * @param {string} raw
 * @returns {{ text: string, order: Record<string, unknown> | null, deposit: Record<string, unknown> | null, meeting: Record<string, unknown> | null, specialRequest: Record<string, unknown> | null }}
 */
function extractMayaOrderFromReply(raw) {
  let visible = asText(raw);
  let order = null;
  let deposit = null;
  let meeting = null;
  let specialRequest = null;
  const depRe = /MAYA_DEPOSIT_JSON:\s*(\{[\s\S]*?\})\s*$/m;
  const orderRe = /MAYA_ORDER_JSON:\s*(\{[\s\S]*?\})\s*$/m;
  const meetingRe = /MAYA_MEETING_JSON:\s*(\{[\s\S]*?\})\s*$/m;
  const specialRe = /MAYA_SPECIAL_REQUEST_JSON:\s*(\{[\s\S]*?\})\s*$/m;

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
  return { text: visible, order, deposit, meeting, specialRequest };
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

function truncateWhatsApp(s, max = 1500) {
  const t = asText(s);
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** Escapa texto para insertarlo dentro de `<Message>` (TwiML). */
function escapeXmlForTwiml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * TwiML con un único mensaje de salida (WhatsApp/SMS vía webhook).
 * @param {import("firebase-functions").https.Response} res
 * @param {string} respuesta
 */
function sendTwimlMessageResponse(res, respuesta) {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXmlForTwiml(truncateWhatsApp(respuesta))}</Message>
</Response>`;
  res.set("Content-Type", "text/xml; charset=utf-8");
  res.status(200).send(twiml);
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

        const system = getYourColorChatSystemPrompt(firebaseContext);

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

        return res.status(200).json({
          reply: textContent,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return res.status(500).json({ error: "Chat request failed.", details: message });
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

/** Webhook Twilio (WhatsApp) → Claude (YourColor) → respuesta TwiML. */
export const whatsappWebhook = onRequest(
  {
    region: "us-central1",
    secrets: [
      ANTHROPIC_KEY,
      TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN,
      YOURCOLOR_BUSINESS_ID,
    ],
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (req, res) => {
    res.set("Cache-Control", "no-store");

    if (req.method !== "POST") {
      res.status(405).type("text/plain").send("Method Not Allowed");
      return;
    }

    const accountSid = TWILIO_ACCOUNT_SID.value();
    const authToken = TWILIO_AUTH_TOKEN.value();
    const businessId = YOURCOLOR_BUSINESS_ID.value();
    const apiKey = ANTHROPIC_KEY.value();

    const emptyTwiml =
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

    if (!accountSid || !authToken) {
      console.error("[whatsappWebhook] Missing Twilio secrets");
      res.status(500).type("text/xml").send(emptyTwiml);
      return;
    }
    if (!businessId) {
      console.error("[whatsappWebhook] Missing YOURCOLOR_BUSINESS_ID secret");
      res.status(500).type("text/xml").send(emptyTwiml);
      return;
    }
    if (!apiKey) {
      console.error("[whatsappWebhook] Missing ANTHROPIC_KEY");
      res.status(500).type("text/xml").send(emptyTwiml);
      return;
    }

    const fields = parseTwilioFormBody(req);
    const inboundBody = asText(fields.Body);
    const from = asText(fields.From);
    const to = asText(fields.To);

    if (!from || !to) {
      res.status(200).type("text/xml").send(emptyTwiml);
      return;
    }

    if (!inboundBody) {
      res.status(200).type("text/xml").send(emptyTwiml);
      return;
    }

    const db = getAdminDb();
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

    const userMessage = { role: "user", content: inboundBody };
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
          system: getYourColorWhatsAppWebhookPrompt(),
          messages: messagesForClaude,
        }),
      });

      const anthropicBody = await anthropicResponse.json();
      if (!anthropicResponse.ok) {
        const message = asText(anthropicBody?.error?.message, "Anthropic API failed");
        console.error("[whatsappWebhook] Anthropic", message);
        sendTwimlMessageResponse(
          res,
          "Ahora mismo no puedo responder. Escríbenos al " +
            YOURCOLOR_BUSINESS.phone +
            " o intenta de nuevo en unos minutos.",
        );
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
      sendTwimlMessageResponse(
        res,
        "Tuve un problema técnico. Intenta de nuevo o llama al " + YOURCOLOR_BUSINESS.phone,
      );
      return;
    }

    const {
      text: visibleReply,
      order: orderPayload,
      deposit: depositPayload,
      meeting: meetingPayload,
      specialRequest: specialRequestPayload,
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
        lastWhatsAppTo: to,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (sessionLastLeadId) {
        sessionUpdate.lastLeadId = sessionLastLeadId;
      }
      await sessionRef.set(sessionUpdate, { merge: true });
    } catch (e) {
      console.warn("[whatsappWebhook] session write", e);
    }

    sendTwimlMessageResponse(res, outbound);
  },
);

function formatUsd(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "$0";
  return `$${v.toFixed(2)}`;
}
