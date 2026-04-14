import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";

const MODEL = "claude-sonnet-4-20250514";
const ANTHROPIC_KEY = defineSecret("ANTHROPIC_KEY");

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

function buildSystemPrompt(profile) {
  const businessName = asText(profile.businessName, "Tu negocio");
  const services = Array.isArray(profile.services) ? profile.services : [];
  const serviceArea = asText(profile.serviceArea, "No especificado");

  return `
Eres un experto en marketing digital para negocios locales y conoces el negocio del usuario.
Debes generar campanas hiper-especificas para ESTE negocio, evitando mensajes genericos.

Perfil del negocio (fuente: Firebase):
- businessName: ${businessName}
- services: ${services.length ? services.join(", ") : "No especificado"}
- serviceArea: ${serviceArea}
- businessProfileFullJson: ${JSON.stringify(profile)}

Responde SOLO con JSON valido y accionable.
`.trim();
}

function buildUserPrompt(input, businessName) {
  return `
Genera una propuesta de campana para este negocio local:

- businessName: ${asText(businessName, "Tu negocio")}
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
  { secrets: [ANTHROPIC_KEY], cors: true },
  async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST");
  res.set("Access-Control-Allow-Headers", "Content-Type");

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
        system: buildSystemPrompt(businessProfile),
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
