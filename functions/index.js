import { createHash } from "node:crypto";
import { parse as parseQuery } from "node:querystring";
import { initializeApp, getApps } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import cors from "cors";
import {
  getYourColorSystemPrompt,
  getYourColorChatSystemPrompt,
  getYourColorWhatsAppWebhookPrompt,
  computeValidatedMayaOrder,
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
 * Extrae MAYA_ORDER_JSON y devuelve texto visible para el cliente.
 * @param {string} raw
 * @returns {{ text: string, order: Record<string, unknown> | null }}
 */
function extractMayaOrderFromReply(raw) {
  const text = asText(raw);
  const re = /MAYA_ORDER_JSON:\s*(\{[\s\S]*?\})\s*$/m;
  const m = text.match(re);
  if (!m) {
    return { text, order: null };
  }
  let order = null;
  try {
    order = JSON.parse(m[1]);
  } catch {
    order = null;
  }
  const visible = text.replace(re, "").trim();
  return { text: visible, order };
}

async function sendTwilioWhatsApp(accountSid, authToken, params) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const body = new URLSearchParams(params).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Twilio ${res.status}: ${errText}`);
  }
  return res.json();
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
]);

export const whatsappWebhook = onRequest(
  {
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

    async function replyErrorToUser(from, to, msg) {
      try {
        await sendTwilioWhatsApp(accountSid, authToken, {
          To: from,
          From: to,
          Body: truncateWhatsApp(msg),
        });
      } catch (e) {
        console.error("[whatsappWebhook] Twilio error reply", e);
      }
    }

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
    try {
      const sessionSnap = await sessionRef.get();
      if (sessionSnap.exists) {
        const data = sessionSnap.data();
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
        await replyErrorToUser(
          from,
          to,
          "Ahora mismo no puedo responder. Escríbenos al " +
            YOURCOLOR_BUSINESS.phone +
            " o intenta de nuevo en unos minutos.",
        );
        res.status(200).type("text/xml").send(emptyTwiml);
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
      await replyErrorToUser(
        from,
        to,
        "Tuve un problema técnico. Intenta de nuevo o llama al " + YOURCOLOR_BUSINESS.phone,
      );
      res.status(200).type("text/xml").send(emptyTwiml);
      return;
    }

    const { text: visibleReply, order: orderPayload } = extractMayaOrderFromReply(assistantRaw);
    let outbound = visibleReply || "Gracias por escribir a YourColor.";
    /** Historial sin MAYA_ORDER_JSON para siguientes turnos con Claude. */
    let assistantForSession = visibleReply || assistantRaw;

    const confirmed =
      orderPayload &&
      orderPayload.confirmed === true &&
      typeof orderPayload.productKey === "string" &&
      MAYA_PRODUCT_KEYS.has(orderPayload.productKey);
    const qty = Number(orderPayload?.quantity);

    if (confirmed && Number.isFinite(qty) && qty >= 1) {
      const calc = computeValidatedMayaOrder(orderPayload.productKey, qty);
      if (calc) {
        const product = YOURCOLOR_BUSINESS.products[orderPayload.productKey];
        const productLabel = product?.name || orderPayload.productKey;
        const customerName =
          typeof orderPayload.customerName === "string" && orderPayload.customerName.trim()
            ? orderPayload.customerName.trim()
            : "Cliente WhatsApp";

        const description = [
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

        try {
          await db.collection("businesses").doc(businessId).collection("leads").add({
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
          });

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

    const nextMessages = [...messagesForClaude, { role: "assistant", content: assistantForSession }].slice(
      -40,
    );

    try {
      await sessionRef.set(
        {
          messages: nextMessages,
          lastWhatsAppFrom: from,
          lastWhatsAppTo: to,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    } catch (e) {
      console.warn("[whatsappWebhook] session write", e);
    }

    try {
      await sendTwilioWhatsApp(accountSid, authToken, {
        To: from,
        From: to,
        Body: truncateWhatsApp(outbound),
      });
    } catch (e) {
      console.error("[whatsappWebhook] Twilio send", e);
      res.status(500).type("text/xml").send(emptyTwiml);
      return;
    }

    res.status(200).type("text/xml").send(emptyTwiml);
  },
);

function formatUsd(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "$0";
  return `$${v.toFixed(2)}`;
}
