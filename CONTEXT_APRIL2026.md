# CONTEXT_APRIL2026

Generado automaticamente el 2026-04-16

## 1) Lista completa de archivos actuales y descripcion

- `.env`: Secrets locales (Twilio, etc.).
- `.firebaserc`: Proyecto Firebase por defecto.
- `.gitignore`: Archivo del proyecto.
- `.vscode/settings.json`: Configuracion/datos del proyecto.
- `calendario.html`: Vista/pantalla web del panel.
- `calendario.js`: Logica JavaScript del frontend/backend.
- `campanas-ai-generator.js`: Logica JavaScript del frontend/backend.
- `campanas-campaign-sim.js`: Logica JavaScript del frontend/backend.
- `campanas.html`: Vista/pantalla web del panel.
- `campanas.js`: Modulo de campanas IA: generacion y guardado en Firestore.
- `chat.html`: Vista/pantalla web del panel.
- `chat.js`: Pagina de chat IA conectada a Firebase y Claude.
- `clientes.html`: Vista/pantalla web del panel.
- `clientes.js`: Logica JavaScript del frontend/backend.
- `configuracion.html`: Vista/pantalla web del panel.
- `configuracion.js`: Logica JavaScript del frontend/backend.
- `CONTEXT_APRIL2026.md`: Documentacion del proyecto.
- `dash-shell.js`: Logica JavaScript del frontend/backend.
- `dashboard-data.js`: Logica JavaScript del frontend/backend.
- `dashboard.html`: Vista/pantalla web del panel.
- `dashboard.js`: Logica JavaScript del frontend/backend.
- `equipo.html`: Vista/pantalla web del panel.
- `equipo.js`: Logica JavaScript del frontend/backend.
- `firebase.js`: Inicializacion Firebase Web SDK (Auth y Firestore).
- `firebase.json`: Config de Firebase Hosting/Functions/Firestore.
- `firestore.indexes.json`: Indices de Firestore.
- `firestore.rules`: Reglas de acceso Firestore.
- `functions/.eslintrc.js`: Logica JavaScript del frontend/backend.
- `functions/.gitignore`: Archivo del proyecto.
- `functions/index.js`: Cloud Functions HTTP (IA, chat y webhook WhatsApp/Twilio).
- `functions/package-lock.json`: Configuracion/datos del proyecto.
- `functions/package.json`: Dependencias/scripts de Cloud Functions.
- `functions/README.md`: Documentacion del proyecto.
- `functions/yourcolor-config.js`: Catalogo/reglas de negocio y prompts de YourColor.
- `index.html`: Vista/pantalla web del panel.
- `landing-entry.js`: Logica JavaScript del frontend/backend.
- `login.html`: Vista/pantalla web del panel.
- `login.js`: Logica JavaScript del frontend/backend.
- `onboarding.html`: Vista/pantalla web del panel.
- `onboarding.js`: Logica JavaScript del frontend/backend.
- `package-lock.json`: Configuracion/datos del proyecto.
- `package.json`: Dependencias del proyecto raiz.
- `profile.html`: Vista/pantalla web del panel.
- `profile.js`: Logica JavaScript del frontend/backend.
- `PROJECT_SUMMARY.md`: Documentacion del proyecto.
- `public/index.html`: Vista/pantalla web del panel.
- `script.js`: Logica JavaScript del frontend/backend.
- `server.js`: Logica JavaScript del frontend/backend.
- `set-key-mjs`: Archivo del proyecto.
- `settings.html`: Vista/pantalla web del panel.
- `settings.js`: Logica JavaScript del frontend/backend.
- `setup-env.mjs`: Script utilitario de Node.js.
- `solicitar.html`: Vista/pantalla web del panel.
- `solicitar.js`: Logica JavaScript del frontend/backend.
- `solicitudes.html`: Vista/pantalla web del panel.
- `solicitudes.js`: Logica JavaScript del frontend/backend.
- `styles.css`: Estilos globales de la aplicacion.
- `test-claude.mjs`: Script utilitario de Node.js.
- `testquery.html`: Vista/pantalla web del panel.
- `yourcolor-config.js`: Catalogo/reglas de negocio y prompts de YourColor.

## 2) Contenido COMPLETO de archivos solicitados

### `functions/index.js`
```javascript
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

const MODEL_INTERNAL_CHAT = "claude-haiku-4-5-20251001";
const MODEL_WHATSAPP = "claude-sonnet-4-5-20250929";
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
            model: MODEL_INTERNAL_CHAT,
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
            model: MODEL_INTERNAL_CHAT,
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
          model: MODEL_WHATSAPP,
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

    sendTwimlMessageResponse(res, outbound);
  },
);

function formatUsd(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "$0";
  return `$${v.toFixed(2)}`;
}

```

### `chat.js`
```javascript
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
 */
function appendAssistantBubble(content, opts = {}) {
  const stream = document.getElementById("yc-chat-stream");
  if (!stream) return;

  const wrap = document.createElement("div");
  wrap.className = "yc-msg yc-msg--assistant";

  const col = document.createElement("div");
  col.className = "yc-msg-inner-col";

  const bubble = document.createElement("div");
  bubble.className = "yc-msg-bubble";
  bubble.textContent = content;

  const time = document.createElement("div");
  time.className = "yc-msg-time";
  time.textContent = formatTime();

  col.appendChild(bubble);

  const quote = !opts.isWelcome ? tryBuildQuoteFromAssistantText(content) : null;
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
        await navigator.clipboard.writeText(content);
        showToast("Copiado al portapapeles");
      } catch {
        showToast("No se pudo copiar", true);
      }
    });

    const btnOrder = document.createElement("button");
    btnOrder.type = "button";
    btnOrder.className = "yc-msg-action-btn yc-msg-action-btn--primary";
    btnOrder.textContent = "Convertir a orden";
    btnOrder.addEventListener("click", () => convertConversationToOrder(wrap, content));

    actions.append(btnCopy, btnOrder);
    col.appendChild(actions);
  }

  col.appendChild(time);

  wrap.appendChild(col);
  stream.appendChild(wrap);
  stream.scrollTop = stream.scrollHeight;
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
    apiConversation.push({ role: "assistant", content: reply });
    trimApiMessages();
    appendAssistantBubble(reply);
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

```

