import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

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

function normalizeBusinessProfile(raw, businessName) {
  const profile = raw && typeof raw === "object" ? raw : {};
  const services = Array.isArray(profile.services) ? profile.services : [];
  return {
    ...profile,
    businessName: asText(profile.businessName || businessName, "Tu negocio"),
    services,
    serviceArea: asText(profile.serviceArea, "No especificado"),
  };
}

function buildSystemPrompt(businessName, businessProfile) {
  const profile = normalizeBusinessProfile(businessProfile, businessName);
  return `
Eres un experto en marketing digital para negocios locales y conoces el negocio del usuario.
Debes generar campanas hiper-especificas para ESTE negocio, evitando mensajes genericos.

Perfil del negocio (fuente: Firebase):
- businessName: ${profile.businessName}
- services: ${profile.services.length ? profile.services.join(", ") : "No especificado"}
- serviceArea: ${profile.serviceArea}
- businessProfileFullJson: ${JSON.stringify(profile)}

Usa el perfil y el contexto del usuario para adaptar tono, propuesta de valor, enfoque de plataforma, presupuesto y creatividad.
Responde de forma accionable y concreta.
`.trim();
}

function buildUserPrompt(inputs, businessName) {
  return `
Genera una propuesta de campana para este negocio local:

- businessName: ${asText(businessName, "Tu negocio")}
- goal: ${asText(inputs?.goal, "No especificado")}
- offer: ${asText(inputs?.offer, "No especificado")}
- location: ${asText(inputs?.location, "No especificado")}
- budget: ${asText(inputs?.budget, "No especificado")}
- audience: ${asText(inputs?.audience, "No especificado")}

Responde SOLO en JSON valido con estas llaves exactas:
headline, hook, bodyText, cta, platform, suggestedBudgetWeekly, estimatedLeadsWeekly, creativeIdea
`.trim();
}

app.post("/api/campaign", async (req, res) => {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing ANTHROPIC_API_KEY in server environment." });
    }

    const { inputs = {}, businessName = "", businessProfile = {} } = req.body || {};

    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1000,
        system: buildSystemPrompt(businessName, businessProfile),
        messages: [{ role: "user", content: buildUserPrompt(inputs, businessName) }],
      }),
    });

    const anthropicBody = await anthropicResponse.json();
    if (!anthropicResponse.ok) {
      const errorMessage =
        asText(anthropicBody?.error?.message) || "Anthropic API request failed.";
      return res.status(anthropicResponse.status).json({ error: errorMessage, details: anthropicBody });
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

    return res.json({
      headline: asText(parsed.headline),
      hook: asText(parsed.hook),
      bodyText: asText(parsed.bodyText),
      cta: asText(parsed.cta),
      platform: asText(parsed.platform),
      suggestedBudgetWeekly: asNumber(parsed.suggestedBudgetWeekly),
      estimatedLeadsWeekly: asNumber(parsed.estimatedLeadsWeekly),
      creativeIdea: asText(parsed.creativeIdea),
    });
  } catch (error) {
    return res.status(500).json({
      error: "Server error generating campaign.",
      details: asText(error?.message, "Unknown error"),
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
