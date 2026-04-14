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

export async function generateCampaignWithClaude(inputs, businessName, businessProfileRaw = {}) {
  const response = await fetch("/api/campaign", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      inputs,
      businessName,
      businessProfile: businessProfileRaw,
    }),
  });

  const responseBody = await response.json();

  if (!response.ok) {
    const errorMessage =
      asText(responseBody?.error?.message) || "Anthropic API request failed.";
    throw new Error(errorMessage);
  }

  const textContent = Array.isArray(responseBody?.content)
    ? responseBody.content
        .filter((item) => item?.type === "text")
        .map((item) => item?.text || "")
        .join("\n")
    : "";

  const parsed = extractJsonObject(textContent);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Claude response did not include valid JSON output.");
  }

  return {
    headline: asText(parsed.headline),
    hook: asText(parsed.hook),
    bodyText: asText(parsed.bodyText),
    cta: asText(parsed.cta),
    platform: asText(parsed.platform),
    suggestedBudgetWeekly: asNumber(parsed.suggestedBudgetWeekly),
    estimatedLeadsWeekly: asNumber(parsed.estimatedLeadsWeekly),
    creativeIdea: asText(parsed.creativeIdea),
  };
}