### `yourcolor-config.js`
```javascript
export const YOURCOLOR_BUSINESS = {
  name: "YourColor",
  owner: "Marvin",
  city: "Fort Pierce, FL",
  phone: "772-212-3882",
  type: "Personalización de ropa para empresas",
  
  deliveryZones: ["Fort Pierce", "Vero Beach", 
    "Port St. Lucie", "Stuart"],
  
  rules: {
    minPieces: 6,
    depositPercent: 50,
    paymentMethods: ["Zelle", "CashApp"],
    deliveryDays: "10-12 días hábiles",
    logoFreeThreshold: 300,
    logoDesignCost: 30,
    size2XLExtraCost: true
  },

  products: {
    mangaLargaPoliester: {
      name: "Manga Larga 100% Poliéster",
      pricePerPiece: [
        { minQty: 6, maxQty: 11, price: 21.50 },
        { minQty: 12, maxQty: 17, price: 20.20 },
        { minQty: 18, maxQty: 49, price: 19.50 },
        { minQty: 50, maxQty: 999, price: 17.50 }
      ]
    },
    mangaLargaAlgodon: {
      name: "Manga Larga 100% Algodón",
      pricePerPiece: [
        { minQty: 6, maxQty: 11, price: 20.50 },
        { minQty: 12, maxQty: 23, price: 19.00 },
        { minQty: 24, maxQty: 49, price: 17.50 },
        { minQty: 50, maxQty: 99, price: 16.00 },
        { minQty: 100, maxQty: 999, price: null, 
          note: "Cotización especial" }
      ]
    },
    mangaCortaAlgodon: {
      name: "Manga Corta 100% Algodón",
      pricePerPiece: [
        { minQty: 6, maxQty: 11, price: 15.50 },
        { minQty: 12, maxQty: 23, price: 14.50 },
        { minQty: 24, maxQty: 49, price: 13.50 },
        { minQty: 50, maxQty: 99, price: 12.50 },
        { minQty: 100, maxQty: 999, price: null, 
          note: "Cotización especial" }
      ]
    },
    mangaCortaPoliester: {
      name: "Manga Corta 100% Poliéster",
      pricePerPiece: [
        { minQty: 6, maxQty: 11, price: 18.50 },
        { minQty: 12, maxQty: 23, price: 17.50 },
        { minQty: 24, maxQty: 49, price: 16.50 },
        { minQty: 50, maxQty: 999, price: 14.50 }
      ]
    },
    capuchaPoliester: {
      name: "Camiseta con Capucha 100% Poliéster",
      pricePerPiece: [
        { minQty: 6, maxQty: 11, price: 29.50 },
        { minQty: 12, maxQty: 23, price: 27.50 },
        { minQty: 24, maxQty: 49, price: 25.50 },
        { minQty: 50, maxQty: 99, price: 23.50 },
        { minQty: 100, maxQty: 999, price: null, 
          note: "Cotización especial" }
      ]
    },
    polo: {
      name: "Camisa Polo 100% Poliéster",
      pricePerPiece: [
        { minQty: 12, maxQty: 23, price: 30.00 },
        { minQty: 24, maxQty: 29, price: 28.00 },
        { minQty: 30, maxQty: 999, price: 25.00 }
      ]
    },
    gorras: {
      name: "Gorras Estilo Camionero DTF",
      pricePerPiece: [
        { minQty: 6, maxQty: 11, price: 17.00 },
        { minQty: 12, maxQty: 23, price: 16.00 },
        { minQty: 24, maxQty: 35, price: 15.00 },
        { minQty: 36, maxQty: 47, price: 14.00 },
        { minQty: 48, maxQty: 59, price: 13.00 },
        { minQty: 60, maxQty: 999, price: 12.00 }
      ]
    },
    tarjetas: {
      name: "Tarjetas de Presentación",
      pricePerPiece: [
        { minQty: 500, maxQty: 999, price: 86.00, 
          note: "Precio total, no por pieza" },
        { minQty: 1000, maxQty: 9999, price: 140.00, 
          note: "Precio total, no por pieza" }
      ]
    }
  }
};

export function calculateOrderTotal(productKey, quantity) {
  const product = YOURCOLOR_BUSINESS.products[productKey];
  if (!product) return null;
  
  const range = product.pricePerPiece.find(
    r => quantity >= r.minQty && quantity <= r.maxQty
  );
  
  if (!range) return null;
  if (!range.price) return { needsQuote: true };
  
  const subtotal = quantity * range.price;
  const logoFee = subtotal >= YOURCOLOR_BUSINESS.rules.logoFreeThreshold 
    ? 0 : YOURCOLOR_BUSINESS.rules.logoDesignCost;
  const deposit = (subtotal + logoFee) * 0.50;
  
  return {
    quantity,
    pricePerPiece: range.price,
    subtotal,
    logoFee,
    total: subtotal + logoFee,
    deposit,
    deliveryDays: YOURCOLOR_BUSINESS.rules.deliveryDays
  };
}

/**
 * Totales validados para Maya/WhatsApp (tarjetas = precio fijo del rango, no × cantidad).
 * @returns {null | object}
 */
export function computeValidatedMayaOrder(productKey, quantity) {
  const q = Number(quantity);
  if (!Number.isFinite(q) || q < 1) return null;

  if (productKey === "tarjetas") {
    const product = YOURCOLOR_BUSINESS.products.tarjetas;
    const range = product.pricePerPiece.find(
      (r) => q >= r.minQty && q <= r.maxQty && r.price != null,
    );
    if (!range) return null;
    const total = range.price;
    return {
      quantity: q,
      pricePerPiece: null,
      subtotal: total,
      logoFee: 0,
      total,
      deposit: total * 0.5,
      deliveryDays: YOURCOLOR_BUSINESS.rules.deliveryDays,
      isTarjetas: true,
    };
  }

  const calc = calculateOrderTotal(productKey, q);
  if (!calc || typeof calc !== "object" || "needsQuote" in calc) return null;
  return { ...calc, isTarjetas: false };
}

export function getYourColorSystemPrompt() {
  return `Eres el asistente de YourColor, negocio de 
personalización de ropa para empresas en Fort Pierce, FL.
Dueño: Marvin.

REGLA CRÍTICA DE PRECIOS: El precio listado es POR PIEZA
según el rango de cantidad. SIEMPRE calcula:
total = cantidad × precio_por_pieza

Ejemplo: 8 manga larga poliéster = 8 × $21.50 = $172.00
NO es $21.50 el precio del paquete de 6.

${JSON.stringify(YOURCOLOR_BUSINESS, null, 2)}`;
}

/**
 * Mismo núcleo que {@link getYourColorSystemPrompt} + reglas para webhook Twilio/WhatsApp y registro de pedidos.
 */
export function getYourColorWhatsAppWebhookPrompt() {
  return `${getYourColorSystemPrompt()}

--- WhatsApp (Twilio) ---
Respondes en español, tono cordial, mensajes breves.

CONFIRMACIÓN DE PEDIDO: solo si el cliente confirma explícitamente producto y cantidad acordados, agrega al FINAL una sola línea exacta (sin markdown):
MAYA_ORDER_JSON:{"confirmed":true,"productKey":"CLAVE","quantity":N,"customerName":"opcional"}

productKey debe ser: mangaLargaPoliester, mangaLargaAlgodon, mangaCortaAlgodon, mangaCortaPoliester, capuchaPoliester, polo, gorras o tarjetas.
Si no hay pedido confirmado, NO incluyas MAYA_ORDER_JSON.`;
}

/**
 * System prompt para el chat: catálogo YourColor + datos Firebase + capacidades del asistente.
 * @param {Record<string, unknown>} firebaseContext
 */
export function getYourColorChatSystemPrompt(firebaseContext = {}) {
  const base = getYourColorSystemPrompt();
  const ctx =
    firebaseContext && typeof firebaseContext === "object" ? firebaseContext : {};
  return `${base}

--- DATOS EN TIEMPO REAL (Firebase; úsalos como fuente de verdad para este negocio) ---
${JSON.stringify(ctx, null, 2)}

