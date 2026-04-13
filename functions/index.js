import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import OpenAI from "openai";

const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
const ALLOWED_ORIGINS = defineSecret("ALLOWED_ORIGINS");

const MODEL = "gpt-4o-mini";
const MAX_FIELD_LEN = 500;
const PLATFORM_SET = new Set(["facebook", "instagram", "google"]);

function sanitizeText(value, maxLen = MAX_FIELD_LEN) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

function sanitizeServices(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => sanitizeText(item, 80))
    .filter(Boolean)
    .slice(0, 20);
}

function sanitizeBudget(value) {
  const raw = String(value ?? "").replace(/[^\d.]/g, "");
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

function parseAndValidatePayload(raw) {
  const payload = raw && typeof raw === "object" ? raw : {};
  const cleaned = {
    businessType: sanitizeText(payload.businessType, 120),
    services: sanitizeServices(payload.services),
    location: sanitizeText(payload.location, 160),
    audience: sanitizeText(payload.audience, 200),
    branding: sanitizeText(payload.branding, 260),
    budget: sanitizeBudget(payload.budget),
    campaignGoal: sanitizeText(payload.campaignGoal, 240),
  };

  const missing = [];
  if (!cleaned.businessType) missing.push("businessType");
  if (!cleaned.services.length) missing.push("services");
  if (!cleaned.location) missing.push("location");
  if (!cleaned.audience) missing.push("audience");
  if (!cleaned.branding) missing.push("branding");
  if (!cleaned.budget) missing.push("budget");
  if (!cleaned.campaignGoal) missing.push("campaignGoal");

  if (missing.length) {
    throw new Error(`Missing or invalid fields: ${missing.join(", ")}`);
  }

  return cleaned;
}

function buildMessages(input) {
  const systemPrompt = [
    "You are a senior paid-marketing strategist for local service businesses.",
    "Return ONLY valid JSON. No markdown, no prose, no code fences.",
    "Output must follow this exact object shape:",
    "{",
    '  "headline": "",',
    '  "description": "",',
    '  "cta": "",',
    '  "recommendedPlatform": "",',
    '  "recommendedBudget": "",',
    '  "strategy": "",',
    '  "visualIdeas": [],',
    '  "photoSuggestions": [],',
    '  "videoSuggestions": [],',
    '  "estimatedLeads": "",',
    '  "estimatedReach": ""',
    "}",
    "recommendedPlatform must be one of: facebook, instagram, google.",
    "visualIdeas/photoSuggestions/videoSuggestions: each 3 concise bullet-like strings.",
    "recommendedBudget, estimatedLeads, estimatedReach must be numeric strings only.",
  ].join("\n");

  const userPrompt = [
    "Create one high-conversion campaign brief.",
    `Business type: ${input.businessType}`,
    `Services: ${input.services.join(", ")}`,
    `Location: ${input.location}`,
    `Audience: ${input.audience}`,
    `Branding: ${input.branding}`,
    `Budget (weekly, USD): ${input.budget}`,
    `Campaign goal: ${input.campaignGoal}`,
    "Keep messaging clear, professional, and action-oriented.",
  ].join("\n");

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
}

function parseOpenAIJson(content) {
  const text = sanitizeText(content, 10000);
  if (!text) throw new Error("AI returned empty response.");
  return JSON.parse(text);
}

function sanitizeList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => sanitizeText(item, 180)).filter(Boolean).slice(0, 5);
}

function numericString(value, fallback) {
  const num = Number.parseFloat(String(value ?? "").replace(/[^\d.]/g, ""));
  if (!Number.isFinite(num) || num < 0) return String(fallback);
  return String(Math.round(num));
}

function sanitizeAiObject(raw, fallbackBudget) {
  const obj = raw && typeof raw === "object" ? raw : {};
  const out = {
    headline: sanitizeText(obj.headline, 140),
    description: sanitizeText(obj.description, 700),
    cta: sanitizeText(obj.cta, 80),
    recommendedPlatform: sanitizeText(obj.recommendedPlatform, 20).toLowerCase(),
    recommendedBudget: numericString(obj.recommendedBudget, fallbackBudget),
    strategy: sanitizeText(obj.strategy, 700),
    visualIdeas: sanitizeList(obj.visualIdeas),
    photoSuggestions: sanitizeList(obj.photoSuggestions),
    videoSuggestions: sanitizeList(obj.videoSuggestions),
    estimatedLeads: numericString(obj.estimatedLeads, 0),
    estimatedReach: numericString(obj.estimatedReach, 0),
  };

  if (!PLATFORM_SET.has(out.recommendedPlatform)) {
    out.recommendedPlatform = "facebook";
  }
  if (!out.headline) throw new Error("AI response missing headline.");
  if (!out.description) throw new Error("AI response missing description.");
  if (!out.cta) throw new Error("AI response missing cta.");
  if (!out.strategy) {
    out.strategy = "Segment by intent, optimize creatives weekly, and monitor CPL by platform.";
  }
  if (!out.visualIdeas.length) {
    out.visualIdeas = ["Before/after transformation", "Benefit-focused text overlay", "Local trust badge"];
  }
  if (!out.photoSuggestions.length) {
    out.photoSuggestions = ["Team at work on-site", "Service close-up detail", "Satisfied customer moment"];
  }
  if (!out.videoSuggestions.length) {
    out.videoSuggestions = ["15s problem-solution reel", "Quick testimonial clip", "Service process timelapse"];
  }
  return out;
}

function applyCors(req, res, allowedOriginsCsv) {
  const origin = String(req.headers.origin || "");
  const allowed = String(allowedOriginsCsv || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  if (!allowed.length || allowed.includes("*")) {
    res.set("Access-Control-Allow-Origin", origin || "*");
  } else if (allowed.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
  }

  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function generateCampaignFromOpenAI(input, openAiKey) {
  const client = new OpenAI({ apiKey: openAiKey });
  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: buildMessages(input),
  });
  const content = completion.choices?.[0]?.message?.content || "";
  const parsed = parseOpenAIJson(content);
  return sanitizeAiObject(parsed, input.budget);
}

export const generateCampaign = onRequest(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB", secrets: [OPENAI_API_KEY, ALLOWED_ORIGINS] },
  async (req, res) => {
    applyCors(req, res, ALLOWED_ORIGINS.value());
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed. Use POST." });
      return;
    }

    try {
      const payload = parseAndValidatePayload(req.body);
      const apiKey = OPENAI_API_KEY.value();
      if (!apiKey) {
        logger.error("OPENAI_API_KEY is not configured.");
        res.status(500).json({ error: "Server AI configuration is missing." });
        return;
      }

      const campaign = await generateCampaignFromOpenAI(payload, apiKey);
      res.status(200).json(campaign);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      const isInputError = /Missing or invalid fields|missing/i.test(message);
      logger.error("generateCampaign failed", { message });
      res.status(isInputError ? 400 : 502).json({
        error: isInputError ? message : "Failed to generate campaign with AI provider.",
      });
    }
  },
);