CAPACIDADES: Puedes dar consejos de negocio local, calcular presupuestos y precios con el catálogo
(rango de cantidad → precio por pieza; total = cantidad × precio; depósito y logo según reglas),
analizar tendencias o estacionalidad cuando aplique, y sugerir estrategias de marketing o seguimiento
apoyándote en clientes, órdenes y campañas guardadas. Responde en español salvo que pidan otro idioma.
Si faltan datos en Firebase, dilo claramente y no inventes cifras.`;
}

/**
 * Maya — asistente WhatsApp (Twilio). Catálogo completo + reglas de precio.
 * La función HTTP valida montos con calculateOrderTotal antes de guardar en Firestore.
 */
export function getMayaWhatsAppSystemPrompt() {
  return `Eres Maya, la asistente virtual de YourColor por WhatsApp.
Personalización de ropa para empresas · Fort Pierce, FL · Contacto negocio: ${YOURCOLOR_BUSINESS.phone}

Tono: cordial, profesional, mensajes cortos (WhatsApp). Español por defecto.

CATÁLOGO Y PRECIOS (obligatorio usar estos datos):
${JSON.stringify(YOURCOLOR_BUSINESS, null, 2)}

REGLAS DE PRECIOS:
- El precio del catálogo es POR PIEZA según el rango de cantidad (minQty–maxQty).
- Total prendas = cantidad × precio_por_pieza. NO es el precio del "lote mínimo".
- Si subtotal de prendas < ${YOURCOLOR_BUSINESS.rules.logoFreeThreshold}, suma logo $${YOURCOLOR_BUSINESS.rules.logoDesignCost}; si no, logo $0.
- Total = subtotal prendas + logo. Depósito = ${YOURCOLOR_BUSINESS.rules.depositPercent}% del total (redondea a centavos al explicar).
- Métodos de pago del depósito: ${YOURCOLOR_BUSINESS.rules.paymentMethods.join(", ")}.
- Tarjetas de presentación: el precio del rango es TOTAL del pedido, no por pieza (ver notas en catálogo).

PEDIDOS CONFIRMADOS — MUY IMPORTANTE:
Solo cuando el cliente confirme claramente el pedido (cantidad + producto acordados), al FINAL de tu mensaje agrega UNA sola línea exacta (sin markdown):
MAYA_ORDER_JSON:{"confirmed":true,"productKey":"CLAVE_PRODUCTO","quantity":N,"customerName":"Nombre opcional"}

productKey debe ser una de estas claves exactas: mangaLargaPoliester, mangaLargaAlgodon, mangaCortaAlgodon, mangaCortaPoliester, capuchaPoliester, polo, gorras, tarjetas.
Si NO hay confirmación de pedido, NO incluyas MAYA_ORDER_JSON.

Si la cantidad no califica en ningún rango o requiere cotización especial, NO pongas confirmed:true; explica y ofrece seguir por teléfono ${YOURCOLOR_BUSINESS.phone}.`;
}

```

### `campanas.js`
```javascript
import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import {
  addDoc,
  collection,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import {
  campaignPlatformDisplayName,
  resolveBusinessForUser,
  fetchCampaignsListAndStats,
  fetchLaunchedRecommendationIds,
  formatBusinessMeta,
  formatShortDate,
  getCampaignGeneratorProfileDefaults,
  initialsFromName,
} from "./dashboard-data.js";
import { initDashShell, openComingSoon } from "./dash-shell.js";
import { YOURCOLOR_BUSINESS } from "./yourcolor-config.js";

const LOG_PREFIX = "[ClientFlow Campañas]";
/** Set false to silence temporary generator wiring logs. */
const DEBUG_CAMPAIGN_GENERATOR = true;

/** @type {{ business: { id: string, data: Record<string, unknown> } | null, last: { inputs: Record<string, string>, output: Record<string, unknown> } | null, genVariation: number, prefillBusinessId: string | null }} */
const genState = {
  business: null,
  last: null,
  genVariation: 0,
  prefillBusinessId: null,
};

function formatUsd(n) {
  const v = Number(n) || 0;
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function logProfileDebug(business) {
  if (!business?.data) {
    console.log(LOG_PREFIX, "No business document (null).");
    return;
  }
  const { id, data } = business;
  console.log(LOG_PREFIX, "Business doc id:", id);
  console.log(LOG_PREFIX, "Raw field keys:", Object.keys(data));
  try {
    const safe = JSON.parse(
      JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
    );
    console.log(LOG_PREFIX, "Normalized profile (JSON-safe):", safe);
  } catch (e) {
    console.log(LOG_PREFIX, "Profile snapshot (object):", data);
  }
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/**
 * @param {{ id: string, data: Record<string, unknown> } | null} business
 * @param {{ loading?: boolean }} [opts]
 */
function renderHeader(business, opts = {}) {
  const nameEl = document.getElementById("dash-business-name");
  const metaEl = document.getElementById("dash-business-meta");
  const av = document.getElementById("dash-avatar-initials");

  if (!business) {
    if (nameEl) nameEl.textContent = "Campañas IA";
    if (metaEl) {
      metaEl.textContent = opts.loading ? "Cargando perfil…" : "Sin negocio vinculado aún";
    }
    if (av) av.textContent = opts.loading ? "…" : "?";
    return;
  }

  const { data } = business;
  const displayName =
    (typeof data.businessName === "string" && data.businessName.trim()) || "Tu negocio";
  const { metaLine } = formatBusinessMeta(data);

  if (nameEl) nameEl.textContent = displayName;
  if (metaEl) metaEl.textContent = metaLine;
  if (av) av.textContent = initialsFromName(displayName);
}

function platformClass(platform) {
  if (platform === "instagram") return "camp-ai-platform camp-ai-platform--instagram";
  if (platform === "google") return "camp-ai-platform camp-ai-platform--google";
  return "camp-ai-platform camp-ai-platform--facebook";
}

function showCampLaunchSuccessToast(message) {
  const el = document.getElementById("camp-launch-toast");
  if (!el) return;
  el.textContent = message || "Campaña guardada";
  el.hidden = false;
  const prev = showCampLaunchSuccessToast._timer;
  if (prev) clearTimeout(prev);
  showCampLaunchSuccessToast._timer = setTimeout(() => {
    el.hidden = true;
  }, 4500);
}

function markLaunchButtonLaunched(btn) {
  btn.removeAttribute("aria-busy");
  btn.removeAttribute("data-saving");
  btn.disabled = true;
  btn.textContent = "Campaña activa";
  btn.classList.remove("dash-quick-btn--primary");
  btn.classList.add("is-launched");
  btn.setAttribute("aria-label", "Campaña activa");
}

function showCampaignSaveError(message) {
  const box = document.getElementById("camp-campaign-save-error");
  const text = document.getElementById("camp-campaign-save-error-text");
  if (text) text.textContent = message;
  if (box) box.hidden = false;
}

function hideCampaignSaveError() {
  const box = document.getElementById("camp-campaign-save-error");
  if (box) box.hidden = true;
}

function liveCampaignStatusPresentation(status) {
  const s = String(status || "").toLowerCase();
  if (s === "paused") return { label: "Pausada", mod: "paused" };
  if (s === "completed" || s === "ended" || s === "finalizada" || s === "finished") {
    return { label: "Finalizada", mod: "ended" };
  }
  return { label: "Activa", mod: "active" };
}

function reachForCampaignRow(row) {
  const er = Number(row.estimatedReach);
  return Number.isFinite(er) && er > 0 ? Math.round(er) : null;
}

function renderHubStats(agg) {
  setText("camp-hub-active", String(agg.activeCount));
  setText("camp-hub-leads", agg.totalLeads.toLocaleString("es"));
  setText("camp-hub-reach", agg.totalReach.toLocaleString("es"));
  setText("camp-hub-conv", agg.totalConversions.toLocaleString("es"));
}

function excerptText(s, maxLen) {
  const t = typeof s === "string" ? s.trim() : "";
  if (!t) return "";
  if (t.length <= maxLen) return t;
  return `${t.slice(0, Math.max(0, maxLen - 1)).trim()}…`;
}

function renderLiveCampaignCard(row) {
  const title =
    (typeof row.title === "string" && row.title.trim()) || "Campaña sin título";
  const isGenerator = row.sourceType === "ai-generator";
  const plat = campaignPlatformDisplayName(row.platform);
  const status = liveCampaignStatusPresentation(row.status);
  const budget = Number(row.recommendedBudget);
  const budgetStr = Number.isFinite(budget) && budget >= 0 ? `${formatUsd(budget)} / sem` : "—";
  const reachN = reachForCampaignRow(row);
  const leadsN = Number(row.estimatedLeads);
  const leadsStr = Number.isFinite(leadsN) && leadsN >= 0 ? String(Math.round(leadsN)) : "—";
  const startStr = formatShortDate(row.createdAt);
  const hookLine = typeof row.hook === "string" ? row.hook.trim() : "";
  const ctaLine = typeof row.cta === "string" ? row.cta.trim() : "";
  const bodyPreview = excerptText(
    typeof row.adDescription === "string" ? row.adDescription : "",
    155,
  );

  const article = document.createElement("article");
  article.className = isGenerator ? "camp-live-card camp-live-card--from-ia" : "camp-live-card";
  article.setAttribute("data-campaign-doc-id", row.id);

  const top = document.createElement("div");
  top.className = "camp-live-card-top";

  const titles = document.createElement("div");
  titles.className = "camp-live-card-titles";

  if (isGenerator) {
    const kicker = document.createElement("p");
    kicker.className = "camp-live-card-kicker";
    kicker.textContent = "Desde el generador";
    titles.appendChild(kicker);
  }

  const h3 = document.createElement("h3");
  h3.className = "camp-live-card-title";
  h3.textContent = title;

  const platEl = document.createElement("span");
  platEl.className = `camp-live-platform ${platformClass(row.platform)}`;
  platEl.textContent = plat;

  titles.append(h3);

  if (isGenerator && hookLine) {
    const hookEl = document.createElement("p");
    hookEl.className = "camp-live-card-hook";
    hookEl.textContent = hookLine;
    titles.appendChild(hookEl);
  }

  if (isGenerator && bodyPreview) {
    const prev = document.createElement("p");
    prev.className = "camp-live-card-preview";
    prev.textContent = bodyPreview;
    titles.appendChild(prev);
  }

  titles.appendChild(platEl);

  const badge = document.createElement("span");
  badge.className = `camp-live-badge camp-live-badge--${status.mod}`;
  badge.textContent = status.label;

  top.append(titles, badge);

  const grid = document.createElement("dl");
  grid.className = "camp-live-meta";

  const addRow = (dtText, ddText) => {
    const wrap = document.createElement("div");
    wrap.className = "camp-live-meta-row";
    const dt = document.createElement("dt");
    dt.textContent = dtText;
    const dd = document.createElement("dd");
    dd.textContent = ddText;
    wrap.append(dt, dd);
    grid.appendChild(wrap);
  };

  addRow("Presupuesto", budgetStr);
  if (isGenerator && ctaLine) {
    addRow("CTA sugerido", ctaLine);
  }
  addRow("Alcance estimado", reachN != null ? reachN.toLocaleString("es") : "—");
  addRow("Leads generados (est.)", leadsStr);
  addRow("Inicio", startStr);

  article.append(top, grid);
  return article;
}

function renderLiveCampaigns(campaigns) {
  const listEl = document.getElementById("camp-live-list");
  const emptyEl = document.getElementById("camp-live-empty");
  if (!listEl || !emptyEl) return;

  listEl.replaceChildren();

  if (!campaigns.length) {
    emptyEl.hidden = false;
    return;
  }

  emptyEl.hidden = true;
  campaigns.forEach((row) => {
    listEl.appendChild(renderLiveCampaignCard(row));
  });
}

async function refreshCampaignsHub(businessId) {
  const agg = await fetchCampaignsListAndStats(db, businessId);
  renderHubStats(agg);
  renderLiveCampaigns(agg.campaigns);
  return agg;
}

async function saveCampaignFromRecommendation(businessId, c, btn) {
  if (btn.disabled || btn.dataset.saving === "1") return;

  hideCampaignSaveError();
  btn.dataset.saving = "1";
  btn.setAttribute("aria-busy", "true");

  const campaignsCol = collection(db, "businesses", businessId, "campaigns");
  const payload = {
    title: c.name,
    platform: c.platform,
    recommendedBudget: c.budgetWeekly,
    estimatedLeads: c.estimatedLeadsWeekly,
    audience: c.audience,
    adDescription: c.adDescription,
    status: "active",
    createdAt: serverTimestamp(),
    recommendationId: c.id,
  };

  console.log("Launching campaign...", { businessId, path: `businesses/${businessId}/campaigns`, payload });

  try {
    await addDoc(campaignsCol, payload);
    markLaunchButtonLaunched(btn);
    showCampLaunchSuccessToast("Campaña guardada");
    await refreshCampaignsHub(businessId);
  } catch (err) {
    console.error("Campaign save failed", err);
    btn.removeAttribute("aria-busy");
    delete btn.dataset.saving;
    const msg =
      err && typeof err.message === "string"
        ? err.message
        : "Error desconocido al guardar en Firestore.";
    showCampaignSaveError(
      `No se pudo guardar la campaña: ${msg}. Revisa reglas de seguridad (escritura en businesses/{id}/campaigns) y la consola.`,
    );
  }
}

function renderCampaignCard(c, businessId, launchedIds) {
  const article = document.createElement("article");
  article.className = "camp-ai-card";
  article.setAttribute("data-campaign-id", c.id);
  article.setAttribute("data-recommended-budget-weekly", String(c.budgetWeekly));
  article.setAttribute("data-estimated-leads-weekly", String(c.estimatedLeadsWeekly));
  article.setAttribute("data-platform", c.platform);

  const top = document.createElement("div");
  top.className = "camp-ai-card-top";

  const h3 = document.createElement("h3");
  h3.className = "camp-ai-card-title";
  h3.textContent = c.name;

  const plat = document.createElement("span");
  plat.className = platformClass(c.platform);
  plat.setAttribute("data-platform-label", "");
  plat.textContent = c.platformLabel;

  top.append(h3, plat);

  const dl = document.createElement("dl");
  dl.className = "camp-ai-meta";

  const row = (dtText, ddNode) => {
    const wrap = document.createElement("div");
    wrap.className = "camp-ai-meta-row";
    const dt = document.createElement("dt");
    dt.textContent = dtText;
    const dd = document.createElement("dd");
    if (typeof ddNode === "string") dd.textContent = ddNode;
    else dd.appendChild(ddNode);
    wrap.append(dt, dd);
    return wrap;
  };

  const budgetDd = document.createElement("dd");
  const strongB = document.createElement("strong");
  strongB.textContent = formatUsd(c.budgetWeekly);
  budgetDd.append(strongB, " / semana");

  const leadsDd = document.createElement("dd");
  const strongL = document.createElement("strong");
  strongL.textContent = String(c.estimatedLeadsWeekly);
  leadsDd.append(strongL, " / semana");

  dl.append(
    row("Presupuesto recomendado", budgetDd),
    row("Leads estimados", leadsDd),
    row("Audiencia sugerida", c.audience),
  );

  const full = document.createElement("div");
  full.className = "camp-ai-meta-row camp-ai-meta-row--full";
  const dtDesc = document.createElement("dt");
  dtDesc.textContent = "Descripción del anuncio";
  const ddDesc = document.createElement("dd");
  ddDesc.textContent = c.adDescription;
  full.append(dtDesc, ddDesc);
  dl.appendChild(full);

  const actions = document.createElement("div");
  actions.className = "camp-ai-actions";

  const btnLaunch = document.createElement("button");
  btnLaunch.type = "button";
  btnLaunch.className = "dash-quick-btn dash-quick-btn--primary camp-ai-btn-launch";
  btnLaunch.textContent = "Guardar campaña";

  const already = launchedIds.has(c.id);
  if (already) {
    markLaunchButtonLaunched(btnLaunch);
  } else {
    btnLaunch.addEventListener("click", () => saveCampaignFromRecommendation(businessId, c, btnLaunch));
  }

  const btnEdit = document.createElement("button");
  btnEdit.type = "button";
  btnEdit.className = "dash-quick-btn camp-ai-btn-edit";
  btnEdit.textContent = "Editar";
  btnEdit.addEventListener("click", () => {
    openComingSoon(
      "Editor de campaña",
      "Aquí podrás ajustar creatividades, segmentación y presupuesto antes de publicar. Lo activaremos en la siguiente iteración.",
    );
  });

  actions.append(btnLaunch, btnEdit);
  article.append(top, dl, actions);

  return article;
}

function renderRecommendationSummary(summary) {
  if (!summary) return;
  setText(
    "camp-reco-summary-line",
    `Recomendaciones IA · ${formatUsd(summary.totalBudgetWeekly)}/sem en total · ~${summary.estimatedLeadsWeekly} leads/semana · plataformas sugeridas: ${summary.platforms.join(", ")}`,
  );
}

function setLoadingVisible(show) {
  const loading = document.getElementById("camp-loading");
  if (loading) loading.hidden = !show;
}

function setHubLoading(isLoading) {
  const stats = document.getElementById("camp-hub-stats");
  if (stats) stats.setAttribute("aria-busy", isLoading ? "true" : "false");
}

function showFirestoreError(message) {
  const box = document.getElementById("camp-firestore-error");
  const text = document.getElementById("camp-firestore-error-text");
  if (text) text.textContent = message;
  if (box) box.hidden = false;
}

function hideFirestoreError() {
  const box = document.getElementById("camp-firestore-error");
  if (box) box.hidden = true;
}

function setHubVisible(show) {
  const root = document.getElementById("camp-hub-root");
  if (root) root.hidden = !show;
}

function hasCompleteBusinessProfile(data) {
  if (!data || typeof data !== "object") return false;
  const name = typeof data.businessName === "string" ? data.businessName.trim() : "";
  const area = typeof data.serviceArea === "string" ? data.serviceArea.trim() : "";
  const services = Array.isArray(data.services) ? data.services.filter(Boolean) : [];
  return Boolean(name && area && services.length);
}

function toRecommendationCardModel(ai, idx, inputs) {
  const platformLabel = campaignPlatformDisplayName(ai.platform);
  return {
    id: `yc-ai-${idx + 1}-${hashStringForDebug(`${ai.headline}|${ai.platform}|${inputs.goal}`)}`,
    name: ai.headline,
    platform: ai.platform,
    platformLabel,
    budgetWeekly: ai.suggestedBudgetWeekly,
    estimatedLeadsWeekly: ai.estimatedLeadsWeekly,
    audience: inputs.audience || "Segmentación según perfil del negocio",
    adDescription: ai.bodyText,
  };
}

async function generateThreeRecommendationsWithClaude(business) {
  const profileDefaults = getCampaignGeneratorProfileDefaults(business.data);
  const base = mergeCampaignGeneratorInputs(readGeneratorInputsFromDom(), profileDefaults);
  const variants = [
    { ...base, platformPref: "facebook" },
    { ...base, platformPref: "instagram" },
    { ...base, platformPref: "google" },
  ];
  const responses = await Promise.all(
    variants.map((inputs) => generateCampaignWithAI(buildAIGeneratorPayload(inputs, business.data))),
  );
  const cards = responses.map((ai, idx) => toRecommendationCardModel(ai, idx, variants[idx]));
  const totalBudgetWeekly = cards.reduce((acc, c) => acc + (Number(c.budgetWeekly) || 0), 0);
  const estimatedLeadsWeekly = cards.reduce((acc, c) => acc + (Number(c.estimatedLeadsWeekly) || 0), 0);
  const platforms = Array.from(new Set(cards.map((c) => c.platformLabel)));
  return { campaigns: cards, summary: { totalBudgetWeekly, estimatedLeadsWeekly, platforms } };
}

async function renderCampaignsPage(business) {
  const listEl = document.getElementById("ai-campaign-recommendations");
  const emptyEl = document.getElementById("camp-empty-state");
  const noteEl = document.querySelector(".camp-demo-note");

  if (!listEl) return;

  if (!business) {
    genState.business = null;
    genState.prefillBusinessId = null;
    clearGeneratorFormFields();
    resetGeneratorUI();
    listEl.hidden = true;
    listEl.innerHTML = "";
    listEl.setAttribute("data-campaign-source", "none");
    if (emptyEl) emptyEl.hidden = false;
    setHubVisible(false);
    setText("camp-reco-summary-line", "");
    if (noteEl) {
      noteEl.textContent =
        "Inicia sesión con la misma cuenta con la que guardaste el negocio y completa el onboarding si aún no lo has hecho.";
    }
    return;
  }

  genState.business = business;

  if (genState.prefillBusinessId !== business.id) {
    applyGeneratorPrefillFromBusiness(business.data);
    genState.prefillBusinessId = business.id;
  }

  if (emptyEl) emptyEl.hidden = true;
  setHubVisible(true);

  try {
    setHubLoading(true);
    await refreshCampaignsHub(business.id);
  } catch (e) {
    console.warn(LOG_PREFIX, "Could not load campaign hub stats:", e);
    renderHubStats({
      activeCount: 0,
      totalLeads: 0,
      totalReach: 0,
      totalConversions: 0,
      campaigns: [],
    });
    renderLiveCampaigns([]);
    const liveEmpty = document.getElementById("camp-live-empty");
    if (liveEmpty) liveEmpty.hidden = false;
  } finally {
    setHubLoading(false);
  }

  let result = null;
  if (hasCompleteBusinessProfile(business.data)) {
    try {
      result = await generateThreeRecommendationsWithClaude(business);
    } catch (e) {
      console.error(LOG_PREFIX, "Claude recommendations failed:", e);
      showFirestoreError(
        "No se pudieron generar recomendaciones automáticas con IA. Revisa conexión/función e inténtalo de nuevo.",
      );
    }
  } else {
    showFirestoreError(
      "Completa perfil del negocio (nombre, zona y servicios) para generar recomendaciones automáticas con IA.",
    );
  }

  if (!result || !Array.isArray(result.campaigns) || !result.campaigns.length) {
    listEl.hidden = true;
    listEl.innerHTML = "";
    setText("camp-reco-summary-line", "");
    if (noteEl) {
      noteEl.textContent = "Las recomendaciones se generan con Claude cuando el perfil del negocio está completo.";
    }
    return;
  }

  listEl.hidden = false;
  listEl.setAttribute("data-campaign-source", "claude");
  listEl.removeAttribute("data-vertical");
  listEl.innerHTML = "";

  let launchedIds = new Set();
  try {
    launchedIds = await fetchLaunchedRecommendationIds(db, business.id);
  } catch (e) {
    console.warn(LOG_PREFIX, "Could not read existing campaigns:", e);
  }

  result.campaigns.forEach((c) => {
    listEl.appendChild(renderCampaignCard(c, business.id, launchedIds));
  });

  renderRecommendationSummary(result.summary);

  if (noteEl) {
    noteEl.textContent = "Recomendaciones automáticas generadas con Claude a partir de tu perfil real.";
  }
}

function genFormVal(id) {
  const el = document.getElementById(id);
  return el && "value" in el ? String(el.value).trim() : "";
}

/**
 * Lee el formulario del generador en el DOM (única fuente de verdad al generar).
 * @returns {{ goal: string, offer: string, location: string, budget: string, audience: string, platformPref: string }}
 */
function readGeneratorInputsFromDom() {
  return {
    goal: genFormVal("camp-gen-goal"),
    offer: genFormVal("camp-gen-offer"),
    location: genFormVal("camp-gen-location"),
    budget: genFormVal("camp-gen-budget"),
    audience: genFormVal("camp-gen-audience"),
    platformPref: (() => {
      const el = document.getElementById("camp-gen-platform");
      return el && "value" in el ? String(el.value) : "auto";
    })(),
  };
}

function setGeneratorFormField(id, value) {
  const el = document.getElementById(id);
  if (el && "value" in el) el.value = value ?? "";
}

/** Vacía el generador si no hay negocio vinculado. */
function clearGeneratorFormFields() {
  setGeneratorFormField("camp-gen-goal", "");
  setGeneratorFormField("camp-gen-offer", "");
  setGeneratorFormField("camp-gen-location", "");
  setGeneratorFormField("camp-gen-budget", "");
  setGeneratorFormField("camp-gen-audience", "");
  setGeneratorFormField("camp-gen-platform", "auto");
}

/**
 * Rellena el formulario con datos del perfil (una vez por negocio al cargar).
 * @param {Record<string, unknown>} data
 */
function applyGeneratorPrefillFromBusiness(data) {
  const d = getCampaignGeneratorProfileDefaults(data);
  setGeneratorFormField("camp-gen-goal", d.goal);
  setGeneratorFormField("camp-gen-offer", d.offer);
  setGeneratorFormField("camp-gen-location", d.location);
  setGeneratorFormField("camp-gen-budget", d.budget);
  setGeneratorFormField("camp-gen-audience", d.audience);
  setGeneratorFormField("camp-gen-platform", d.platformPref || "auto");
}

/**
 * Valores efectivos para el mock: campo del formulario si el usuario escribió algo; si no, perfil.
 * @param {ReturnType<typeof readGeneratorInputsFromDom>} fromDom
 * @param {ReturnType<typeof getCampaignGeneratorProfileDefaults>} profile
 */
function mergeCampaignGeneratorInputs(fromDom, profile) {
  const nz = (s) => (typeof s === "string" && s.trim() ? s.trim() : "");
  return {
    goal: nz(fromDom.goal) || nz(profile.goal) || "",
    offer: nz(fromDom.offer) || nz(profile.offer) || "",
    location: nz(fromDom.location) || nz(profile.location) || "",
    budget: nz(fromDom.budget) || nz(profile.budget) || "",
    audience: nz(fromDom.audience) || nz(profile.audience) || "",
    platformPref: nz(fromDom.platformPref) || nz(profile.platformPref) || "auto",
  };
}

function hashStringForDebug(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return String(Math.abs(h));
}

function parseBudgetNumber(raw) {
  const cleaned = String(raw ?? "").trim().replace(/[^\d.]/g, "");
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

function normalizePlatformKey(raw) {
  const p = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (p === "facebook" || p === "instagram" || p === "google") return p;
  return "facebook";
}

function lineList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((v) => String(v ?? "").trim())
      .filter(Boolean);
  }
  return String(value)
    .split(/\r?\n|•|- /g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function normalizeAIResponse(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Respuesta de IA inválida: se esperaba un objeto JSON.");
  }

  const headline = String(raw.headline ?? "").trim();
  const bodyText = String(raw.bodyText ?? "").trim();
  const hook = String(raw.hook ?? "").trim();
  const cta = String(raw.cta ?? "").trim();
  const platform = normalizePlatformKey(raw.platform);
  const budget = Number(raw.suggestedBudgetWeekly);
  const estimatedLeads = Number(raw.estimatedLeadsWeekly);

  if (!headline) throw new Error("Falta `headline` en la respuesta.");
  if (!bodyText) throw new Error("Falta `bodyText` en la respuesta.");
  if (!cta) throw new Error("Falta `cta` en la respuesta.");
  if (!Number.isFinite(budget) || budget <= 0) {
    throw new Error("`suggestedBudgetWeekly` inválido en la respuesta.");
  }
  if (!Number.isFinite(estimatedLeads) || estimatedLeads < 0) {
    throw new Error("`estimatedLeadsWeekly` inválido en la respuesta.");
  }

  return {
    headline,
    hook,
    bodyText,
    cta,
    platform,
    suggestedBudgetWeekly: Math.round(budget),
    estimatedLeadsWeekly: Math.round(estimatedLeads),
    creativeIdea: String(raw.creativeIdea ?? "").trim(),
  };
}

function mapAIResponseToGeneratorOutput(ai) {
  return {
    headline: ai.headline,
    hook: ai.hook || ai.bodyText,
    bodyText: ai.bodyText,
    cta: ai.cta,
    platform: ai.platform,
    platformDisplayLabel: campaignPlatformDisplayName(ai.platform),
    suggestedBudgetWeekly: ai.suggestedBudgetWeekly,
    estimatedLeadsWeekly: ai.estimatedLeadsWeekly,
    estimatedReachWeekly: Math.max(160, Math.round(ai.estimatedLeadsWeekly * 36)),
    creativeIdea: ai.creativeIdea || ai.bodyText,
    strategy: "",
    visualIdeas: [],
    photoSuggestions: [],
    videoSuggestions: [],
  };
}

function buildAIGeneratorPayload(inputs, businessData) {
  const safeBusiness = businessData && typeof businessData === "object" ? businessData : {};
  return {
    goal: inputs.goal,
    offer: inputs.offer,
    location: inputs.location,
    budget: inputs.budget,
    audience: inputs.audience,
    platformPref: inputs.platformPref,
    yourColorBusiness: YOURCOLOR_BUSINESS,
    businessProfile: {
      businessId: genState.business?.id || null,
      businessName: String(safeBusiness.businessName ?? "").trim(),
      businessDescription: String(safeBusiness.businessDescription ?? "").trim(),
      serviceArea: String(safeBusiness.serviceArea ?? "").trim(),
      services: Array.isArray(safeBusiness.services) ? safeBusiness.services : [],
      serviceOtherDetail: String(safeBusiness.serviceOtherDetail ?? "").trim(),
      category: String(safeBusiness.category ?? "").trim(),
    },
  };
}

async function generateCampaignWithAI(payload) {
  const res = await fetch("https://generatecampaign-5laxqi2i4q-uc.a.run.app", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Backend AI error (${res.status}).`);
  }
  const json = await res.json();
  return normalizeAIResponse(json);
}

function resetGeneratorUI() {
  genState.last = null;
  genState.genVariation = 0;
  const out = document.getElementById("camp-gen-output");
  const saveBtn = document.getElementById("camp-gen-save-btn");
  const hint = document.getElementById("camp-gen-save-hint");
  const note = document.getElementById("camp-gen-output-note");
  if (out) out.hidden = true;
  if (saveBtn) saveBtn.disabled = true;
  if (hint) hint.textContent = "";
  if (note) note.textContent = "";
}

function fillGeneratorOutput(data) {
  setText("camp-gen-out-headline", data.headline);
  setText("camp-gen-out-hook", data.hook);
  setText("camp-gen-out-body", data.bodyText);
  setText("camp-gen-out-cta", data.cta);
  setText(
    "camp-gen-out-platform",
    typeof data.platformDisplayLabel === "string" && data.platformDisplayLabel.trim()
      ? data.platformDisplayLabel
      : campaignPlatformDisplayName(data.platform),
  );
  setText("camp-gen-out-budget", `${formatUsd(data.suggestedBudgetWeekly)} / semana`);
  setText("camp-gen-out-leads", String(data.estimatedLeadsWeekly));
  setText("camp-gen-out-creative", data.creativeIdea);
}

async function saveGeneratedCampaign(businessId, pack) {
  const { output: data, inputs } = pack;
  const campaignsCol = collection(db, "businesses", businessId, "campaigns");
  const audienceLine = [inputs.goal, inputs.audience, inputs.location].filter(Boolean).join(" · ") || "—";
  await addDoc(campaignsCol, {
    title: data.headline.slice(0, 120),
    platform: data.platform,
    recommendedBudget: data.suggestedBudgetWeekly,
    estimatedLeads: data.estimatedLeadsWeekly,
    estimatedReach: data.estimatedReachWeekly,
    audience: audienceLine,
    adDescription: data.bodyText,
    headline: data.headline,
    hook: data.hook,
    cta: data.cta,
    creativeIdea: data.creativeIdea,
    strategy: data.strategy || "",
    visualIdeas: Array.isArray(data.visualIdeas) ? data.visualIdeas : [],
    photoSuggestions: Array.isArray(data.photoSuggestions) ? data.photoSuggestions : [],
    videoSuggestions: Array.isArray(data.videoSuggestions) ? data.videoSuggestions : [],
    status: "active",
    sourceType: "ai-generator",
    generatorInputs: inputs,
    createdAt: serverTimestamp(),
  });
}

function runCampaignGenerator() {
  const b = genState.business;
  if (!b) return;
  const genBtn = document.getElementById("camp-gen-generate-btn");
  const regenBtn = document.getElementById("camp-gen-regenerate-btn");
  const saveBtn = document.getElementById("camp-gen-save-btn");
  hideCampaignSaveError();
  const hint = document.getElementById("camp-gen-save-hint");
  const note = document.getElementById("camp-gen-output-note");
  const outWrap = document.getElementById("camp-gen-output");
  const inputsAtEvent = readGeneratorInputsFromDom();
  const profileDefaults = getCampaignGeneratorProfileDefaults(b.data);
  if (DEBUG_CAMPAIGN_GENERATOR) {
    console.log(`${LOG_PREFIX} [gen] DOM inputs at click`, {
      goal: inputsAtEvent.goal,
      offer: inputsAtEvent.offer,
      location: inputsAtEvent.location,
      budget: inputsAtEvent.budget,
      audience: inputsAtEvent.audience,
      platformPref: inputsAtEvent.platformPref,
      profileDefaults,
    });
  }

  if (genBtn) {
    genBtn.disabled = true;
    genBtn.setAttribute("aria-busy", "true");
  }
  if (regenBtn) {
    regenBtn.disabled = true;
    regenBtn.setAttribute("aria-busy", "true");
  }
  if (note) note.textContent = "Generando borrador…";
  if (outWrap) outWrap.hidden = false;
  if (hint) hint.textContent = "";

  window.setTimeout(async () => {
    try {
      const fromDom = readGeneratorInputsFromDom();
      const diverged = JSON.stringify(fromDom) !== JSON.stringify(inputsAtEvent);
      const inputs = mergeCampaignGeneratorInputs(fromDom, profileDefaults);
      if (DEBUG_CAMPAIGN_GENERATOR) {
        console.log(`${LOG_PREFIX} [gen] merged inputs -> backend payload`, {
          fromDom,
          merged: inputs,
          reReadMatchesClick: !diverged,
        });
        if (diverged) {
          console.warn(`${LOG_PREFIX} [gen] DOM at click vs pre-submit differ (IME/autofill?)`, {
            atClick: inputsAtEvent,
            preMock: fromDom,
          });
        }
      }
      genState.genVariation += 1;
      const payload = buildAIGeneratorPayload(inputs, b.data);
      if (DEBUG_CAMPAIGN_GENERATOR) {
        console.log(`${LOG_PREFIX} [gen] payload -> generateCampaignWithAI`, payload);
      }
      const aiResponse = await generateCampaignWithAI(payload);
      const output = mapAIResponseToGeneratorOutput(aiResponse);
      genState.last = { inputs, output };
      if (DEBUG_CAMPAIGN_GENERATOR) {
        console.log(`${LOG_PREFIX} [gen] ai result digest`, {
          headline: output.headline,
          hookPreview: output.hook.slice(0, 120),
          cta: output.cta,
          platform: output.platform,
          platformDisplayLabel: output.platformDisplayLabel,
          suggestedBudgetWeekly: output.suggestedBudgetWeekly,
          estimatedLeadsWeekly: output.estimatedLeadsWeekly,
          estimatedReachWeekly: output.estimatedReachWeekly,
          inputFingerprint: hashStringForDebug(JSON.stringify(inputs)),
        });
      }
      fillGeneratorOutput(output);
      if (note) {
        note.textContent = "Borrador generado por IA desde backend seguro.";
      }
      if (saveBtn) saveBtn.disabled = false;
      const resultCard = document.getElementById("camp-gen-result-card");
      if (resultCard) {
        window.requestAnimationFrame(() => {
          resultCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
      }
    } catch (e) {
      console.error(LOG_PREFIX, "Generator backend call failed:", e);
      if (note) note.textContent = "No se pudo generar con IA backend. Inténtalo de nuevo.";
      if (outWrap) outWrap.hidden = true;
    } finally {
      if (genBtn) {
        genBtn.disabled = false;
        genBtn.removeAttribute("aria-busy");
      }
      if (regenBtn) {
        regenBtn.disabled = false;
        regenBtn.removeAttribute("aria-busy");
      }
    }
  }, 420);
}

function wireCampaignGenerator() {
  const genBtn = document.getElementById("camp-gen-generate-btn");
  const regenBtn = document.getElementById("camp-gen-regenerate-btn");
  const saveBtn = document.getElementById("camp-gen-save-btn");
  if (!genBtn || !saveBtn || genBtn.dataset.wired === "1") return;
  genBtn.dataset.wired = "1";

  genBtn.addEventListener("click", () => runCampaignGenerator());
  if (regenBtn) regenBtn.addEventListener("click", () => runCampaignGenerator());

  saveBtn.addEventListener("click", async () => {
    const b = genState.business;
    const pack = genState.last;
    if (!b || !pack) return;
    const hint = document.getElementById("camp-gen-save-hint");
    saveBtn.disabled = true;
    saveBtn.setAttribute("aria-busy", "true");
    hideCampaignSaveError();
    if (hint) hint.textContent = "";
    try {
      await saveGeneratedCampaign(b.id, pack);
      showCampLaunchSuccessToast("Campaña guardada");
      if (hint) hint.textContent = "Listo — aparece en «Campañas guardadas».";
      await refreshCampaignsHub(b.id);
      window.setTimeout(() => {
        if (hint) hint.textContent = "";
      }, 4000);
    } catch (err) {
      console.error(LOG_PREFIX, "Save generated campaign failed:", err);
      showCampaignSaveError(
        err && err.message
          ? `No se pudo guardar: ${err.message}`
          : "No se pudo guardar la campaña. Revisa Firestore y la consola.",
      );
    } finally {
      saveBtn.disabled = false;
      saveBtn.removeAttribute("aria-busy");
    }
  });
}

async function loadCampanasForUser(user) {
  const queryUid = user.uid;
  console.log(LOG_PREFIX, "[biz-link] auth uid:", queryUid, "isAnonymous:", user.isAnonymous);

  setLoadingVisible(true);
  renderHeader(null, { loading: true });

  try {
    if (typeof auth.authStateReady === "function") {
      await auth.authStateReady();
    }

    const business = await resolveBusinessForUser(db, user);
    if (business) {
      const ou = business.data && business.data.ownerUid;
      console.log(LOG_PREFIX, "[biz-link] negocio encontrado", {
        businessId: business.id,
        ownerUidEnDocumento: ou,
        consultaPorOwnerUid: queryUid,
        coinciden: ou === queryUid,
      });
    } else {
      console.warn(LOG_PREFIX, "[biz-link] ningún documento en businesses con ownerUid ==", queryUid);
    }
    logProfileDebug(business);

    hideFirestoreError();
    hideCampaignSaveError();
    renderHeader(business, {});
    await renderCampaignsPage(business);
  } catch (err) {
    console.error(LOG_PREFIX, "Firestore / render error:", err);
    renderHeader(null, { loading: false });
    showFirestoreError(
      err && err.message
        ? `Error al leer tu negocio: ${err.message}. Comprueba reglas de Firestore y la consola.`
        : "Error al leer tu negocio en Firestore. Comprueba reglas, red y la consola.",
    );
    await renderCampaignsPage(null);
  } finally {
    setLoadingVisible(false);
    console.log(LOG_PREFIX, "Load finished (loading UI cleared).");
  }
}

function boot() {
  initDashShell({ auth });
  wireCampaignGenerator();

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      console.log(LOG_PREFIX, "No user — redirect to login.");
      window.location.replace("login.html");
      return;
    }

    loadCampanasForUser(user).catch((err) => {
      console.error(LOG_PREFIX, "Unhandled loadCampanasForUser:", err);
      setLoadingVisible(false);
      showFirestoreError("Error inesperado al cargar la página. Recarga e inténtalo de nuevo.");
      renderCampaignsPage(null);
    });
  });
}

boot();

```

## 3) Variables de entorno y Firebase config actuales

### `.env` actual
```env
TWILIO_ACCOUNT_SID=ACe7a7676244795473167e339c6f3bf270
TWILIO_AUTH_TOKEN=8d0e3140390c884b0a85406ebb58c082
```

### Firebase Web config (`firebase.js`)
```javascript
/**
 * ClientFlow AI — Firebase (modular SDK)
 * Ensure Firestore rules allow authenticated writes to `businesses`. Onboarding usa cuenta con correo (mismo uid que el panel).
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDYqbVqMTR0jnQzm-YDThfFcFz9__fmbTI",
  authDomain: "clientflow-ai-7eb08.firebaseapp.com",
  projectId: "clientflow-ai-7eb08",
  storageBucket: "clientflow-ai-7eb08.firebasestorage.app",
  messagingSenderId: "299452046381",
  appId: "1:299452046381:web:9fc81e4bc940bd4dfa2ca4",
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);

```

### Firebase project/runtime config
```json
{
  "projects": {
    "default": "clientflow-ai-7eb08"
  }
}

```
```json
{
  "firestore": {
    "database": "(default)",
    "location": "nam5",
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "functions": [
    {
      "source": "functions",
      "codebase": "default",
      "disallowLegacyRuntimeConfig": true,
      "ignore": [
        "node_modules",
        ".git",
        "firebase-debug.log",
        "firebase-debug.*.log",
        "*.local"
      ],
      "predeploy": [
        "npm --prefix \"$RESOURCE_DIR\" run lint"
      ]
    }
  ],
  "hosting": {
    "public": "public",
    "ignore": [
      "firebase.json",
      "**/.*",
      "**/node_modules/**"
    ],
    "rewrites": [
      {
        "source": "**",
        "destination": "/index.html"
      }
    ]
  }
}

```

### Firebase Functions secrets referenciados en codigo
- `ANTHROPIC_KEY`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `YOURCOLOR_BUSINESS_ID`

## 4) Estado actual del proyecto

### Que funciona
- Frontend principal con autenticacion y panel (dashboard, clientes, equipo, calendario, campanas, chat).
- Integracion Firebase Web SDK (Auth + Firestore).
- Cloud Functions desplegadas: `generateCampaign`, `chatWithAI`, `whatsappWebhook`.
- Generacion de campanas con IA via endpoint `generateCampaign`.
- Chat IA en `chat.js` con contexto de Firebase y creacion de ordenes desde conversacion.
- Flujo WhatsApp/Twilio con respuesta TwiML y registro de leads/pedidos cuando aplica.

### Que esta pendiente
- Migrar runtime/dependencias de Functions segun advertencias (Node 20 deprecado y `firebase-functions` outdated).
- Definir lint real en `functions` (actualmente script placeholder).
- Completar/activar modulos marcados como coming soon (p. ej. editor de campana).
- Endurecer manejo de secretos locales (`.env`) y documentacion operativa.
- Validacion funcional end-to-end periodica despues de cada deploy.

## 5) URLs del proyecto y Firebase

- https://console.firebase.google.com/project/clientflow-ai-7eb08/overview
- https://us-central1-clientflow-ai-7eb08.cloudfunctions.net/whatsappWebhook
- https://whatsappwebhook-5laxqi2i4q-uc.a.run.app
- https://chatwithai-5laxqi2i4q-uc.a.run.app
- https://generatecampaign-5laxqi2i4q-uc.a.run.app
- https://clientflow-ai-7eb08.firebaseapp.com

## 6) Comandos importantes usados hasta hoy

- `firebase deploy --only functions`
- `firebase functions:list`
- `firebase functions:log --only whatsappWebhook`
- `npm --prefix functions run lint`
- `npm --prefix functions install`
- `node test-claude.mjs`
- `node set-key-mjs`
- `node campanas-ai-generator.js`
- `git add`
- `git push`